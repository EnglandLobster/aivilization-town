import {
  residentExitFixture,
  capturedResidentDeparture,
  residentDeathFixture,
} from './testFixtures/residentExit';
import {
  enableServiceEmploymentEvent,
  serviceBusinessAuthorizationEvent,
} from './serviceBusinessAuthorization';
import { enableResidentLaborEvent } from './residentLabor';
import type { WorldCommandPolicies } from './agentActions';
import { RESIDENT_REST_POLICY } from '@aivilization/society';
import { enableServiceTimeEvent } from './serviceTime';
import { describe, expect, it } from 'vitest';
import {
  createCommandEnvelope,
  createEventEnvelope,
  asAgentId,
  asLocationId,
} from '@aivilization/sim-core';
import { PREMISES_POLICY, PUBLIC_LAND_USE_POLICY } from '@aivilization/premises';
import { createMaterialsPolicy } from '@aivilization/materials';
import {
  SERVICE_ENGAGEMENTS_POLICY,
  engagementEscrowBalance,
  type ServiceEngagementCommand,
  type ServiceEngagementTerms,
} from '@aivilization/services';
import { COMMON_ACCOUNTS_POLICY, commonAccountsBalance } from '@aivilization/economy';
import { applyWorldEvent, createWorldProjection } from './projection';
import {
  residentServiceEngagementEvent,
  enableResidentServiceEngagementsEvent,
  advanceResidentServiceEngagements,
} from './residentServiceEngagements';
import {
  enableResidentMaterialsEvent,
  residentMaterialEvent,
  residentMaterialReservationEvent,
  type MaterialAuthorization,
} from './residentMaterials';
import { enableResidentPremisesEvent } from './residentPremises';
import {
  enableCommonAccountsEvent,
  residentCommonAccountEvent,
  type ResidentCommonAccountCommand,
} from './residentCommonAccounts';
import { handleAdvanceSimulationTimeCommand, dispatchWorldCommand } from './agentActions';
import type { WorldEvent } from './events';
import type { ServiceEngagementAuthorization } from './serviceEngagementPorts';
function setup(actualTime = false, providerEnergy = 25.05, business = false, bankruptcy = false) {
  const initial = createWorldProjection({
    agents: ['alice', 'bob', 'charlie', 'dana', 'eve', 'fred'].map((id) => ({
      agentId: asAgentId(id),
      balance: 100,
      inventory: { Apple: 10, Book: 1 },
      physiology: {
        health: actualTime && id === 'charlie' ? 99 : 50,
        energy: actualTime ? (id === 'bob' ? providerEnergy : id === 'charlie' ? 22 : 100) : 100,
        satiety: 50,
      },
      educationScore: id === 'bob' || id === 'eve' ? 10 : 9,
      residentialTier: 1,
      job: null,
      locationId: asLocationId('place'),
    })),
    ...(business
      ? {
          enterprises: [
            {
              enterpriseId: 'firm',
              name: 'Residents choose the business',
              ownerAgentId: asAgentId('fred'),
              occupationName: 'Provider',
              balance: 100,
              inventory: {},
              maxEmployees: 2,
              employeeAgentIds: [asAgentId('bob')],
              employeeWageOffers: { bob: 10 },
              status: 'active' as const,
              foundedAt: 0,
              cumulativeSales: 0,
              cumulativePurchases: 0,
              cumulativeWages: 0,
            },
          ],
        }
      : {}),
    locations: [
      {
        locationId: asLocationId('place'),
        name: 'An ordinary room',
        kind: 'social',
        capacity: 10,
        activityAffinities: business ? ['work'] : [],
        connections: [],
      },
    ],
    moneySupply: business ? 700 : 600,
  });
  let w = initial,
    n = 0;
  const events: WorldEvent[] = [];
  const context = (actorId = 'alice') => ({
    projection: w,
    actorId,
    requestId: `service${++n}`,
    simulationId: 'sim',
    nextSequence: events.length + 1,
  });
  const commit = (es: readonly WorldEvent[]) => {
    let next = w;
    for (const e of es) next = applyWorldEvent(next, e);
    w = next;
    events.push(...es);
    expect(
      Object.values(w.agents).reduce((sum, a) => sum + a.balance, 0) +
        Object.values(w.enterprises).reduce((sum, e) => sum + e.balance, 0) +
        commonAccountsBalance(w.commonAccounts) +
        engagementEscrowBalance(w.serviceEngagements),
    ).toBeCloseTo(w.moneySupply, 8);
  };
  const ok = (
    d: { accepted: true; events: readonly WorldEvent[] } | { accepted: false; reason: string },
  ) => {
    expect(d.accepted, JSON.stringify(d)).toBe(true);
    if (d.accepted) commit(d.events);
  };
  const auth = (actorId: string): ServiceEngagementAuthorization => ({
    controllerAvailable: (c) => (c.kind === 'resident' ? !!w.agents[c.id] : c.id === 'club'),
    authorize: (c) =>
      c.kind === 'collective' && c.id === 'club' && actorId === 'alice'
        ? { actorId, decisionId: 'decision' }
        : undefined,
  });
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
          workMs: 60000,
          energyCost: 1,
          satietyCost: 1,
          minResidentialTier: 1,
        },
      ]),
    }),
  ]);
  ok(
    enableResidentPremisesEvent({
      ...context(),
      policy: PREMISES_POLICY,
      landUsePolicy: PUBLIC_LAND_USE_POLICY,
      sites: [],
    }),
  );
  ok(
    enableResidentServiceEngagementsEvent({
      ...context(),
      policy: SERVICE_ENGAGEMENTS_POLICY,
      facilities: [
        {
          locationId: 'place',
          careStations: 1,
          teachingStations: 1,
          source: 'scenario-seed',
          sourceId: 'explicit-test-assets',
        },
      ],
    }),
  );
  const act = (actorId: string, command: ServiceEngagementCommand) =>
    residentServiceEngagementEvent({
      ...context(actorId),
      authorization: auth(actorId),
      command,
      policies: physicalPolicies,
    });
  const terms = (patch: Partial<ServiceEngagementTerms> = {}): ServiceEngagementTerms => ({
    id: 'svc',
    controller: { kind: 'resident', id: 'alice' },
    title: 'Residents choose its name',
    terms: 'Only actual service; sponsor funds, participants may leave.',
    locationId: 'place',
    providerId: 'bob',
    recipientId: 'charlie',
    payer: { sector: 'agent', id: 'dana' },
    revenue: { sector: 'agent', id: 'alice' },
    providerShareBps: 5000,
    pricePerHour: 36,
    modelId: 'personal-assistance-v1',
    maxDurationMs: 3600000,
    startAt: w.clock.now,
    endAt: w.clock.now + 7200000,
    materials: [],
    ...patch,
  });
  const operation = (actorId: string, type: 'accept' | 'fund' | 'cancel' | 'leave', id = 'svc') =>
    act(actorId, { type, id, expectedRevision: w.serviceEngagements!.engagements[id]!.revision });
  const start = (actorId: string, id = 'svc') =>
    act(actorId, {
      type: 'start',
      id,
      expectedRevision: w.serviceEngagements!.engagements[id]!.revision,
      until: w.serviceEngagements!.engagements[id]!.endAt,
    });
  const prepare = (patch: Partial<ServiceEngagementTerms> = {}) => {
    const t = terms(patch);
    ok(act('alice', { type: 'offer', ...t }));
    ok(operation(t.recipientId, 'accept', t.id));
    ok(operation(t.payer.sector === 'agent' ? t.payer.id : 'alice', 'fund', t.id));
  };
  const physicalPolicies: WorldCommandPolicies = {
    ...(bankruptcy
      ? {
          enterprise: {
            policyVersion: 'service-insolvency-test-v1',
            minimumInitialCapital: 0,
            maximumInitialCapital: 10000,
            maximumEmployees: 10,
            solvency: {
              evaluationCadenceMs: 60000,
              minimumCashBalance: 1000,
              gracePeriodMs: 60000,
            },
          },
        }
      : {}),
    laborPay: { version: 'labor-proportional-pay-v1', referenceSeconds: 3600 },
    satietyRecoveryByCommodity: {},
    maxSatiety: 100,
    wageCalculator: () => 0,
    laborCost: { energyCostPerHour: 0, satietyCostPerHour: 0 },
    criticalThresholds: { energy: 0, health: 0 },
    calendar: {
      policyVersion: 'service-test-calendar-v1',
      dayLengthMs: 86400000,
      phases: [{ phase: 'night' as const, startFraction: 0 }],
      physiologicalDecay: { energyPerHour: 5, satietyPerHour: 1 },
    },
    sleepDeprivation: { energyThreshold: 20, healthDecayPerSecond: 0.01, minHealth: 0 },
  };
  if (actualTime) {
    commit([
      createEventEnvelope({
        id: 'rest',
        simulationId: 'sim',
        sequence: events.length + 1,
        occurredAt: 0,
        type: 'ResidentRestEnabled',
        payload: { policy: RESIDENT_REST_POLICY },
      }),
    ]);
    commit([enableServiceTimeEvent({ ...context(), policies: physicalPolicies })]);
  }
  if (business) {
    commit([enableResidentLaborEvent({ ...context(), policies: physicalPolicies })]);
    commit([enableServiceEmploymentEvent(context())]);
  }
  const time = (deltaMs: number) => {
    commit(
      handleAdvanceSimulationTimeCommand({
        projection: w,
        ...(actualTime ? physicalPolicies : {}),
        nextSequence: events.length + 1,
        command: createCommandEnvelope({
          id: `time${++n}`,
          simulationId: 'sim',
          source: 'system',
          type: 'AdvanceSimulationTime',
          issuedAt: w.clock.now,
          payload: { deltaMs },
        }),
      }),
    );
    commit(advanceResidentServiceEngagements(context('system')));
  };
  const matAuth: MaterialAuthorization = {
    authorize: () => undefined,
    controlAvailable: (c) => (c.kind === 'resident' ? !!w.agents[c.id] : c.id === 'club'),
    mayStoreAt: () => true,
    hasExternalObligation: () => false,
  };
  const supply = (items: Record<string, number>, id = 'svc') => {
    ok(
      residentMaterialEvent({
        ...context('dana'),
        authorization: matAuth,
        command: {
          type: 'create-stock',
          id: `s-${id}`,
          title: 'Actual items',
          locationId: 'place',
        },
      }),
    );
    ok(
      residentMaterialEvent({
        ...context('dana'),
        authorization: matAuth,
        command: { type: 'deposit', id: `s-${id}`, expectedRevision: 1, items },
      }),
    );
    ok(
      residentMaterialReservationEvent({
        ...context('dana'),
        authorization: matAuth,
        command: {
          type: 'offer',
          offer: {
            id: `m-${id}`,
            stockId: `s-${id}`,
            expectedStockRevision: 2,
            items,
            beneficiary: { kind: 'resident', id: 'alice' },
            consumer: { domain: 'services', id },
            terms: 'Only this actual service',
            expiresAt: 7200000,
          },
        },
      }),
    );
  };
  const common = (command: ResidentCommonAccountCommand) =>
    residentCommonAccountEvent({
      ...context(),
      receiptId: `receipt${n}`,
      authorization: {
        isActiveMember: (id, a) => id === 'club' && a === 'alice',
        unresolvedObligations: () => false,
        authorize: () => ({
          accepted: true,
          authority: {
            collectiveId: 'club',
            decisionId: 'decision',
            decisionRevision: 1,
            charterVersion: 1,
          },
        }),
      },
      command,
    });
  const seedCommon = (maxBalance = COMMON_ACCOUNTS_POLICY.maxBalance as number) => {
    commit([
      enableCommonAccountsEvent({
        ...context(),
        at: w.clock.now,
        policy: {
          ...COMMON_ACCOUNTS_POLICY,
          maxBalance,
          maxTransfer: Math.min(maxBalance, COMMON_ACCOUNTS_POLICY.maxTransfer),
        },
      }),
    ]);
    ok(common({ type: 'open', id: 'pool', collectiveId: 'club', title: 'Our fund' }));
    ok(
      common({
        type: 'contribute',
        id: 'pool',
        expectedRevision: 1,
        amount: 36,
        note: 'Actual contribution',
      }),
    );
  };
  return {
    context,
    get w() {
      return w;
    },
    initial,
    events,
    act,
    terms,
    operation,
    start,
    prepare,
    time,
    supply,
    common,
    seedCommon,
    commit,
    ok,
    replay: () => expect(events.reduce(applyWorldEvent, initial)).toEqual(w),
  };
}
describe('resident service application', () => {
  it('reserves common refund headroom so later contributions cannot block an already owed refund', () => {
    const h = setup();
    h.seedCommon(36);
    h.prepare({ payer: { sector: 'collective', id: 'pool' } });
    expect(
      h.common({
        type: 'contribute',
        id: 'pool',
        expectedRevision: h.w.commonAccounts!.accounts.pool!.revision,
        amount: 1,
        note: 'Should not occupy refund space',
      }),
    ).toEqual({ accepted: false, reason: 'unrepresentable-common-account-transfer' });
    h.ok(h.operation('charlie', 'cancel'));
    expect(h.w.commonAccounts!.accounts.pool!.balance).toBe(36);
    h.replay();
  });
  it('pays collectively controlled revenue through the common ledger without minting or assigning members to work', () => {
    const h = setup();
    h.seedCommon();
    h.prepare({
      controller: { kind: 'collective', id: 'club' },
      revenue: { sector: 'collective', id: 'pool' },
    });
    expect(h.start('alice')).toEqual({
      accepted: false,
      reason: 'personal-service-participation-required',
    });
    h.ok(h.start('bob'));
    h.ok(h.start('charlie'));
    h.time(600000);
    expect(h.w.commonAccounts!.accounts.pool!.balance).toBe(39);
    expect(h.w.agents.bob!.balance).toBe(103);
    h.ok(h.operation('charlie', 'leave'));
    h.replay();
  });
  it('atomically reserves real personal time, pays both earners, refunds sponsor and deterministically replays', () => {
    const h = setup();
    h.prepare();
    h.ok(h.start('bob'));
    h.ok(h.start('charlie'));
    expect(h.w.activityTimeByAgent.bob!.commandType).toBe('ResidentServiceWork');
    h.time(600000);
    expect(h.w.serviceEngagements!.engagements.svc!.progressMs).toBe(600000);
    expect(h.w.agents.bob!.balance).toBe(103);
    expect(h.w.agents.alice!.balance).toBe(103);
    h.ok(h.operation('charlie', 'leave'));
    expect(h.w.agents.dana!.balance).toBe(94);
    expect(h.w.activityTimeByAgent.bob!.availableAt).toBe(h.w.clock.now);
    expect(engagementEscrowBalance(h.w.serviceEngagements)).toBe(0);
    h.replay();
  });
  it('consumes actual held food progressively and returns the rest without creating inventory', () => {
    const h = setup();
    h.supply({ Apple: 4 });
    h.prepare({ modelId: 'meal-assistance-v1', materials: [{ id: 'm-svc', revision: 1 }] });
    h.ok(h.start('bob'));
    h.ok(h.start('charlie'));
    h.time(900000);
    expect(h.w.materials!.reservations!.records['m-svc']!.allocated.Apple).toBe(1);
    expect(h.w.agents.charlie!.physiology.satiety).toBe(70);
    h.ok(h.operation('bob', 'leave'));
    expect(h.w.materials!.stocks['s-svc']!.inventory.Apple).toBe(3);
    expect(h.w.agents.dana!.inventory.Apple).toBe(6);
    h.replay();
  });
  it('uses explicit physical teaching assets, keeps books and never awards a formal degree', () => {
    const h = setup();
    h.supply({ Book: 1 });
    h.prepare({ modelId: 'guided-study-v1', materials: [{ id: 'm-svc', revision: 1 }] });
    h.ok(h.start('bob'));
    h.ok(h.start('charlie'));
    h.time(3600000);
    expect(h.w.agents.charlie!.educationScore).toBe(10);
    expect(h.w.agents.charlie!.educationLevel).toBeUndefined();
    expect(h.w.materials!.stocks['s-svc']!.inventory.Book).toBe(1);
    expect(h.w.serviceEngagements!.engagements.svc!.endReason).toBe('completed');
    h.replay();
  });
  it('prevents competing services from sharing one care station and releases it after personal exit', () => {
    const h = setup();
    h.prepare({ modelId: 'supportive-care-v1' });
    h.ok(h.start('bob'));
    h.prepare({
      id: 'next',
      modelId: 'supportive-care-v1',
      providerId: 'eve',
      recipientId: 'fred',
    });
    expect(h.start('eve', 'next')).toEqual({
      accepted: false,
      reason: 'service-facility-unavailable',
    });
    h.ok(h.operation('bob', 'leave'));
    h.ok(h.start('eve', 'next'));
    h.replay();
  });
  it('keeps common refund obligations until termination and refunds into a settling account', () => {
    const h = setup();
    h.seedCommon();
    h.prepare({ payer: { sector: 'collective', id: 'pool' } });
    expect(h.w.commonAccounts!.accounts.pool!.balance).toBe(0);
    h.ok(h.common({ type: 'beginSettlement', id: 'pool', controlVersion: 1 }));
    expect(h.common({ type: 'close', id: 'pool', controlVersion: 2 })).toEqual({
      accepted: false,
      reason: 'common-account-not-settled',
    });
    h.ok(h.operation('charlie', 'cancel'));
    expect(h.w.commonAccounts!.accounts.pool!.balance).toBe(36);
    expect(h.w.commonAccounts!.accounts.pool!.status).toBe('settling');
    h.replay();
  });
  it('does not let an unsolicited offer lock the named payer account and rejects bypassing the personal service port', () => {
    const h = setup();
    h.seedCommon();
    h.ok(
      h.act('alice', {
        type: 'offer',
        ...h.terms({ payer: { sector: 'collective', id: 'pool' } }),
      }),
    );
    h.ok(
      h.common({
        type: 'transfer',
        id: 'pool',
        controlVersion: 1,
        recipient: { sector: 'agent', id: 'alice' },
        amount: 36,
        note: 'Our money',
      }),
    );
    h.ok(h.common({ type: 'beginSettlement', id: 'pool', controlVersion: 1 }));
    h.ok(h.common({ type: 'close', id: 'pool', controlVersion: 2 }));
    h.ok(h.operation('charlie', 'accept'));
    expect(h.operation('alice', 'fund')).toEqual({
      accepted: false,
      reason: 'service-account-unavailable',
    });
    const direct = dispatchWorldCommand({
      projection: h.w,
      policies: {
        satietyRecoveryByCommodity: {},
        maxSatiety: 100,
        wageCalculator: () => 0,
        laborCost: { energyCostPerHour: 1, satietyCostPerHour: 1 },
        criticalThresholds: { energy: 0, health: 0 },
      },
      nextSequence: h.events.length + 1,
      command: createCommandEnvelope({
        id: 'bypass',
        simulationId: 'sim',
        source: 'agent-runtime',
        actorId: 'alice',
        type: 'ResidentServiceWork',
        issuedAt: 0,
        payload: {},
      }),
    });
    expect(direct[0]?.type).toBe('ActionRejected');
    h.replay();
  });
});

