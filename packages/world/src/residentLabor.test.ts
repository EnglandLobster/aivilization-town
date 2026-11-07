import {
  asAgentId,
  asLocationId,
  createCommandEnvelope,
  createEventEnvelope,
  type CoreCommandType,
} from '@aivilization/sim-core';
import { RESIDENT_REST_POLICY } from '@aivilization/society';
import { expect, test } from 'vitest';
import { estateCashBalance } from '@aivilization/economy';
import { residentLaborCommit, stopUnavailableResidentLabor } from './residentLabor';
import {
  capturedResidentDeparture,
  residentDeathFixture,
  residentExitFixture,
} from './testFixtures/residentExit';
import {
  applyWorldEvent,
  createWorldProjection,
  dispatchWorldCommand,
  enableResidentLaborEvent,
  prepareResidentEmploymentDeparture,
  type WorldCommandPolicies,
  type WorldEvent,
  type WorldProjection,
} from './index';

function fixture(
  options: {
    cash?: number;
    legacy?: number;
    enabled?: boolean;
    lifecycle?: boolean;
    taxRate?: number;
  } = {},
) {
  const cash = options.cash ?? 50;
  const policies: WorldCommandPolicies = {
    satietyRecoveryByCommodity: {},
    maxSatiety: 100,
    sleep: { energyRecoveryPerSecond: 0.1, maxEnergy: 100 },
    wageCalculator: () => 100,
    laborPay: { version: 'labor-proportional-pay-v1', referenceSeconds: 3600 },
    laborCost: { energyCostPerHour: 12, satietyCostPerHour: 5 },
    criticalThresholds: { energy: 0, health: 0 },
    calendar: {
      policyVersion: 'town-calendar-v1',
      dayLengthMs: 86400000,
      phases: [{ phase: 'night', startFraction: 0 }],
      physiologicalDecay: { energyPerHour: 2, satietyPerHour: 3 },
    },
    tax: {
      policyVersion: 'labor-test-tax-v1',
      source: 'test',
      neutralRate: options.taxRate ?? 0.1,
      incomeTaxBrackets: [{ upToAmount: null, rate: options.taxRate ?? 0.1 }],
      tradeTaxRate: 0,
    },
    enterprise: {
      policyVersion: 'enterprise-v2',
      minimumInitialCapital: 0,
      maximumInitialCapital: 10000,
      maximumEmployees: 10,
      ...(options.lifecycle
        ? {
            solvency: { evaluationCadenceMs: 60000, minimumCashBalance: 1, gracePeriodMs: 120000 },
            dividend: { paymentCadenceMs: 60000, minimumCashReserve: 0, payoutRatio: 1 },
          }
        : {}),
    },
  };
  const initial = createWorldProjection({
    agents: ['alice', 'bob', 'owner'].map((id) => ({
      agentId: asAgentId(id),
      locationId: asLocationId('workshop'),
      balance: id === 'owner' ? 1000 : 0,
      job: id === 'owner' ? null : 'Maker',
      inventory: {},
      residentialTier: 1,
      educationScore: 0,
      physiology: { energy: 100, satiety: 100, health: 100 },
    })),
    enterprises: [
      {
        enterpriseId: 'firm',
        name: 'Firm',
        ownerAgentId: asAgentId('owner'),
        occupationName: 'Maker',
        balance: cash,
        inventory: {},
        maxEmployees: 5,
        employeeAgentIds: [asAgentId('alice'), asAgentId('bob')],
        status: 'active',
        foundedAt: 0,
        cumulativeSales: 100,
        cumulativePurchases: 0,
        cumulativeWages: 0,
        wageArrears: options.legacy ?? 0,
        employeeWageOffers: { alice: 100, bob: 100 },
      },
    ],
    treasury: 100,
    moneySupply: 1100 + cash,
    locations: [
      {
        locationId: asLocationId('workshop'),
        name: 'Scenario work venue',
        kind: 'production',
        activityAffinities: ['work', 'produce'],
        capacity: 10,
      },
    ],
  });
  let w = initial,
    n = 0;
  const events: WorldEvent[] = [];
  const commit = (es: readonly WorldEvent[]) => {
    for (const e of es) {
      w = applyWorldEvent(w, e);
      events.push(e);
      expect(
        Object.values(w.agents).reduce((sum, a) => sum + a.balance, 0) +
          Object.values(w.enterprises).reduce((sum, a) => sum + a.balance, 0) +
          (w.treasury ?? 0),
      ).toBeCloseTo(w.moneySupply, 8);
    }
  };
  commit([
    createEventEnvelope({
      id: 'rest',
      simulationId: 'labor-world',
      sequence: 1,
      occurredAt: 0,
      type: 'ResidentRestEnabled',
      payload: { policy: RESIDENT_REST_POLICY },
    }),
  ]);
  const enable = () =>
    commit([
      enableResidentLaborEvent({
        projection: w,
        policies,
        requestId: `enable-${++n}`,
        simulationId: 'labor-world',
        nextSequence: events.length + 1,
      }),
    ]);
  if (options.enabled !== false) enable();
  const act = (type: CoreCommandType, payload: unknown, actorId = 'alice') => {
    const es = dispatchWorldCommand({
      projection: w,
      policies,
      nextSequence: events.length + 1,
      command: createCommandEnvelope({
        id: `labor-command-${++n}`,
        simulationId: 'labor-world',
        type,
        payload,
        issuedAt: w.clock.now,
        ...(type === 'AdvanceSimulationTime' ? { source: 'system' as const } : { actorId }),
      }),
    });
    commit(es);
    return es;
  };
  return {
    initial,
    events,
    policies,
    commit,
    enable,
    act,
    get w() {
      return w;
    },
    work: (actorId = 'alice', seconds = 3600) =>
      act('AgentWork', { occupationName: 'Maker', laborSeconds: seconds }, actorId),
    time: (deltaMs: number) => act('AdvanceSimulationTime', { deltaMs }),
    session: (actorId = 'alice') =>
      Object.values(w.residentLabor!.process.sessions).find((s) => s.actorId === actorId)!,
    claim: (actorId = 'alice') =>
      Object.values(w.enterprises.firm!.earnedPayroll!.claims).find((c) => c.actorId === actorId)!,
    replay: () => expect(events.reduce(applyWorldEvent, initial)).toEqual(w),
  };
}

