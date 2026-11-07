import { estateCashBalance } from '@aivilization/economy';
import { residentDeathFixture, residentExitFixture } from './testFixtures/residentExit';
import {
  asAgentId,
  asLocationId,
  createCommandEnvelope,
  createEventEnvelope,
  type CoreCommandType,
} from '@aivilization/sim-core';
import { RESIDENT_REST_POLICY, type EducationSystemPolicy } from '@aivilization/society';
import { expect, test } from 'vitest';
import {
  applyWorldEvent,
  createWorldProjection,
  dispatchWorldCommand,
  enableResidentStudyEvent,
  prepareResidentEmploymentDeparture,
  enableEducationAuthorityEvent,
  residentStudyEscrowBalance,
  type WorldEvent,
  type WorldCommandPolicies,
} from './index';

const educationSystem: EducationSystemPolicy = {
  policyVersion: 'education-system-v2',
  enabled: true,
  levelScoreThresholds: [20, 70, 180, 320, 450],
  compulsoryLevels: [1, 2],
  levelTuitionPerHour: { 0: 20, 1: 20, 2: 20, 3: 25, 4: 30, 5: 40 },
  employedStudyEfficiencyRatio: 0.3,
  examCycleDurationMs: 86400000,
  admissionQuotaByLevel: { 3: 0.5, 4: 0.25, 5: 0.1 },
  vocationalTrackShare: 0.5,
  source: 'explicit-test-scenario',
};
const policies: WorldCommandPolicies = {
  satietyRecoveryByCommodity: {},
  maxSatiety: 100,
  wageCalculator: () => 0,
  laborCost: { energyCostPerHour: 0, satietyCostPerHour: 0 },
  criticalThresholds: { energy: 0, health: 0 },
  educationSystem,
  calendar: {
    policyVersion: 'town-calendar-v1',
    dayLengthMs: 86400000,
    phases: [{ phase: 'night', startFraction: 0 }],
    physiologicalDecay: { energyPerHour: 1, satietyPerHour: 1 },
  },
};
function fixture(enabled = true, authority = false) {
  const initial = createWorldProjection({
    agents: ['alice', 'bob'].map((id, i) => ({
      agentId: asAgentId(id),
      locationId: asLocationId('school'),
      physiology: { energy: 100, satiety: 100, health: 100 },
      educationScore: i * 25,
      ...(authority ? {} : { educationLevel: i === 0 ? (0 as const) : (1 as const) }),
      balance: 100,
      residentialTier: 1,
      job: null,
      inventory: {},
    })),
    treasury: 1000,
    moneySupply: 1200,
    locations: [
      {
        locationId: asLocationId('school'),
        name: 'Scenario school',
        kind: 'education',
        activityAffinities: ['education'],
        capacity: 10,
      },
    ],
  });
  let w = initial,
    n = 0;
  const events: WorldEvent[] = [];
  const conservation = () =>
    expect(
      Object.values(w.agents).reduce((s, a) => s + a.balance, 0) +
        (w.treasury ?? 0) +
        residentStudyEscrowBalance(w.residentStudy) +
        Object.values(w.publicBudget?.serviceBalances ?? {}).reduce((s, b) => s + b, 0),
    ).toBeCloseTo(w.moneySupply, 8);
  const commit = (es: readonly WorldEvent[]) => {
    for (const e of es) {
      w = applyWorldEvent(w, e);
      events.push(e);
      conservation();
    }
  };
  commit([
    createEventEnvelope({
      id: 'rest',
      simulationId: 'study-world',
      sequence: 1,
      occurredAt: 0,
      type: 'ResidentRestEnabled',
      payload: { policy: RESIDENT_REST_POLICY },
    }),
  ]);
  const enable = () =>
    commit([
      enableResidentStudyEvent({
        projection: w,
        policies,
        requestId: `enable-${++n}`,
        simulationId: 'study-world',
        nextSequence: events.length + 1,
      }),
    ]);
  if (enabled) enable();
  if (authority)
    commit([
      enableEducationAuthorityEvent({
        projection: w,
        policies,
        mode: 'scenario',
        simulationId: 'study-world',
        requestId: 'education-authority',
        nextSequence: events.length + 1,
      }),
    ]);
  const act = (type: CoreCommandType, payload: unknown, actorId = 'alice') => {
    const es = dispatchWorldCommand({
      projection: w,
      policies,
      nextSequence: events.length + 1,
      command: createCommandEnvelope({
        id: `command-${++n}`,
        simulationId: 'study-world',
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
    commit,
    enable,
    act,
    get w() {
      return w;
    },
    study: (actorId = 'alice', seconds = 3600) =>
      act('AgentStudy', { durationSeconds: seconds, educationRatePerSecond: 999 }, actorId),
    time: (deltaMs: number) => act('AdvanceSimulationTime', { deltaMs }),
    session: (actorId = 'alice') =>
      Object.values(w.residentStudy!.process.sessions).find((s) => s.actorId === actorId)!,
    replay: () => expect(events.reduce(applyWorldEvent, initial)).toEqual(w),
  };
}
test('study reserves tuition without prepaid knowledge or external payment; exact elapsed portion is charged and unused personal money refunded', () => {
  const t = fixture();
  t.study();
  expect(t.w.agents.alice).toMatchObject({ balance: 80, educationScore: 0 });
  expect(t.w.moneySupply).toBe(1200);
  expect(residentStudyEscrowBalance(t.w.residentStudy)).toBe(20);
  expect(t.w.activityTimeByAgent.alice).toMatchObject({
    settlementTiming: 'effects-during-activity',
    availableAt: 3600000,
  });
  t.time(900000);
  expect(t.w.agents.alice!.educationScore).toBeCloseTo(15, 8);
  expect(t.w.moneySupply).toBeCloseTo(1195, 8);
  const { id, revision } = t.session();
  t.act('AgentStopStudy', { id, expectedRevision: revision });
  expect(t.w.agents.alice!.balance).toBeCloseTo(95, 8);
  expect(residentStudyEscrowBalance(t.w.residentStudy)).toBe(0);
  expect(t.w.activityTimeByAgent.alice!.availableAt).toBe(900000);
  expect(t.session()).toMatchObject({
    elapsedMs: 900000,
    status: 'interrupted',
    endReason: 'participant-left',
  });
  t.time(3600000);
  expect(t.w.agents.alice!.educationScore).toBeCloseTo(15, 8);
  t.replay();
});
test('initial compulsory tuition stays in circulating escrow then pays only earned public service amounts and refunds treasury', () => {
  const t = fixture();
  t.study('bob');
  expect(t.w.treasury).toBe(980);
  expect(t.w.agents.bob!.balance).toBe(100);
  expect(t.w.publicBudget?.serviceBalances.education ?? 0).toBe(0);
  t.time(1800000);
  expect(t.w.publicBudget!.serviceBalances.education).toBeCloseTo(10, 8);
  expect(t.w.agents.bob!.educationScore).toBeCloseTo(55, 8);
  const { id, revision } = t.session('bob');
  t.act('AgentStopStudy', { id, expectedRevision: revision }, 'bob');
  expect(t.w.treasury).toBeCloseTo(990, 8);
  expect(t.w.moneySupply).toBeCloseTo(1200, 8);
  t.replay();
});
test('own current study only, concurrent body use, insufficient funds and forged settlement all keep authoritative state intact', () => {
  const t = fixture();
  t.study();
  t.time(60000);
  const { id, revision } = t.session();
  const session = structuredClone(t.session());
  for (const [actor, rev] of [
    ['bob', revision],
    ['alice', 1],
  ] as const)
    expect(
      t
        .act('AgentStopStudy', { id, expectedRevision: rev }, actor)
        .some((e) => e.type === 'ActionRejected'),
    ).toBe(true);
  expect(t.session()).toEqual(session);
  expect(t.study().some((e) => e.type === 'ActionRejected')).toBe(true);
  const before = fixture(),
    started = before.study().find((e) => e.type === 'ResidentStudyCommitted')!;
  if (started.type !== 'ResidentStudyCommitted') throw Error('missing-event');
  const preceding = before.events
    .slice(0, before.events.indexOf(started))
    .reduce(applyWorldEvent, before.initial);
  expect(() =>
    applyWorldEvent(preceding, {
      ...started,
      payload: { ...started.payload, educationAfter: 100 },
    }),
  ).toThrow('study-education-proof-mismatch');
  expect(() =>
    applyWorldEvent(preceding, { ...started, payload: { ...started.payload, transactions: [] } }),
  ).toThrow('study-accounting-proof-mismatch');
  expect(() =>
    applyWorldEvent(
      preceding,
      createEventEnvelope({
        id: 'forged-prepaid-learning',
        simulationId: 'study-world',
        sequence: 999,
        occurredAt: preceding.clock.now,
        type: 'EducationChanged',
        payload: {
          agentId: asAgentId('alice'),
          previousEducationScore: 0,
          nextEducationScore: 100,
          reason: 'study',
        },
      }),
    ),
  ).toThrow('elapsed-study-requires-process-settlement');
  const poor = fixture();
  expect(poor.study('alice', 86400).some((e) => e.type === 'ActionRejected')).toBe(true);
  expect(residentStudyEscrowBalance(poor.w.residentStudy)).toBe(0);
  t.replay();
});
test('large advance and irregular advances preserve total study duration, tuition and learning including off-grid completion', () => {
  const a = fixture(),
    b = fixture();
  a.study('alice', 125);
  b.study('alice', 125);
  a.time(240000);
  for (const ms of [17001, 48002, 73003, 101994]) b.time(ms);
  for (const axis of ['balance', 'educationScore'] as const)
    expect(b.w.agents.alice![axis]).toBeCloseTo(a.w.agents.alice![axis], 8);
  expect(b.w.moneySupply).toBeCloseTo(a.w.moneySupply, 8);
  expect(a.session()).toMatchObject({ status: 'completed', settledAt: 125000, elapsedMs: 125000 });
  expect(b.session().applied).toEqual(a.session().applied);
  a.replay();
  b.replay();
});
test('formal promotion observes earned learning on fixed boundaries regardless of extra time requests', () => {
  const a = fixture(),
    b = fixture();
  for (const t of [a, b]) {
    t.time(17001);
    t.study('alice', 3600);
  }
  a.time(1230000 - 17001);
  b.time(1220000 - 17001);
  b.time(10000);
  expect(a.w.agents.alice!.educationScore).toBeCloseTo(b.w.agents.alice!.educationScore, 8);
  expect(a.w.agents.alice!.educationLevel).toBe(0);
  expect(b.w.agents.alice!.educationLevel).toBe(0);
  for (const t of [a, b]) {
    t.time(30000);
    expect(t.w.agents.alice!.educationLevel).toBe(1);
    t.replay();
  }
});
test('old study events retain prepaid semantics and cannot be migrated during an active prepaid reservation', () => {
  const t = fixture(false);
  const events = t.study('alice', 60);
  expect(events.some((e) => e.type === 'EducationChanged')).toBe(true);
  expect(events.some((e) => e.type === 'ResidentStudyCommitted')).toBe(false);
  expect(t.w.agents.alice!.educationScore).toBe(59940);
  expect(() => t.enable()).toThrow(
    'study-activation-requires-education-system-and-no-prepaid-activity',
  );
  t.time(60000);
  t.enable();
  t.replay();
});

test('pinned newcomer qualifications advance only through recorded compulsory promotions, with partition-equivalent earned learning', () => {
  const once = fixture(true, true),
    split = fixture(true, true);
  for (const t of [once, split]) t.study('alice', 7200);
  once.time(7200000);
  for (const dt of [1199999, 1, 2999999, 1, 3000000]) split.time(dt);
  for (const t of [once, split]) {
    expect(t.w.agents.alice!.educationLevel).toBe(2);
    expect(t.w.agents.alice!.qualificationOrigin).toMatchObject({
      level: 0,
      source: 'scenario-initial-qualification',
    });
    expect(t.w.agents.alice!.educationScore).toBeCloseTo(120, 8);
    expect(
      t.events
        .filter((e) => e.type === 'EducationLevelChanged')
        .map((e) => [e.occurredAt, e.payload]),
    ).toEqual([
      [
        1200000,
        {
          agentId: 'alice',
          previousLevel: 0,
          nextLevel: 1,
          reason: 'compulsory-automatic-promotion',
        },
      ],
      [
        4200000,
        {
          agentId: 'alice',
          previousLevel: 1,
          nextLevel: 2,
          reason: 'compulsory-automatic-promotion',
        },
      ],
    ]);
    t.replay();
  }
  expect(once.w.agents.alice!.balance).toBeCloseTo(split.w.agents.alice!.balance, 8);
});

test.each(['alice', 'bob'])(
  'population departure preserves real study and refunds original funding for %s',
  (actorId) => {
    const t = fixture();
    t.study(actorId);
    t.time(900000);
    const initial = { ...t.w, residentExits: residentExitFixture().residentExits },
      before = structuredClone(initial);
    const session = t.session(actorId),
      death = residentDeathFixture();
    const departure = {
      ...death,
      occurredAt: initial.clock.now,
      payload: { ...death.payload, agentId: asAgentId(actorId), diedAt: initial.clock.now },
    };
    const d = prepareResidentEmploymentDeparture({ projection: initial, departure });
    if (!d.accepted) throw Error(d.reason);
    const next = d.events.reduce(applyWorldEvent, initial);
    const remaining = session.terms.allocation.residentMicros - session.applied.residentMicros;
    const publicRemaining =
      session.terms.allocation.treasuryMicros - session.applied.treasuryMicros;
    expect(estateCashBalance(next.residentExits!.cash)).toBeCloseTo(
      initial.agents[actorId]!.balance + remaining / 1e6,
      8,
    );
    expect(next.treasury).toBeCloseTo(initial.treasury! + publicRemaining / 1e6, 8);
    expect(residentStudyEscrowBalance(next.residentStudy)).toBe(0);
    expect(next.residentStudy!.process.sessions[session.id]).toMatchObject({
      status: 'interrupted',
      endReason: 'population-departure',
      elapsedMs: session.elapsedMs,
      applied: session.applied,
    });
    const event = d.events.find((e) => e.type === 'ResidentStudyCommitted');
    if (event?.type !== 'ResidentStudyCommitted') throw Error('missing-study-stop');
    expect(event.payload.educationAfter).toBe(event.payload.educationBefore);
    expect(event.payload.actorId).toBe('system');
    const { departure: source, ...withoutSource } = event.payload;
    expect(source?.populationEventId).toBe(death.id);
    const beforeStop = d.events.slice(0, d.events.indexOf(event)).reduce(applyWorldEvent, initial);
    expect(() => applyWorldEvent(beforeStop, { ...event, payload: withoutSource })).toThrow(
      'departure-study-interruption-required',
    );
    expect(next.agents[actorId]).toBeUndefined();
    expect(next.activityTimeByAgent[actorId]).toBeUndefined();
    expect(next.moneySupply).toBe(initial.moneySupply);
    expect(d.events.reduce(applyWorldEvent, initial)).toEqual(next);
    expect(initial).toEqual(before);
  },
);
