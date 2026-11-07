import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { OpenSocietyRuntime } from './runtime';
import { createOpenSocietyManifest } from './manifest';
const clean: (() => void)[] = [];
afterEach(() => {
  for (const f of clean.reverse()) f();
  clean.length = 0;
});
function fixture(enabled = false) {
  const root = mkdtempSync(join(tmpdir(), 'housing-choice-'));
  clean.push(() => rmSync(root, { recursive: true, force: true }));
  const m = createOpenSocietyManifest({
    count: 2,
    continuity: true,
    elapsedRest: true,
    housingChoice: enabled,
  });
  const [a, b] = m.residents.map((r) => r.id) as [string, string];
  const r = new OpenSocietyRuntime(root, {
    ...m,
    initialWorld: {
      ...m.initialWorld,
      agents: {
        ...m.initialWorld.agents,
        [a]: { ...m.initialWorld.agents[a]!, residentialTier: 3, upkeepArrears: 17 },
      },
    },
  });
  clean.push(() => r.close());
  let n = 0;
  const call = (actor: string, name: string, args: Record<string, unknown> = {}) => {
    r.beginTurn(actor);
    const result = r.invoke(actor, { name, arguments: args, requestId: `housing-test-${++n}` });
    r.finishTurn(actor, { summary: 'Directed housing choice verification' });
    return result;
  };
  const replay = () => {
    const before = structuredClone(r.state),
      bytes = readFileSync(join(root, 'journal.jsonl'));
    r.close();
    const next = new OpenSocietyRuntime(root);
    clean.push(() => next.close());
    expect(next.state).toEqual(before);
    expect(readFileSync(join(root, 'journal.jsonl'))).toEqual(bytes);
  };
  return { root, r, a, b, call, replay };
}
test('personal choice preserves arrears, private space and body while bounded queries expose the real source', () => {
  const t = fixture(true),
    original = readFileSync(join(t.root, 'manifest.json'));
  expect(t.r.context(t.a).self).toHaveProperty('housingStandardWith', 'town housing standard');
  const query = t.call(t.a, 'housing.standard', { limit: 1 });
  expect(query.ok).toBe(true);
  expect(query.data).toMatchObject({
    revision: 1,
    personalStandard: 3,
    upkeepArrears: 17,
    standards: { items: [{ tier: 1, lowerSelectable: true }], total: 6 },
  });
  const own = structuredClone(t.r.state.world.agents[t.a]),
    other = structuredClone(t.r.state.world.agents[t.b]),
    spaces = structuredClone(t.r.state.world.locations),
    money = t.r.state.world.moneySupply;
  expect(
    t.call(t.b, 'housing.lower', { actorId: t.a, targetTier: 1, expectedRevision: 1 }).ok,
  ).toBe(false);
  expect(t.call(t.b, 'housing.standard', { actorId: t.a }).ok).toBe(false);
  expect(t.call(t.a, 'housing.lower', { targetTier: 1, expectedRevision: 1 }).ok).toBe(true);
  expect(t.r.state.world.agents[t.a]).toEqual({ ...own, residentialTier: 1 });
  expect(t.r.state.world.agents[t.b]).toEqual(other);
  expect(t.r.state.world.locations).toEqual(spaces);
  expect(t.r.state.world.moneySupply).toBe(money);
  expect(t.call(t.a, 'housing.lower', { targetTier: 1, expectedRevision: 1 }).error).toBe(
    'housing-choice-revision-conflict',
  );
  expect(t.call(t.a, 'housing.lower', { targetTier: 2, expectedRevision: 2 }).error).toBe(
    'housing-choice-requires-lower-standard',
  );
  expect(readFileSync(join(t.root, 'manifest.json'))).toEqual(original);
  t.replay();
});
test('choosing a new standard requires ending an active physical commitment through its own path, never rewriting its frozen recovery', () => {
  const t = fixture(true);
  expect(t.call(t.a, 'world.sleep', { durationSeconds: 3600 }).ok).toBe(true);
  const rest = t.r.context(t.a).action.rest!.active!;
  const before = structuredClone(t.r.state.world);
  expect(t.call(t.a, 'housing.lower', { targetTier: 1, expectedRevision: 1 }).error).toBe(
    'housing-choice-requires-no-active-physical-commitment',
  );
  expect(t.r.state.world).toEqual(before);
  expect(t.call(t.a, 'world.stop_rest', { id: rest.id, expectedRevision: rest.revision }).ok).toBe(
    true,
  );
  expect(t.call(t.a, 'housing.lower', { targetTier: 1, expectedRevision: 1 }).ok).toBe(true);
  expect(t.r.state.world.agents[t.a]!.upkeepArrears).toBe(17);
  t.replay();
});
