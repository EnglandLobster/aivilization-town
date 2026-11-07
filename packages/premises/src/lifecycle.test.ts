import { expect, test } from 'vitest';
import {
  createMaterialsPolicy,
  emptyMaterialsState,
  applyMaterialCommit,
  decideMaterialStock,
  offerMaterialReservation,
  settleConsumerMaterials,
  MATERIAL_RESERVATIONS_POLICY,
  type MaterialPorts,
  type MaterialDecision,
  type MaterialEvent,
} from '@aivilization/materials';
import {
  PREMISES_POLICY,
  PUBLIC_LAND_USE_POLICY,
  emptyPremisesState,
  applyPremisesEvent,
  createConstruction,
  initialPublicSiteGrant,
  startConstruction,
  progressConstruction,
  finalizeConstruction,
  applyPremisesCommit,
  managePremises,
  agePremises,
  recordConstructionSettlementBlock,
  type PremisesPorts,
  type ConstructionDecision,
  type ConstructionWorkDecision,
  type PremisesEvent,
} from './index';
function setup() {
  const policy = createMaterialsPolicy([
    {
      id: 'stub',
      version: 'v1',
      inputs: { Wood: 1 },
      outputs: { Book: 1 },
      workMs: 1000,
      energyCost: 1,
      satietyCost: 1,
      minResidentialTier: 1,
    },
  ]);
  let materials = emptyMaterialsState(policy),
    premises = emptyPremisesState(PREMISES_POLICY, PUBLIC_LAND_USE_POLICY),
    now = 0,
    receipt = 0;
  const body = { energy: 100, satiety: 100, capable: true },
    busy: Record<string, { startedAt: number; until: number }> = {};
  const mp: MaterialPorts = {
    exists: () => true,
    present: () => true,
    idle: () => true,
    mayStoreAt: () => true,
    inventory: () => ({ Wood: 20 }),
    body: () => ({ ...body, residentialTier: 1 }),
    controlAvailable: () => true,
    authorize: () => undefined,
    hasExternalObligation: () => false,
    sessionReserved: () => true,
  };
  const applyM = (d: MaterialDecision) => {
    expect(d.accepted, d.accepted ? '' : d.reason).toBe(true);
    if (d.accepted) materials = applyMaterialCommit(materials, d.events).state;
  };
  applyM({
    accepted: true,
    events: [{ type: 'MaterialReservationsEnabled', policy: MATERIAL_RESERVATIONS_POLICY }],
  });
  applyM(
    decideMaterialStock(
      materials,
      'donor',
      now,
      'stock',
      { type: 'create-stock', id: 's', title: '真实材料', locationId: 'street' },
      mp,
    ),
  );
  applyM(
    decideMaterialStock(
      materials,
      'donor',
      now,
      'deposit',
      { type: 'deposit', id: 's', expectedRevision: 1, items: { Wood: 8 } },
      mp,
    ),
  );
  applyM(
    offerMaterialReservation(
      materials,
      'donor',
      now,
      'offer',
      {
        id: 'r',
        stockId: 's',
        expectedStockRevision: 2,
        items: { Wood: 8 },
        beneficiary: { kind: 'resident', id: 'builder' },
        consumer: { domain: 'premises', id: 'p' },
        terms: '明确工程',
        expiresAt: 10000,
      },
      mp,
    ),
  );
  premises = applyPremisesEvent(premises, {
    type: 'ConstructionSiteRegistered',
    site: {
      id: 'site',
      parentLocationId: 'street',
      usableFloorArea: 16,
      occupiedFloorArea: 0,
      reservedFloorArea: 0,
      accessTravelMs: 60000,
      revision: 1,
      source: 'scenario-seed',
      sourceId: 'seed',
    },
  });
  const ports: PremisesPorts = {
    exists: () => true,
    present: () => true,
    idle: (a) => !busy[a] || busy[a].until <= now,
    body: () => body,
    reservation: (id) => materials.reservations?.records[id],
    stockLocation: (id) => materials.stocks[id]?.locationId,
    authorize: () => undefined,
    controlAvailable: () => true,
    siteGrant: (id, c) => initialPublicSiteGrant(premises, id, c),
    occupiedOrReserved: () => 0,
    hasObligations: () => false,
    sessionReserved: (p) =>
      !!p.session &&
      busy[p.session.actorId]?.startedAt === p.session.startedAt &&
      busy[p.session.actorId]?.until === p.session.until,
  };
  const batches: { events: readonly PremisesEvent[]; materials: readonly MaterialEvent[] }[] = [];
  const apply = (d: ConstructionDecision | ConstructionWorkDecision) => {
    expect(d.accepted, d.accepted ? '' : d.reason).toBe(true);
    if (!d.accepted) return;
    let nextMaterials = materials;
    const materialEvents: MaterialEvent[] = [];
    const evidence = d.events.flatMap((e) =>
      e.type === 'ConstructionResourcesAllocated' ? e.allocations : [],
    );
    for (const a of d.materials) {
      const result = settleConsumerMaterials(
        nextMaterials,
        'builder',
        now,
        `settle${++receipt}`,
        a.reservationId,
        a.expectedRevision,
        a.authorization,
      );
      expect(result.accepted).toBe(true);
      if (result.accepted) {
        nextMaterials = applyMaterialCommit(
          nextMaterials,
          result.events,
          evidence.filter((e) => e.reservationId === a.reservationId),
        ).state;
        materialEvents.push(...result.events);
      }
    }
    const next = applyPremisesCommit(
      premises,
      d.events,
      'effort' in d && d.effort ? [d.effort] : [],
    ).state;
    premises = next;
    materials = nextMaterials;
    if ('reservation' in d && d.reservation)
      busy[d.reservation.actorId] = { startedAt: now, until: d.reservation.until };
    if ('release' in d && d.release) delete busy[d.release.actorId];
    if ('effort' in d && d.effort) {
      body.energy -= d.effort.energyCost;
      body.satiety -= d.effort.satietyCost;
    }
    batches.push({ events: d.events, materials: materialEvents });
  };
  apply(
    createConstruction(
      premises,
      'builder',
      now,
      'create',
      {
        id: 'p',
        kind: 'build',
        buildingId: 'home',
        siteId: 'site',
        expectedSiteRevision: 1,
        controller: { kind: 'resident', id: 'builder' },
        title: '居民命名',
        description: '用途自己选择',
        blueprint: {
          primaryUse: 'residence',
          floorArea: 8,
          capacity: 2,
          fixtures: { workstations: 0, careStations: 0, teachingStations: 0, storageUnits: 0 },
        },
        workers: ['one', 'two'],
        reservations: [{ id: 'r', revision: 1 }],
      },
      ports,
    ),
  );
  return {
    get state() {
      return premises;
    },
    get materials() {
      return materials;
    },
    get now() {
      return now;
    },
    body,
    busy,
    ports,
    apply,
    applyM,
    mp,
    setTime: (at: number) => {
      now = at;
    },
    start: (actor: string, until: number) =>
      startConstruction(premises, actor, now, 'p', premises.projects.p!.revision, until, ports),
    progress: (actor = 'system', mode: 'tick' | 'leave' | 'cancel' = 'tick') =>
      progressConstruction(premises, actor, now, 'p', `progress${++receipt}`, ports, mode),
    finish: (cancel = false, actor = 'builder') =>
      finalizeConstruction(premises, actor, now, 'p', `finish${++receipt}`, ports, cancel),
    batches,
  };
}
test('independent workers perform elapsed construction; only completion binds material consumption to a real building', () => {
  const t = setup();
  expect(t.materials.reservations!.records.r!.status).toBe('bound');
  expect(t.state.buildings).toEqual({});
  t.apply(t.start('one', 240000));
  t.setTime(120000);
  t.apply(t.progress('one', 'leave'));
  expect(t.state.projects.p!.progressMs).toBe(120000);
  expect(t.state.buildings).toEqual({});
  expect(t.finish().accepted).toBe(false);
  t.apply(t.start('two', 480000));
  t.setTime(480000);
  t.apply(t.progress());
  t.apply(t.finish());
  expect(t.state.projects.p!.status).toBe('completed');
  expect(t.state.sites.site).toMatchObject({ occupiedFloorArea: 8, reservedFloorArea: 0 });
  expect(t.state.buildings.home).toMatchObject({
    blueprint: { capacity: 2 },
    condition: 1000,
    embodied: { Wood: 8 },
    ownerId: 'builder',
    status: 'operational',
    access: { entry: 'listed', visitors: [], operators: [], residents: [] },
  });
  expect(t.materials.reservations!.records.r).toMatchObject({
    held: {},
    allocated: { Wood: 8 },
    status: 'settled',
  });
  expect(t.body.energy).toBeCloseTo(100 - (480000 / 3600000) * 10, 8);
});
test('cancellation returns unconsumed inputs and releases reserved area, while preserving labor and individual refusal', () => {
  const t = setup();
  expect(t.start('builder', 10000).accepted).toBe(false);
  t.apply(t.start('one', 240000));
  t.setTime(120000);
  expect(t.progress('builder', 'leave').accepted).toBe(false);
  t.apply(t.progress('builder', 'cancel'));
  expect(t.finish(true, 'stranger').accepted).toBe(false);
  t.apply(t.finish(true));
  expect(t.state.projects.p).toMatchObject({ status: 'cancelled', progressMs: 120000 });
  expect(t.state.buildings).toEqual({});
  expect(t.materials.stocks.s!.inventory).toEqual({ Wood: 8 });
  expect(t.state.sites.site!.reservedFloorArea).toBe(0);
  expect(t.body.energy).toBeLessThan(100);
});
test('exhaustion stops at affordable integer work time and records the reason without consuming unfinished materials', () => {
  const t = setup();
  t.apply(t.start('one', 240000));
  t.body.energy = 0.1;
  t.setTime(120000);
  t.apply(t.progress());
  expect(t.state.projects.p!.progressMs).toBe(36000);
  expect(t.state.projects.p!.session).toBeUndefined();
  expect(t.state.projects.p!.lastStop?.reason).toBe('effort-exhausted');
  expect(t.materials.reservations!.records.r!.held.Wood).toBe(8);
  expect(t.body.energy).toBeCloseTo(0, 9);
});
function completedBuilding() {
  const t = setup();
  t.apply(t.start('one', 480000));
  t.setTime(480000);
  t.apply(t.progress());
  t.apply(t.finish());
  return t;
}
test('demolition consumes the real structure; rubble retains its footprint until collected by the authorized resident', () => {
  const t = completedBuilding(),
    building = t.state.buildings.home!;
  expect(
    managePremises(
      t.state,
      'builder',
      t.now,
      'home',
      building.revision,
      { type: 'close' },
      { ...t.ports, hasObligations: () => true },
    ),
  ).toMatchObject({ accepted: false, reason: 'premises-unsettled' });
  t.apply(
    managePremises(
      t.state,
      'builder',
      t.now,
      'home',
      building.revision,
      { type: 'close' },
      t.ports,
    ),
  );
  const c = {
    id: 'demo',
    kind: 'demolish' as const,
    buildingId: 'home',
    siteId: 'site',
    expectedSiteRevision: t.state.sites.site!.revision,
    expectedBuildingRevision: t.state.buildings.home!.revision,
    controller: building.control.controller,
    title: '拆除',
    description: '本人施工后回收',
    blueprint: building.blueprint,
    workers: ['one'],
    reservations: [],
  };
  t.apply(createConstruction(t.state, 'builder', t.now, 'democreate', c, t.ports));
  expect(
    managePremises(
      t.state,
      'builder',
      t.now,
      'home',
      t.state.buildings.home!.revision,
      { type: 'reopen' },
      t.ports,
    ).accepted,
  ).toBe(false);
  t.apply(startConstruction(t.state, 'one', t.now, 'demo', 1, t.now + 240000, t.ports));
  t.setTime(t.now + 240000);
  t.apply(progressConstruction(t.state, 'system', t.now, 'demo', 'demowork', t.ports));
  const blocked = finalizeConstruction(t.state, 'system', t.now, 'demo', 'demofinish', {
    ...t.ports,
    hasObligations: () => true,
  });
  expect(blocked).toMatchObject({ accepted: false, reason: 'premises-unsettled' });
  t.apply(recordConstructionSettlementBlock(t.state, 'demo', t.now, 'premises-unsettled'));
  expect(t.state.projects.demo!.session).toBeUndefined();
  expect(t.state.buildings.home!.status).toBe('closed');
  const d = finalizeConstruction(t.state, 'system', t.now, 'demo', 'demofinish', t.ports);
  expect(d.accepted).toBe(true);
  if (d.accepted) {
    expect(() =>
      applyPremisesCommit(
        t.state,
        d.events.filter((e) => e.type !== 'PremisesDemolished'),
      ),
    ).toThrow('premises-demolition-evidence-required');
    t.apply(d);
  }
  expect(t.state.projects.demo!.settlementBlock).toBeUndefined();
  expect(t.state.buildings.home).toMatchObject({
    status: 'demolished',
    embodied: {},
    salvage: { Wood: 4 },
    footprintReleased: false,
  });
  expect(t.state.sites.site!.occupiedFloorArea).toBe(8);
  const collect = { type: 'collect-salvage' as const, recipientId: 'builder', items: { Wood: 4 } };
  expect(
    managePremises(
      t.state,
      'stranger',
      t.now,
      'home',
      t.state.buildings.home!.revision,
      collect,
      t.ports,
    ).accepted,
  ).toBe(false);
  expect(
    managePremises(t.state, 'builder', t.now, 'home', t.state.buildings.home!.revision, collect, {
      ...t.ports,
      present: () => false,
    }).accepted,
  ).toBe(false);
  const withdrawal = managePremises(
    t.state,
    'builder',
    t.now,
    'home',
    t.state.buildings.home!.revision,
    collect,
    t.ports,
  );
  if (!withdrawal.accepted) throw Error(withdrawal.reason);
  expect(applyPremisesCommit(t.state, withdrawal.events).residentDeltas).toEqual({
    builder: { Wood: 4 },
  });
  expect(() =>
    applyPremisesCommit(
      t.state,
      withdrawal.events.filter((e) => e.type !== 'PremisesSalvageCollected'),
    ),
  ).toThrow('premises-salvage-conservation');
  t.apply(withdrawal);
  expect(t.state.sites.site!.occupiedFloorArea).toBe(0);
  expect(t.state.buildings.home!.footprintReleased).toBe(true);
  expect(
    managePremises(
      t.state,
      'builder',
      t.now,
      'home',
      t.state.buildings.home!.revision,
      collect,
      t.ports,
    ).accepted,
  ).toBe(false);
});
test('wear is deterministic over split intervals, maintenance uses newly consented materials and real work, and reordered blueprints retain semantics', () => {
  const t = completedBuilding(),
    initial = t.state;
  const applyWear = (s: typeof initial, at: number) => {
    const d = agePremises(s, at);
    if (!d.accepted) throw Error(d.reason);
    return applyPremisesCommit(s, d.events).state;
  };
  const one = applyWear(initial, t.now + 2 * 86400000),
    two = applyWear(applyWear(initial, t.now + 86400000), t.now + 2 * 86400000);
  expect(one.buildings.home!.condition).toBe(998);
  expect(two.buildings.home!.condition).toBe(998);
  expect(two.buildings.home!.wearSettledAt).toBe(one.buildings.home!.wearSettledAt);
  t.setTime(t.now + 2 * 86400000);
  t.apply(agePremises(t.state, t.now));
  t.applyM(
    decideMaterialStock(
      t.materials,
      'donor',
      t.now,
      'repairdeposit',
      {
        type: 'deposit',
        id: 's',
        expectedRevision: t.materials.stocks.s!.revision,
        items: { Wood: 0.004 },
      },
      t.mp,
    ),
  );
  t.applyM(
    offerMaterialReservation(
      t.materials,
      'donor',
      t.now,
      'repairreserve',
      {
        id: 'repairmaterials',
        stockId: 's',
        expectedStockRevision: t.materials.stocks.s!.revision,
        items: { Wood: 0.004 },
        beneficiary: { kind: 'resident', id: 'builder' },
        consumer: { domain: 'premises', id: 'repair' },
        terms: '维修',
        expiresAt: t.now + 100000,
      },
      {
        exists: () => true,
        present: () => true,
        idle: () => true,
        mayStoreAt: () => true,
        inventory: () => ({ Wood: 20 }),
        body: () => ({ ...t.body, residentialTier: 1 }),
        authorize: () => undefined,
        controlAvailable: () => true,
        hasExternalObligation: () => false,
        sessionReserved: () => true,
      },
    ),
  );
  const b = t.state.buildings.home!;
  t.apply(
    createConstruction(
      t.state,
      'builder',
      t.now,
      'repaircreate',
      {
        id: 'repair',
        kind: 'maintain',
        buildingId: 'home',
        siteId: 'site',
        expectedSiteRevision: t.state.sites.site!.revision,
        expectedBuildingRevision: b.revision,
        controller: b.control.controller,
        title: '维修',
        description: '真实材料和劳动',
        blueprint: {
          fixtures: b.blueprint.fixtures,
          capacity: b.blueprint.capacity,
          floorArea: b.blueprint.floorArea,
          primaryUse: b.blueprint.primaryUse,
        },
        workers: ['one'],
        reservations: [{ id: 'repairmaterials', revision: 1 }],
      },
      t.ports,
    ),
  );
  const duration = t.state.projects.repair!.plan.workMs;
  expect(duration).toBe(240);
  t.apply(startConstruction(t.state, 'one', t.now, 'repair', 1, t.now + duration, t.ports));
  t.setTime(t.now + duration);
  t.apply(progressConstruction(t.state, 'system', t.now, 'repair', 'repairwork', t.ports));
  t.apply(finalizeConstruction(t.state, 'system', t.now, 'repair', 'repairfinish', t.ports));
  expect(t.state.buildings.home!.condition).toBe(1000);
  expect(t.state.buildings.home!.embodied.Wood).toBeCloseTo(8.004, 8);
});
test('control transfer requires separate acceptance and preserves original author and use grants', () => {
  const t = completedBuilding(),
    b = t.state.buildings.home!;
  t.apply(
    managePremises(
      t.state,
      'builder',
      t.now,
      'home',
      b.revision,
      {
        type: 'configure',
        title: '共享房屋',
        access: { entry: 'public', visitors: [], operators: [], residents: ['tenant'] },
      },
      t.ports,
    ),
  );
  t.apply(
    managePremises(
      t.state,
      'builder',
      t.now,
      'home',
      t.state.buildings.home!.revision,
      {
        type: 'control',
        control: {
          type: 'offer',
          expectedVersion: 2,
          target: { kind: 'resident', id: 'other' },
          expiresAt: t.now + 10000,
          terms: '连同现有使用授权',
        },
      },
      t.ports,
    ),
  );
  expect(
    managePremises(
      t.state,
      'builder',
      t.now,
      'home',
      t.state.buildings.home!.revision,
      { type: 'control', control: { type: 'accept', expectedVersion: 3 } },
      t.ports,
    ).accepted,
  ).toBe(false);
  t.apply(
    managePremises(
      t.state,
      'other',
      t.now,
      'home',
      t.state.buildings.home!.revision,
      { type: 'control', control: { type: 'accept', expectedVersion: 3 } },
      t.ports,
    ),
  );
  expect(t.state.buildings.home).toMatchObject({
    ownerId: 'builder',
    control: { controller: { id: 'other' } },
    access: { residents: ['tenant'] },
  });
  expect(
    managePremises(
      t.state,
      'builder',
      t.now,
      'home',
      t.state.buildings.home!.revision,
      { type: 'close' },
      t.ports,
    ).accepted,
  ).toBe(false);
});
