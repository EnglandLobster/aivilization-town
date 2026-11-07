import { expect, test } from 'vitest';
import {
  PROGRAM_ACTIONS_POLICY,
  ENTERPRISE_PROGRAM_ACTIONS_POLICY,
  parseProgramResourceControl,
} from './programActions';
import {
  COORDINATION_POLICY,
  emptyCoordinationState,
  parseResidentProgramDefinition,
} from './programModel';
import {
  applyCoordinationEvent,
  decideCoordination,
  prepareProgramRun,
  prepareProgramStepAuthority,
  recordProgramRun,
} from './programs';
const action = {
  resourceKind: 'premises',
  resourceId: 'house',
  expectedRevision: 1,
  control: {
    type: 'offer',
    expectedVersion: 1,
    target: { kind: 'resident', id: 'buyer' },
    expiresAt: 10000,
    terms: '卖方的原始移交',
  },
};
const steps = [
  { principalId: 'seller', capability: 'resource.control', arguments: action },
  {
    principalId: 'buyer',
    capability: 'resource.control',
    arguments: {
      resourceKind: 'premises',
      resourceId: 'house',
      expectedRevision: 2,
      control: { type: 'accept', expectedVersion: 2 },
    },
  },
  {
    principalId: 'buyer',
    capability: 'payments.transfer',
    arguments: { targetId: 'seller', amount: 30, note: '双方确定价格' },
  },
];
const definition = { actionPolicyVersion: PROGRAM_ACTIONS_POLICY.version, steps };
const parse = (v: unknown) =>
  parseResidentProgramDefinition(v, COORDINATION_POLICY, undefined, PROGRAM_ACTIONS_POLICY);