it('actual service combines effort and passive time before fees, with exact replay and partition-equivalent health', () => {
  const one = setup(true),
    split = setup(true);
  for (const t of [one, split]) {
    t.prepare({ modelId: 'supportive-care-v1' });
    t.ok(t.start('bob'));
    t.ok(t.start('charlie'));
  }
  one.time(3600000);
  for (let i = 0; i < 120; i++) split.time(30000);
  for (const t of [one, split]) {
    expect(t.w.agents.bob!.physiology.health).toBeCloseTo(26.12, 8);
    expect(t.w.agents.charlie!.physiology.health).toBeCloseTo(80.8, 8);
    expect(t.w.serviceEngagements!.engagements.svc!.progressMs).toBe(3600000);
    expect(t.w.serviceEngagements!.engagements.svc!.charged).toBe(36);
    t.replay();
  }
  expect(one.w.agents.bob!.balance).toBeCloseTo(split.w.agents.bob!.balance, 8);
});

it('service exhaustion releases both people at the actual last productive millisecond, preserves exact charges and rejects forged physical receipts', () => {
  const once = setup(true, 5),
    split = setup(true, 5);
  for (const t of [once, split]) {
    t.prepare({ modelId: 'supportive-care-v1' });
    t.ok(t.start('bob'));
    t.ok(t.start('charlie'));
  }
  once.time(3600000);
  for (const dt of [1199999, 1, 2400000]) split.time(dt);
  for (const t of [once, split]) {
    const e = t.w.serviceEngagements!.engagements.svc!;
    expect(e.progressMs).toBe(1200000);
    expect(e.charged).toBe(12);
    expect(e.refunded).toBe(24);
    expect(e.endReason).toBe('physical-budget-exhausted');
    expect(t.w.activityTimeByAgent.bob!.availableAt).toBe(1200000);
    expect(t.w.activityTimeByAgent.charlie!.availableAt).toBe(1200000);
    t.replay();
  }
  expect(once.w.agents.bob!.physiology.health).toBeCloseTo(
    split.w.agents.bob!.physiology.health,
    8,
  );
  const i = once.events.findIndex(
    (e) => e.type === 'ResidentServiceEngagementsCommitted' && e.payload.elapsedBody,
  );
  const event = once.events[i]!;
  if (event.type !== 'ResidentServiceEngagementsCommitted' || !event.payload.elapsedBody)
    throw Error('missing-service-body');
  const body = event.payload.elapsedBody;
  const before = once.events.slice(0, i).reduce(applyWorldEvent, once.initial);
  expect(() =>
    applyWorldEvent(before, {
      ...event,
      payload: {
        ...event.payload,
        elapsedBody: {
          ...body,
          workedMs: body.workedMs + 1,
        },
      },
    }),
  ).toThrow('service-elapsed-body-proof-mismatch');
  const { elapsedBody, ...missingBody } = event.payload;
  void elapsedBody;
  expect(() => applyWorldEvent(before, { ...event, payload: missingBody })).toThrow(
    'service-elapsed-proof-required',
  );
});

