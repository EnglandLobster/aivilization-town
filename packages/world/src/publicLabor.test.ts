import { expect, test } from 'vitest';
import {
  asAgentId,
  asLocationId,
  createCommandEnvelope,
  createEventEnvelope,
  type CoreCommandType,
} from '@aivilization/sim-core';
import { RESIDENT_REST_POLICY, publicLaborEscrowBalance } from '@aivilization/society';
import {
  applyWorldEvent,
  createWorldProjection,
  dispatchWorldCommand,
  enablePublicLaborEvent,
  stopUnavailablePublicLabor,
  type WorldCommandPolicies,
  type WorldEvent,
} from './index';
function fixture(
  options: {
    energy?: number;
    treasury?: number;
    enabled?: boolean;
    policies?: Partial<WorldCommandPolicies>;
  } = {},
) {
  const policies: WorldCommandPolicies = {
    satietyRecoveryByCommodity: {},
    maxSatiety: 100,
    wageCalculator: () => 101.000003,
    laborPay: { version: 'labor-proportional-pay-v1', referenceSeconds: 3600 },
    laborCost: { energyCostPerHour: 10, satietyCostPerHour: 5 },
    criticalThresholds: { energy: 0, health: 0 },
    calendar: {
      policyVersion: 'public-work-calendar',
      dayLengthMs: 86400000,
      phases: [{ phase: 'night', startFraction: 0 }],
      physiologicalDecay: { energyPerHour: 2, satietyPerHour: 3 },
    },
    tax: {
      policyVersion: 'public-work-tax',
      source: 'test',
      neutralRate: 0.1,
      incomeTaxBrackets: [{ upToAmount: null, rate: 0.1 }],
      tradeTaxRate: 0,
    },
    ...options.policies,
  };
  const initial = createWorldProjection({
    agents: ['alice', 'bob'].map((id) => ({
      agentId: asAgentId(id),
      balance: 0,
      inventory: {},
      job: 'Cleaner',
      residentialTier: 1,
      educationScore: 100,
      locationId: asLocationId('place'),
      physiology: { energy: options.energy ?? 100, satiety: 100, health: 100 },
    })),
    locations: [
      {
        locationId: asLocationId('place'),
        name: 'Initial workplace',
        kind: 'production',
        activityAffinities: ['work'],
        capacity: 10,
      },
    ],
    treasury: options.treasury ?? 200,
    moneySupply: options.treasury ?? 200,
  });
  let w = initial,
    n = 0;
  const events: WorldEvent[] = [];
  const context = () => ({
    projection: w,
    requestId: `public-${++n}`,
    simulationId: 'sim',
    nextSequence: events.length + 1,
  });
  const commit = (es: readonly WorldEvent[]) => {
    let next = w;
    for (const event of es) next = applyWorldEvent(next, event);
    w = next;
    events.push(...es);
    expect(
      Object.values(w.agents).reduce((sum, a) => sum + a.balance, 0) +
        (w.treasury ?? 0) +
        publicLaborEscrowBalance(w.publicLabor?.process),
    ).toBeCloseTo(w.moneySupply, 8);
  };
  commit([
    createEventEnvelope({
      id: 'rest',
      simulationId: 'sim',
      sequence: 1,
      occurredAt: 0,
      type: 'ResidentRestEnabled',
      payload: { policy: RESIDENT_REST_POLICY },
    }),
  ]);
  if (options.enabled !== false) commit([enablePublicLaborEvent({ ...context(), policies })]);
  const act = (type: CoreCommandType, payload: unknown, actor = 'alice', expected = true) => {
    const command = createCommandEnvelope({
      id: `cmd-${++n}`,
      simulationId: 'sim',
      issuedAt: w.clock.now,
      type,
      ...(actor === 'system' ? { source: 'system' as const } : {}),
      ...(actor === 'system' ? {} : { actorId: asAgentId(actor) }),
      payload,
    });
    const es = dispatchWorldCommand({
      projection: w,
      command,
      policies,
      nextSequence: events.length + 1,
    });
    expect(
      es.some((e) => e.type === 'ActionRejected'),
      JSON.stringify(es),
    ).toBe(!expected);
    commit(es);
    return es;
  };
  return {
    initial,
    policies,
    context,
    commit,
    act,
    events,
    get w() {
      return w;
    },
    start: (seconds = 3600, actor = 'alice', expected = true) =>
      act('AgentWork', { occupationName: 'Cleaner', laborSeconds: seconds }, actor, expected),
    time: (deltaMs: number) => act('AdvanceSimulationTime', { deltaMs }, 'system'),
    session: (actor = 'alice') =>
      Object.values(w.publicLabor!.process.sessions).find((s) => s.actorId === actor)!,
    replay: () => expect(events.reduce(applyWorldEvent, initial)).toEqual(w),
  };
}
test('public work protects full cash before any wage or effort, rejects double spending, pays actual net/tax and refunds unworked time', () => {
  const t = fixture();
  t.start();
  expect(t.w.agents.alice!.balance).toBe(0);
  expect(t.w.agents.alice!.physiology.energy).toBe(100);
  expect(t.w.treasury).toBeCloseTo(98.999997, 8);
  expect(publicLaborEscrowBalance(t.w.publicLabor!.process)).toBe(101.000003);
  t.start(3600, 'bob', false);
  expect(t.w.publicLabor!.process.activeByActor.bob).toBeUndefined();
  t.time(1200000);
  expect(t.session()).toMatchObject({
    elapsedMs: 1200000,
    earnedMicros: 33666667,
    paidMicros: 33666667,
    withheldMicros: 3366666,
  });
  expect(t.w.agents.alice!.balance).toBeCloseTo(30.300001, 8);
  expect(t.w.agents.alice!.physiology.energy).toBeCloseTo(96, 8);
  t.act(
    'AgentStopWork',
    { id: t.session().id, expectedRevision: t.session().revision },
    'bob',
    false,
  );
  const state = t.w,
    stop = t.act('AgentStopWork', { id: t.session().id, expectedRevision: t.session().revision });
  expect(t.session().status).toBe('interrupted');
  expect(publicLaborEscrowBalance(t.w.publicLabor!.process)).toBe(0);
  expect(t.w.activityTimeByAgent.alice!.availableAt).toBe(1200000);
  const e = stop.find((e) => e.type === 'PublicLaborCommitted')!;
  const first = e.payload.transactions[0]!;
  expect(() =>
    applyWorldEvent(state, {
      ...e,
      payload: {
        ...e.payload,
        transactions: [
          {
            ...first,
            entries: first.entries.map((entry) => ({ ...entry, amount: entry.amount * 2 })),
          },
        ],
      },
    }),
  ).toThrow('public-labor-accounting-proof-mismatch');
  t.replay();
});
test('actual exhaustion stops at the same millisecond across a large advance and one-millisecond partitions; never pays a future hour', () => {
  const once = fixture({ energy: 4 }),
    split = fixture({ energy: 4 });
  for (const t of [once, split]) t.start();
  once.time(7200000);
  for (const delta of [1199999, 1, 6000000]) split.time(delta);
  for (const t of [once, split]) {
    expect(t.session()).toMatchObject({
      status: 'interrupted',
      endReason: 'physical-unavailable',
      elapsedMs: 1200000,
      earnedMicros: 33666667,
    });
    expect(t.w.activityTimeByAgent.alice!.availableAt).toBe(1200000);
    expect(t.w.agents.alice!.physiology.energy).toBe(0);
    expect(t.w.agents.alice!.physiology.satiety).toBeCloseTo(100 - 6 - 5 / 3, 8);
    expect(publicLaborEscrowBalance(t.w.publicLabor!.process)).toBe(0);
    t.replay();
  }
  expect(once.w.agents.alice!.balance).toBeCloseTo(split.w.agents.alice!.balance, 8);
  const i = once.events.findIndex((e) => e.type === 'PublicLaborCommitted' && e.payload.body),
    event = once.events[i]!;
  if (event.type !== 'PublicLaborCommitted' || !event.payload.body) throw Error('no-body-fixture');
  const before = once.events.slice(0, i).reduce(applyWorldEvent, once.initial);
  const recordedBody = event.payload.body;
  expect(() =>
    applyWorldEvent(before, {
      ...event,
      payload: { ...event.payload, body: { ...recordedBody, workedMs: recordedBody.workedMs + 1 } },
    }),
  ).toThrow('public-labor-body-proof-mismatch');
  const { body, ...missing } = event.payload;
  void body;
  expect(() => applyWorldEvent(before, { ...event, payload: missing })).toThrow(
    'public-labor-stop-source-mismatch',
  );
});
test('legacy future-paid labor keeps its event meaning and cannot be reinterpreted while active', () => {
  const t = fixture({ enabled: false });
  t.start();
  expect(t.w.agents.alice!.balance).toBeGreaterThan(0);
  expect(() => enablePublicLaborEvent({ ...t.context(), policies: t.policies })).toThrow(
    'public-labor-requires-period-pay-and-no-prepaid-activity',
  );
  t.time(3600000);
  t.commit([enablePublicLaborEvent({ ...t.context(), policies: t.policies })]);
  expect(t.w.publicLabor!.process.sessions).toEqual({});
  t.replay();
});

