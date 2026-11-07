import {
  emptyProgramReactions,
  type ProgramReactionsPolicy,
  type ProgramReactionsState,
  type ProgramReactionEvent,
} from './reactionModel';
import {
  parseProgramConditions,
  assertProgramConditionsPolicy,
  type ProgramConditionsPolicy,
  type ProgramCondition,
  type ConditionEvidence,
} from './conditionModel';
import {
  assertProgramActionsPolicy,
  resolveProgramActionsPolicy,
  parseProgramResourceControl,
  type ProgramActionsPolicy,
  type ProgramExecutionRecord,
} from './programActions';
export const COORDINATION_POLICY = {
  version: 'resident-coordination-v1',
  maxProgramsPerOwner: 20,
  maxSteps: 8,
  maxRunners: 10,
  maxPrincipals: 8,
  maxDefinitionChars: 12000,
  maxRuns: 100,
  maxHorizonMs: 30 * 86_400_000,
  maxActiveMandates: 100,
  maxActiveSchedules: 20,
  minIntervalMs: 60_000,
  maxDuePerAdvance: 128,
} as const;
export type CoordinationPolicy = { readonly version: 'resident-coordination-v1' } & {
  readonly [K in Exclude<keyof typeof COORDINATION_POLICY, 'version'>]: number;
};
export type ProgramStep = {
  readonly principalId: string;
  readonly capability:
    | 'payments.transfer'
    | 'messages.send'
    | 'records.put'
    | 'records.append'
    | 'resource.control';
  readonly arguments: Readonly<Record<string, unknown>>;
};
export type ResidentProgram = {
  readonly actionPolicyVersion?: ProgramActionsPolicy['version'];
  readonly conditions?: readonly ProgramCondition[];
  readonly conditionPolicyVersion?: ProgramConditionsPolicy['version'];
  readonly id: string;
  readonly ownerId: string;
  readonly title: string;
  readonly purpose: string;
  readonly runners: readonly string[];
  readonly steps: readonly ProgramStep[];
  readonly revision: number;
  readonly active: boolean;
  readonly at: number;
};
export type ResidentMandate = {
  readonly id: string;
  readonly principalId: string;
  readonly runnerId: string;
  readonly programId: string;
  readonly programRevision: number;
  readonly maxRuns: number;
  readonly usedRuns: number;
  readonly expiresAt: number;
  readonly revoked: boolean;
  readonly revision: number;
  readonly at: number;
};
export type ProgramSchedule = {
  readonly id: string;
  readonly runnerId: string;
  readonly programId: string;
  readonly programRevision: number;
  readonly nextAt: number;
  readonly intervalMs: number;
  readonly remainingRuns: number;
  readonly completedRuns: number;
  readonly status: 'active' | 'cancelled' | 'completed' | 'failed';
  readonly revision: number;
  readonly at: number;
};
export type ProgramRun = {
  readonly execution?: ProgramExecutionRecord;
  readonly reactionId?: string;
  readonly conditionEvidence?: readonly ConditionEvidence[];
  readonly id: string;
  readonly programId: string;
  readonly programRevision: number;
  readonly runnerId: string;
  readonly participants: readonly string[];
  readonly mandateIds: readonly string[];
  readonly status: 'succeeded' | 'failed';
  readonly at: number;
  readonly reason?: string;
  readonly scheduleId?: string;
};
export type CoordinationState = {
  readonly actionsPolicy?: ProgramActionsPolicy;
  readonly reactions?: ProgramReactionsState;
  readonly conditionsPolicy?: ProgramConditionsPolicy;
  readonly policy: CoordinationPolicy;
  readonly programs: Readonly<Record<string, ResidentProgram>>;
  readonly history: Readonly<Record<string, readonly ResidentProgram[]>>;
  readonly mandates: Readonly<Record<string, ResidentMandate>>;
  readonly schedules: Readonly<Record<string, ProgramSchedule>>;
  readonly runs: Readonly<Record<string, ProgramRun>>;
};
export type CoordinationEvent =
  | ProgramReactionEvent
  | { readonly type: 'ProgramActionsEnabled'; readonly policy: ProgramActionsPolicy }
  | {
      readonly type: 'ProgramActionsUpgraded';
      readonly fromVersion: ProgramActionsPolicy['version'];
      readonly policy: ProgramActionsPolicy;
    }
  | { readonly type: 'ProgramConditionsEnabled'; readonly policy: ProgramConditionsPolicy }
  | { readonly type: 'CoordinationEnabled'; readonly policy: CoordinationPolicy }
  | { readonly type: 'ResidentProgramChanged'; readonly program: ResidentProgram }
  | { readonly type: 'ResidentMandateChanged'; readonly mandate: ResidentMandate }
  | { readonly type: 'ProgramScheduleChanged'; readonly schedule: ProgramSchedule }
  | { readonly type: 'ProgramRunRecorded'; readonly run: ProgramRun };