it('independent enterprise permission funds actual service, records expenses and refunds without inventing sales or owner income', () => {
  const t = setup(true, 100, true);
  const grant = (actorId: string) =>
    serviceBusinessAuthorizationEvent({
      ...t.context(actorId),
      enterpriseId: 'firm',
      serviceId: 'svc',
      expectedServiceRevision: t.w.serviceEngagements!.engagements.svc!.revision,
      operation: 'authorize',
      wageBasis: 'none',
    });
  t.ok(
    t.act('alice', {
      type: 'offer',
      ...t.terms({
        payer: { sector: 'enterprise', id: 'firm' },
        revenue: { sector: 'enterprise', id: 'firm' },
      }),
    }),
  );
  t.ok(t.operation('charlie', 'accept'));
  expect(t.operation('fred', 'fund')).toMatchObject({
    accepted: false,
    reason: 'exact-enterprise-service-authorization-required',
  });
  expect(grant('alice').accepted).toBe(false);
  t.ok(grant('fred'));
  expect(t.w.enterprises.firm!.balance).toBe(100);
  expect(t.w.activityTimeByAgent.bob).toBeUndefined();
  t.ok(t.operation('fred', 'fund'));
  expect(t.w.enterprises.firm).toMatchObject({
    balance: 64,
    retainedEarnings: 0,
    cumulativePurchases: 0,
  });
  t.ok(t.start('bob'));
  t.ok(t.start('charlie'));
  t.time(900000);
  const service = t.w.serviceEngagements!.engagements.svc!;
  expect(service.charged).toBe(9);
  expect(t.w.enterprises.firm!.balance).toBeCloseTo(68.5, 8);
  expect(t.w.enterprises.firm!.retainedEarnings).toBeCloseTo(-4.5, 8);
  expect(t.w.enterprises.firm!.cumulativeSales).toBe(0);
  const before = t.w,
    ending = t.operation('charlie', 'leave');
  expect(ending.accepted).toBe(true);
  if (!ending.accepted) return;
  const commit = ending.events.find((e) => e.type === 'ResidentServiceEngagementsCommitted')!;
  const proof = commit.payload.enterpriseAccounting![0]!;
  expect(() =>
    applyWorldEvent(before, {
      ...commit,
      payload: {
        ...commit.payload,
        enterpriseAccounting: [
          { ...proof, event: { ...proof.event, revenueMicros: proof.event.revenueMicros + 1 } },
        ],
      },
    }),
  ).toThrow('service-enterprise-source-proof-mismatch');
  t.ok(ending);
  expect(t.w.enterprises.firm!.balance).toBeCloseTo(95.5, 8);
  expect(t.w.enterprises.firm!.retainedEarnings).toBeCloseTo(-4.5, 8);
  expect(t.w.enterprises.firm).toMatchObject({ cumulativeSales: 0, cumulativePurchases: 0 });
  expect(t.w.enterprises.firm!.serviceBusiness!.contracts.svc).toMatchObject({
    costMicros: 9000000,
    revenueMicros: 4500000,
    refundMicros: 27000000,
  });
  expect(t.w.agents.fred!.balance).toBe(100);
  expect(t.w.agents.bob!.balance).toBeCloseTo(104.5, 8);
  expect(t.w.enterprises.firm!.serviceBusiness!.contracts.svc!.phase).toBe('ended');
  expect(t.events.reduce(applyWorldEvent, t.initial)).toEqual(t.w);
});