test('actual enterprise labor starts without pay or body cost, then pays earned wages and tax, and personally stops future effort', () => {
  const t = fixture();
  t.work();
  expect(t.w.agents.alice).toMatchObject({
    balance: 0,
    physiology: { energy: 100, satiety: 100, health: 100 },
  });
  expect(t.claim().earnedMicros).toBe(0);
  t.time(900000);
  expect(t.w.agents.alice!.balance).toBeCloseTo(22.5, 8);
  expect(t.w.agents.alice!.physiology.energy).toBeCloseTo(96.5, 8);
  expect(t.w.enterprises.firm!.balance).toBeCloseTo(25, 8);
  expect(t.w.treasury).toBeCloseTo(102.5, 8);
  const s = t.session();
  t.act('AgentStopWork', { id: s.id, expectedRevision: s.revision });
  expect(t.session().status).toBe('interrupted');
  expect(t.w.activityTimeByAgent.alice!.availableAt).toBe(900000);
  t.time(900000);
  expect(t.w.agents.alice!.balance).toBeCloseTo(22.5, 8);
  expect(t.w.agents.alice!.physiology.energy).toBeCloseTo(96, 8);
  t.replay();
});

test('another worker cannot collect old personal or unassigned arrears, and an ex-employee can collect their own later', () => {
  const t = fixture({ cash: 0, legacy: 17.123456789 });
  t.work();
  t.time(3600000);
  expect(t.claim().earnedMicros).toBe(100e6);
  expect(t.claim().paidMicros).toBe(0);
  t.act('AgentLeaveEnterprise', { enterpriseId: 'firm' });
  t.act('AgentFundEnterprise', { enterpriseId: 'firm', amount: 150 }, 'owner');
  t.work('bob', 1800);
  t.time(1800000);
  expect(t.w.agents.bob!.balance).toBeCloseTo(45, 8);
  expect(t.w.agents.alice!.balance).toBe(0);
  const claim = t.claim();
  const denied = t.act('AgentClaimWage', { id: claim.id, expectedRevision: claim.revision }, 'bob');
  expect(denied.some((e) => e.type === 'ActionRejected')).toBe(true);
  t.act('AgentClaimWage', { id: claim.id, expectedRevision: claim.revision });
  expect(t.w.agents.alice!.balance).toBeCloseTo(90, 8);
  expect(t.w.enterprises.firm!.wageArrears).toBe(17.123456789);
  expect(t.w.enterprises.firm!.earnedPayroll!.legacyUnattributedAmount).toBe(17.123456789);
  t.replay();
});

