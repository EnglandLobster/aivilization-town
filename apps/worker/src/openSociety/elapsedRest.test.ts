import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { OpenSocietyRuntime } from './runtime';
import { createOpenSocietyManifest } from './manifest';
const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const f of cleanup.reverse()) f();
  cleanup.length = 0;
});
function setup(elapsedRest = false) {
  const root = mkdtempSync(join(tmpdir(), 'resident-elapsed-rest-'));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const manifest = createOpenSocietyManifest({ count: 2, continuity: true, elapsedRest });
  const [a, b] = manifest.residents.map((x) => x.id) as [string, string];
  const r = new OpenSocietyRuntime(root, {
    ...manifest,
    initialWorld: {
      ...manifest.initialWorld,
      agents: {
        ...manifest.initialWorld.agents,
        [a]: {
          ...manifest.initialWorld.agents[a]!,
          physiology: { energy: 20, satiety: 90, health: 90 },
        },
      },
    },
  });
  cleanup.push(() => r.close());
  let n = 0;
  const call = (actor: string, name: string, args: Record<string, unknown>) => {
    r.beginTurn(actor);
    const result = r.invoke(actor, { name, arguments: args, requestId: `test-${++n}` });
    r.finishTurn(actor, { summary: 'test' });
    return result;
  };
  const replay = () => {
    const state = structuredClone(r.state),
      bytes = readFileSync(join(root, 'journal.jsonl'));
    r.close();
    const reopened = new OpenSocietyRuntime(root);
    cleanup.push(() => reopened.close());
    expect(reopened.state).toEqual(state);
    expect(readFileSync(join(root, 'journal.jsonl'))).toEqual(bytes);
    return reopened;
  };
  return { r, a, b, call, replay };
}
test('explicit activation persists; own bounded context and action query expose interruption without revealing another body', () => {
  const t = setup();
  expect(t.r.state.world.residentRest).toBeUndefined();
  const enabled = t.r.enableElapsedRest();
  expect(enabled.ok).toBe(true);
  expect(t.r.enableElapsedRest()).toEqual(enabled);
  const before = t.r.state.world.agents[t.a]!.physiology.energy;
  expect(t.call(t.a, 'world.sleep', { durationSeconds: 3600 }).ok).toBe(true);
  expect(t.r.state.world.agents[t.a]!.physiology.energy).toBe(before);
  const active = t.r.context(t.a).action.rest!.active!;
  expect(active.elapsedMs).toBe(0);
  expect(t.r.context(t.b).action.rest!.active).toBeNull();
  expect(
    t.call(t.b, 'world.stop_rest', { id: active.id, expectedRevision: active.revision }).error,
  ).toBe('own-rest-required');
  expect(t.r.advanceTime(120000, 'time').ok).toBe(true);
  const settled = t.r.context(t.a).action.rest!.active!;
  expect(settled.elapsedMs).toBe(120000);
  expect(t.r.state.world.agents[t.a]!.physiology.energy).toBeGreaterThan(before);
  const observation = t.call(t.a, 'world.observe', { view: 'action' });
  expect(observation.data).toMatchObject({ rest: { active: settled } });
  expect(
    t.call(t.a, 'world.stop_rest', { id: active.id, expectedRevision: active.revision }).error,
  ).toBe('rest-revision-conflict');
  expect(
    t.call(t.a, 'world.stop_rest', { id: settled.id, expectedRevision: settled.revision }).ok,
  ).toBe(true);
  expect(t.r.context(t.a).action.rest!.active).toBeNull();
  expect(t.r.state.world.activityTimeByAgent[t.a]!.availableAt).toBe(t.r.state.world.clock.now);
  expect(t.r.state.world.residentRest!.sessions[settled.id]!.elapsedMs).toBe(120000);
  expect(t.replay().enableElapsedRest()).toEqual(enabled);
});
test('fresh opted-in manifests record policy provenance; legacy mode stays upfront and cannot migrate prepaid active time', () => {
  const manifest = createOpenSocietyManifest({ continuity: true, elapsedRest: true });
  expect(manifest.provenance.elapsedRest).toBe('resident-rest-v1');
  expect(manifest.initialWorld.residentRest!.policy.physiologyVersion).toBe(
    'resident-elapsed-physiology-v1',
  );
  const t = setup();
  expect(t.call(t.a, 'world.sleep', { durationSeconds: 120 }).ok).toBe(true);
  expect(t.r.state.world.agents[t.a]!.physiology.energy).toBeGreaterThan(20);
  expect(t.r.enableElapsedRest().error).toBe('rest-activation-requires-no-active-prepaid-effects');
  expect(t.r.state.world.residentRest).toBeUndefined();
  expect(t.r.advanceTime(120000, 'time').ok).toBe(true);
  expect(t.r.enableElapsedRest().ok).toBe(true);
  t.replay();
});