it('one actual service body earns the separately accepted employment wage and service share', () => {
  const t = setup(true, 100, true);
  t.ok(
    t.act('alice', {
      type: 'offer',
      ...t.terms({ revenue: { sector: 'enterprise', id: 'firm' } }),
    }),
  );
  t.ok(t.operation('charlie', 'accept'));
  t.ok(
    serviceBusinessAuthorizationEvent({
      ...t.context('fred'),
      enterpriseId: 'firm',
      serviceId: 'svc',
      expectedServiceRevision: t.w.serviceEngagements!.engagements.svc!.revision,
      operation: 'authorize',
      wageBasis: 'effective-service',
    }),
  );
  t.ok(t.operation('dana', 'fund'));
  expect(t.start('bob')).toMatchObject({
    accepted: false,
    reason: 'exact-current-service-employment-acceptance-required',
  });
  const c = t.w.enterprises.firm!.serviceBusiness!.contracts.svc!;
  t.ok(
    t.act('bob', {
      type: 'start',
      id: 'svc',
      expectedRevision: t.w.serviceEngagements!.engagements.svc!.revision,
      expectedEmploymentRevision: c.revision,
      until: 3600000,
    }),
  );
  const claimId = Object.keys(t.w.serviceEmployment!.claims)[0]!;
  expect(t.w.enterprises.firm!.earnedPayroll!.claims[claimId]!.earnedMicros).toBe(0);
  expect(t.w.agents.bob!.balance).toBe(100);
  t.ok(t.start('charlie'));
  t.time(900000);
  expect(t.w.enterprises.firm!.earnedPayroll!.claims[claimId]).toMatchObject({
    elapsedMs: 900000,
    earnedMicros: 2500000,
    paidMicros: 2500000,
  });
  expect(t.w.agents.bob!.balance).toBeCloseTo(107, 8);
  expect(t.w.agents.bob!.physiology.energy).toBeCloseTo(96.25, 8);
  expect(t.w.enterprises.firm!.balance).toBeCloseTo(102, 8);
  t.ok(t.operation('charlie', 'leave'));
  expect(t.w.enterprises.firm!.earnedPayroll!.claims[claimId]!.status).toBe('ended');
  expect(t.w.agents.dana!.balance).toBeCloseTo(91, 8);
  expect(t.events.reduce(applyWorldEvent, t.initial)).toEqual(t.w);
});