export type CoordinationCommand =
  | {
      type: 'programs.publish';
      id: string;
      title: string;
      purpose: string;
      runners: readonly string[];
      definition: unknown;
    }
  | {
      type: 'programs.revise';
      id: string;
      expectedRevision: number;
      title: string;
      purpose: string;
      runners: readonly string[];
      definition: unknown;
    }
  | { type: 'programs.disable'; id: string; expectedRevision: number }
  | {
      type: 'mandates.grant';
      id: string;
      programId: string;
      programRevision: number;
      runnerId: string;
      maxRuns: number;
      expiresAt: number;
    }
  | { type: 'mandates.revoke'; id: string; expectedRevision: number }
  | {
      type: 'programs.schedule';
      id: string;
      programId: string;
      programRevision: number;
      startAt: number;
      intervalMs: number;
      runs: number;
    }
  | { type: 'programs.cancel'; id: string; expectedRevision: number };
export type CoordinationDecision =
  | { accepted: true; events: readonly CoordinationEvent[] }
  | { accepted: false; reason: string };
export const coordinationId = (id: string) =>
  /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(id) && !Object.hasOwn(Object.prototype, id);
export const programPrincipals = (p: ResidentProgram) => [
  ...new Set(p.steps.map((s) => s.principalId)),
];
export const canReadProgram = (p: ResidentProgram, actor: string) =>
  p.ownerId === actor || p.runners.includes(actor) || programPrincipals(p).includes(actor);
