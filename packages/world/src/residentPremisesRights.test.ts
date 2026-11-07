import { expect, test } from 'vitest';
import {
  emptyCommerceState,
  EVIDENCE_TRADE_POLICY,
  type EvidenceTradeCommand,
} from '@aivilization/commerce';
import {
  residentEvidenceTradeEvent,
  enableResidentEvidenceTradeEvent,
  upgradeResidentEvidenceTradeEvent,
  advanceResidentEvidenceTrade,
} from './residentEvidenceTrade';
import { settleResidentPremisesProvisions } from './residentPremisesProvision';
import { LOGISTICS_POLICY } from '@aivilization/logistics';
import { residentLogisticsEvent, enableResidentLogisticsEvent } from './residentLogistics';
import { residentLeaseCommand } from './residentLeases';
import { freightCargoAccess } from './logisticsPorts';
import { initialResourceControl, RESOURCE_CONTROL_POLICY } from '@aivilization/authority';
import {
  PREMISES_POLICY,
  PUBLIC_LAND_USE_POLICY,
  PREMISES_FACILITY_USE_POLICY,
  PREMISES_RIGHTS_POLICY,
  emptyPremisesState,
  type PremisesRightsCommand,
} from '@aivilization/premises';
import {
  createMaterialsPolicy,
  MATERIAL_RESERVATIONS_POLICY,
  type MaterialCommand,
} from '@aivilization/materials';
import { SERVICE_ENGAGEMENTS_POLICY, type ServiceEngagementCommand } from '@aivilization/services';
import {
  asAgentId,
  asEventId,
  asLocationId,
  createCommandEnvelope,
  createEventEnvelope,
} from '@aivilization/sim-core';
import { applyWorldEvent, createWorldProjection, type WorldProjection } from './projection';
import {
  enableResidentMaterialsEvent,
  residentMaterialEvent,
  settleResidentMaterialEvent,
  residentMaterialReservationEvent,
} from './residentMaterials';
import {
  enableResidentPremisesRightsEvent,
  residentPremisesRightsEvent,
  advanceResidentPremisesRights,
} from './residentPremisesRights';
import {
  enableResidentServiceEngagementsEvent,
  residentServiceEngagementEvent,
  advanceResidentServiceEngagements,
} from './residentServiceEngagements';
import { residentPremisesEvent } from './residentPremises';
import { handleAdvanceSimulationTimeCommand, dispatchWorldCommand } from './agentActions';
import {
  mayEnterWorldPremises,
  mayOperateWorldPremises,
  mayStoreWorldPremises,
} from './premisesAccess';
import type { WorldEvent } from './events';