test('layoff atomically ends current work and settles its elapsed fraction without taking away the claim', () => {
  const t = fixture();
  t.work();
  t.time(90000);
  t.act(
    'AgentLayoffEnterpriseEmployee',
    { enterpriseId: 'firm', employeeAgentId: 'alice' },
    'owner',
  );
  expect(t.w.agents.alice!.job).toBeNull();
  expect(t.session()).toMatchObject({
    elapsedMs: 90000,
    status: 'interrupted',
    endReason: 'employment-ended',
  });
  expect(t.claim()).toMatchObject({
    earnedMicros: 2_500_000,
    paidMicros: 2_500_000,
    status: 'ended',
  });
  expect(t.w.activityTimeByAgent.alice!.availableAt).toBe(90000);
  t.time(900000);
  expect(t.w.agents.alice!.balance).toBeCloseTo(2.25, 8);
  t.replay();
});

test('off-grid completion and withholding are identical under irregular time subdivision', () => {
  const a = fixture(),
    b = fixture();
  for (const t of [a, b]) {
    t.time(17001);
    t.work('alice', 125);
  }
  a.time(240000);
  for (const ms of [17001, 48002, 73003, 101994]) b.time(ms);
  expect(a.session()).toMatchObject({ status: 'completed', settledAt: 142001, elapsedMs: 125000 });
  expect(b.claim().earnedMicros).toBe(a.claim().earnedMicros);
  expect(b.claim().paidMicros).toBe(a.claim().paidMicros);
  expect(b.w.agents.alice!.balance).toBeCloseTo(a.w.agents.alice!.balance, 8);
  expect(b.w.agents.alice!.physiology.energy).toBeCloseTo(a.w.agents.alice!.physiology.energy, 8);
  expect(b.w.treasury).toBeCloseTo(a.w.treasury!, 8);
  a.replay();
  b.replay();
});

test('solvency sees already earned obligations and cannot distribute or destroy assets ahead of labor settlement', () => {
  const a = fixture({ cash: 20, lifecycle: true }),
    b = fixture({ cash: 20, lifecycle: true });
  a.work();
  b.work();
  a.time(900000);
  for (let i = 0; i < 15; i++) b.time(60000);
  for (const t of [a, b]) {
    expect(
      t.events.some((e) => e.type === 'EnterpriseDividendPaid' || e.type === 'EnterpriseClosed'),
    ).toBe(false);
    expect(t.w.enterprises.firm!.status).toBe('bankrupt');
    expect(t.session().status).toBe('interrupted');
    expect(t.w.enterprises.firm!.wageArrears).toBeGreaterThan(0);
    t.act('AgentFundEnterprise', { enterpriseId: 'firm', amount: 20 }, 'owner');
    const c = t.claim();
    t.act('AgentClaimWage', { id: c.id, expectedRevision: c.revision });
    expect(t.w.enterprises.firm!.wageArrears).toBe(0);
    t.replay();
  }
  expect(b.claim().earnedMicros).toBe(a.claim().earnedMicros);
  expect(b.w.agents.alice!.balance).toBeCloseTo(a.w.agents.alice!.balance, 8);
});

test('invalid effort, busy body, stale stop and forged account proofs leave no extra entitlement', () => {
  const t = fixture();
  expect(t.work('alice', 86400).some((e) => e.type === 'ActionRejected')).toBe(true);
  expect(Object.keys(t.w.residentLabor!.process.sessions)).toHaveLength(0);
  t.work();
  const first = t.session();
  expect(t.work().some((e) => e.type === 'ActionRejected')).toBe(true);
  t.time(60000);
  expect(
    t
      .act('AgentStopWork', { id: first.id, expectedRevision: first.revision })
      .some((e) => e.type === 'ActionRejected'),
  ).toBe(true);
  const i = t.events.findIndex(
    (e) => e.type === 'ResidentLaborCommitted' && e.payload.transactions.length > 0,
  );
  const e = t.events[i]!;
  if (e.type !== 'ResidentLaborCommitted') throw Error('missing-pay');
  const before = t.events.slice(0, i).reduce(applyWorldEvent, t.initial);
  expect(() =>
    applyWorldEvent(before, { ...e, payload: { ...e.payload, transactions: [] } }),
  ).toThrow('labor-accounting-proof-mismatch');
  expect(() =>
    applyWorldEvent(before, { ...e, payload: { ...e.payload, withheldMicros: 0 } }),
  ).toThrow('labor-withholding-proof-mismatch');
  t.replay();
});

