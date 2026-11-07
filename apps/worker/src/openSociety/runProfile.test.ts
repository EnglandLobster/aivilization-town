import {
  INTEGRATED_SOCIETY_PROFILE_V2,
  INTEGRATED_SOCIETY_PROFILE_V3,
  INTEGRATED_SOCIETY_PROFILE_V4,
  INTERDEPENDENT_SOCIETY_PROFILE_V2,
  INTERDEPENDENT_SOCIETY_PROFILE_V3,
  isIntegratedSocietyProfile,
} from './runProfile';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { createOpenSocietyManifest } from './manifest';
import { createIntegratedSocietyManifest, INTEGRATED_SOCIETY_PROFILE } from './runProfile';
import { OpenSocietyRuntime } from './runtime';

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const close of cleanup.reverse()) close();
  cleanup.length = 0;
});
function open(
  manifest: ReturnType<typeof createOpenSocietyManifest> = createIntegratedSocietyManifest({
    count: 2,
  }),
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

test('integrated release opens actual runtime, exposes enabled labor/service ports and preserves full replay', () => {
  const t = open();
  expect(t.runtime.state.collectives!.charters).toEqual({});
  expect(t.runtime.state.coordination!.programs).toEqual({});
  expect(t.runtime.state.coordination!.mandates).toEqual({});
  for (const [name, args] of [
    ['world.observe', { view: 'labor' }],
    ['business.services', {}],
    ['world.observe', { view: 'study' }],
  ] as const) {
    const result = t.call(name, args);
    expect(result.ok, result.error).toBe(true);
  }
  const capability = t.call('rules.capability', { name: 'business.services' });
  expect(capability.data).toMatchObject({
    policySources: { runProfile: INTEGRATED_SOCIETY_PROFILE },
  });
  const travel = t.call('world.move', { targetLocationId: 'school' });
  expect(travel.ok, travel.error).toBe(true);
  const arrival = t.runtime.state.world.activityTimeByAgent[t.actor]!.availableAt;
  expect(t.runtime.advanceTime(arrival - t.runtime.state.world.clock.now, 'arrive').ok).toBe(true);
  const score = t.runtime.state.world.agents[t.actor]!.educationScore;
  const study = t.call('world.study', { durationSeconds: 3600 });
  expect(study.ok, study.error).toBe(true);
  expect(t.runtime.state.world.agents[t.actor]!.educationScore).toBe(score);
  expect(t.runtime.context(t.actor).action.study!.active!.elapsedMs).toBe(0);
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

test('old defaults retain disabled semantics and cannot be implicitly upgraded by a new profile', () => {
  const legacy = createOpenSocietyManifest({ count: 2, continuity: true });
  const t = open(legacy);
  expect(t.call('business.services', {}).error).toBe('service-employment-not-enabled');
  expect(t.call('world.observe', { view: 'labor' }).error).toBe('resident-labor-not-enabled');
  expect(t.runtime.manifest.provenance.runProfile).toBeUndefined();
  const manifest = readFileSync(join(t.root, 'manifest.json'));
  const state = structuredClone(t.runtime.state);
  t.runtime.close();
  expect(
    () => new OpenSocietyRuntime(t.root, createIntegratedSocietyManifest({ count: 2 })),
  ).toThrow('manifest-seed-mismatch');
  const reopened = new OpenSocietyRuntime(t.root);
  cleanup.push(() => reopened.close());
  expect(reopened.state).toEqual(state);
  expect(readFileSync(join(t.root, 'manifest.json'))).toEqual(manifest);
});

test('v2 explicitly enables empty construction procurement without manufacturing organizations, projects, funds or old-profile authority', () => {
  const input = { count: 2, seed: 'profile-version-fixture' };
  const v1 = createIntegratedSocietyManifest(input),
    v2 = createIntegratedSocietyManifest({ ...input, profile: INTEGRATED_SOCIETY_PROFILE_V2 });
  expect(v1.provenance.runProfile).toBe(INTEGRATED_SOCIETY_PROFILE);
  expect(v1.initialWorld.residentTrade?.constructionOrders).toBeUndefined();
  expect(v1.initialWorld.publicGovernance?.authority.grant.constructionTrade).toBeUndefined();
  expect(v2.provenance).toMatchObject({
    runProfile: INTEGRATED_SOCIETY_PROFILE_V2,
    constructionTrade: 'construction-trade-v1',
  });
  expect(v2.initialWorld.residentTrade?.constructionOrders?.orders).toEqual({});
  expect(v2.initialWorld.publicGovernance?.authority.grant.constructionTrade?.version).toBe(
    'public-construction-trade-v1',
  );
  expect(v2.initialWorld.agents).toEqual(v1.initialWorld.agents);
  expect(v2.initialWorld.premises).toEqual(v1.initialWorld.premises);
  expect(v2.initialWorld.moneySupply).toBe(v1.initialWorld.moneySupply);
  expect(v2.initialWorld.treasury).toBe(v1.initialWorld.treasury);
  const t = open(v2);
  expect(t.call('rules.read', { id: 'construction-procurement' }).data).toMatchObject({
    enabled: true,
  });
  expect(t.runtime.advanceTime(900000, 'v2-cadence').ok).toBe(true);
  const state = structuredClone(t.runtime.state),
    bytes = readFileSync(join(t.root, 'journal.jsonl'));
  t.runtime.close();
  const reopened = new OpenSocietyRuntime(t.root);
  cleanup.push(() => reopened.close());
  expect(reopened.state).toEqual(state);
  expect(readFileSync(join(t.root, 'journal.jsonl'))).toEqual(bytes);
});
test('v2 cannot silently upgrade an existing v1 world and unknown profiles are rejected', () => {
  expect(isIntegratedSocietyProfile('society-integrated-v99')).toBe(false);
  expect(isIntegratedSocietyProfile('society-integrated-v3')).toBe(true);
  expect(() => {
    Reflect.apply(createIntegratedSocietyManifest, undefined, [{ profile: 'unknown' }]);
  }).toThrow('invalid-integrated-society-profile');
  const t = open(),
    initial = structuredClone(t.runtime.state),
    manifest = readFileSync(join(t.root, 'manifest.json'));
  t.runtime.close();
  expect(
    () =>
      new OpenSocietyRuntime(
        t.root,
        createIntegratedSocietyManifest({ count: 2, profile: INTEGRATED_SOCIETY_PROFILE_V2 }),
      ),
  ).toThrow('manifest-seed-mismatch');
  const reopened = new OpenSocietyRuntime(t.root);
  cleanup.push(() => reopened.close());
  expect(reopened.state).toEqual(initial);
  expect(readFileSync(join(t.root, 'manifest.json'))).toEqual(manifest);
});
test('plan profiles add only resident action plans to their predecessors', () => {
  for (const [before, after] of [
    [INTEGRATED_SOCIETY_PROFILE_V3, INTEGRATED_SOCIETY_PROFILE_V4],
    [INTERDEPENDENT_SOCIETY_PROFILE_V2, INTERDEPENDENT_SOCIETY_PROFILE_V3],
  ] as const) {
    const {
      policy: p1,
      provenance: v1,
      ...rest1
    } = createIntegratedSocietyManifest({
      count: 2,
      profile: before,
    });
    const {
      policy: p2,
      provenance: v2,
      ...rest2
    } = createIntegratedSocietyManifest({
      count: 2,
      profile: after,
    });
    expect(rest2).toEqual(rest1);
    expect(p1.actionPlans).toBeUndefined();
    expect(p2).toEqual({
      ...p1,
      actionPlans: { version: 'resident-action-plans-v1', maxSteps: 8 },
    });
    expect(v2).toEqual({ ...v1, runProfile: after });
  }
});
