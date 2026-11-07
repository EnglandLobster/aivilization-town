import { expect, test } from 'vitest';
import { asAgentId, createCommandEnvelope } from '@aivilization/sim-core';
import type { PublicEmploymentTerms } from '@aivilization/society';
import {
  createWorldProjection,
  applyWorldEvent,
  enableResidentPublicGovernanceEvent,
  residentPublicGovernanceCommand,
  enablePublicEmploymentEvent,
  dispatchWorldCommand,
  type WorldEvent,
  type WorldCommandPolicies,
} from './index';
function fixture() {
  const initial = createWorldProjection({
    agents: ['a', 'b', 'c'].map((id, i) => ({
      agentId: asAgentId(id),
      physiology: { energy: 100, satiety: 100, health: 100 },
      educationScore: i === 0 ? 330 : 500,
      residentialTier: 1,
      balance: 100,
      job: null,
      inventory: {},
    })),
    treasury: 1000,
    moneySupply: 1300,
  });
  const policies: WorldCommandPolicies = {
    satietyRecoveryByCommodity: {},
    maxSatiety: 100,
    wageCalculator: () => 10,
    laborCost: { energyCostPerHour: 0, satietyCostPerHour: 0 },
    criticalThresholds: { energy: 0, health: 0 },
    jobApplication: {
      populationEducationScores: [330, 500, 500],
      quotaByResidentialTier: [1, 1, 2, 3, 4, 5],
      recruitmentCycle: {
        policyVersion: 'original',
        cycleDurationMs: 1000,
        defaultOccupationCapacity: 1,
        occupationCapacityOverrides: {},
      },
    },
  };
  let w = initial,
    n = 0;
  const events: WorldEvent[] = [];
  const ctx = (actorId = 'a') => ({
    projection: w,
    actorId,
    requestId: `employment-${++n}`,
    simulationId: 'test',
    nextSequence: events.length + 1,
  });
  const commit = (es: readonly WorldEvent[]) => {
    for (const e of es) {
      w = applyWorldEvent(w, e);
      events.push(e);
    }
    expect(w.moneySupply).toBe(1300);
  };
  commit([
    enableResidentPublicGovernanceEvent({
      ...ctx(),
      institutionPolicy: {
        policyVersion: 'test',
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
          version: 'test',
          description: 'Test initial institution',
        },
        residents: ['a', 'b', 'c'],
        actions: ['set-tax', 'set-procedure'],
      },
      procedure: {
        electorate: ['a', 'b', 'c'],
        minimumTurnout: 2,
        minimumYes: 2,
        allowVoteChanges: true,
        minimumVotingMs: 10,
        maximumVotingMs: 1000,
        executionWindowMs: 1000,
        executors: 'electorate',
      },
    }),
  ]);
  const activation = enablePublicEmploymentEvent({ ...ctx(), policies });
  commit([activation]);
  const act = (
    command: Parameters<typeof residentPublicGovernanceCommand>[0]['command'],
    actor = 'a',
  ) => residentPublicGovernanceCommand({ ...ctx(actor), command });
  const ok = (command: Parameters<typeof act>[0], actor = 'a') => {
    const d = act(command, actor);
    expect(d.accepted, JSON.stringify(d)).toBe(true);
    if (d.accepted) commit(d.events);
    return d;
  };
  const rev = (id: string) => w.publicGovernance!.authority.proposals[id]!.revision;
  const time = (deltaMs: number) =>
    commit(
      dispatchWorldCommand({
        projection: w,
        policies,
        nextSequence: events.length + 1,
        command: createCommandEnvelope({
          id: `time-${++n}`,
          simulationId: 'test',
          source: 'system',
          type: 'AdvanceSimulationTime',
          issuedAt: w.clock.now,
          payload: { deltaMs },
        }),
      }),
    );
  const propose = (id: string, terms: PublicEmploymentTerms, expectedRevision = 1) => {
    ok({
      type: 'propose',
      id,
      text: 'Directed boundary test',
      action: { kind: 'set-employment', expectedRevision, terms },
      closesAt: w.clock.now + 10,
      expectedProcedureRevision: 1,
    });
    for (const actor of ['a', 'b'])
      ok({ type: 'vote', id, choice: 'yes', expectedRevision: rev(id) }, actor);
  };
  const apply = (actor: string, occupationName: string) => {
    const es = dispatchWorldCommand({
      projection: w,
      policies,
      nextSequence: events.length + 1,
      command: createCommandEnvelope({
        id: `apply-${++n}`,
        simulationId: 'test',
        source: 'agent-runtime',
        actorId: actor,
        type: 'AgentApplyJob',
        issuedAt: w.clock.now,
        payload: { occupationName },
      }),
    });
    commit(es);
    return es;
  };
  return {
    get w() {
      return w;
    },
    initial,
    policies,
    events,
    activation,
    ctx,
    commit,
    act,
    ok,
    rev,
    time,
    propose,
    apply,
    replay: () => expect(events.reduce(applyWorldEvent, initial)).toEqual(w),
  };
}
function revised(t: ReturnType<typeof fixture>): PublicEmploymentTerms {
  const terms = t.w.publicEmployment!.revisions[0]!.terms;
  return {
    ...terms,
    quotaByResidentialTier: [3, 2, 1],
    ranking: ['submitted'],
    occupations: terms.occupations.map((o) =>
      o.occupationName === 'Chef'
        ? {
            ...o,
            minimumResidentialTier: 1,
            educationFloor: 0,
            eligibilityShare: 1,
            prerequisiteCommodity: null,
          }
        : o,
    ),
  };
}
test('real independent approval schedules next-cycle admission and ranking without touching queued, assigned, body, qualification or balances; replay preserves sources', () => {
  const t = fixture(),
    before = t.w.agents;
  expect(t.apply('a', 'Chef').some((e) => e.type === 'JobApplicationSubmitted')).toBe(false);
  t.apply('a', 'Cleaner');
  t.apply('b', 'Cleaner');
  t.propose('reform', revised(t));
  expect(t.act({ type: 'execute', id: 'reform', expectedRevision: t.rev('reform') })).toMatchObject(
    { accepted: false },
  );
  t.time(10);
  t.ok({ type: 'close', id: 'reform', expectedRevision: t.rev('reform') });
  t.ok({ type: 'execute', id: 'reform', expectedRevision: t.rev('reform') });
  expect(t.w.agents).toEqual(before);
  expect(t.w.publicEmployment?.revisions[1]).toMatchObject({
    effectiveCycle: 1,
    source: { kind: 'public-decision', proposalId: 'reform', actorId: 'a', procedureRevision: 1 },
  });
  expect(t.apply('c', 'Chef').some((e) => e.type === 'JobApplicationSubmitted')).toBe(false);
  t.time(990);
  expect(t.w.agents.b!.job).toBe('Cleaner');
  expect(t.w.agents.a!.job).toBeNull();
  expect(t.w.recruitmentCycles[0]).toMatchObject({
    publicEmploymentRevision: 1,
    completedAt: 1000,
  });
  t.apply('a', 'Chef');
  t.time(1);
  t.apply('b', 'Chef');
  expect(
    t.w.jobApplications
      .filter((a) => a.occupationName === 'Chef')
      .every((a) => a.publicEmploymentRevision === 2),
  ).toBe(true);
  t.time(999);
  expect(t.w.agents.a!.job).toBe('Chef');
  expect(t.w.agents.b!.job).toBe('Cleaner');
  expect(t.w.recruitmentCycles[1]).toMatchObject({
    publicEmploymentRevision: 2,
    completedAt: 2000,
  });
  expect(t.w.agents.a!.educationScore).toBe(330);
  expect(t.w.agents.a!.balance).toBe(100);
  t.replay();
});
test('stale approved changes and substituted effects fail atomically and retain the unconsumed public decision', () => {
  const t = fixture();
  t.propose('first', revised(t));
  t.propose('stale', revised(t));
  t.time(10);
  for (const id of ['first', 'stale']) t.ok({ type: 'close', id, expectedRevision: t.rev(id) });
  const ready = t.act({ type: 'execute', id: 'first', expectedRevision: t.rev('first') });
  if (!ready.accepted) throw Error('fixture');
  const e = ready.events[0]!;
  if (e.type !== 'ResidentPublicGovernanceCommitted') throw Error('fixture');
  const change = e.payload.employmentChange!;
  const { employmentChange, ...rest } = e.payload;
  expect(employmentChange).toBeDefined();
  expect(() => applyWorldEvent(t.w, { ...e, payload: rest })).toThrow(
    'public-employment-effect-mismatch',
  );
  expect(() =>
    applyWorldEvent(t.w, {
      ...e,
      payload: {
        ...e.payload,
        employmentChange: {
          ...change,
          policy: {
            ...change.policy,
            terms: { ...change.policy.terms, defaultOccupationCapacity: 999 },
          },
        },
      },
    }),
  ).toThrow('public-employment-effect-mismatch');
  expect(() =>
    applyWorldEvent(t.w, {
      ...e,
      payload: {
        ...e.payload,
        employmentChange: { ...change, policy: { ...change.policy, effectiveCycle: 0 } },
      },
    }),
  ).toThrow('invalid-public-employment-revision');
  t.commit(ready.events);
  const before = t.w;
  expect(t.act({ type: 'execute', id: 'stale', expectedRevision: t.rev('stale') })).toMatchObject({
    accepted: false,
    reason: 'public-employment-revision-conflict',
  });
  expect(t.w).toBe(before);
  expect(t.w.publicGovernance?.authority.proposals.stale?.status).toBe('approved');
  t.replay();
});
test('multi-cycle advances resolve each frozen cycle identically to separate advances and preserve the original non-enabled world', () => {
  const prepare = () => {
    const t = fixture();
    t.apply('a', 'Cleaner');
    t.apply('b', 'Cleaner');
    t.propose('capacity', { ...revised(t), defaultOccupationCapacity: 0 });
    t.time(10);
    t.ok({ type: 'close', id: 'capacity', expectedRevision: t.rev('capacity') });
    t.ok({ type: 'execute', id: 'capacity', expectedRevision: t.rev('capacity') });
    return t;
  };
  const whole = prepare(),
    split = prepare();
  whole.time(2990);
  split.time(990);
  split.time(1000);
  split.time(1000);
  expect(whole.w.agents).toEqual(split.w.agents);
  expect(whole.w.jobApplications).toEqual(split.w.jobApplications);
  expect(whole.w.recruitmentCycles).toEqual(split.w.recruitmentCycles);
  expect(whole.w.recruitmentCycles.map((c) => c.publicEmploymentRevision)).toEqual([1, 2, 2]);
  expect(whole.initial.publicEmployment).toBeUndefined();
  whole.replay();
  split.replay();
});

