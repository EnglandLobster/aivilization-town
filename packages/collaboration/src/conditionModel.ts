export const PROGRAM_CONDITIONS_POLICY = {
  version: 'resident-program-conditions-v1',
  maxConditions: 8,
  maxWork: 100000,
} as const;
export type ProgramConditionsPolicy = {
  readonly version: 'resident-program-conditions-v1';
  readonly maxConditions: number;
  readonly maxWork: number;
};
export type ProgramConditionSource =
  | {
      readonly kind: 'record';
      readonly registerId: string;
      readonly key: string;
      readonly revision: number | 'latest';
      readonly field: string;
    }
  | {
      readonly kind: 'statement';
      readonly registerId: string;
      readonly key: string;
      readonly revision: number | 'latest';
      readonly field: string;
      readonly signerId: string;
    }
  | { readonly kind: 'clock' }
  | {
      readonly kind: 'personal-fact';
      readonly actorId: string;
      readonly field: 'balance' | 'locationId' | 'availableAt' | 'inventory';
      readonly commodity?: string;
    }
  | { readonly kind: 'common-balance'; readonly accountId: string; readonly controlVersion: number }
  | { readonly kind: 'decision'; readonly decisionId: string; readonly charterVersion: number };
export type ConditionScalar = string | number | boolean;
export type ProgramCondition = {
  readonly source: ProgramConditionSource;
  readonly op: 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte';
  readonly value: ConditionScalar;
};
export type ConditionEvidence = {
  readonly index: number;
  readonly source: ProgramConditionSource;
  readonly sourceClass:
    | 'resident-claim'
    | 'signed-claim'
    | 'resident-computation'
    | 'procedural-fact'
    | 'world-fact';
  readonly sourceVersions: Readonly<Record<string, string | number>>;
  readonly matched: boolean;
};
export function assertProgramConditionsPolicy(p: ProgramConditionsPolicy) {
  if (
    p.version !== 'resident-program-conditions-v1' ||
    ![p.maxConditions, p.maxWork].every((n) => Number.isSafeInteger(n) && n > 0)
  )
    throw new Error('invalid-program-conditions-policy');
}
const object = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const keys = (v: Record<string, unknown>, names: readonly string[]) =>
  Object.keys(v).length === names.length && names.every((k) => Object.hasOwn(v, k));
const id = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(v) &&
  !Object.hasOwn(Object.prototype, v);
const revision = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 1;
const scalar = (v: unknown): v is ConditionScalar =>
  typeof v === 'boolean' ||
  (typeof v === 'number' && Number.isFinite(v)) ||
  (typeof v === 'string' && v.length <= 2000);
function parseSource(v: unknown): ProgramConditionSource | undefined {
  if (!object(v)) return undefined;
  if (v.kind === 'clock' && keys(v, ['kind'])) return { kind: 'clock' };
  if (
    (v.kind === 'record' || v.kind === 'statement') &&
    keys(
      v,
      v.kind === 'record'
        ? ['kind', 'registerId', 'key', 'revision', 'field']
        : ['kind', 'registerId', 'key', 'revision', 'field', 'signerId'],
    ) &&
    id(v.registerId) &&
    id(v.key) &&
    id(v.field) &&
    (v.revision === 'latest' || revision(v.revision))
  ) {
    const base: { registerId: string; key: string; field: string; revision: number | 'latest' } = {
      registerId: v.registerId,
      key: v.key,
      field: v.field,
      revision: v.revision,
    };
    if (v.kind === 'record') return { kind: 'record', ...base };
    if (id(v.signerId)) return { kind: 'statement', ...base, signerId: v.signerId };
    return undefined;
  }
  if (
    v.kind === 'personal-fact' &&
    id(v.actorId) &&
    typeof v.field === 'string' &&
    ['balance', 'locationId', 'availableAt', 'inventory'].includes(v.field) &&
    keys(
      v,
      v.field === 'inventory'
        ? ['kind', 'actorId', 'field', 'commodity']
        : ['kind', 'actorId', 'field'],
    )
  ) {
    if (v.field === 'inventory')
      return typeof v.commodity === 'string' &&
        v.commodity.trim().length > 0 &&
        v.commodity.length <= 120 &&
        !Object.hasOwn(Object.prototype, v.commodity)
        ? { kind: 'personal-fact', actorId: v.actorId, field: 'inventory', commodity: v.commodity }
        : undefined;
    if (v.field === 'balance' || v.field === 'locationId' || v.field === 'availableAt')
      return { kind: 'personal-fact', actorId: v.actorId, field: v.field };
  }
  if (
    v.kind === 'common-balance' &&
    keys(v, ['kind', 'accountId', 'controlVersion']) &&
    id(v.accountId) &&
    revision(v.controlVersion)
  )
    return { kind: 'common-balance', accountId: v.accountId, controlVersion: v.controlVersion };
  if (
    v.kind === 'decision' &&
    keys(v, ['kind', 'decisionId', 'charterVersion']) &&
    id(v.decisionId) &&
    revision(v.charterVersion)
  )
    return { kind: 'decision', decisionId: v.decisionId, charterVersion: v.charterVersion };
  return undefined;
}
export function parseProgramConditions(
  v: unknown,
  p: ProgramConditionsPolicy,
): readonly ProgramCondition[] | undefined {
  assertProgramConditionsPolicy(p);
  if (!Array.isArray(v) || v.length > p.maxConditions) return undefined;
  const result: ProgramCondition[] = [];
  for (const raw of v as unknown[]) {
    if (
      !object(raw) ||
      !keys(raw, ['source', 'op', 'value']) ||
      typeof raw.op !== 'string' ||
      !['eq', 'ne', 'lt', 'lte', 'gt', 'gte'].includes(raw.op) ||
      !scalar(raw.value)
    )
      return undefined;
    const source = parseSource(raw.source);
    if (!source) return undefined;
    const op = raw.op as ProgramCondition['op'];
    if (op !== 'eq' && op !== 'ne' && typeof raw.value !== 'number') return undefined;
    const numeric =
      source.kind === 'clock' ||
      source.kind === 'common-balance' ||
      (source.kind === 'personal-fact' && source.field !== 'locationId');
    if (numeric && typeof raw.value !== 'number') return undefined;
    if (
      (source.kind === 'decision' ||
        (source.kind === 'personal-fact' && source.field === 'locationId')) &&
      (typeof raw.value !== 'string' || (op !== 'eq' && op !== 'ne'))
    )
      return undefined;
    if (
      source.kind === 'decision' &&
      (typeof raw.value !== 'string' || !['passed', 'executed'].includes(raw.value))
    )
      return undefined;
    result.push({ source, op, value: raw.value });
  }
  return result;
}