test('legacy prepayment remains replayable and explicit activation waits for prepaid work to end', () => {
  const t = fixture({ cash: 100, enabled: false });
  t.work('alice', 60);
  expect(t.w.agents.alice!.balance).toBeGreaterThan(0);
  expect(t.events.some((e) => e.type === 'WagePaid')).toBe(true);
  expect(() => t.enable()).toThrow('labor-activation-requires-period-pay-and-no-prepaid-activity');
  t.time(60000);
  t.enable();
  t.replay();
});

test('activation uses explicit code-point enterprise order for resident-defined mixed-case identifiers', () => {
  const t = fixture({ enabled: false });
  for (const enterpriseId of ['a', 'B'])
    t.act(
      'AgentFoundEnterprise',
      {
        enterpriseId,
        name: enterpriseId,
        occupationName: 'Maker',
        initialCapital: 100,
        maxEmployees: 1,
      },
      'owner',
    );
  t.enable();
  const enabled = t.events.find((e) => e.type === 'ResidentLaborEnabled');
  if (enabled?.type !== 'ResidentLaborEnabled') throw Error('missing-enable');
  expect(enabled.payload.enterprises.map((e) => e.enterpriseId)).toEqual(['B', 'a', 'firm']);
  t.replay();
});

test.each([
  { cash: 0, duration: 900000, earned: 25, initialPaid: 0, taxRate: 0.1 },
  { cash: 0, duration: 900000, earned: 25, initialPaid: 0, taxRate: 1 },
  { cash: 0, duration: 900000, earned: 25, initialPaid: 0, taxRate: 0 },
  { cash: 10, duration: 3600000, earned: 100, initialPaid: 10, taxRate: 0.1 },
  { cash: 0, duration: 0, earned: 0, initialPaid: 0, taxRate: 0.1 },
  { cash: 10, duration: 900000, earned: 25, initialPaid: 10, taxRate: 0.1 },
  { cash: 50, duration: 90000, earned: 2.5, initialPaid: 100 / 60, taxRate: 0.1 },
])(
  'preserved worker exit freezes original work and retains or pays original wages: $cash/$duration',
  ({ cash, duration, earned, initialPaid, taxRate }) => {
    const t = fixture({ cash, taxRate });
    t.work();
    if (duration) t.time(duration);
    expect(t.claim().paidMicros / 1e6).toBeCloseTo(initialPaid, 5);
    const initial = { ...t.w, residentExits: residentExitFixture().residentExits };
    let w: WorldProjection = initial;
    const events: WorldEvent[] = [];
    const commit = (es: readonly WorldEvent[]) => {
      for (const e of es) {
        w = applyWorldEvent(w, e);
        events.push(e);
        expect(
          Object.values(w.agents).reduce((n, a) => n + a.balance, 0) +
            Object.values(w.enterprises).reduce((n, a) => n + a.balance, 0) +
            (w.treasury ?? 0) +
            estateCashBalance(w.residentExits!.cash),
        ).toBeCloseTo(w.moneySupply, 8);
      }
    };
    const death = residentDeathFixture();
    commit([
      capturedResidentDeparture(w, {
        ...death,
        occurredAt: w.clock.now,
        payload: { ...death.payload, agentId: asAgentId('alice'), diedAt: w.clock.now },
      }),
    ]);
    const beforeStop = structuredClone(w);
    const stopped = stopUnavailableResidentLabor({
      projection: w,
      requestId: 'exit-stop',
      simulationId: 'labor-world',
      nextSequence: 100,
    });
    expect(w).toEqual(beforeStop);
    expect(stopped).toHaveLength(duration === 3600000 ? 0 : 1);
    commit(stopped);
    const id = t.session().id;
    expect(w.residentLabor!.process.sessions[id]).toMatchObject({
      status: duration === 3600000 ? 'completed' : 'interrupted',
      elapsedMs: duration,
      settledAt: duration,
    });
    expect(w.residentLabor!.process.activeByActor.alice).toBeUndefined();
    expect(w.agents.alice).toBeUndefined();
    expect(w.activityTimeByAgent.alice).toBeUndefined();
    expect(w.enterprises.firm!.earnedPayroll!.claims[id]).toMatchObject({
      status: 'ended',
      earnedMicros: earned * 1e6,
    });
    const stop = stopped[0];
    if (stop) {
      if (stop.type !== 'ResidentLaborCommitted') throw Error('missing-stop');
      const { estatePayment: _proof, ...withoutProof } = stop.payload;
      expect(_proof).toBeDefined();
      expect(() => applyWorldEvent(beforeStop, { ...stop, payload: withoutProof })).toThrow(
        'labor-preserved-exit-source-required',
      );
      expect(() => applyWorldEvent(w, stop)).toThrow();
      expect(stop.occurredAt).toBe(duration);
    }
    if (cash < earned) {
      expect(w.enterprises.firm!.wageArrears).toBeCloseTo(earned - cash, 8);
      commit(
        dispatchWorldCommand({
          projection: w,
          policies: t.policies,
          nextSequence: 101,
          command: createCommandEnvelope({
            id: 'later-boundary',
            simulationId: 'labor-world',
            type: 'AdvanceSimulationTime',
            source: 'system',
            issuedAt: w.clock.now,
            payload: { deltaMs: 60000 },
          }),
        }),
      );
      commit(
        dispatchWorldCommand({
          projection: w,
          policies: t.policies,
          nextSequence: 101,
          command: createCommandEnvelope({
            id: 'real-recapitalization',
            simulationId: 'labor-world',
            type: 'AgentFundEnterprise',
            actorId: 'owner',
            issuedAt: w.clock.now,
            payload: { enterpriseId: 'firm', amount: 150 },
          }),
        }),
      );
      const beforePayment = structuredClone(w);
      const paid = residentLaborCommit({
        projection: w,
        requestId: 'old-wage-payment',
        simulationId: 'labor-world',
        nextSequence: 110,
        actorId: 'system',
        sessionId: id,
        pay: true,
      });
      if (paid.type !== 'ResidentLaborCommitted' || !paid.payload.estatePayment)
        throw Error('missing-payment-proof');
      const estatePayment = paid.payload.estatePayment;
      expect(paid.occurredAt).toBe(duration + 60000);
      expect(() => applyWorldEvent(w, { ...paid, occurredAt: duration })).toThrow(
        'labor-preserved-exit-source-required',
      );
      expect(() =>
        applyWorldEvent(w, { ...paid, payload: { ...paid.payload, actorId: 'alice' } }),
      ).toThrow('labor-preserved-exit-source-required');
      expect(() =>
        applyWorldEvent(w, { ...paid, payload: { ...paid.payload, transactions: [] } }),
      ).toThrow('labor-accounting-proof-mismatch');
      expect(() =>
        applyWorldEvent(w, {
          ...paid,
          payload: {
            ...paid.payload,
            estatePayment: { ...estatePayment, populationEventId: 'invented-death' },
          },
        }),
      ).toThrow('earned-wage-estate-proof-mismatch');
      expect(w).toEqual(beforePayment);
      commit([paid]);
      expect(() => applyWorldEvent(w, paid)).toThrow();
    }
    expect(w.enterprises.firm!.earnedPayroll!.claims[id]!.paidMicros).toBe(earned * 1e6);
    expect(w.enterprises.firm!.wageArrears).toBe(0);
    expect(estateCashBalance(w.residentExits!.cash)).toBeCloseTo(earned * (1 - taxRate), 6);
    expect(w.treasury).toBeCloseTo(100 + earned * taxRate, 6);
    expect(events.reduce(applyWorldEvent, initial)).toEqual(w);
    expect(
      stopUnavailableResidentLabor({
        projection: w,
        requestId: 'again',
        simulationId: 'labor-world',
        nextSequence: 200,
      }),
    ).toEqual([]);
  },
);

