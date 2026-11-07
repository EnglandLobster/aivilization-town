import type { ControlCommand } from '@aivilization/authority';

/** A versioned data language for resource control; neither CLI dispatch nor executable source. */
export const PROGRAM_ACTIONS_POLICY = {
  version: 'resident-program-actions-v2',
  execution: 'ordered-program-transaction-v1',
  maxResourceTermsChars: 2000,
  maxStepEffects: 1024,
} as const;
/** Explicit additive grammar. Existing v2 programs keep their exact interpretation. */
export const ENTERPRISE_PROGRAM_ACTIONS_POLICY = {
  ...PROGRAM_ACTIONS_POLICY,
  version: 'resident-program-actions-v3',
} as const;
export type ProgramActionsPolicy =
  | typeof PROGRAM_ACTIONS_POLICY
  | typeof ENTERPRISE_PROGRAM_ACTIONS_POLICY;
export function programActionsPolicy(version: unknown): ProgramActionsPolicy | undefined {
  return version === PROGRAM_ACTIONS_POLICY.version
    ? PROGRAM_ACTIONS_POLICY
    : version === ENTERPRISE_PROGRAM_ACTIONS_POLICY.version
      ? ENTERPRISE_PROGRAM_ACTIONS_POLICY
      : undefined;
}
export function resolveProgramActionsPolicy(
  enabled: ProgramActionsPolicy | undefined,
  version: unknown,
): ProgramActionsPolicy | undefined {
  if (!enabled) return undefined;
  assertProgramActionsPolicy(enabled);
  const requested = programActionsPolicy(version);
  return requested &&
    (enabled.version === requested.version ||
      enabled.version === ENTERPRISE_PROGRAM_ACTIONS_POLICY.version)
    ? requested
    : undefined;
}
/** Original authority and actual executor remain separately attributable; this is not a personal attendance/signature fact. */
export type ProgramStepAuthority = {
  readonly policyVersion: ProgramActionsPolicy['version'];
  readonly programId: string;
  readonly programRevision: number;
  readonly runId: string;
  readonly stepIndex: number;
  readonly principalId: string;
  readonly executedBy: string;
  readonly mandateId: string;
  readonly mandateRevision: number;
  readonly at: number;
};
/** Application effect commitments bind the receipt to the actual ordered packets; the application verifies each owning-domain fact. */
export type ProgramExecutionRecord = {
  readonly version: ProgramActionsPolicy['execution'];
  readonly steps: readonly {
    readonly authority: ProgramStepAuthority;
    readonly effectIds: readonly string[];
  }[];
};
export type ProgramResourceKind =
  | 'premises'
  | 'stock'
  | 'space'
  | 'register'
  | 'view'
  | 'group'
  | 'service'
  | 'enterprise';
export type ProgramResourceControl = {
  readonly resourceKind: ProgramResourceKind;
  readonly resourceId: string;
  readonly expectedRevision: number;
  readonly control: ControlCommand;
};
const object = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const exact = (v: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(v).length === keys.length && keys.every((k) => Object.hasOwn(v, k));
const id = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(v) &&
  !Object.hasOwn(Object.prototype, v);
const revision = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 1;
const kind = (v: unknown): v is ProgramResourceKind =>
  v === 'premises' ||
  v === 'stock' ||
  v === 'space' ||
  v === 'register' ||
  v === 'view' ||
  v === 'group' ||
  v === 'service' ||
  v === 'enterprise';
export function assertProgramActionsPolicy(p: ProgramActionsPolicy) {
  const expected = programActionsPolicy(p.version);
  if (
    !expected ||
    !exact(p, ['version', 'execution', 'maxResourceTermsChars', 'maxStepEffects']) ||
    Object.entries(expected).some(([k, v]) => p[k as keyof ProgramActionsPolicy] !== v)
  )
    throw Error('unsupported-program-actions-policy');
}
export function parseProgramResourceControl(
  value: unknown,
  policy: ProgramActionsPolicy,
): ProgramResourceControl | undefined {
  assertProgramActionsPolicy(policy);
  if (
    !object(value) ||
    !exact(value, ['resourceKind', 'resourceId', 'expectedRevision', 'control']) ||
    !kind(value.resourceKind) ||
    (value.resourceKind === 'enterprise' &&
      policy.version !== ENTERPRISE_PROGRAM_ACTIONS_POLICY.version) ||
    !id(value.resourceId) ||
    !revision(value.expectedRevision) ||
    !object(value.control)
  )
    return undefined;
  const c = value.control;
  if (!revision(c.expectedVersion)) return undefined;
  const base = {
    resourceKind: value.resourceKind,
    resourceId: value.resourceId,
    expectedRevision: value.expectedRevision,
  };
  if ((c.type === 'accept' || c.type === 'cancel') && exact(c, ['type', 'expectedVersion']))
    return { ...base, control: { type: c.type, expectedVersion: c.expectedVersion } };
  if (
    c.type !== 'offer' ||
    !exact(c, ['type', 'expectedVersion', 'target', 'expiresAt', 'terms']) ||
    !object(c.target) ||
    !exact(c.target, ['kind', 'id']) ||
    (c.target.kind !== 'resident' && c.target.kind !== 'collective') ||
    !id(c.target.id) ||
    !revision(c.expiresAt) ||
    typeof c.terms !== 'string' ||
    !c.terms.trim() ||
    c.terms.length > policy.maxResourceTermsChars
  )
    return undefined;
  return {
    ...base,
    control: {
      type: 'offer',
      expectedVersion: c.expectedVersion,
      target: { kind: c.target.kind, id: c.target.id },
      expiresAt: c.expiresAt,
      terms: c.terms,
    },
  };
}