function setup(enableRights = true, scenario: 'default' | 'freight' | 'residence' = 'default') {
  const seed = createWorldProjection({
    agents: ['owner', 'user', 'guest'].map((id) => ({
      agentId: asAgentId(id),
      balance: 100,
      inventory: { Wood: 5 },
      physiology: { energy: 100, satiety: 80, health: 50 },
      educationScore: 1,
      residentialTier: 1,
      job: null,
      locationId: asLocationId(scenario === 'freight' && id !== 'user' ? 'street' : 'room'),
      ...(scenario === 'residence'
        ? { residenceLocationId: id === 'owner' ? asLocationId('room') : null }
        : {}),
    })),
    locations: [
      {
        locationId: asLocationId('room'),
        kind: scenario === 'residence' ? 'residence' : 'healthcare',
        name: 'Explicit seeded building',
        capacity: 6,
        activityAffinities: [],
        connections: [
          {
            targetLocationId: asLocationId('street'),
            travelDurationSeconds: scenario === 'freight' ? 30 : 60,
          },
        ],
        source: 'resident-premises:hall',
      },
      {
        locationId: asLocationId('street'),
        kind: 'social',
        name: 'Street',
        capacity: 10,
        activityAffinities: [],
        connections: [
          {
            targetLocationId: asLocationId('room'),
            travelDurationSeconds: scenario === 'freight' ? 30 : 60,
          },
        ],
      },
    ],
    moneySupply: 300,
  });
  const initial: WorldProjection = {
    ...seed,
    ...(scenario === 'residence' ? { residentCommerce: emptyCommerceState() } : {}),
    premises: {
      ...emptyPremisesState(PREMISES_POLICY, PUBLIC_LAND_USE_POLICY),
      facilityUsePolicy: PREMISES_FACILITY_USE_POLICY,
      sites: {
        site: {
          id: 'site',
          parentLocationId: 'room',
          usableFloorArea: 50,
          occupiedFloorArea: 30,
          reservedFloorArea: 0,
          accessTravelMs: 1000,
          revision: 1,
          source: 'scenario-seed',
          sourceId: 'explicit-fixture-building',
        },
      },
      buildings: {
        hall: {
          id: 'hall',
          siteId: 'site',
          locationId: 'room',
          ownerId: 'owner',
          control: initialResourceControl('owner', 0, RESOURCE_CONTROL_POLICY),
          title: '房屋',
          blueprint: {
            primaryUse: scenario === 'residence' ? 'residence' : 'healthcare',
            floorArea: 30,
            capacity: 6,
            fixtures: { workstations: 2, careStations: 1, teachingStations: 1, storageUnits: 10 },
          },
          condition: 1000,
          status: 'operational',
          access: { entry: 'listed', visitors: [], operators: [], residents: [] },
          embodied: { Wood: 40 },
          salvage: {},
          footprintReleased: false,
          wearSettledAt: 0,
          revision: 1,
          at: 0,
        },
      },
    },
  };
  let w = initial,
    n = 0;
  const events: WorldEvent[] = [];
  const context = (actorId = 'owner') => ({
    projection: w,
    actorId,
    simulationId: 'rights',
    requestId: `rights-${++n}`,
    nextSequence: events.length + 1,
  });
  const authorization = {
    authorize: () => undefined,
    controllerAvailable: (c: { id: string }) => !!w.agents[c.id],
  };
  const commit = (es: readonly WorldEvent[]) => {
    let next = w;
    for (const e of es) next = applyWorldEvent(next, e);
    w = next;
    events.push(...es);
    expect(w.moneySupply).toBe(300);
  };
  const ok = (
    d: { accepted: true; events: readonly WorldEvent[] } | { accepted: false; reason: string },
  ) => {
    expect(d.accepted, JSON.stringify(d)).toBe(true);
    if (d.accepted) commit(d.events);
  };
  commit([
    enableResidentMaterialsEvent({
      ...context(),
      at: 0,
      policy: createMaterialsPolicy([
        {
          id: 'book',
          version: 'v1',
          inputs: { Wood: 1 },
          outputs: { Book: 1 },
          workMs: 1000,
          energyCost: 1,
          satietyCost: 1,
          minResidentialTier: 1,
        },
      ]),
    }),
  ]);
  commit([
    createEventEnvelope({
      id: 'reservations',
      simulationId: 'rights',
      type: 'ResidentMaterialsCommitted',
      sequence: events.length + 1,
      occurredAt: 0,
      payload: {
        policyVersion: 'resident-materials-v1' as const,
        events: [
          { type: 'MaterialReservationsEnabled' as const, policy: MATERIAL_RESERVATIONS_POLICY },
        ],
      },
    }),
  ]);
  ok(
    enableResidentServiceEngagementsEvent({
      ...context(),
      policy: SERVICE_ENGAGEMENTS_POLICY,
      facilities: [],
    }),
  );
  if (enableRights)
    ok(enableResidentPremisesRightsEvent({ ...context(), policy: PREMISES_RIGHTS_POLICY }));
  const rights = (actor: string, command: PremisesRightsCommand) =>
    residentPremisesRightsEvent({ ...context(actor), command, authorization });
  const material = (actor: string, command: MaterialCommand) =>
    residentMaterialEvent({
      ...context(actor),
      command,
      authorization: {
        authorize: () => undefined,
        controlAvailable: authorization.controllerAvailable,
        mayStoreAt: () => true,
        hasExternalObligation: () => false,
      },
    });
  const service = (actor: string, command: ServiceEngagementCommand) =>
    residentServiceEngagementEvent({ ...context(actor), command, authorization });
  const grant = (
    mode: 'exclusive' | 'shared' = 'shared',
    scopes: ('operate' | 'store')[] = ['operate', 'store'],
  ) => {
    ok(
      rights('owner', {
        type: 'offer',
        buildingRevision: w.premises!.buildings.hall!.revision,
        terms: {
          id: 'permit',
          buildingId: 'hall',
          grantee: { kind: 'resident', id: 'user' },
          users: ['user', 'guest'],
          scopes,
          mode,
          title: '明确许可',
          terms: '使用一分钟',
          startAt: 0,
          endAt: 60000,
          acceptBy: 10000,
        },
      }),
    );
    ok(rights('user', { type: 'accept', id: 'permit', revision: 1 }));
  };
  const time = (deltaMs: number) =>
    commit(
      handleAdvanceSimulationTimeCommand({
        projection: w,
        nextSequence: events.length + 1,
        command: createCommandEnvelope({
          id: `tick${++n}`,
          simulationId: 'rights',
          source: 'system',
          type: 'AdvanceSimulationTime',
          issuedAt: w.clock.now,
          payload: { deltaMs },
        }),
      }),
    );
  const replay = () => {
    let next = initial;
    for (const e of JSON.parse(JSON.stringify(events)) as WorldEvent[])
      next = applyWorldEvent(next, e);
    expect(next).toEqual(w);
  };
  return {
    get w() {
      return w;
    },
    initial,
    events,
    context,
    authorization,
    commit,
    ok,
    rights,
    material,
    service,
    grant,
    time,
    replay,
  };
}
test('a real manufacturing session ends at permit expiry without losing output; retrieval remains but new deposit/work rejects', () => {
  const f = setup();
  expect(
    f.material('user', { type: 'create-stock', id: 'stock', title: '仓', locationId: 'room' })
      .accepted,
  ).toBe(false);
  f.grant();
  f.ok(f.material('user', { type: 'create-stock', id: 'stock', title: '仓', locationId: 'room' }));
  f.ok(
    f.material('user', { type: 'deposit', id: 'stock', expectedRevision: 1, items: { Wood: 2 } }),
  );
  f.ok(
    f.material('user', {
      type: 'create-production',
      id: 'job',
      stockId: 'stock',
      expectedRevision: 2,
      recipeId: 'book',
      quantity: 2,
      productName: '书',
      description: '自定作品',
      workers: ['user'],
    }),
  );
  f.time(59000);
  expect(
    f.material('user', { type: 'start-production', id: 'job', expectedRevision: 1, until: 61000 }),
  ).toMatchObject({ accepted: false, reason: 'production-permit-window-exceeded' });
  f.ok(
    f.material('user', { type: 'start-production', id: 'job', expectedRevision: 1, until: 60000 }),
  );
  expect(f.rights('user', { type: 'release', id: 'permit', revision: 2 })).toMatchObject({
    accepted: false,
    reason: 'permit-active-work-must-end-first',
  });
  f.time(1000);
  f.commit(advanceResidentPremisesRights(f.context('system'))); // Even expiry recorded first must preserve the preceding work.
  f.ok(
    settleResidentMaterialEvent({
      ...f.context('user'),
      productionId: 'job',
      authorization: {
        authorize: () => undefined,
        controlAvailable: () => true,
        mayStoreAt: () => false,
        hasExternalObligation: () => false,
      },
    }),
  );
  expect(f.w.materials?.stocks.stock?.inventory).toEqual({ Book: 1 });
  expect(f.w.materials?.productions.job?.held).toEqual({ Wood: 1 });
  expect(f.w.agents.user?.physiology.energy).toBe(99);
  expect(mayOperateWorldPremises(f.w, 'user', 'room')).toBe(false);
  expect(mayStoreWorldPremises(f.w, 'user', 'room')).toBe(false);
  expect(mayEnterWorldPremises(f.w, 'user', 'room')).toBe(true);
  expect(
    f.material('user', {
      type: 'deposit',
      id: 'stock',
      expectedRevision: f.w.materials!.stocks.stock!.revision,
      items: { Wood: 1 },
    }),
  ).toMatchObject({ accepted: false, reason: 'material-storage-permit-required' });
  f.ok(
    f.material('user', {
      type: 'withdraw',
      id: 'stock',
      expectedRevision: f.w.materials!.stocks.stock!.revision,
      items: { Book: 1 },
      recipientId: 'user',
    }),
  );
  expect(f.w.agents.user?.inventory.Book).toBe(1);
  f.replay();
});
test('actual care records and pays the last authorized interval even when the right expires first', () => {
  const f = setup();
  f.grant('shared', ['operate']);
  f.ok(
    f.service('user', {
      type: 'offer',
      id: 'care',
      controller: { kind: 'resident', id: 'user' },
      title: '照护',
      terms: '实际照护',
      locationId: 'room',
      providerId: 'user',
      recipientId: 'guest',
      payer: { sector: 'agent', id: 'guest' },
      revenue: { sector: 'agent', id: 'user' },
      providerShareBps: 10000,
      pricePerHour: 60,
      modelId: 'supportive-care-v1',
      maxDurationMs: 120000,
      startAt: 0,
      endAt: 120000,
      materials: [],
    }),
  );
  for (const type of ['accept', 'fund'] as const)
    f.ok(
      f.service('guest', {
        type,
        id: 'care',
        expectedRevision: f.w.serviceEngagements!.engagements.care!.revision,
      }),
    );
  expect(
    f.service('user', { type: 'start', id: 'care', expectedRevision: 3, until: 120000 }),
  ).toMatchObject({ accepted: false, reason: 'service-permit-window-exceeded' });
  for (const actor of ['user', 'guest'])
    f.ok(
      f.service(actor, {
        type: 'start',
        id: 'care',
        expectedRevision: f.w.serviceEngagements!.engagements.care!.revision,
        until: 60000,
      }),
    );
  f.time(60000);
  f.commit(advanceResidentPremisesRights(f.context('system')));
  f.commit(advanceResidentServiceEngagements(f.context('system')));
  expect(f.w.serviceEngagements?.engagements.care).toMatchObject({
    status: 'ended',
    progressMs: 60000,
    charged: 1,
    refunded: 1,
  });
  expect(f.w.agents.user?.balance).toBe(101);
  expect(f.w.agents.guest?.balance).toBe(99);
  expect(f.w.agents.guest!.physiology.health).toBeGreaterThan(50);
  f.replay();
});
test('exclusive use constrains current controller and survives transfer; accepted rights prevent closure', () => {
  const f = setup();
  f.grant('exclusive');
  expect(mayOperateWorldPremises(f.w, 'owner', 'room')).toBe(false);
  expect(
    f.material('owner', {
      type: 'create-stock',
      id: 'bypass',
      title: '不能绕过',
      locationId: 'room',
    }).accepted,
  ).toBe(false);
  const auth = {
    authorize: () => undefined,
    controlAvailable: () => true,
    additionalObligations: () => false,
  };
  expect(
    residentPremisesEvent({
      ...f.context(),
      authorization: auth,
      id: 'hall',
      revision: 1,
      command: { type: 'close' },
    }).accepted,
  ).toBe(false);
  f.ok(
    residentPremisesEvent({
      ...f.context(),
      authorization: auth,
      id: 'hall',
      revision: 1,
      command: {
        type: 'control',
        control: {
          type: 'offer',
          expectedVersion: 1,
          target: { kind: 'resident', id: 'guest' },
          expiresAt: 10000,
          terms: '承接已有许可',
        },
      },
    }),
  );
  f.ok(
    residentPremisesEvent({
      ...f.context('guest'),
      authorization: auth,
      id: 'hall',
      revision: 2,
      command: { type: 'control', control: { type: 'accept', expectedVersion: 2 } },
    }),
  );
  expect(mayOperateWorldPremises(f.w, 'user', 'room')).toBe(true);
  expect(f.w.premisesRights?.permits.permit?.status).toBe('accepted');
  f.replay();
});
test('world rejects authority-consistent forged acceptance that conflicts with actual stocks', () => {
  const f = setup();
  f.ok(
    f.material('owner', {
      type: 'create-stock',
      id: 'ownerstock',
      title: '既有物品',
      locationId: 'room',
    }),
  );
  f.ok(
    f.rights('owner', {
      type: 'offer',
      buildingRevision: 1,
      terms: {
        id: 'bad',
        buildingId: 'hall',
        grantee: { kind: 'resident', id: 'user' },
        users: ['user'],
        scopes: ['store'],
        mode: 'exclusive',
        title: '不能赶走库存',
        terms: '原文',
        startAt: 0,
        endAt: 10000,
        acceptBy: 1000,
      },
    }),
  );
  expect(f.rights('user', { type: 'accept', id: 'bad', revision: 1 })).toMatchObject({
    accepted: false,
    reason: 'permit-existing-stock-obligation',
  });
  const last = f.events.at(-1)!;
  if (last.type !== 'ResidentPremisesRightsCommitted') throw Error('fixture');
  expect(() =>
    applyWorldEvent(f.w, {
      ...last,
      id: asEventId('forged'),
      sequence: last.sequence + 1,
      payload: {
        ...last.payload,
        actorId: 'user',
        events: [
          {
            type: 'PremisesPermitAccepted',
            id: 'bad',
            revision: 2,
            signature: { actorId: 'user', at: 0 },
          },
        ],
      },
    }),
  ).toThrow('permit-existing-obligation-conflict');
});
test('enabling an older world adds no assets or permissions and no legacy domain is reinterpreted', () => {
  const f = setup(false),
    before = f.w;
  expect(before.premisesRights).toBeUndefined();
  f.ok(enableResidentPremisesRightsEvent({ ...f.context(), policy: PREMISES_RIGHTS_POLICY }));
  const { premisesRights, ...rest } = f.w;
  expect(rest).toEqual(before);
  expect(premisesRights?.permits).toEqual({});
  f.replay();
});

