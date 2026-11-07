import { expect, test } from 'vitest';
import { RESOURCE_CONTROL_POLICY, initialResourceControl } from '@aivilization/authority';
import { type MaterialReservation } from '@aivilization/materials';
import {
  PREMISES_POLICY,
  PUBLIC_LAND_USE_POLICY,
  planConstruction,
  emptyPremisesState,
  applyPremisesEvent,
  createConstruction,
  startConstruction,
  interruptConstruction,
  applyPremisesCommit,
  initialPublicSiteGrant,
  mayEnterPremises,
  mayOperatePremises,
  mayResideInPremises,
  type PremisesBlueprint,
  type PremisesPorts,
  type CreateConstruction,
  type PremisesBuilding,
} from './index';
const blueprint: PremisesBlueprint = {
  primaryUse: 'production',
  floorArea: 8,
  capacity: 2,
  fixtures: { workstations: 1, careStations: 0, teachingStations: 0, storageUnits: 0 },
};
const site = {
  id: 'site',
  parentLocationId: 'street',
  usableFloorArea: 16,
  occupiedFloorArea: 0,
  reservedFloorArea: 0,
  accessTravelMs: 60000,
  revision: 1,
  source: 'scenario-seed' as const,
  sourceId: 'explicit-seed',
};
function fixture() {
  const initial = emptyPremisesState(PREMISES_POLICY, PUBLIC_LAND_USE_POLICY),
    state = applyPremisesEvent(initial, { type: 'ConstructionSiteRegistered', site });
  const reservation: MaterialReservation = {
    id: 'r',
    stockId: 'stock',
    beneficiary: { kind: 'resident', id: 'builder' },
    consumer: { domain: 'premises', id: 'project' },
    original: { Wood: 8, 'Iron Ingot': 1 },
    held: { Wood: 8, 'Iron Ingot': 1 },
    allocated: {},
    returned: {},
    createdBy: 'donor',
    terms: '只供这一工程',
    expiresAt: 10000,
    revision: 1,
    at: 0,
    status: 'offered',
  };
  const ports: PremisesPorts = {
    exists: (id) => ['donor', 'builder', 'worker'].includes(id),
    present: () => true,
    idle: () => true,
    body: () => ({ energy: 100, satiety: 100, capable: true }),
    reservation: (id) => (id === 'r' ? reservation : undefined),
    stockLocation: () => 'street',
    authorize: () => undefined,
    controlAvailable: () => true,
    siteGrant: (id, c) => initialPublicSiteGrant(state, id, c),
    occupiedOrReserved: () => 0,
    hasObligations: () => false,
    sessionReserved: () => false,
  };
  const command: CreateConstruction = {
    id: 'project',
    kind: 'build',
    buildingId: 'building',
    siteId: 'site',
    expectedSiteRevision: 1,
    controller: { kind: 'resident', id: 'builder' },
    title: '随居民选择的建筑名称',
    description: '不因名字获得特殊能力',
    blueprint,
    workers: ['worker'],
    reservations: [{ id: 'r', revision: 1 }],
  };
  return { initial, state, ports, command, reservation };
}
test('a material-backed permit reserves finite land and binds exactly the donated materials, without creating a building or making anyone work', () => {
  const t = fixture(),
    d = createConstruction(t.state, 'builder', 0, 'create-project', t.command, t.ports);
  expect(d.accepted).toBe(true);
  if (d.accepted) {
    const next = d.events.reduce(applyPremisesEvent, t.state);
    expect(next.sites.site!.reservedFloorArea).toBe(8);
    expect(next.buildings).toEqual({});
    expect(next.projects.project).toMatchObject({
      progressMs: 0,
      status: 'open',
      workLocationId: 'street',
      workers: ['worker'],
    });
    expect(next.projects.project!.session).toBeUndefined();
    expect(d.materials).toEqual([
      {
        reservationId: 'r',
        expectedRevision: 1,
        authorization: {
          consumer: { domain: 'premises', id: 'project' },
          beneficiary: { kind: 'resident', id: 'builder' },
          evidenceId: 'create-project',
        },
      },
    ]);
    expect(d.events.reduce(applyPremisesEvent, t.state)).toEqual(next);
  }
});
test('building plans cannot spend an unapproved donor reservation, move it from another location, or change its beneficiary', () => {
  const t = fixture();
  for (const r of [
    { ...t.reservation, consumer: { domain: 'premises' as const, id: 'other' } },
    { ...t.reservation, beneficiary: { kind: 'resident' as const, id: 'donor' } },
    { ...t.reservation, status: 'bound' as const },
    { ...t.reservation, expiresAt: 0 },
    { ...t.reservation, revision: 2 },
  ])
    expect(
      createConstruction(t.state, 'builder', 0, 'create-project', t.command, {
        ...t.ports,
        reservation: () => r,
      }),
    ).toMatchObject({ accepted: false, reason: 'construction-material-reservation-unavailable' });
  expect(
    createConstruction(t.state, 'builder', 0, 'create-project', t.command, {
      ...t.ports,
      stockLocation: () => 'remote',
    }).accepted,
  ).toBe(false);
  expect(
    createConstruction(t.state, 'builder', 0, 'create-project', t.command, {
      ...t.ports,
      reservation: () => ({ ...t.reservation, held: { Wood: 7, 'Iron Ingot': 1 } }),
    }),
  ).toMatchObject({ accepted: false, reason: 'construction-materials-do-not-match-blueprint' });
});
test('initial land use is an explicit institution: missing grant, changed policy, exhausted area and stale site revision reject', () => {
  const t = fixture();
  expect(
    createConstruction(t.state, 'builder', 0, 'x', t.command, {
      ...t.ports,
      siteGrant: () => undefined,
    }).accepted,
  ).toBe(false);
  expect(
    initialPublicSiteGrant(
      { ...t.state, landUsePolicy: { ...PUBLIC_LAND_USE_POLICY, mode: 'authorization-required' } },
      'site',
      t.command.controller,
    ),
  ).toBeUndefined();
  expect(
    createConstruction(
      { ...t.state, sites: { site: { ...site, reservedFloorArea: 9 } } },
      'builder',
      0,
      'x',
      t.command,
      t.ports,
    ),
  ).toMatchObject({ accepted: false, reason: 'construction-site-area-unavailable' });
  expect(
    createConstruction(
      t.state,
      'builder',
      0,
      'x',
      { ...t.command, expectedSiteRevision: 2 },
      t.ports,
    ),
  ).toMatchObject({ accepted: false, reason: 'construction-site-revision-conflict' });
  expect(() => applyPremisesEvent(t.state, { type: 'ConstructionSiteRegistered', site })).toThrow(
    'invalid-construction-site-registration',
  );
});
test('physical blueprints constrain space and material/work costs, and modifications cannot erase already built capacity', () => {
  const plan = planConstruction(PREMISES_POLICY, blueprint, 'build')!;
  expect(plan.materials).toEqual({ Wood: 8, 'Iron Ingot': 1 });
  expect(plan.workMs).toBe(540000);
  expect(plan.addedFloorArea).toBe(8);
  expect(planConstruction(PREMISES_POLICY, { ...blueprint, capacity: 3 }, 'build')).toBeUndefined();
  expect(
    planConstruction(PREMISES_POLICY, { ...blueprint, floorArea: Infinity }, 'build'),
  ).toBeUndefined();
  expect(
    planConstruction(
      PREMISES_POLICY,
      { ...blueprint, fixtures: { ...blueprint.fixtures, careStations: 2 } },
      'build',
    ),
  ).toBeUndefined();
  expect(
    planConstruction(PREMISES_POLICY, { ...blueprint, floorArea: 4, capacity: 1 }, 'modify', {
      blueprint,
      condition: 1000,
    }),
  ).toBeUndefined();
  expect(
    planConstruction(PREMISES_POLICY, blueprint, 'maintain', { blueprint, condition: 1000 }),
  ).toBeUndefined();
  expect(
    planConstruction(PREMISES_POLICY, blueprint, 'maintain', { blueprint, condition: 500 })
      ?.repairPoints,
  ).toBe(500);
  expect(
    planConstruction(PREMISES_POLICY, blueprint, 'demolish', { blueprint, condition: 500 })
      ?.materials,
  ).toEqual({});
});
test('entry, operation, residence and collective control remain separate; a public doorway grants no land or residence', () => {
  const building: PremisesBuilding = {
    id: 'home',
    siteId: 'site',
    locationId: 'home-location',
    ownerId: 'donor',
    control: initialResourceControl('builder', 0, RESOURCE_CONTROL_POLICY),
    title: '名称不授权',
    blueprint: { ...blueprint, primaryUse: 'residence' },
    condition: 1000,
    status: 'operational',
    access: { entry: 'public', visitors: [], operators: ['worker'], residents: ['resident'] },
    embodied: { Wood: 8 },
    salvage: {},
    footprintReleased: false,
    wearSettledAt: 0,
    revision: 1,
    at: 0,
  };
  expect(mayEnterPremises(building, 'stranger')).toBe(true);
  expect(mayOperatePremises(building, 'stranger')).toBe(false);
  expect(mayResideInPremises(building, 'stranger')).toBe(false);
  expect(mayOperatePremises(building, 'worker')).toBe(true);
  expect(mayResideInPremises(building, 'worker')).toBe(false);
  expect(mayResideInPremises(building, 'resident')).toBe(true);
  const collective = {
    ...building,
    control: { ...building.control, controller: { kind: 'collective' as const, id: 'club' } },
    access: { ...building.access, entry: 'listed' as const },
  };
  expect(mayEnterPremises(collective, 'donor')).toBe(false);
  expect(mayOperatePremises(collective, 'builder')).toBe(false);
  expect(mayEnterPremises({ ...building, status: 'closed' }, 'builder')).toBe(false);
});