export function assertCoordinationPolicy(p: CoordinationPolicy) {
  if (
    p.version !== 'resident-coordination-v1' ||
    Object.keys(COORDINATION_POLICY).some(
      (k) =>
        k !== 'version' &&
        (!Number.isSafeInteger(p[k as keyof CoordinationPolicy]) ||
          Number(p[k as keyof CoordinationPolicy]) < 1),
    )
  )
    throw new Error('invalid-coordination-policy');
}
export function emptyCoordinationState(
  policy: CoordinationPolicy = COORDINATION_POLICY,
  conditionsPolicy?: ProgramConditionsPolicy,
  reactionsPolicy?: ProgramReactionsPolicy,
  actionsPolicy?: ProgramActionsPolicy,
): CoordinationState {
  assertCoordinationPolicy(policy);
  if (conditionsPolicy) assertProgramConditionsPolicy(conditionsPolicy);
  if (actionsPolicy) assertProgramActionsPolicy(actionsPolicy);
  if (reactionsPolicy && !conditionsPolicy) throw new Error('reaction-conditions-required');
  return {
    policy,
    ...(actionsPolicy ? { actionsPolicy } : {}),
    ...(conditionsPolicy ? { conditionsPolicy } : {}),
    ...(reactionsPolicy ? { reactions: emptyProgramReactions(reactionsPolicy) } : {}),
    programs: {},
    history: {},
    mandates: {},
    schedules: {},
    runs: {},
  };
}
const object = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(v).length === keys.length && keys.every((k) => Object.hasOwn(v, k));
const id = (v: unknown): v is string => typeof v === 'string' && coordinationId(v);
const text = (v: unknown): v is string => typeof v === 'string' && v.length <= 8000;
/** A closed data language, not executable source or an arbitrary capability proxy. */
export function parseProgramDefinition(
  value: unknown,
  p: CoordinationPolicy,
  actionsPolicy?: ProgramActionsPolicy,
): readonly ProgramStep[] | undefined {
  if (
    !object(value) ||
    !exact(value, ['steps']) ||
    !Array.isArray(value.steps) ||
    value.steps.length < 1 ||
    value.steps.length > p.maxSteps
  )
    return undefined;
  const result: ProgramStep[] = [];
  for (const raw of value.steps as unknown[]) {
    if (
      !object(raw) ||
      !exact(raw, ['principalId', 'capability', 'arguments']) ||
      !id(raw.principalId) ||
      !object(raw.arguments)
    )
      return undefined;
    const a = raw.arguments,
      c = raw.capability;
    let valid = false;
    if (c === 'resource.control')
      valid = !!actionsPolicy && !!parseProgramResourceControl(a, actionsPolicy);
    else if (c === 'payments.transfer')
      valid =
        exact(a, ['targetId', 'amount', 'note']) &&
        id(a.targetId) &&
        typeof a.amount === 'number' &&
        Number.isFinite(a.amount) &&
        a.amount > 0 &&
        a.amount <= 1_000_000 &&
        text(a.note);
    else if (c === 'messages.send')
      valid =
        exact(a, ['recipientId', 'content']) &&
        id(a.recipientId) &&
        text(a.content) &&
        a.content.trim().length > 0;
    else if (c === 'records.put' || c === 'records.append') {
      valid =
        exact(
          a,
          c === 'records.put'
            ? ['registerId', 'key', 'expectedRevision', 'values']
            : ['registerId', 'values'],
        ) &&
        id(a.registerId) &&
        object(a.values) &&
        Object.keys(a.values).length >= 1 &&
        Object.keys(a.values).length <= 16 &&
        Object.entries(a.values).every(
          ([k, v]) =>
            coordinationId(k) &&
            (typeof v === 'boolean' ||
              (typeof v === 'number' && Number.isFinite(v)) ||
              (typeof v === 'string' && v.length <= 2000)),
        );
      if (c === 'records.put')
        valid =
          valid &&
          id(a.key) &&
          Number.isSafeInteger(a.expectedRevision) &&
          Number(a.expectedRevision) >= 0;
    }
    if (
      !valid ||
      (c !== 'payments.transfer' &&
        c !== 'messages.send' &&
        c !== 'records.put' &&
        c !== 'records.append' &&
        c !== 'resource.control')
    )
      return undefined;
    result.push({ principalId: raw.principalId, capability: c, arguments: structuredClone(a) });
  }
  return JSON.stringify(result).length <= p.maxDefinitionChars &&
    new Set(result.map((s) => s.principalId)).size <= p.maxPrincipals
    ? result
    : undefined;
}

/** Old definitions keep their exact event shape; conditional definitions explicitly bind a policy version. */
export function parseResidentProgramDefinition(
  value: unknown,
  policy: CoordinationPolicy,
  conditionsPolicy?: ProgramConditionsPolicy,
  actionsPolicy?: ProgramActionsPolicy,
):
  | Pick<ResidentProgram, 'steps' | 'conditions' | 'conditionPolicyVersion' | 'actionPolicyVersion'>
  | undefined {
  if (!object(value)) return undefined;
  const versioned = Object.hasOwn(value, 'actionPolicyVersion'),
    conditional = Object.hasOwn(value, 'conditions');
  if (
    !exact(value, [
      'steps',
      ...(versioned ? ['actionPolicyVersion'] : []),
      ...(conditional ? ['conditions'] : []),
    ])
  )
    return undefined;
  const selected = versioned
    ? resolveProgramActionsPolicy(actionsPolicy, value.actionPolicyVersion)
    : undefined;
  if (versioned && !selected) return undefined;
  const steps = parseProgramDefinition({ steps: value.steps }, policy, selected);
  if (!steps) return undefined;
  const conditions =
    conditional && conditionsPolicy
      ? parseProgramConditions(value.conditions, conditionsPolicy)
      : undefined;
  if (conditional && !conditions) return undefined;
  if (
    (versioned && JSON.stringify(value).length > policy.maxDefinitionChars) ||
    (conditional && JSON.stringify({ steps, conditions }).length > policy.maxDefinitionChars)
  )
    return undefined;
  return {
    steps,
    ...(conditions ? { conditions, conditionPolicyVersion: conditionsPolicy!.version } : {}),
    ...(versioned ? { actionPolicyVersion: selected!.version } : {}),
  };
}