it.each(['attendance', 'effective-service'] as const)(
  'service wage basis %s distinguishes actual waiting from delivered service',
  (basis) => {
    const t = setup(true, 100, true);
    t.ok(
      t.act('alice', {
        type: 'offer',
        ...t.terms({ revenue: { sector: 'enterprise', id: 'firm' } }),
      }),
    );
    t.ok(t.operation('charlie', 'accept'));
    t.ok(
      serviceBusinessAuthorizationEvent({
        ...t.context('fred'),
        enterpriseId: 'firm',
        serviceId: 'svc',
        expectedServiceRevision: t.w.serviceEngagements!.engagements.svc!.revision,
        operation: 'authorize',
        wageBasis: basis,
      }),
    );
    t.ok(t.operation('dana', 'fund'));
    t.ok(
      t.act('bob', {
        type: 'start',
        id: 'svc',
        expectedRevision: t.w.serviceEngagements!.engagements.svc!.revision,
        expectedEmploymentRevision: t.w.enterprises.firm!.serviceBusiness!.contracts.svc!.revision,
        until: 3600000,
      }),
    );
    const claimId = Object.keys(t.w.serviceEmployment!.claims)[0]!;
    t.time(900000);
    expect(t.w.serviceEngagements!.engagements.svc).toMatchObject({ progressMs: 0, charged: 0 });
    expect(t.w.enterprises.firm!.earnedPayroll!.claims[claimId]!.earnedMicros).toBe(
      basis === 'attendance' ? 2500000 : 0,
    );
    expect(t.w.agents.bob!.physiology.energy).toBeCloseTo(98.75, 8);
    t.ok(t.start('charlie'));
    t.time(900000);
    t.ok(t.operation('charlie', 'leave'));
    const wages = basis === 'attendance' ? 5 : 2.5;
    expect(t.w.enterprises.firm!.earnedPayroll!.claims[claimId]).toMatchObject({
      earnedMicros: wages * 1e6,
      paidMicros: wages * 1e6,
      status: 'ended',
    });
    expect(t.w.agents.bob!.balance).toBeCloseTo(104.5 + wages, 8);
    expect(t.w.serviceEngagements!.engagements.svc).toMatchObject({ charged: 9, refunded: 27 });
    expect(t.w.agents.bob!.physiology.energy).toBeCloseTo(95, 8);
    expect(t.events.reduce(applyWorldEvent, t.initial)).toEqual(t.w);
  },
);