test('employment departure freezes only the target worker, captures final pay and keeps the other worker active', () => {
  const t = fixture({ cash: 100 });
  t.work('alice');
  t.work('bob');
  t.time(90000);
  const initial: WorldProjection = { ...t.w, residentExits: residentExitFixture().residentExits };
  const death = residentDeathFixture();
  const departure = {
    ...death,
    occurredAt: initial.clock.now,
    payload: { ...death.payload, agentId: asAgentId('alice'), diedAt: initial.clock.now },
  };
  expect(
    prepareResidentEmploymentDeparture({
      projection: { ...initial, clock: { ...initial.clock, now: initial.clock.now + 1 } },
      departure: {
        ...departure,
        occurredAt: initial.clock.now + 1,
        payload: { ...departure.payload, diedAt: initial.clock.now + 1 },
      },
    }),
  ).toEqual({ accepted: false, reason: 'employment-departure-needs-settled-labor-boundary' });
  const plan = prepareResidentEmploymentDeparture({ projection: initial, departure });
  if (!plan.accepted) throw Error(plan.reason);
  const next = plan.events.reduce(applyWorldEvent, initial);
  expect(next.agents.alice).toBeUndefined();
  expect(next.agents.bob).toEqual(initial.agents.bob);
  expect(next.residentLabor!.process.sessions[t.session('alice').id]!.status).toBe('interrupted');
  expect(next.residentLabor!.process.sessions[t.session('bob').id]).toEqual(
    initial.residentLabor!.process.sessions[t.session('bob').id],
  );
  expect(next.enterprises.firm!.earnedPayroll!.claims[t.claim('bob').id]).toEqual(t.claim('bob'));
  expect(estateCashBalance(next.residentExits!.cash)).toBeCloseTo(2.25, 8);
  expect(next.moneySupply).toBe(initial.moneySupply);
  expect(plan.events.reduce(applyWorldEvent, initial)).toEqual(next);
  expect(initial.agents.alice).toEqual(t.w.agents.alice);
});

