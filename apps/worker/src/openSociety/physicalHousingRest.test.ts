import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OpenSocietyRuntime } from './runtime';
import { openPremisesFixture, premisesCleanup } from './testFixtures/openPremises';
import { dispatchWorldCommand } from '@aivilization/world';
import { createCommandEnvelope } from '@aivilization/sim-core';
import { openWorldPolicies } from './manifest';

function setup() {
  return openPremisesFixture(true, true, {}, true, {
    elapsedRest: true,
    initialEnergy: 30,
    wearIntervalMs: 600000,
    wearPerInterval: 250,
    manifest: { housingOccupancy: true, physicalHousingRest: true },
  });
}
function build(t: ReturnType<typeof setup>) {
  t.reserve();
  t.create();
  t.ok(t.b, 'construction.start', {
    id: 'p',
    expectedRevision: 1,
    until: t.r.state.world.clock.now + t.project().plan.workMs,
  });
  t.time(t.project().plan.workMs);
}
function move(t: ReturnType<typeof setup>, actor: string, targetLocationId: string) {
  t.ok(actor, 'world.move', { targetLocationId });
  t.time(t.r.state.world.activityTimeByAgent[actor]!.availableAt - t.r.state.world.clock.now);
}
/** The owner lets resident c live in the building; c walks in and registers residence there. */
function enter(t: ReturnType<typeof setup>) {
  const home = t.r.state.world.premises!.buildings.home!;
  t.ok(t.b, 'premises.configure', {
    id: 'home',
    expectedRevision: home.revision,
    title: home.title,
    entry: 'listed',
    visitors: [t.c],
    operators: [],
    residents: [t.c],
  });
  move(t, t.c, 'premises-home');
  t.ok(t.c, 'world.choose_residence', { locationId: 'premises-home' });
}
function replay(t: ReturnType<typeof setup>) {
  const before = structuredClone(t.r.state),
    journal = readFileSync(join(t.root, 'journal.jsonl'));
  t.r.close();
  const r = new OpenSocietyRuntime(t.root);
  premisesCleanup.push(() => r.close());
  expect(r.state).toEqual(before);
  expect(readFileSync(join(t.root, 'journal.jsonl'))).toEqual(journal);
}
test('actual materials and labour create structure; only granted entry and real location produce elapsed recovery, a withdrawn grant does not erase the roof', () => {
  const t = setup();
  t.reserve();
  t.create();
  expect(t.r.state.world.locations['premises-home']).toBeUndefined();
  expect(t.ok(t.c, 'housing.occupancy', {}).data).toMatchObject({
    physicalRest: { source: { kind: 'unsheltered' } },
  });
  t.ok(t.b, 'construction.start', {
    id: 'p',
    expectedRevision: 1,
    until: t.r.state.world.clock.now + t.project().plan.workMs,
  });
  t.time(t.project().plan.workMs);
  expect(t.stock().inventory).toEqual({});
  expect(t.r.state.world.premises!.buildings.home!.embodied).toEqual({ Wood: 8 });
  enter(t);
  const before = structuredClone(t.r.state.world.agents[t.c]!);
  const source = t.ok(t.c, 'housing.occupancy', {}).data;
  expect(source).toMatchObject({
    physicalRest: {
      source: { kind: 'resident-built-residence', buildingId: 'home', condition: 1000 },
    },
  });
  t.ok(t.c, 'world.sleep', { durationSeconds: 300 });
  expect(t.r.state.world.agents[t.c]!.physiology).toEqual(before.physiology);
  t.time(300000);
  expect(t.r.state.world.agents[t.c]!.physiology.energy).toBeGreaterThan(before.physiology.energy);
  // The owner withdraws the residence grant: the roof does not disappear with the permission.
  const home = t.r.state.world.premises!.buildings.home!;
  t.ok(t.b, 'premises.configure', {
    id: 'home',
    expectedRevision: home.revision,
    title: home.title,
    entry: 'listed',
    visitors: [],
    operators: [],
    residents: [],
  });
  expect(t.ok(t.c, 'housing.occupancy', {}).data).toMatchObject({
    currentPermission: false,
    requiresRightsResolution: true,
    physicalRest: { source: { kind: 'resident-built-residence' } },
  });
  const tier = t.r.state.world.agents[t.c]!.residentialTier;
  move(t, t.c, t.location);
  expect(t.ok(t.c, 'housing.occupancy', {}).data).toMatchObject({
    residenceId: 'premises-home',
    physicalRest: { source: { kind: 'unsheltered' } },
  });
  expect(t.r.state.world.agents[t.c]!.residentialTier).toBe(tier);
  replay(t);
});
test('actual wear splits ongoing rest and source evidence; large and irregular small advances are equivalent, naked world refuses unsettled boundaries', () => {
  const large = setup(),
    small = setup();
  for (const t of [large, small]) {
    build(t);
    enter(t);
    t.ok(t.c, 'world.sleep', { durationSeconds: 1500 });
  }
  const initial = large.r.state.world;
  expect(() =>
    dispatchWorldCommand({
      projection: initial,
      policies: openWorldPolicies(large.manifest.seed, initial, large.manifest.rhythm),
      nextSequence: large.r.state.worldSequence + 1,
      command: createCommandEnvelope({
        id: 'bad-crossing',
        simulationId: large.manifest.simulationId,
        type: 'AdvanceSimulationTime',
        payload: { deltaMs: 1500000 },
        issuedAt: initial.clock.now,
        source: 'system',
      }),
    }),
  ).toThrow('physical-housing-requires-settled-premises-boundaries');
  expect(large.r.state.world).toBe(initial);
  large.time(1500000);
  for (const ms of [12345, 400000, 297655, 790000]) small.time(ms);
  for (const axis of ['energy', 'satiety', 'health'] as const)
    expect(large.r.state.world.agents[large.c]!.physiology[axis]).toBeCloseTo(
      small.r.state.world.agents[small.c]!.physiology[axis],
      10,
    );
  expect(large.r.state.world.premises!.buildings.home!.condition).toBe(
    small.r.state.world.premises!.buildings.home!.condition,
  );
  const effects = large.r.journal.commits
    .flatMap((c) => c.worldEvents ?? [])
    .filter(
      (e) =>
        e.type === 'PhysiologyChanged' &&
        e.payload.agentId === large.c &&
        e.payload.elapsed?.physicalHousing,
    );
  expect(
    effects.some(
      (e) => e.type === 'PhysiologyChanged' && e.payload.elapsed?.physicalHousing?.multiplier === 1,
    ),
  ).toBe(true);
  expect(
    effects.some(
      (e) =>
        e.type === 'PhysiologyChanged' && (e.payload.elapsed?.physicalHousing?.multiplier ?? 1) < 1,
    ),
  ).toBe(true);
  const effect = effects.find(
    (e) =>
      e.type === 'PhysiologyChanged' &&
      e.payload.elapsed?.physicalHousing?.source.kind === 'resident-built-residence',
  );
  expect(effect).toBeDefined();
  // Standalone forged source validation is covered in world tests; complete journal includes actual prior building facts.
  replay(large);
  replay(small);
});
test('maintenance needs actual reserved materials and personal elapsed labour; labels or consent alone never repair future rest effects', () => {
  const t = setup();
  build(t);
  enter(t);
  t.time(600000);
  const building = t.r.state.world.premises!.buildings.home!;
  expect(building.condition).toBe(750);
  const before = t.ok(t.c, 'housing.occupancy', {}).data;
  expect(before).toMatchObject({ physicalRest: { source: { condition: 750 } } });
  t.ok(t.b, 'stocks.create', { id: 'repair-stock', title: 'Supplies', locationId: t.location });
  t.ok(t.b, 'stocks.deposit', { id: 'repair-stock', expectedRevision: 1, items: { Wood: 0.5 } });
  const at = t.r.state.world.clock.now;
  t.ok(t.b, 'materials.reserve', {
    id: 'repair-material',
    stockId: 'repair-stock',
    expectedStockRevision: 2,
    beneficiaryKind: 'resident',
    beneficiaryId: t.b,
    consumerDomain: 'premises',
    consumerId: 'repair',
    items: { Wood: 0.5 },
    terms: 'One repair',
    expiresAt: at + 500000,
  });
  t.ok(t.b, 'construction.create', {
    id: 'repair',
    kind: 'maintain',
    buildingId: 'home',
    siteId: t.site!.id,
    expectedSiteRevision: t.r.state.world.premises!.sites[t.site!.id]!.revision,
    expectedBuildingRevision: building.revision,
    controllerKind: 'resident',
    controllerId: t.b,
    title: 'Good as new',
    description: 'Statement cannot repair',
    workers: [t.b],
    reservationRefs: ['repair-material@1'],
    ...t.blueprint,
  });
  expect(t.r.state.world.premises!.buildings.home!.condition).toBe(750);
  expect(
    t.call(t.c, 'construction.start', { id: 'repair', expectedRevision: 1, until: at + 60000 }).ok,
  ).toBe(false);
  const project = t.r.state.world.premises!.projects.repair!;
  t.ok(t.b, 'construction.start', {
    id: 'repair',
    expectedRevision: project.revision,
    until: at + project.plan.workMs,
  });
  expect(t.r.state.world.premises!.buildings.home!.condition).toBe(750);
  t.time(project.plan.workMs);
  expect(t.r.state.world.premises!.buildings.home!.condition).toBe(1000);
  expect(t.r.state.world.materials!.stocks['repair-stock']!.inventory).toEqual({});
  expect(t.r.state.world.premises!.buildings.home!.embodied.Wood).toBe(8.5);
  expect(t.ok(t.c, 'housing.occupancy', {}).data).toMatchObject({
    physicalRest: { source: { condition: 1000 } },
  });
  t.ok(t.c, 'world.sleep', { durationSeconds: 120 });
  const session = Object.values(t.r.state.world.residentRest!.sessions).find(
    (s) => s.actorId === t.c,
  )!;
  expect(
    t.call(t.b, 'world.stop_rest', { id: session.id, expectedRevision: session.revision }).ok,
  ).toBe(false);
  t.time(30000);
  const current = t.r.state.world.residentRest!.sessions[session.id]!;
  t.ok(t.c, 'world.stop_rest', { id: current.id, expectedRevision: current.revision });
  expect(t.r.state.world.residentRest!.sessions[session.id]!.elapsedMs).toBe(30000);
  replay(t);
});