const recruitment: NonNullable<WorldCommandPolicies['jobApplication']> = {
  populationEducationScores: [100],
  quotaByResidentialTier: [1, 1, 1, 1, 1, 1, 1],
  recruitmentCycle: {
    policyVersion: 'public-work-recruitment-test',
    cycleDurationMs: 60000,
    defaultOccupationCapacity: 10,
    occupationCapacityOverrides: {},
  },
};
function applyForDifferentJob(t: ReturnType<typeof fixture>) {
  t.commit([
    createEventEnvelope({
      id: 'application',
      simulationId: 'sim',
      sequence: t.events.length + 1,
      occurredAt: t.w.clock.now,
      type: 'JobApplicationSubmitted',
      payload: {
        applicationId: 'application',
        agentId: asAgentId('alice'),
        occupationName: 'Cashier',
        cycleNumber: 0,
        residentialTier: 1,
        educationScore: 100,
      },
    }),
  ]);
}
test('a real recruitment boundary stops the previous public job immediately and preserves earned wages across batched time', () => {
  const once = fixture({ policies: { jobApplication: recruitment } }),
    split = fixture({ policies: { jobApplication: recruitment } });
  for (const t of [once, split]) {
    applyForDifferentJob(t);
    t.start();
  }
  once.time(180000);
  for (let i = 0; i < 3; i++) split.time(60000);
  for (const t of [once, split]) {
    expect(t.w.agents.alice!.job).toBe('Cashier');
    expect(t.w.jobApplications[0]!.resolvedAt).toBe(60000);
    expect(t.events.filter(e => e.type === 'JobAssigned' || e.type === 'JobApplicationResolved').every(e => e.occurredAt === 60000)).toBe(true);
    expect(t.session()).toMatchObject({
      status: 'interrupted',
      endReason: 'employment-ended',
      elapsedMs: 60000,
      earnedMicros: 1683333,
    });
    expect(t.w.activityTimeByAgent.alice!.availableAt).toBe(60000);
    expect(publicLaborEscrowBalance(t.w.publicLabor!.process)).toBe(0);
    t.replay();
  }
  expect(once.w.agents).toEqual(split.w.agents);
  expect(once.w.treasury).toBeCloseTo(split.w.treasury!, 8);
});
test.each(['retirement', 'departure'] as const)(
  'public termination adapter can refund after a recorded %s without reviving people; full lifecycle activation remains guarded',
  (kind) => {
    const t = fixture();
    t.start();
    t.time(60000);
    const terminal: WorldEvent =
      kind === 'retirement'
        ? createEventEnvelope({
            id: 'terminal',
            simulationId: 'sim',
            sequence: t.events.length + 1,
            occurredAt: 60000,
            type: 'AgentRetired',
            payload: {
              agentId: asAgentId('alice'),
              previousJob: 'Cleaner',
              retiredAtMs: 60000,
              ageDays: 90,
              policyVersion: 'test-lifecycle',
              reason: 'forced-retirement' as const,
            },
          })
        : createEventEnvelope({
            id: 'terminal',
            simulationId: 'sim',
            sequence: t.events.length + 1,
            occurredAt: 60000,
            type: 'AgentDied',
            payload: {
              agentId: asAgentId('alice'),
              cause: 'old-age' as const,
              diedAt: 60000,
              ageDays: 90,
              retired: false,
              policyVersion: 'test-lifecycle',
              estate: {
                burnedCurrency: t.w.agents.alice!.balance,
                inventoryByCommodity: {},
                depositForfeited: 0,
                writtenOffLoanIds: [],
              },
            },
          });
    t.commit([terminal]);
    t.commit(stopUnavailablePublicLabor({ ...t.context(), at: 60000 }));
    expect(t.session()).toMatchObject({
      status: 'interrupted',
      endReason: 'employment-ended',
      elapsedMs: 60000,
      earnedMicros: 1683333,
    });
    expect(publicLaborEscrowBalance(t.w.publicLabor!.process)).toBe(0);
    if (kind === 'departure') {
      expect(t.w.agents.alice).toBeUndefined();
      expect(t.w.activityTimeByAgent.alice).toBeUndefined();
    } else expect(t.w.agents.alice!.job).toBeNull();
    t.time(120000);
    t.replay();
  },
);
test('unversioned changes to shared body rates cannot silently change a public labor process', () => {
  const t = fixture();
  t.start();
  const command = createCommandEnvelope({
    id: 'drift',
    simulationId: 'sim',
    source: 'system',
    type: 'AdvanceSimulationTime',
    issuedAt: 0,
    payload: { deltaMs: 60000 },
  });
  expect(() =>
    dispatchWorldCommand({
      projection: t.w,
      command,
      nextSequence: t.events.length + 1,
      policies: {
        ...t.policies,
        calendar: {
          ...t.policies.calendar!,
          physiologicalDecay: { energyPerHour: 20, satietyPerHour: 3 },
        },
      },
    }),
  ).toThrow('public-labor-physiology-policy-mismatch');
});