test.each([0, 30000])(
  'population departure ends settled rest at %s without adding recovery or impersonating the sleeper',
  (elapsed) => {
    const t = fixture();
    t.act('AgentSleep', { durationSeconds: 60 }, 'alice');
    if (elapsed) t.time(elapsed);
    const initial: WorldProjection = { ...t.w, residentExits: residentExitFixture().residentExits },
      before = structuredClone(initial);
    const death = residentDeathFixture(),
      departure = {
        ...death,
        occurredAt: initial.clock.now,
        payload: { ...death.payload, agentId: asAgentId('alice'), diedAt: initial.clock.now },
      };
    const d = prepareResidentEmploymentDeparture({ projection: initial, departure });
    if (!d.accepted) throw Error(d.reason);
    const priorToCapture = d.events.slice(0, -1).reduce(applyWorldEvent, initial);
    expect(priorToCapture.agents.alice!.physiology).toEqual(initial.agents.alice!.physiology);
    expect(priorToCapture.residentRest!.activeByActor.alice).toBeUndefined();
    const s = Object.values(priorToCapture.residentRest!.sessions)[0]!;
    expect(s).toMatchObject({ status: 'interrupted', elapsedMs: elapsed });
    const event = d.events.find((e) => e.type === 'ResidentRestSessionChanged');
    if (event?.type !== 'ResidentRestSessionChanged' || !event.payload.departure)
      throw Error('missing-system-rest-source');
    const source = event.payload.departure;
    expect(source).toMatchObject({ executor: 'system', populationEventId: death.id, at: elapsed });
    const beforeStop = d.events.slice(0, d.events.indexOf(event)).reduce(applyWorldEvent, initial);
    expect(() =>
      applyWorldEvent(beforeStop, {
        ...event,
        payload: { ...event.payload, departure: { ...source, actorId: 'bob' } },
      }),
    ).toThrow('invalid-departure-activity-source');
    const next = d.events.reduce(applyWorldEvent, initial);
    expect(next.agents.alice).toBeUndefined();
    expect(next.activityTimeByAgent.alice).toBeUndefined();
    expect(next.agents.bob).toEqual(initial.agents.bob);
    expect(next.moneySupply).toBe(initial.moneySupply);
    expect(initial).toEqual(before);
    expect(
      prepareResidentEmploymentDeparture({
        projection: { ...initial, clock: { ...initial.clock, now: elapsed + 1 } },
        departure: {
          ...departure,
          occurredAt: elapsed + 1,
          payload: { ...departure.payload, diedAt: elapsed + 1 },
        },
      }),
    ).toMatchObject({ accepted: false, reason: 'rest-progress-must-be-settled' });
  },
);