const movementPolicies = {
  residentialAssignment: {
    policyVersion: 'residential-assignment-test-v1',
    arrivalSelection: 'most-vacancies-then-location-id' as const,
  },
  satietyRecoveryByCommodity: {},
  maxSatiety: 100,
  wageCalculator: () => 0,
  laborCost: { energyCostPerHour: 1, satietyCostPerHour: 1 },
  criticalThresholds: { energy: 0, health: 0 },
};
test('cargo admitted before storage expiry cannot be newly delivered afterwards and can physically return without erasing custody', () => {
  const f = setup(true, 'freight');
  f.grant('shared', ['store']);
  f.ok(enableResidentLogisticsEvent({ ...f.context(), policy: LOGISTICS_POLICY }));
  for (const [actor, id, locationId] of [
    ['owner', 'source', 'street'],
    ['user', 'destination', 'room'],
  ])
    f.ok(
      f.material(actor!, {
        type: 'create-stock',
        id: id!,
        locationId: locationId!,
        title: 'Real stock',
      }),
    );
  f.ok(
    f.material('owner', { type: 'deposit', id: 'source', expectedRevision: 1, items: { Wood: 2 } }),
  );
  f.ok(
    residentMaterialReservationEvent({
      ...f.context('owner'),
      authorization: {
        authorize: () => undefined,
        controlAvailable: () => true,
        mayStoreAt: () => true,
        hasExternalObligation: () => false,
      },
      command: {
        type: 'offer',
        offer: {
          id: 'supply',
          stockId: 'source',
          expectedStockRevision: 2,
          items: { Wood: 2 },
          beneficiary: { kind: 'resident', id: 'owner' },
          consumer: { domain: 'logistics', id: 'parcel' },
          terms: 'Real cargo',
          expiresAt: 300000,
        },
      },
    }),
  );
  f.ok(
    residentLogisticsEvent({
      ...f.context('owner'),
      authorization: f.authorization,
      command: {
        type: 'offer',
        id: 'parcel',
        controller: { kind: 'resident', id: 'owner' },
        recipient: { kind: 'resident', id: 'user' },
        sourceStockId: 'source',
        destinationStockId: 'destination',
        sourceLocationId: 'street',
        destinationLocationId: 'room',
        materialRef: { id: 'supply', revision: 1 },
        items: { Wood: 2 },
        carrierId: 'guest',
        payer: { sector: 'agent', id: 'owner' },
        deliveryFee: 0,
        returnFee: 0,
        deadline: 300000,
        title: 'Actual movement',
        terms: 'Physical delivery or return',
      },
    }),
  );
  const act = (actor: string, type: 'accept' | 'fund' | 'load' | 'deliver' | 'cancel' | 'return') =>
    residentLogisticsEvent({
      ...f.context(actor),
      authorization: f.authorization,
      command: { type, id: 'parcel', expectedRevision: f.w.logistics!.freight.parcel!.revision },
    });
  f.ok(act('user', 'accept'));
  f.ok(act('owner', 'fund'));
  f.ok(act('guest', 'load'));
  const move = (location: string) => {
    const ctx = f.context('guest');
    const events = dispatchWorldCommand({
      projection: f.w,
      nextSequence: ctx.nextSequence,
      policies: movementPolicies,
      command: createCommandEnvelope({
        id: ctx.requestId,
        simulationId: 'rights',
        source: 'agent-runtime',
        actorId: 'guest',
        type: 'AgentMoveTo',
        issuedAt: f.w.clock.now,
        payload: { targetLocationId: asLocationId(location) },
      }),
    });
    expect(events.some((e) => e.type === 'ActionRejected')).toBe(false);
    f.commit(events);
    f.time(f.w.transitByAgent!.guest!.arrivesAt - f.w.clock.now);
  };
  move('room');
  f.time(60000 - f.w.clock.now);
  f.commit(advanceResidentPremisesRights(f.context('system')));
  expect(f.w.agents.guest!.locationId).toBe('room');
  expect(f.w.transitByAgent?.guest).toBeUndefined();
  expect(f.w.activityTimeByAgent.guest?.availableAt ?? 0).toBeLessThanOrEqual(f.w.clock.now);
  expect(freightCargoAccess(f.w, f.w.logistics!.freight.parcel!, 'deliver')).toBe(
    'freight-destination-storage-permit-required',
  );
  expect(act('guest', 'deliver')).toMatchObject({
    accepted: false,
    reason: 'freight-destination-storage-permit-required',
  });
  expect(f.w.materials!.custodies!.records.parcel!.held).toEqual({ Wood: 2 });
  expect(f.w.materials!.stocks.destination!.inventory).toEqual({});
  f.ok(act('owner', 'cancel'));
  move('street');
  f.ok(act('guest', 'return'));
  expect(f.w.materials!.stocks.source!.inventory).toEqual({ Wood: 2 });
  expect(f.w.logistics!.freight.parcel!.status).toBe('returned');
  f.replay();
});
test('legacy tenancy cannot override an exclusive residence permit, while an explicitly included person can still independently accept a lease', () => {
  const f = setup(true, 'residence');
  f.ok(
    f.rights('owner', {
      type: 'offer',
      buildingRevision: 1,
      terms: {
        id: 'home-right',
        buildingId: 'hall',
        grantee: { kind: 'resident', id: 'user' },
        users: ['owner', 'user'],
        scopes: ['reside'],
        mode: 'exclusive',
        title: '明确居住权',
        terms: '保留原有屋主占有',
        startAt: 0,
        endAt: 60000,
        acceptBy: 1000,
      },
    }),
  );
  f.ok(f.rights('user', { type: 'accept', id: 'home-right', revision: 1 }));
  const lease = (tenantId: string) =>
    residentLeaseCommand({
      ...f.context('owner'),
      policies: movementPolicies,
      command: {
        type: 'offer',
        id: `lease-${tenantId}`,
        tenantId,
        locationId: 'room',
        terms: '租住原文',
        rent: 0,
        deposit: 0,
        expiresAt: 50000,
      },
    });
  expect(lease('guest')).toMatchObject({
    accepted: false,
    reason: 'lease-conflicts-with-premises-use-rights',
  });
  f.ok(lease('user'));
  f.ok(
    residentLeaseCommand({
      ...f.context('user'),
      policies: movementPolicies,
      command: { type: 'accept', id: 'lease-user', expectedRevision: 1 },
    }),
  );
  expect(f.w.residentLeases!.leases['lease-user']!.status).toBe('active');
  expect(f.w.agents.user!.residenceLocationId).toBe('room');
  f.replay();
});

