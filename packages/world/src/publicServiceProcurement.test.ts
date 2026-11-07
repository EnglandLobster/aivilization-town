import { expect, test } from 'vitest';
import { asAgentId, asLocationId, createCommandEnvelope } from '@aivilization/sim-core';
import { createMaterialsPolicy } from '@aivilization/materials';
import { PREMISES_POLICY, PUBLIC_LAND_USE_POLICY } from '@aivilization/premises';
import {
  SERVICE_ENGAGEMENTS_POLICY,
  engagementEscrowBalance,
  type ServiceEngagementCommand,
  type ServiceEngagementTerms,
} from '@aivilization/services';
import type { PublicAction, PublicCommand } from '@aivilization/governance';
import { createWorldProjection, applyWorldEvent } from './projection';
import { enableResidentMaterialsEvent } from './residentMaterials';
import { enableResidentPremisesEvent } from './residentPremises';
import {
  enableResidentServiceEngagementsEvent,
  residentServiceEngagementEvent,
  advanceResidentServiceEngagements,
} from './residentServiceEngagements';
import {
  enableResidentPublicGovernanceEvent,
  residentPublicGovernanceCommand,
} from './residentPublicGovernance';
import { enableResidentPublicProcurementEvent } from './publicServiceProcurement';
import { dispatchWorldCommand } from './agentActions';
import type { WorldEvent } from './events';

