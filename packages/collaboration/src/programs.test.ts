import { expect, test } from 'vitest';
import {
  applyCoordinationEvent,
  decideCoordination,
  prepareProgramRun,
  recordProgramRun,
  programAdvanceWithinBudget,
  nextProgramBoundary,
} from './programs';
import {
  COORDINATION_POLICY,
  emptyCoordinationState,
  parseProgramDefinition,
  type CoordinationCommand,
  type CoordinationEvent,
} from './programModel';
const exists = (id: string) => ['a', 'b', 'c'].includes(id);
const definition = {
  steps: [
    {
      principalId: 'b',
      capability: 'payments.transfer',
      arguments: { targetId: 'c', amount: 3, note: '原始约定' },
    },
  ],
};
function setup() {
  let state = emptyCoordinationState();
  const events: CoordinationEvent[] = [];
  const apply = (es: readonly CoordinationEvent[]) => {
    for (const e of es) {
      state = applyCoordinationEvent(state, e);
      events.push(e);
    }
  };
  const call = (actorId: string, command: CoordinationCommand, at = 0) => {
    const d = decideCoordination({ state, actorId, at, command, exists });
    if (d.accepted) apply(d.events);
    return d;
  };
  const publish = () =>
    call('a', {
      type: 'programs.publish',
      id: 'p',
      title: '合作',
      purpose: '居民自行约定',
      runners: ['a'],
      definition,
    });
  const grant = () =>
    call('b', {
      type: 'mandates.grant',
      id: 'g',
      programId: 'p',
      programRevision: 1,
      runnerId: 'a',
      maxRuns: 2,
      expiresAt: 200_000,
    });
  return {
    call,
    apply,
    publish,
    grant,
    events,
    get state() {
      return state;
    },
  };
}
test('only actual principals authorize exact versions; finite uses, revocation and replay are explicit', () => {
  const t = setup();
  expect(t.publish().accepted).toBe(true);
  expect(prepareProgramRun(t.state, 'a', 'p', 1, 0, exists)).toEqual({
    accepted: false,
    reason: 'program-mandate-required',
  });
  expect(
    t.call('a', {
      type: 'mandates.grant',
      id: 'fake',
      programId: 'p',
      programRevision: 1,
      runnerId: 'a',
      maxRuns: 1,
      expiresAt: 100,
    }).accepted,
  ).toBe(false);
  expect(t.grant().accepted).toBe(true);
  expect(prepareProgramRun(t.state, 'c', 'p', 1, 0, exists).accepted).toBe(false);
  expect(prepareProgramRun(t.state, 'a', 'p', 1, 200_000, exists).accepted).toBe(false);
  for (let i = 0; i < 2; i++) {
    expect(prepareProgramRun(t.state, 'a', 'p', 1, i, exists).accepted).toBe(true);
    t.apply(
      recordProgramRun(t.state, {
        id: `run-${i}`,
        programId: 'p',
        programRevision: 1,
        runnerId: 'a',
        participants: ['a', 'b'],
        mandateIds: ['g'],
        status: 'succeeded',
        at: i,
      }),
    );
  }
  expect(t.state.mandates.g?.usedRuns).toBe(2);
  expect(prepareProgramRun(t.state, 'a', 'p', 1, 2, exists).accepted).toBe(false);
  expect(t.events.reduce(applyCoordinationEvent, emptyCoordinationState())).toEqual(t.state);
});
test('revisions invalidate old mandates; failed attempts do not consume grants; revoke cannot impersonate', () => {
  const t = setup();
  t.publish();
  t.grant();
  t.apply(
    recordProgramRun(t.state, {
      id: 'failed',
      programId: 'p',
      programRevision: 1,
      runnerId: 'a',
      participants: ['a', 'b'],
      mandateIds: [],
      status: 'failed',
      reason: 'step-rejected',
      at: 0,
    }),
  );
  expect(t.state.mandates.g?.usedRuns).toBe(0);
  expect(t.call('a', { type: 'mandates.revoke', id: 'g', expectedRevision: 1 }).accepted).toBe(
    false,
  );
  expect(
    t.call('a', {
      type: 'programs.revise',
      id: 'p',
      expectedRevision: 1,
      title: '新约定',
      purpose: 'changed',
      runners: ['a'],
      definition,
    }).accepted,
  ).toBe(true);
  expect(prepareProgramRun(t.state, 'a', 'p', 1, 0, exists)).toEqual({
    accepted: false,
    reason: 'program-version-inactive',
  });
  expect(prepareProgramRun(t.state, 'a', 'p', 2, 0, exists)).toEqual({
    accepted: false,
    reason: 'program-mandate-required',
  });
  expect(t.call('b', { type: 'mandates.revoke', id: 'g', expectedRevision: 1 }).accepted).toBe(
    true,
  );
});
test('closed program language rejects arbitrary source, recursive calls, authority overrides and oversize steps', () => {
  for (const value of [
    { steps: [], script: 'x' },
    { steps: [] },
    { steps: [{ ...definition.steps[0], capability: 'programs.run' }] },
    {
      steps: [
        { ...definition.steps[0], arguments: { ...definition.steps[0]!.arguments, actorId: 'c' } },
      ],
    },
    { steps: Array.from({ length: 9 }, () => definition.steps[0]) },
    {
      steps: [
        {
          ...definition.steps[0],
          arguments: { ...definition.steps[0]!.arguments, amount: Infinity },
        },
      ],
    },
  ])
    expect(parseProgramDefinition(value, COORDINATION_POLICY)).toBeUndefined();
  expect(parseProgramDefinition(definition, COORDINATION_POLICY)).toHaveLength(1);
  expect(
    parseProgramDefinition(
      {
        steps: [
          {
            principalId: 'b',
            capability: 'records.append',
            arguments: { registerId: 'ledger', values: { fact: 'not authoritative' } },
          },
        ],
      },
      COORDINATION_POLICY,
    ),
  ).toHaveLength(1);
});
test('scheduled executions have bounded cadence, stop on failure and do not reschedule on replay', () => {
  const t = setup();
  t.publish();
  t.grant();
  expect(
    t.call('a', {
      type: 'programs.schedule',
      id: 's',
      programId: 'p',
      programRevision: 1,
      startAt: 10,
      intervalMs: 1,
      runs: 2,
    }).accepted,
  ).toBe(false);
  expect(
    t.call('a', {
      type: 'programs.schedule',
      id: 's',
      programId: 'p',
      programRevision: 1,
      startAt: 10,
      intervalMs: 60_000,
      runs: 2,
    }).accepted,
  ).toBe(true);
  expect(nextProgramBoundary(t.state)).toBe(10);
  expect(
    programAdvanceWithinBudget(
      { ...t.state, policy: { ...t.state.policy, maxDuePerAdvance: 1 } },
      70_000,
    ),
  ).toBe(false);
  t.apply(
    recordProgramRun(t.state, {
      id: 'run-s-0',
      programId: 'p',
      programRevision: 1,
      runnerId: 'a',
      participants: ['a', 'b'],
      mandateIds: [],
      status: 'failed',
      reason: 'insufficient-funds',
      at: 10,
      scheduleId: 's',
    }),
  );
  expect(t.state.schedules.s).toMatchObject({ status: 'failed', completedRuns: 1 });
  expect(nextProgramBoundary(t.state)).toBeUndefined();
  expect(t.state.mandates.g?.usedRuns).toBe(0);
  expect(t.events.reduce(applyCoordinationEvent, emptyCoordinationState())).toEqual(t.state);
});