it('actual service common-account receipts use each source interval time during a multi-boundary advance', () => {
  const t = setup(true, 100, true);
  t.seedCommon();
  t.prepare({
    controller: { kind: 'collective', id: 'club' },
    revenue: { sector: 'collective', id: 'pool' },
  });
  t.ok(t.start('bob'));
  t.ok(t.start('charlie'));
  t.time(600000);
  expect(t.w.commonAccounts!.accounts.pool!.balance).toBeCloseTo(39, 8);
  expect(t.w.agents.bob!.balance).toBeCloseTo(103, 8);
  expect(t.w.serviceEngagements!.engagements.svc!.charged).toBe(6);
  expect(t.events.reduce(applyWorldEvent, t.initial)).toEqual(t.w);
});

it('actual waiting stops at loss of health, preserves exact wage across time partitions and rejects missing attendance proof', () => {
  const once = setup(true, 0, true),
    split = setup(true, 0, true);
  for (const t of [once, split]) {
    t.ok(
      t.act('alice', {
        type: 'offer',
        ...t.terms({ revenue: { sector: 'enterprise', id: 'firm' } }),
      }),
    );
    t.ok(t.operation('charlie', 'accept'));
    t.ok(
      serviceBusinessAuthorizationEvent({
        ...t.context('fred'),
        enterpriseId: 'firm',
        serviceId: 'svc',
        expectedServiceRevision: t.w.serviceEngagements!.engagements.svc!.revision,
        operation: 'authorize',
        wageBasis: 'attendance',
      }),
    );
    t.ok(t.operation('dana', 'fund'));
    t.ok(
      t.act('bob', {
        type: 'start',
        id: 'svc',
        expectedRevision: t.w.serviceEngagements!.engagements.svc!.revision,
        expectedEmploymentRevision: t.w.enterprises.firm!.serviceBusiness!.contracts.svc!.revision,
        until: 7200000,
      }),
    );
  }
  once.time(8000000);
  for (const delta of [4999998, 1, 1, 3000000]) split.time(delta);
  for (const t of [once, split]) {
    const claim = Object.values(t.w.enterprises.firm!.earnedPayroll!.claims)[0]!;
    expect(t.w.serviceEngagements!.engagements.svc).toMatchObject({
      status: 'ended',
      progressMs: 0,
      charged: 0,
      refunded: 36,
      endReason: 'physical-budget-exhausted',
    });
    expect(claim.status).toBe('ended');
    expect(claim.elapsedMs).toBe(4999999);
    expect(claim.earnedMicros).toBe(Math.floor((20000000 * 4999999) / 7200000));
    expect(claim.paidMicros).toBe(claim.earnedMicros);
    expect(t.w.activityTimeByAgent.bob!.availableAt).toBe(4999999);
    expect(t.w.agents.bob!.physiology.health).toBe(0);
    expect(t.events.reduce(applyWorldEvent, t.initial)).toEqual(t.w);
  }
  const i = once.events.findIndex(
    (e) => e.type === 'ResidentServiceEngagementsCommitted' && e.payload.elapsedAttendance,
  );
  const event = once.events[i]!;
  if (event.type !== 'ResidentServiceEngagementsCommitted' || !event.payload.elapsedAttendance)
    throw Error('missing-attendance-fixture');
  const before = once.events.slice(0, i).reduce(applyWorldEvent, once.initial);
  const { elapsedAttendance, ...missing } = event.payload;
  expect(() => applyWorldEvent(before, { ...event, payload: missing })).toThrow(
    'service-attendance-proof-required',
  );
  expect(() =>
    applyWorldEvent(before, {
      ...event,
      payload: {
        ...event.payload,
        elapsedAttendance: { ...elapsedAttendance, attendedMs: elapsedAttendance.attendedMs + 1 },
      },
    }),
  ).toThrow('service-attendance-body-proof-mismatch');
});