test('journal replay refuses forged admission policy sources and prevents employment activation without explicit public authority', () => {
  const t = fixture();
  expect(() =>
    enablePublicEmploymentEvent({ ...t.ctx(), projection: t.initial, policies: t.policies }),
  ).toThrow('public-employment-requires-public-authority-and-recruitment');
  const es = dispatchWorldCommand({
    projection: t.w,
    policies: t.policies,
    nextSequence: t.events.length + 1,
    command: createCommandEnvelope({
      id: 'source-proof',
      simulationId: 'test',
      source: 'agent-runtime',
      actorId: 'a',
      type: 'AgentApplyJob',
      issuedAt: 0,
      payload: { occupationName: 'Cleaner' },
    }),
  });
  const event = es.find((e) => e.type === 'JobApplicationSubmitted')!;
  if (event.type !== 'JobApplicationSubmitted') throw Error('fixture');
  expect(() =>
    applyWorldEvent(t.w, { ...event, payload: { ...event.payload, publicEmploymentRevision: 2 } }),
  ).toThrow('employment-event-policy-source-mismatch');
  const { publicEmploymentRevision, ...legacy } = event.payload;
  expect(publicEmploymentRevision).toBe(1);
  expect(() => applyWorldEvent(t.w, { ...event, payload: legacy })).toThrow(
    'employment-event-policy-source-mismatch',
  );
  expect(() => applyWorldEvent(t.initial, event)).toThrow('employment-event-without-institution');
});