test('admission prevents same-instant scheduler deadlock and successful facts require complete distinct mandates', () => {
  const t = setup();
  t.publish();
  t.grant();
  expect(() =>
    recordProgramRun(t.state, {
      id: 'forged',
      programId: 'p',
      programRevision: 1,
      runnerId: 'a',
      participants: ['a', 'b'],
      mandateIds: [],
      status: 'succeeded',
      at: 0,
    }),
  ).toThrow('program-mandates-incomplete');
  const state = { ...t.state, policy: { ...t.state.policy, maxDuePerAdvance: 1 } };
  const command = {
    type: 'programs.schedule' as const,
    id: 'first',
    programId: 'p',
    programRevision: 1,
    startAt: 60_000,
    intervalMs: 60_000,
    runs: 2,
  };
  const d = decideCoordination({ state, actorId: 'a', at: 0, command, exists });
  if (!d.accepted) throw new Error(d.reason);
  const after = d.events.reduce(applyCoordinationEvent, state);
  expect(
    decideCoordination({
      state: after,
      actorId: 'a',
      at: 0,
      command: { ...command, id: 'second', startAt: 120_000 },
      exists,
    }),
  ).toEqual({ accepted: false, reason: 'schedule-concurrency-quota' });
  expect(
    decideCoordination({
      state: after,
      actorId: 'a',
      at: 0,
      command: { ...command, id: 'offset', startAt: 60_001 },
      exists,
    }).accepted,
  ).toBe(true);
});