test('system construction interruption preserves the plan and materials and requires an exactly settled boundary', () => {
  const f = fixture();
  const created = createConstruction(
    f.state,
    'builder',
    0,
    'create-for-interruption',
    f.command,
    f.ports,
  );
  if (!created.accepted) throw Error(created.reason);
  const built = created.events.reduce(applyPremisesEvent, f.state);
  const started = startConstruction(
    built,
    'worker',
    0,
    'project',
    built.projects.project!.revision,
    1000,
    f.ports,
  );
  if (!started.accepted) throw Error(started.reason);
  const before = applyPremisesCommit(built, started.events).state;
  expect(interruptConstruction(before, 'project', 1)).toMatchObject({
    accepted: false,
    reason: 'construction-interruption-needs-settled-boundary',
  });
  const d = interruptConstruction(before, 'project', 0);
  if (!d.accepted) throw Error(d.reason);
  expect(d.effort).toBeUndefined();
  expect(d.materials).toEqual([]);
  expect(d.release).toEqual(before.projects.project!.session);
  const next = applyPremisesCommit(before, d.events).state;
  expect(next.projects.project).toMatchObject({
    status: 'open',
    progressMs: 0,
    plan: before.projects.project!.plan,
    reservations: before.projects.project!.reservations,
    lastStop: { actorId: 'worker', at: 0, reason: 'worker-unavailable' },
  });
  expect(next.projects.project!.session).toBeUndefined();
  expect(next.sites).toEqual(before.sites);
  expect(next.buildings).toEqual(before.buildings);
  expect(() => applyPremisesCommit(next, d.events)).toThrow();
  expect(interruptConstruction(next, 'project', 0)).toMatchObject({
    accepted: false,
    reason: 'active-construction-required',
  });
});