test('resource composition requires both explicit grammar version and enabled policy; legacy steps keep their prior representation', () => {
  expect(parseResidentProgramDefinition(definition, COORDINATION_POLICY)).toBeUndefined();
  expect(parse({ steps })).toBeUndefined();
  expect(parse({ ...definition, actionPolicyVersion: 'arbitrary-v9' })).toBeUndefined();
  expect(parse(definition)).toEqual(definition);
  const legacy = { steps: [steps[2]] };
  expect(parse(legacy)).toEqual(legacy);
  // Legacy length is the original steps-array bound, not an unversioned new wrapper overhead.
  const small = { ...COORDINATION_POLICY, maxDefinitionChars: JSON.stringify(legacy.steps).length };
  expect(parseResidentProgramDefinition(legacy, small)).toEqual(legacy);
});
test('resource actions admit only exact supported control transitions and cannot delegate bodies, arbitrary commands or hidden actors', () => {
  expect(parseProgramResourceControl(action, PROGRAM_ACTIONS_POLICY)).toEqual(action);
  for (const resourceKind of ['vehicle', 'enterprise', 'body', 'bank', '__proto__'])
    expect(
      parseProgramResourceControl({ ...action, resourceKind }, PROGRAM_ACTIONS_POLICY),
    ).toBeUndefined();
  for (const arguments_ of [
    { ...action, actorId: 'victim' },
    { ...action, control: { ...action.control, type: 'run-code' } },
    {
      ...action,
      control: { ...action.control, target: { ...action.control.target, unlimited: true } },
    },
    { ...action, expectedRevision: 0 },
    { ...action, expectedRevision: Infinity },
  ])
    expect(parseProgramResourceControl(arguments_, PROGRAM_ACTIONS_POLICY)).toBeUndefined();
  for (const capability of [
    'world.move',
    'engagements.start',
    'programs.run',
    'shell.exec',
    'collectives.vote',
  ])
    expect(parse({ ...definition, steps: [{ ...steps[0], capability }] })).toBeUndefined();
});
test('each supported resource retains exact domain identity, original terms and finite revisions', () => {
  for (const resourceKind of ['premises', 'stock', 'space', 'register', 'group']) {
    const value = { ...action, resourceKind };
    expect(parseProgramResourceControl(value, PROGRAM_ACTIONS_POLICY)).toEqual(value);
  }
  expect(
    parseProgramResourceControl(
      { ...action, control: { type: 'cancel', expectedVersion: 1 } },
      PROGRAM_ACTIONS_POLICY,
    ),
  ).toMatchObject({ control: { type: 'cancel' } });
  expect(
    parseProgramResourceControl(
      { ...action, control: { ...action.control, terms: 'x'.repeat(2001) } },
      PROGRAM_ACTIONS_POLICY,
    ),
  ).toBeUndefined();
  expect(
    parseProgramResourceControl(
      { ...action, control: { ...action.control, expiresAt: 1.2 } },
      PROGRAM_ACTIONS_POLICY,
    ),
  ).toBeUndefined();
});
test('explicit action activation preserves legacy programs and denies forged resource events without activation', () => {
  const old = emptyCoordinationState();
  const next = applyCoordinationEvent(old, {
    type: 'ProgramActionsEnabled',
    policy: PROGRAM_ACTIONS_POLICY,
  });
  expect(next.programs).toBe(old.programs);
  expect(next.mandates).toBe(old.mandates);
  const result = decideCoordination({
    state: next,
    actorId: 'seller',
    at: 0,
    exists: () => true,
    command: {
      type: 'programs.publish',
      id: 'exchange',
      title: '居民定义交换',
      purpose: '已有资产和价款一起提交',
      runners: ['runner'],
      definition,
    },
  });
  if (!result.accepted) throw Error(result.reason);
  expect(() => applyCoordinationEvent(old, result.events[0]!)).toThrow(
    'invalid-program-action-version-or-definition',
  );
  expect(() =>
    applyCoordinationEvent(next, { type: 'ProgramActionsEnabled', policy: PROGRAM_ACTIONS_POLICY }),
  ).toThrow('program-actions-already-enabled');
  const committed = applyCoordinationEvent(next, result.events[0]!);
  expect(committed.programs.exchange!.actionPolicyVersion).toBe(PROGRAM_ACTIONS_POLICY.version);
});
test('both resource seller and payer independently mandate the exact version, with revocation and one-use consumption', () => {
  let state = emptyCoordinationState(COORDINATION_POLICY, undefined, PROGRAM_ACTIONS_POLICY);
  const decide = (
    actorId: string,
    command: Parameters<typeof decideCoordination>[0]['command'],
  ) => {
    const d = decideCoordination({ state, actorId, at: 0, command, exists: () => true });
    if (!d.accepted) throw Error(d.reason);
    for (const e of d.events) state = applyCoordinationEvent(state, e);
  };
  decide('seller', {
    type: 'programs.publish',
    id: 'exchange',
    title: '双方交换',
    purpose: '实际交割',
    runners: ['runner'],
    definition,
  });
  decide('seller', {
    type: 'mandates.grant',
    id: 'seller-consent',
    programId: 'exchange',
    programRevision: 1,
    runnerId: 'runner',
    maxRuns: 1,
    expiresAt: 10000,
  });
  expect(prepareProgramRun(state, 'runner', 'exchange', 1, 0, () => true)).toMatchObject({
    accepted: false,
    reason: 'program-mandate-required',
  });
  decide('buyer', {
    type: 'mandates.grant',
    id: 'buyer-consent',
    programId: 'exchange',
    programRevision: 1,
    runnerId: 'runner',
    maxRuns: 1,
    expiresAt: 10000,
  });
  expect(prepareProgramRun(state, 'runner', 'exchange', 1, 0, () => true).accepted).toBe(true);
  expect(prepareProgramRun(state, 'runner', 'exchange', 2, 0, () => true)).toMatchObject({
    accepted: false,
    reason: 'program-version-inactive',
  });
  const authorityInput = {
    state,
    executorId: 'runner',
    programId: 'exchange',
    programRevision: 1,
    runId: 'run',
    stepIndex: 0,
    at: 0,
    exists: () => true,
  };
  expect(prepareProgramStepAuthority(authorityInput)).toMatchObject({
    accepted: true,
    authority: {
      principalId: 'seller',
      executedBy: 'runner',
      mandateId: 'seller-consent',
      mandateRevision: 1,
      stepIndex: 0,
    },
  });
  expect(prepareProgramStepAuthority({ ...authorityInput, stepIndex: 1 })).toMatchObject({
    accepted: true,
    authority: {
      principalId: 'buyer',
      executedBy: 'runner',
      mandateId: 'buyer-consent',
      stepIndex: 1,
    },
  });
  expect(prepareProgramStepAuthority({ ...authorityInput, stepIndex: 3 })).toMatchObject({
    accepted: false,
    reason: 'invalid-program-step-reference',
  });
  expect(prepareProgramStepAuthority({ ...authorityInput, executorId: 'stranger' }).accepted).toBe(
    false,
  );
  const before = state;
  decide('buyer', { type: 'mandates.revoke', id: 'buyer-consent', expectedRevision: 1 });
  expect(prepareProgramRun(state, 'runner', 'exchange', 1, 0, () => true).accepted).toBe(false);
  state = before;
  const execution = {
    version: PROGRAM_ACTIONS_POLICY.execution,
    steps: [0, 1, 2].map((stepIndex) => {
      const d = prepareProgramStepAuthority({ ...authorityInput, state, stepIndex });
      if (!d.accepted) throw Error(d.reason);
      return { authority: d.authority, effectIds: [String(stepIndex + 1).padStart(64, '0')] };
    }),
  };
  expect(() =>
    recordProgramRun(state, {
      id: 'missing',
      programId: 'exchange',
      programRevision: 1,
      runnerId: 'runner',
      participants: ['seller', 'buyer', 'runner'],
      mandateIds: ['seller-consent', 'buyer-consent'],
      status: 'succeeded',
      at: 0,
    }),
  ).toThrow('program-step-execution-record-required');

  for (const e of recordProgramRun(state, {
    id: 'run',
    execution,
    programId: 'exchange',
    programRevision: 1,
    runnerId: 'runner',
    participants: ['seller', 'buyer', 'runner'],
    mandateIds: ['seller-consent', 'buyer-consent'],
    status: 'succeeded',
    at: 0,
  }))
    state = applyCoordinationEvent(state, e);
  expect(state.mandates['seller-consent']!.usedRuns).toBe(1);
  expect(state.mandates['buyer-consent']!.usedRuns).toBe(1);
  expect(prepareProgramRun(state, 'runner', 'exchange', 1, 0, () => true).accepted).toBe(false);
});