function fixture(treasury = 100) {
  const initial = createWorldProjection({
    agents: ['a', 'b', 'c'].map((id) => ({
      agentId: asAgentId(id),
      balance: 100,
      inventory: {},
      physiology: { energy: 100, satiety: 100, health: 50 },
      educationScore: 10,
      residentialTier: 1,
      job: null,
      locationId: asLocationId('place'),
    })),
    locations: [
      {
        locationId: asLocationId('place'),
        name: 'Place',
        kind: 'social',
        capacity: 10,
        activityAffinities: [],
        connections: [],
      },
    ],
    treasury,
    moneySupply: 300 + treasury,
  });
  let w = initial,
    n = 0;
  const events: WorldEvent[] = [];
  const ctx = (actorId = 'a') => ({
    projection: w,
    actorId,
    requestId: `procurement-${++n}`,
    simulationId: 'test',
    nextSequence: events.length + 1,
  });
  const commit = (es: readonly WorldEvent[]) => {
    const next = es.reduce(applyWorldEvent, w);
    expect(next.moneySupply).toBe(initial.moneySupply);
    expect(
      Object.values(next.agents).reduce((sum, a) => sum + a.balance, 0) +
        (next.treasury ?? 0) +
        engagementEscrowBalance(next.serviceEngagements),
    ).toBeCloseTo(initial.moneySupply, 8);
    w = next;
    events.push(...es);
  };
  const ok = (
    d: { accepted: true; events: readonly WorldEvent[] } | { accepted: false; reason: string },
  ) => {
    expect(d.accepted, JSON.stringify(d)).toBe(true);
    if (!d.accepted) throw Error(d.reason);
    commit(d.events);
    return d.events;
  };
  commit([
    enableResidentMaterialsEvent({
      ...ctx(),
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
      ...ctx(),
      policy: PREMISES_POLICY,
      landUsePolicy: PUBLIC_LAND_USE_POLICY,
      sites: [],
    }),
  );
  ok(enableResidentServiceEngagementsEvent({ ...ctx(), policy: SERVICE_ENGAGEMENTS_POLICY }));
  commit([
    enableResidentPublicGovernanceEvent({
      ...ctx(),
      institutionPolicy: {
        policyVersion: 'test-bound-v1',
        allowedBudgetServices: ['healthcare'],
        maximumAllocationPerCadence: 100,
        maximumTreasuryReserve: 1000,
        maximumSubsidyBalanceFloor: 100,
        maximumSubsidyPerCadence: 10,
      },
      grant: {
        id: 'town',
        source: {
          kind: 'explicit-scenario-grant',
          version: 'test-v1',
          description: 'Explicit test grant',
        },
        residents: ['a', 'b', 'c'],
        actions: ['set-tax', 'set-budget', 'set-subsidy', 'set-procedure', 'invalidate-decision'],
      },
      procedure: {
        electorate: ['a', 'b', 'c'],
        minimumTurnout: 2,
        minimumYes: 2,
        allowVoteChanges: true,
        minimumVotingMs: 100,
        maximumVotingMs: 1000,
        executionWindowMs: 10000,
        executors: 'electorate',
      },
    }),
  ]);
  const service = (actor: string, command: ServiceEngagementCommand) =>
    residentServiceEngagementEvent({
      ...ctx(actor),
      command,
      authorization: {
        authorize: () => undefined,
        controllerAvailable: (c) => c.kind === 'resident' && !!w.agents[c.id],
      },
    });
  const terms: ServiceEngagementTerms = {
    id: 'svc',
    controller: { kind: 'resident', id: 'a' },
    title: 'Residents choose the service',
    terms: 'Public payer; voluntary actual assistance.',
    locationId: 'place',
    providerId: 'a',
    recipientId: 'b',
    payer: { sector: 'treasury', id: 'public-treasury' },
    revenue: { sector: 'agent', id: 'a' },
    providerShareBps: 5000,
    pricePerHour: 36,
    modelId: 'personal-assistance-v1',
    maxDurationMs: 3600000,
    startAt: 0,
    endAt: 7200000,
    materials: [],
  };
  const gov = (
    command: PublicCommand | { type: 'execute'; id: string; expectedRevision: number },
    actor = 'a',
  ) => residentPublicGovernanceCommand({ ...ctx(actor), command });
  const time = (deltaMs: number, staleBudget = false) => {
    commit(
      dispatchWorldCommand({
        projection: w,
        nextSequence: events.length + 1,
        policies: {
          satietyRecoveryByCommodity: {},
          maxSatiety: 100,
          wageCalculator: () => 0,
          laborCost: { energyCostPerHour: 0, satietyCostPerHour: 0 },
          criticalThresholds: { energy: 0, health: 0 },
          ...(staleBudget
            ? {
                publicBudget: {
                  policyVersion: 'old-budget',
                  cadenceMs: 60000,
                  minimumTreasuryReserve: 0,
                  allocations: [{ service: 'healthcare', amountPerCadence: 10 }],
                },
              }
            : {}),
        },
        command: createCommandEnvelope({
          id: `time-${++n}`,
          simulationId: 'test',
          type: 'AdvanceSimulationTime',
          source: 'system',
          payload: { deltaMs },
          issuedAt: w.clock.now,
        }),
      }),
    );
    commit(advanceResidentServiceEngagements(ctx('system')));
  };
  const revision = (id = 'p') => w.publicGovernance!.authority.proposals[id]!.revision;
  const approve = (
    action: PublicAction = {
      kind: 'fund-service',
      engagementId: 'svc',
      expectedRevision: 2,
      maximumCharge: 36,
    },
    id = 'p',
  ) => {
    ok(
      gov({
        type: 'propose',
        id,
        action,
        text: 'A chosen public purchase.',
        closesAt: w.clock.now + 100,
        expectedProcedureRevision: 1,
      }),
    );
    for (const a of ['a', 'b'])
      ok(gov({ type: 'vote', id, expectedRevision: revision(id), choice: 'yes' }, a));
    time(100);
    ok(gov({ type: 'close', id, expectedRevision: revision(id) }));
  };
  return {
    get w() {
      return w;
    },
    initial,
    events,
    ctx,
    commit,
    ok,
    service,
    terms,
    gov,
    time,
    revision,
    approve,
    enable: () => commit([enableResidentPublicProcurementEvent(ctx())]),
    prepare: () => {
      ok(service('a', { type: 'offer', ...terms }));
      ok(service('b', { type: 'accept', id: 'svc', expectedRevision: 1 }));
    },
    execute: () => gov({ type: 'execute', id: 'p', expectedRevision: revision() }),
    replay: () => expect(events.reduce(applyWorldEvent, initial)).toEqual(w),
  };
}

test('public treasury funds one approved contract atomically, actual joint time is paid, and unearned escrow returns to treasury', () => {
  const t = fixture();
  expect(t.service('a', { type: 'offer', ...t.terms }).accepted).toBe(false);
  t.enable();
  t.prepare();
  expect(t.service('a', { type: 'fund', id: 'svc', expectedRevision: 2 })).toMatchObject({
    accepted: false,
    reason: 'service-payer-authority-required',
  });
  t.approve();
  const es = t.ok(t.execute());
  expect(es).toHaveLength(1);
  expect(t.w.treasury).toBe(64);
  expect(t.w.serviceEngagements!.engagements.svc).toMatchObject({
    status: 'funded',
    escrow: 36,
    progressMs: 0,
    fundingDecisionId: 'p',
  });
  expect(t.execute().accepted).toBe(false);
  for (const a of ['a', 'b'])
    t.ok(
      t.service(a, {
        type: 'start',
        id: 'svc',
        expectedRevision: t.w.serviceEngagements!.engagements.svc!.revision,
        until: 3600100,
      }),
    );
  t.time(600000, true);
  expect(t.w.serviceEngagements!.engagements.svc).toMatchObject({
    progressMs: 600000,
    charged: 6,
    escrow: 30,
  });
  t.ok(
    t.service('b', {
      type: 'leave',
      id: 'svc',
      expectedRevision: t.w.serviceEngagements!.engagements.svc!.revision,
    }),
  );
  expect(t.w.treasury).toBe(94);
  expect(t.w.agents.a!.balance).toBe(106);
  expect(t.w.serviceEngagements!.engagements.svc).toMatchObject({
    refunded: 30,
    charged: 6,
    status: 'ended',
  });
  expect(t.events.some((e) => e.type === 'PublicBudgetSpent')).toBe(false);
  t.replay();
});

test('insufficient treasury, stale contracts and mismatched amounts leave the approved authority and all balances untouched', () => {
  for (const [treasury, amount, reason] of [
    [35, 36, 'insufficient-service-funding'],
    [100, 35, 'public-service-terms-or-consent-mismatch'],
  ] as const) {
    const t = fixture(treasury);
    t.enable();
    t.prepare();
    t.approve({
      kind: 'fund-service',
      engagementId: 'svc',
      expectedRevision: 2,
      maximumCharge: amount,
    });
    const before = structuredClone(t.w);
    expect(t.execute()).toMatchObject({ accepted: false, reason });
    expect(t.w).toEqual(before);
    expect(t.w.publicGovernance!.authority.proposals.p!.status).toBe('approved');
    t.replay();
  }
  const t = fixture();
  t.enable();
  t.prepare();
  t.approve();
  t.ok(t.service('b', { type: 'cancel', id: 'svc', expectedRevision: 2 }));
  expect(t.execute()).toMatchObject({
    accepted: false,
    reason: 'public-service-revision-conflict',
  });
  expect(t.w.publicGovernance!.authority.proposals.p!.status).toBe('approved');
  t.replay();
});

test('replay rejects detached funding, missing service effects, substituted recipients and unrelated state transitions', () => {
  const t = fixture();
  t.enable();
  t.prepare();
  t.approve();
  const d = t.execute();
  if (!d.accepted) throw Error(d.reason);
  const e = d.events[0]!;
  if (e.type !== 'ResidentPublicGovernanceCommitted' || !e.payload.serviceCommit)
    throw Error('fixture');
  const service = e.payload.serviceCommit;
  expect(() =>
    applyWorldEvent(t.w, { ...e, type: 'ResidentServiceEngagementsCommitted', payload: service }),
  ).toThrow('exact-public-procurement-composite-event-required');
  const { serviceCommit, ...without } = e.payload;
  void serviceCommit;
  expect(() => applyWorldEvent(t.w, { ...e, payload: without })).toThrow(
    'public-service-effect-mismatch',
  );
  const changed = service.events[0];
  if (changed?.type !== 'ServiceEngagementChanged') throw Error('fixture');
  expect(() =>
    applyWorldEvent(t.w, {
      ...e,
      payload: {
        ...e.payload,
        serviceCommit: {
          ...service,
          events: [{ ...changed, engagement: { ...changed.engagement, recipientId: 'c' } }],
        },
      },
    }),
  ).toThrow('invalid-service-engagement-event');
  expect(() =>
    applyWorldEvent(t.w, {
      ...e,
      payload: {
        ...e.payload,
        serviceCommit: {
          ...service,
          events: [{ ...changed, engagement: { ...changed.engagement, status: 'accepted' } }],
        },
      },
    }),
  ).toThrow('unrelated-public-service-effects');
  expect(t.w.treasury).toBe(100);
  t.ok(d);
  t.replay();
});

test('procurement activation preserves old votes, records its source and prevents reintroducing abstract automatic spending', () => {
  const t = fixture();
  t.approve({
    kind: 'set-budget',
    expectedRevision: 0,
    terms: {
      cadenceMs: 60000,
      minimumTreasuryReserve: 0,
      allocations: [{ service: 'healthcare', amountPerCadence: 10 }],
    },
  });
  const old = structuredClone(t.w.publicGovernance!.authority.proposals);
  t.enable();
  expect(t.w.publicGovernance!.authority.proposals).toEqual(old);
  expect(t.w.governance).toMatchObject({
    publicBudget: { allocations: [] },
    lastChangedBy: { kind: 'operator' },
  });
  expect(t.execute()).toMatchObject({
    accepted: false,
    reason: 'abstract-budget-disabled-by-public-procurement',
  });
  expect(() => t.enable()).toThrow('public-procurement-already-enabled');
  t.replay();
});

test('the currently enacted treasury reserve constrains procurement and multi-cadence refunds remain equivalent', () => {
  const t = fixture();
  t.enable();
  t.prepare();
  t.approve(
    {
      kind: 'set-budget',
      expectedRevision: 1,
      terms: { cadenceMs: 60000, minimumTreasuryReserve: 65, allocations: [] },
    },
    'reserve',
  );
  t.ok(t.gov({ type: 'execute', id: 'reserve', expectedRevision: t.revision('reserve') }));
  t.approve();
  expect(t.execute()).toMatchObject({ accepted: false, reason: 'insufficient-service-funding' });
  t.replay();
  const results = [false, true].map((split) => {
    const f = fixture();
    f.enable();
    f.prepare();
    f.approve();
    f.ok(f.execute());
    for (const actor of ['a', 'b'])
      f.ok(
        f.service(actor, {
          type: 'start',
          id: 'svc',
          expectedRevision: f.w.serviceEngagements!.engagements.svc!.revision,
          until: 3600100,
        }),
      );
    if (split) for (let i = 0; i < 6; i++) f.time(100000);
    else f.time(600000);
    f.ok(
      f.service('b', {
        type: 'leave',
        id: 'svc',
        expectedRevision: f.w.serviceEngagements!.engagements.svc!.revision,
      }),
    );
    f.replay();
    return {
      treasury: f.w.treasury,
      money: f.w.agents.a!.balance,
      conditions: Object.values(f.w.agents).map((a) => a.physiology),
      refund: f.w.serviceEngagements!.engagements.svc!.refunded,
    };
  });
  expect(results[0]).toEqual(results[1]);
});