it.each(['none', 'attendance'] as const)(
  'bankruptcy preserves service assets and obligations for %s authorization',
  (wageBasis) => {
    const t = setup(true, 100, true, true);
    t.ok(
      t.act('alice', {
        type: 'offer',
        ...t.terms({
          payer: { sector: 'enterprise', id: 'firm' },
          revenue: { sector: 'enterprise', id: 'firm' },
        }),
      }),
    );
    t.ok(t.operation('charlie', 'accept'));
    t.ok(
      serviceBusinessAuthorizationEvent({
        ...t.context('fred'),
        enterpriseId: 'firm',
        serviceId: 'svc',
        expectedServiceRevision: t.w.serviceEngagements!.engagements.svc!.revision,
        operation: 'authorize',
        wageBasis,
      }),
    );
    t.ok(t.operation('fred', 'fund'));
    if (wageBasis !== 'none')
      t.ok(
        t.act('bob', {
          type: 'start',
          id: 'svc',
          expectedRevision: t.w.serviceEngagements!.engagements.svc!.revision,
          expectedEmploymentRevision:
            t.w.enterprises.firm!.serviceBusiness!.contracts.svc!.revision,
          until: 3600000,
        }),
      );
    t.time(120000);
    expect(t.w.enterprises.firm!.status).toBe('bankrupt');
    if (wageBasis === 'none') {
      expect(t.w.serviceEngagements!.engagements.svc!.status).toBe('funded');
      expect(t.w.enterprises.firm!.balance).toBe(64);
      t.ok(t.operation('alice', 'cancel'));
      expect(t.w.enterprises.firm!.balance).toBe(100);
    } else {
      const claim = Object.values(t.w.enterprises.firm!.earnedPayroll!.claims)[0]!;
      expect(claim).toMatchObject({
        status: 'ended',
        elapsedMs: 120000,
        earnedMicros: 333333,
        paidMicros: 333333,
      });
      expect(t.w.enterprises.firm!.balance).toBeCloseTo(100 - 0.333333, 8);
      expect(t.w.activityTimeByAgent.bob!.availableAt).toBe(120000);
    }
    expect(t.w.serviceEngagements!.engagements.svc).toMatchObject({
      status: 'ended',
      charged: 0,
      refunded: 36,
    });
    expect(t.w.enterprises.firm!.serviceBusiness!.contracts.svc!.phase).toBe('ended');
    expect(t.events.reduce(applyWorldEvent, t.initial)).toEqual(t.w);
  },
);

