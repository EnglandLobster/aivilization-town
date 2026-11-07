import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import type { createOpenSocietyManifest } from './manifest';
import {
  INTERDEPENDENT_ECONOMY,
  TOWN_INTERDEPENDENT_PROFILE,
  TOWN_PROFILE,
  createTownManifest,
  isTownProfile,
} from './runProfile';
import { OpenSocietyRuntime } from './runtime';

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const close of cleanup.reverse()) close();
  cleanup.length = 0;
});
function open(
  manifest: ReturnType<typeof createOpenSocietyManifest> = createTownManifest({ count: 2 }),
) {
  const root = mkdtempSync(join(tmpdir(), 'society-profile-'));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const runtime = new OpenSocietyRuntime(root, manifest);
  cleanup.push(() => runtime.close());
  let sequence = 0;
  const actor = manifest.residents[0]!.id;
  const call = (name: string, args: Record<string, unknown>) => {
    runtime.beginTurn(actor);
    const result = runtime.invoke(actor, {
      name,
      arguments: args,
      requestId: `profile-${++sequence}`,
    });
    runtime.finishTurn(actor, { summary: 'Engineering profile verification' });
    return result;
  };
  return { root, runtime, actor, call };
}

test('the town opens, residents work and study over real time, and the journal replays exactly', () => {
  const t = open();
  expect(t.runtime.manifest.provenance.runProfile).toBe(TOWN_PROFILE);
  expect(t.runtime.manifest.policy.messageWake?.version).toBe('resident-message-pacing-v1');
  expect(t.runtime.manifest.policy.actionPlans?.version).toBe('resident-action-plans-v2');
  expect(t.runtime.state.collectives!.charters).toEqual({});
  expect(t.runtime.state.coordination!.programs).toEqual({});
  for (const [name, args] of [
    ['world.observe', { view: 'labor' }],
    ['world.observe', { view: 'study' }],
  ] as const) {
    const result = t.call(name, args);
    expect(result.ok, result.error).toBe(true);
  }
  expect(t.call('rules.capability', { name: 'world.observe' }).data).toMatchObject({
    policySources: { runProfile: TOWN_PROFILE },
  });
  const travel = t.call('world.move', { targetLocationId: 'school' });
  expect(travel.ok, travel.error).toBe(true);
  const arrival = t.runtime.state.world.activityTimeByAgent[t.actor]!.availableAt;
  expect(t.runtime.advanceTime(arrival - t.runtime.state.world.clock.now, 'arrive').ok).toBe(true);
  const study = t.call('world.study', { durationSeconds: 3600 });
  expect(study.ok, study.error).toBe(true);
  expect(t.runtime.advanceTime(900000, 'profile-cadence').ok).toBe(true);
  expect(t.runtime.context(t.actor).action.study!.active!.elapsedMs).toBe(900000);
  expect(t.runtime.context(t.actor).action.study!.active!.actualLearning).toBeGreaterThan(0);
  const state = structuredClone(t.runtime.state);
  const manifest = readFileSync(join(t.root, 'manifest.json'));
  const journal = readFileSync(join(t.root, 'journal.jsonl'));
  t.runtime.close();
  const replay = new OpenSocietyRuntime(t.root);
  cleanup.push(() => replay.close());
  expect(replay.state).toEqual(state);
  expect(readFileSync(join(t.root, 'manifest.json'))).toEqual(manifest);
  expect(readFileSync(join(t.root, 'journal.jsonl'))).toEqual(journal);
});

test('a town keeps its manifest and unknown profiles are rejected', () => {
  expect(isTownProfile(TOWN_PROFILE)).toBe(true);
  expect(isTownProfile('society-integrated-v4')).toBe(false);
  expect(() => {
    Reflect.apply(createTownManifest, undefined, [{ profile: 'unknown' }]);
  }).toThrow('invalid-town-profile');
  const t = open(),
    state = structuredClone(t.runtime.state),
    manifest = readFileSync(join(t.root, 'manifest.json'));
  t.runtime.close();
  expect(
    () =>
      new OpenSocietyRuntime(
        t.root,
        createTownManifest({ count: 2, profile: TOWN_INTERDEPENDENT_PROFILE }),
      ),
  ).toThrow('manifest-seed-mismatch');
  const reopened = new OpenSocietyRuntime(t.root);
  cleanup.push(() => reopened.close());
  expect(reopened.state).toEqual(state);
  expect(readFileSync(join(t.root, 'manifest.json'))).toEqual(manifest);
});

test('the interdependent town differs only in its economy', () => {
  const input = { count: 2, seed: 'profile-fixture' };
  const town = createTownManifest(input),
    interdependent = createTownManifest({ ...input, profile: TOWN_INTERDEPENDENT_PROFILE });
  expect(interdependent.provenance).toMatchObject({
    runProfile: TOWN_INTERDEPENDENT_PROFILE,
    economyShape: 'open-society-economy-shape-v1',
    materialExpertise: 'resident-learning-by-doing-v1',
    materialRegrowth: 'material-source-regrowth-v1',
  });
  expect(interdependent.initialWorld.treasury).toBe(INTERDEPENDENT_ECONOMY.treasury);
  expect(Object.keys(interdependent.initialWorld.marketPools).length).toBeLessThan(
    Object.keys(town.initialWorld.marketPools).length,
  );
  expect(interdependent.initialWorld.agents).toEqual(town.initialWorld.agents);
  expect(interdependent.policy).toEqual(town.policy);
  expect(interdependent.residents).toEqual(town.residents);
});