function paidFixture(amount = 30) {
  const f = setup();
  f.ok(enableResidentLogisticsEvent({ ...f.context(), policy: LOGISTICS_POLICY }));
  f.ok(enableResidentEvidenceTradeEvent({ ...f.context(), policy: EVIDENCE_TRADE_POLICY }));
  f.ok(upgradeResidentEvidenceTradeEvent(f.context()));
  f.ok(
    f.rights('owner', {
      type: 'offer',
      buildingRevision: 1,
      terms: {
        id: 'paid',
        buildingId: 'hall',
        grantee: { kind: 'resident', id: 'user' },
        users: ['user', 'guest'],
        scopes: ['operate', 'store'],
        mode: 'shared',
        title: '有偿许可',
        terms: '价格以实际可用权限时间为依据',
        startAt: 0,
        endAt: 60000,
        acceptBy: 10000,
      },
    }),
  );
  const trade = (actor: string, command: EvidenceTradeCommand) =>
    residentEvidenceTradeEvent({ ...f.context(actor), command, authorization: f.authorization });
  f.ok(
    trade('owner', {
      type: 'offer',
      id: 'price',
      source: { kind: 'permit', id: 'paid', expectedRevision: 1 },
      payer: { sector: 'agent', id: 'user' },
      revenue: { sector: 'agent', id: 'owner' },
      amount,
      acceptBy: 10000,
      title: '双方定价',
      terms: '原文不证明满意',
    }),
  );
  return {
    f,
    trade,
    accept: () => trade('user', { type: 'accept', id: 'price', expectedRevision: 1 }),
  };
}
test('paid permission acceptance commits money, exact independent consent and provision atomically; standalone bypass rejects', () => {
  const { f, accept } = paidFixture();
  expect(f.rights('user', { type: 'accept', id: 'paid', revision: 1 })).toMatchObject({
    accepted: false,
    reason: 'permit-paid-acceptance-required',
  });
  const before = f.w,
    d = accept();
  if (!d.accepted) throw Error(d.reason);
  expect(d.events).toHaveLength(1);
  const e = d.events[0]!;
  if (e.type !== 'ResidentEvidenceTradeCommitted') throw Error('fixture');
  const { paidPermit: omitted, ...missingPermit } = e.payload;
  expect(omitted).toBeDefined();
  expect(() => applyWorldEvent(before, { ...e, payload: missingPermit })).toThrow(
    'paid-permit-effects-required',
  );
  expect(() =>
    applyWorldEvent(before, { ...e, payload: { ...e.payload, transactions: [] } }),
  ).toThrow('trade-accounting-facts-mismatch');
  const paid = e.payload.paidPermit!;
  expect(() =>
    applyWorldEvent(before, {
      ...e,
      payload: {
        ...e.payload,
        paidPermit: {
          ...paid,
          provision: {
            ...paid.provision,
            provision: { ...paid.provision.provision, orderId: 'wrong' },
          },
        },
      },
    }),
  ).toThrow('paid-permit-provision-mismatch');
  f.ok(d);
  expect(f.w.agents.user!.balance).toBe(70);
  expect(f.w.agents.owner!.balance).toBe(100);
  expect(f.w.premisesRights!.permits.paid!.accepted).toEqual({ actorId: 'user', at: 0 });
  expect(f.w.premisesRights!.provisions!.paid).toMatchObject({
    orderId: 'price',
    availableMs: 0,
    settledAt: 0,
  });
  expect(mayOperateWorldPremises(f.w, 'guest', 'room')).toBe(true);
  expect(f.w.agents.guest!.physiology).toEqual(before.agents.guest!.physiology);
  f.replay();
});
test('insufficient payment and changed resource authority leave both permission and money untouched', () => {
  const poor = paidFixture(101),
    before = poor.f.w;
  expect(poor.accept()).toMatchObject({ accepted: false, reason: 'insufficient-trade-balance' });
  expect(poor.f.w).toBe(before);
  expect(poor.f.w.premisesRights!.permits.paid!.status).toBe('offered');
  const { f, accept } = paidFixture();
  const auth = {
    authorize: () => undefined,
    controlAvailable: f.authorization.controllerAvailable,
    additionalObligations: () => false,
  };
  f.ok(
    residentPremisesEvent({
      ...f.context(),
      authorization: auth,
      id: 'hall',
      revision: 1,
      command: {
        type: 'control',
        control: {
          type: 'offer',
          expectedVersion: 1,
          target: { kind: 'resident', id: 'guest' },
          expiresAt: 10000,
          terms: '新控制提议使旧授权版本失效',
        },
      },
    }),
  );
  const snapshot = f.w;
  expect(accept().accepted).toBe(false);
  expect(f.w).toBe(snapshot);
  expect(f.w.agents.user!.balance).toBe(100);
  expect(f.w.premisesRights!.provisions?.paid).toBeUndefined();
});
test('early release settles elapsed availability first, refunds future time and does not fabricate satisfaction', () => {
  const { f, trade, accept } = paidFixture();
  f.ok(accept());
  f.time(20000);
  const d = f.rights('user', { type: 'release', id: 'paid', revision: 2 });
  if (!d.accepted) throw Error(d.reason);
  expect(d.events.map((e) => e.type)).toEqual([
    'ResidentPremisesProvisionCommitted',
    'ResidentPremisesRightsCommitted',
  ]);
  expect(() => applyWorldEvent(f.w, d.events[1]!)).toThrow(
    'provision-must-settle-before-permit-closes',
  );
  f.ok(d);
  f.commit(advanceResidentEvidenceTrade(f.context()));
  expect(f.w.residentTrade!.orders.price).toMatchObject({
    earned: 10,
    escrow: 10,
    refunded: 20,
    status: 'awaiting-confirmation',
  });
  expect(f.w.agents.user!.balance).toBe(90);
  expect(f.w.agents.owner!.balance).toBe(100);
  f.ok(trade('user', { type: 'confirm', id: 'price', expectedRevision: 3 }));
  expect(f.w.agents.owner!.balance).toBe(110);
  f.replay();
});
test('changing ordinary ACL preserves paid grants and flushes the previous physical version before mutation', () => {
  const { f, accept } = paidFixture();
  f.ok(accept());
  f.time(10000);
  const b = f.w.premises!.buildings.hall!;
  const d = residentPremisesEvent({
    ...f.context(),
    authorization: {
      authorize: () => undefined,
      controlAvailable: f.authorization.controllerAvailable,
      additionalObligations: () => false,
    },
    id: 'hall',
    revision: b.revision,
    command: {
      type: 'configure',
      title: '改名',
      access: { entry: 'listed', visitors: [], operators: [], residents: [] },
    },
  });
  if (!d.accepted) throw Error(d.reason);
  expect(d.events[0]!.type).toBe('ResidentPremisesProvisionCommitted');
  expect(() => applyWorldEvent(f.w, d.events[1]!)).toThrow(
    'premises-provision-settlement-required',
  );
  f.ok(d);
  expect(f.w.premisesRights!.provisions!.paid!.availableMs).toBe(10000);
  expect(mayOperateWorldPremises(f.w, 'user', 'room')).toBe(true);
  f.time(50000);
  f.commit(advanceResidentPremisesRights(f.context()));
  f.commit(advanceResidentEvidenceTrade(f.context()));
  expect(f.w.residentTrade!.orders.price).toMatchObject({
    earned: 30,
    refunded: 0,
    status: 'awaiting-confirmation',
  });
  f.replay();
});
test('counter events must cite the actual owning building; segmented time equals one interval and old free permissions have no invented counters', () => {
  const a = paidFixture(),
    b = paidFixture();
  a.f.ok(a.accept());
  b.f.ok(b.accept());
  a.f.time(60000);
  a.f.commit(advanceResidentPremisesRights(a.f.context()));
  for (let i = 0; i < 3; i++) {
    b.f.time(20000);
    b.f.commit(advanceResidentPremisesRights(b.f.context()));
  }
  expect(a.f.w.premisesRights!.provisions!.paid!.availableMs).toBe(
    b.f.w.premisesRights!.provisions!.paid!.availableMs,
  );
  const c = paidFixture();
  c.f.ok(c.accept());
  c.f.time(10000);
  const events = settleResidentPremisesProvisions(c.f.context()),
    e = events[0]!;
  if (e.type !== 'ResidentPremisesProvisionCommitted') throw Error('fixture');
  expect(() =>
    applyWorldEvent(c.f.w, {
      ...e,
      payload: {
        ...e.payload,
        events: e.payload.events.map((v) => ({ ...v, evidence: { ...v.evidence, condition: 0 } })),
      },
    }),
  ).toThrow('provision-building-evidence-mismatch');
  const free = setup();
  free.grant();
  free.time(60000);
  free.commit(advanceResidentPremisesRights(free.context()));
  expect(free.w.premisesRights!.provisions).toBeUndefined();
  a.f.replay();
  b.f.replay();
});