it('a departed original sponsor receives distinct earned revenue and unused refund without acquiring a body or losing the gross ledger', () => {
  const h = setup();
  h.prepare({ payer: { sector: 'agent', id: 'alice' } });
  for (const actor of ['bob', 'charlie'])
    h.ok(
      h.act(actor, {
        type: 'start',
        id: 'svc',
        expectedRevision: h.w.serviceEngagements!.engagements.svc!.revision,
        until: 1000,
      }),
    );
  const prepared = { ...h.w, residentExits: residentExitFixture().residentExits };
  const death = residentDeathFixture();
  const departed = applyWorldEvent(
    prepared,
    capturedResidentDeparture(prepared, {
      ...death,
      id: 'sponsor-death' as typeof death.id,
      payload: { ...death.payload, agentId: asAgentId('alice') },
    }),
  );
  const w = { ...departed, clock: { ...departed.clock, now: 1000 } },
    before = structuredClone(w);
  const events = advanceResidentServiceEngagements({
    projection: w,
    requestId: 'gross-service',
    simulationId: 'sim',
    nextSequence: 100,
  });
  const after = events.reduce(applyWorldEvent, w);
  expect(after.agents.alice).toBeUndefined();
  expect(after.serviceEngagements!.engagements.svc!.status).toBe('ended');
  expect(after.serviceEngagements!.engagements.svc!.progressMs).toBe(1000);
  expect(engagementEscrowBalance(after.serviceEngagements)).toBe(0);
  const event = events.find((e) => e.type === 'ResidentServiceEngagementsCommitted')!;
  if (event.type !== 'ResidentServiceEngagementsCommitted') throw Error('expected service event');
  expect(
    event.payload.estateCashBatch!.effects.filter((e) => e.resolution.mappings.length),
  ).toHaveLength(2);
  const estate = Object.values(after.residentExits!.cash.accounts)[0]!;
  expect(estate.balance).toBeCloseTo(100 - 0.005, 8);
  expect(
    Object.values(after.agents).reduce((sum, a) => sum + a.balance, 0) + estate.balance,
  ).toBeCloseTo(after.moneySupply, 8);
  expect(events.reduce(applyWorldEvent, structuredClone(before))).toEqual(after);
  const { estateCashBatch, ...without } = event.payload;
  expect(estateCashBatch).toBeDefined();
  expect(() => applyWorldEvent(w, { ...event, payload: without })).toThrow(
    'service-estate-receipt-coverage-mismatch',
  );
  expect(() => applyWorldEvent(after, event)).toThrow();
  expect(w).toEqual(before);
});

for (const actualTime of [false, true])
  for (const departedId of ['bob', 'charlie'])
    it(`preserves settled work and stops both service presences after ${departedId} exits (actual time ${actualTime})`, () => {
      const h = setup(actualTime, 100);
      h.prepare();
      h.ok(h.start('bob'));
      h.ok(h.start('charlie'));
      h.time(1000);
      const earned = structuredClone(h.w.serviceEngagements!.engagements.svc!);
      expect(earned.progressMs).toBeGreaterThan(0);
      const prepared = { ...h.w, residentExits: residentExitFixture().residentExits };
      const raw = residentDeathFixture();
      const death = {
        ...raw,
        occurredAt: prepared.clock.now,
        payload: { ...raw.payload, agentId: asAgentId(departedId), diedAt: prepared.clock.now },
      };
      const w = applyWorldEvent(prepared, capturedResidentDeparture(prepared, death));
      const before = structuredClone(w);
      const events = advanceResidentServiceEngagements({
        projection: w,
        requestId: 'participant-exit',
        simulationId: 'sim',
        nextSequence: 100,
      });
      const after = events.reduce(applyWorldEvent, w),
        service = after.serviceEngagements!.engagements.svc!;
      expect(service).toMatchObject({
        status: 'ended',
        endReason: 'participant-unavailable',
        progressMs: earned.progressMs,
        charged: earned.charged,
        providerPaid: earned.providerPaid,
        revenuePaid: earned.revenuePaid,
        escrow: 0,
      });
      expect(service.providerPresence).toBeUndefined();
      expect(service.recipientPresence).toBeUndefined();
      expect(after.agents[departedId]).toBeUndefined();
      const survivor = departedId === 'bob' ? 'charlie' : 'bob';
      expect(after.activityTimeByAgent[survivor]?.availableAt ?? 0).toBeLessThanOrEqual(
        after.clock.now,
      );
      expect(after.agents.dana!.balance).toBeCloseTo(100 - earned.charged, 8);
      const estate = Object.values(after.residentExits!.cash.accounts)[0]!;
      expect(estate.balance).toBe(prepared.agents[departedId]!.balance);
      expect(
        Object.values(after.agents).reduce((sum, a) => sum + a.balance, 0) + estate.balance,
      ).toBeCloseTo(after.moneySupply, 8);
      expect(events.reduce(applyWorldEvent, structuredClone(before))).toEqual(after);
      expect(w).toEqual(before);
    });
