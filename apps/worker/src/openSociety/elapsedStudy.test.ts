import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { asLocationId } from '@aivilization/sim-core';
import { afterEach, expect, test } from 'vitest';
import { OpenSocietyRuntime } from './runtime';
import { createOpenSocietyManifest, serializableWorldPolicy } from './manifest';
const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const f of cleanup.reverse()) f();
  cleanup.length = 0;
});
function fixture(enabled = true) {
  const root = mkdtempSync(join(tmpdir(), 'actual-study-'));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const m = createOpenSocietyManifest({
    count: 2,
    continuity: true,
    elapsedRest: true,
    elapsedStudy: enabled,
    initialization: 'newcomers',
  });
  const world = {
    ...m.initialWorld,
    agents: Object.fromEntries(
      Object.entries(m.initialWorld.agents).map(([id, a]) => [
        id,
        {
          ...a,
          locationId: asLocationId('school'),
          educationScore: 0,
          educationLevel: 0 as const,
          job: null,
          physiology: { energy: 100, satiety: 100, health: 100 },
        },
      ]),
    ),
  };
  const r = new OpenSocietyRuntime(root, {
    ...m,
    initialWorld: world,
    worldPolicies: serializableWorldPolicy(m.seed, world, m.rhythm),
  });
  cleanup.push(() => r.close());
  const [a, b] = m.residents.map((x) => x.id) as [string, string];
  let n = 0;
  const call = (actor: string, name: string, args: Record<string, unknown>) => {
    r.beginTurn(actor);
    const result = r.invoke(actor, { name, arguments: args, requestId: `study-${++n}` });
    r.finishTurn(actor, { summary: 'Engineering study verification' });
    return result;
  };
  const replay = () => {
    const state = structuredClone(r.state),
      bytes = readFileSync(join(root, 'journal.jsonl'));
    r.close();
    const next = new OpenSocietyRuntime(root);
    cleanup.push(() => next.close());
    expect(next.state).toEqual(state);
    expect(readFileSync(join(root, 'journal.jsonl'))).toEqual(bytes);
  };
  return { root, r, a, b, call, replay };
}
test('real study context/CLI shows own actual progress and source, stop refunds unused tuition, history stays private and replay is exact', () => {
  const t = fixture();
  const start = t.call(t.a, 'world.study', { durationSeconds: 3600 });
  expect(start.ok, start.error).toBe(true);
  expect(t.r.state.world.agents[t.a]!.educationScore).toBe(0);
  const active = t.r.context(t.a).action.study!.active!;
  expect(active.elapsedMs).toBe(0);
  expect(t.r.context(t.b).action.study!.active).toBeNull();
  expect(t.call(t.b, 'world.observe', { view: 'study', section: active.id }).error).toBe(
    'own-study-not-found',
  );
  expect(t.call(t.a, 'world.observe', { view: 'rules', section: 'study' }).data).toMatchObject({
    source: { provider: 'scenario-or-external-not-a-resident-teacher' },
  });
  expect(t.r.advanceTime(900000, 'time').ok).toBe(true);
  const current = t.r.context(t.a).action.study!.active!;
  expect(current.elapsedMs).toBe(900000);
  expect(current.actualLearning).toBe(15);
  expect(
    t.call(t.a, 'world.stop_study', { id: active.id, expectedRevision: active.revision }).error,
  ).toBe('study-revision-conflict');
  expect(
    t.call(t.a, 'world.stop_study', { id: current.id, expectedRevision: current.revision }).ok,
  ).toBe(true);
  expect(t.r.context(t.a).action.study!.active).toBeNull();
  expect(t.call(t.a, 'world.observe', { view: 'study', section: active.id }).data).toMatchObject({
    status: 'interrupted',
    elapsedMs: 900000,
  });
  expect(t.call(t.a, 'world.observe', { view: 'study', limit: 1 }).data).toMatchObject({
    total: 1,
    items: [{ id: active.id }],
  });
  t.replay();
});
test('explicit runtime activation is idempotent, keeps old manifest bytes and exposes versioned source provenance in new manifests', () => {
  const t = fixture(false);
  const bytes = readFileSync(join(t.root, 'manifest.json'));
  const enabled = t.r.enableElapsedStudy();
  expect(enabled.ok).toBe(true);
  expect(t.r.enableElapsedStudy()).toEqual(enabled);
  expect(readFileSync(join(t.root, 'manifest.json'))).toEqual(bytes);
  t.replay();
  const m = createOpenSocietyManifest({ continuity: true, elapsedRest: true, elapsedStudy: true });
  expect(m.provenance.elapsedStudy).toBe('resident-elapsed-study-v1');
  expect(m.provenance.studySource).toBe('scenario-education-course-v1');
  expect(() => createOpenSocietyManifest({ continuity: true, elapsedStudy: true })).toThrow(
    'invalid-elapsed-study-configuration',
  );
});
