import { expect, test } from 'vitest';
import {
  PROGRAM_CONDITIONS_POLICY,
  parseProgramConditions,
  type ProgramCondition,
} from './conditionModel';
import { evaluateProgramConditions } from './conditionEvaluation';
import { applyCoordinationEvent, decideCoordination, prepareProgramRun } from './programs';
import {
  COORDINATION_POLICY,
  emptyCoordinationState,
  parseResidentProgramDefinition,
} from './programModel';
const clock: ProgramCondition = { source: { kind: 'clock' }, op: 'gte', value: 100 };
const steps = [
  {
    principalId: 'a',
    capability: 'payments.transfer',
    arguments: { targetId: 'b', amount: 1, note: '付款' },
  },
];
test('conditional syntax is closed, finite and tied to an explicit policy while old definitions keep their shape', () => {
  expect(parseResidentProgramDefinition({ steps }, COORDINATION_POLICY)).toEqual({ steps });
  expect(
    parseResidentProgramDefinition({ steps, conditions: [clock] }, COORDINATION_POLICY),
  ).toBeUndefined();
  expect(
    parseResidentProgramDefinition(
      { steps, conditions: [clock] },
      COORDINATION_POLICY,
      PROGRAM_CONDITIONS_POLICY,
    ),
  ).toMatchObject({
    conditions: [clock],
    conditionPolicyVersion: PROGRAM_CONDITIONS_POLICY.version,
  });
  for (const c of [
    { ...clock, unlimited: true },
    { ...clock, value: Infinity },
    { source: { kind: 'eval', source: 'x' }, op: 'eq', value: true },
    { source: { kind: 'clock', hostClock: true }, op: 'eq', value: 1 },
    {
      source: { kind: 'record', registerId: 'r', key: 'x', revision: 0, field: 'x' },
      op: 'eq',
      value: true,
    },
    {
      source: {
        kind: 'record',
        registerId: 'r',
        key: 'x',
        revision: 'latest',
        field: 'constructor',
      },
      op: 'eq',
      value: true,
    },
  ])
    expect(parseProgramConditions([c], PROGRAM_CONDITIONS_POLICY)).toBeUndefined();
  expect(
    parseProgramConditions(
      Array.from({ length: 9 }, () => clock),
      PROGRAM_CONDITIONS_POLICY,
    ),
  ).toBeUndefined();
  expect(
    parseResidentProgramDefinition(
      {
        steps,
        conditions: [
          {
            source: { kind: 'record', registerId: 'r', key: 'x', revision: 'latest', field: 'x' },
            op: 'eq',
            value: 'a'.repeat(2000),
          },
        ],
      },
      { ...COORDINATION_POLICY, maxDefinitionChars: 200 },
      PROGRAM_CONDITIONS_POLICY,
    ),
  ).toBeUndefined();
});
test('all audiences and sources are authorized before any calculation or partial result', () => {
  let reads = 0;
  const auth: string[] = [];
  const result = evaluateProgramConditions({
    conditions: [
      clock,
      {
        source: { kind: 'common-balance', accountId: 'pool', controlVersion: 1 },
        op: 'gte',
        value: 5,
      },
    ],
    policy: PROGRAM_CONDITIONS_POLICY,
    audiences: ['a', 'b'],
    port: {
      canRead: (s, a) => {
        auth.push(`${s.kind}:${a}`);
        return !(s.kind === 'common-balance' && a === 'b');
      },
      read: () => {
        reads++;
        return { accepted: true, value: 200, sourceVersions: { v: 1 }, work: 1 };
      },
    },
  });
  expect(result).toEqual({ accepted: false, reason: 'condition-source-unavailable' });
  expect(reads).toBe(0);
  expect(auth).toEqual(['clock:a', 'clock:b', 'common-balance:a', 'common-balance:b']);
});
test('claim and personal signature retain distinct provenance and no raw values in evidence', () => {
  const conditions: ProgramCondition[] = [
    {
      source: { kind: 'record', registerId: 'r', key: 'x', revision: 'latest', field: 'ok' },
      op: 'eq',
      value: true,
    },
    {
      source: {
        kind: 'statement',
        registerId: 'r',
        key: 'x',
        revision: 2,
        field: 'ok',
        signerId: 'a',
      },
      op: 'eq',
      value: true,
    },
  ];
  const result = evaluateProgramConditions({
    conditions,
    policy: PROGRAM_CONDITIONS_POLICY,
    audiences: ['a'],
    port: {
      canRead: () => true,
      read: () => ({
        accepted: true,
        value: true,
        sourceVersions: { revision: 2 },
        work: 1,
      }),
    },
  });
  expect(result).toMatchObject({ accepted: true, matched: true, work: 2 });
  if (!result.accepted) return;
  expect(result.evidence.map((e) => e.sourceClass)).toEqual(['resident-claim', 'signed-claim']);
  expect(result.evidence.every((e) => !Object.hasOwn(e, 'value'))).toBe(true);
});
test('false comparisons are reported without promoting data to authority; type mismatch and exhausted work reject', () => {
  const port = {
    canRead: () => true,
    read: () => ({ accepted: true as const, value: 20, sourceVersions: { at: 20 }, work: 1 }),
  };
  expect(
    evaluateProgramConditions({
      conditions: [clock],
      policy: PROGRAM_CONDITIONS_POLICY,
      audiences: ['a'],
      port,
    }),
  ).toMatchObject({
    accepted: true,
    matched: false,
    evidence: [{ matched: false, sourceClass: 'world-fact' }],
  });
  expect(
    evaluateProgramConditions({
      conditions: [clock],
      policy: PROGRAM_CONDITIONS_POLICY,
      audiences: ['a'],
      port: { ...port, read: () => ({ accepted: true, value: '20', sourceVersions: {}, work: 1 }) },
    }),
  ).toMatchObject({ accepted: false, reason: 'condition-evaluation-failed' });
  let reads = 0;
  expect(
    evaluateProgramConditions({
      conditions: [clock, clock],
      policy: { ...PROGRAM_CONDITIONS_POLICY, maxWork: 1 },
      audiences: ['a'],
      port: {
        ...port,
        read: () => {
          reads++;
          return port.read();
        },
      },
    }),
  ).toMatchObject({ accepted: false, reason: 'condition-work-budget-exceeded' });
  expect(reads).toBe(1);
});
test('enabling and condition amendments replay deterministically and never reuse old mandates', () => {
  let s = emptyCoordinationState();
  const enabled = { type: 'ProgramConditionsEnabled' as const, policy: PROGRAM_CONDITIONS_POLICY };
  s = applyCoordinationEvent(s, enabled);
  const publish = {
    type: 'programs.publish' as const,
    id: 'p',
    title: '条件',
    purpose: '自己的制度',
    runners: ['a'],
    definition: { steps, conditions: [clock] },
  };
  const d = decideCoordination({
    state: s,
    actorId: 'a',
    at: 0,
    command: publish,
    exists: () => true,
  });
  expect(d.accepted).toBe(true);
  if (!d.accepted) return;
  const events = [enabled, ...d.events];
  for (const e of d.events) s = applyCoordinationEvent(s, e);
  const grant = decideCoordination({
    state: s,
    actorId: 'a',
    at: 0,
    command: {
      type: 'mandates.grant',
      id: 'm',
      programId: 'p',
      programRevision: 1,
      runnerId: 'a',
      maxRuns: 1,
      expiresAt: 500,
    },
    exists: () => true,
  });
  if (!grant.accepted) throw new Error(grant.reason);
  for (const e of grant.events) s = applyCoordinationEvent(s, e);
  events.push(...grant.events);
  expect(prepareProgramRun(s, 'a', 'p', 1, 0, () => true).accepted).toBe(true);
  const revised = decideCoordination({
    state: s,
    actorId: 'a',
    at: 0,
    command: {
      ...publish,
      type: 'programs.revise',
      expectedRevision: 1,
      definition: { steps, conditions: [{ ...clock, value: 200 }] },
    },
    exists: () => true,
  });
  if (!revised.accepted) throw new Error(revised.reason);
  for (const e of revised.events) s = applyCoordinationEvent(s, e);
  events.push(...revised.events);
  expect(prepareProgramRun(s, 'a', 'p', 2, 0, () => true)).toMatchObject({
    accepted: false,
    reason: 'program-mandate-required',
  });
  expect(events.reduce(applyCoordinationEvent, emptyCoordinationState())).toEqual(s);
  expect(() => applyCoordinationEvent(s, enabled)).toThrow('program-conditions-already-enabled');
});