test('v3 explicitly adds enterprise control and preserves old v2 program semantics and independent mandates', () => {
  const value = { ...action, resourceKind: 'enterprise' };
  expect(parseProgramResourceControl(value, PROGRAM_ACTIONS_POLICY)).toBeUndefined();
  expect(parseProgramResourceControl(value, ENTERPRISE_PROGRAM_ACTIONS_POLICY)).toEqual(value);
  let state = emptyCoordinationState(COORDINATION_POLICY, undefined, PROGRAM_ACTIONS_POLICY);
  const d = decideCoordination({
    state,
    actorId: 'seller',
    at: 0,
    exists: () => true,
    command: {
      type: 'programs.publish',
      id: 'exchange',
      title: 'Legacy',
      purpose: 'Keep original meaning',
      runners: ['runner'],
      definition,
    },
  });
  if (!d.accepted) throw Error(d.reason);
  for (const event of d.events) state = applyCoordinationEvent(state, event);
  const before = state;
  const upgraded = applyCoordinationEvent(state, {
    type: 'ProgramActionsUpgraded',
    fromVersion: PROGRAM_ACTIONS_POLICY.version,
    policy: ENTERPRISE_PROGRAM_ACTIONS_POLICY,
  });
  expect(upgraded.programs).toBe(before.programs);
  expect(upgraded.mandates).toBe(before.mandates);
  expect(upgraded.runs).toBe(before.runs);
  expect(
    parseResidentProgramDefinition(
      definition,
      COORDINATION_POLICY,
      undefined,
      upgraded.actionsPolicy,
    ),
  ).toEqual(definition);
  const current = {
    actionPolicyVersion: ENTERPRISE_PROGRAM_ACTIONS_POLICY.version,
    steps: [{ principalId: 'seller', capability: 'resource.control', arguments: value }],
  };
  expect(
    parseResidentProgramDefinition(current, COORDINATION_POLICY, undefined, before.actionsPolicy),
  ).toBeUndefined();
  expect(
    parseResidentProgramDefinition(
      { ...current, actionPolicyVersion: PROGRAM_ACTIONS_POLICY.version },
      COORDINATION_POLICY,
      undefined,
      upgraded.actionsPolicy,
    ),
  ).toBeUndefined();
  expect(
    parseResidentProgramDefinition(current, COORDINATION_POLICY, undefined, upgraded.actionsPolicy),
  ).toEqual(current);
  expect(() =>
    applyCoordinationEvent(upgraded, {
      type: 'ProgramActionsUpgraded',
      fromVersion: ENTERPRISE_PROGRAM_ACTIONS_POLICY.version,
      policy: PROGRAM_ACTIONS_POLICY,
    }),
  ).toThrow('invalid-program-actions-upgrade');
  expect(() =>
    applyCoordinationEvent(upgraded, {
      type: 'ProgramActionsUpgraded',
      fromVersion: PROGRAM_ACTIONS_POLICY.version,
      policy: ENTERPRISE_PROGRAM_ACTIONS_POLICY,
    }),
  ).toThrow('invalid-program-actions-upgrade');
});
