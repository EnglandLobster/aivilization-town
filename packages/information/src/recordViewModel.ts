import { personallyControls, type ResourceControl } from '@aivilization/authority';
import { validInformationId } from './model';
import type { RecordFields, RecordValues } from './sharedRecords';

export const RECORD_VIEWS_POLICY = {
  version: 'resident-record-views-v1',
  maxViewsPerOwner: 20,
  maxFilters: 8,
  maxDerived: 8,
  maxColumns: 16,
  maxSort: 2,
  maxDepth: 4,
  maxNodes: 64,
  maxScannedRecords: 1000,
  maxEvaluations: 100000,
  maxDefinitionChars: 12000,
  maxReaders: 30,
} as const;
export type RecordViewsPolicy = { readonly version: typeof RECORD_VIEWS_POLICY.version } & {
  readonly [K in Exclude<keyof typeof RECORD_VIEWS_POLICY, 'version'>]: number;
};
export type ViewExpression =
  | { readonly constant: number }
  | { readonly field: string }
  | {
      readonly op: 'add' | 'subtract' | 'multiply' | 'divide';
      readonly left: ViewExpression;
      readonly right: ViewExpression;
    };
export type ViewFilter = {
  readonly field: string;
  readonly op: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains';
  readonly value: string | number | boolean;
};
export type ViewAggregate =
  | { readonly op: 'count' }
  | { readonly op: 'sum' | 'mean' | 'min' | 'max'; readonly field: string };
export type RecordViewDefinition = {
  readonly sourceRegisterId: string;
  readonly select: readonly string[];
  readonly where: readonly ViewFilter[];
  readonly derive: Readonly<Record<string, ViewExpression>>;
  readonly orderBy: readonly { readonly field: string; readonly direction: 'asc' | 'desc' }[];
  readonly aggregate?: ViewAggregate;
};
export type ResidentRecordView = {
  readonly control?: ResourceControl;
  readonly definedBy?: string;
  readonly definitionDecisionId?: string;
  readonly id: string;
  readonly ownerId: string;
  readonly title: string;
  readonly visibility: 'public' | 'private';
  readonly readers: readonly string[];
  readonly definition: RecordViewDefinition;
  readonly revision: number;
  readonly active: boolean;
  readonly at: number;
};
export type RecordViewsState = {
  readonly policy: RecordViewsPolicy;
  readonly views: Readonly<Record<string, ResidentRecordView>>;
  readonly history: Readonly<Record<string, readonly ResidentRecordView[]>>;
};
export type RecordViewEvent =
  | { readonly type: 'RecordViewsEnabled'; readonly policy: RecordViewsPolicy }
  | { readonly type: 'RecordViewChanged'; readonly view: ResidentRecordView };
export type RecordViewCommand =
  | {
      readonly type: 'views.publish' | 'views.revise';
      readonly id: string;
      readonly expectedRevision: number;
      readonly title: string;
      readonly visibility: 'public' | 'private';
      readonly readers: readonly string[];
      readonly definition: unknown;
    }
  | { readonly type: 'views.disable'; readonly id: string; readonly expectedRevision: number };
export type RecordViewDecision =
  | { readonly accepted: true; readonly events: readonly RecordViewEvent[] }
  | { readonly accepted: false; readonly reason: string };
export type ViewRow = {
  readonly key: string;
  readonly revision: number;
  readonly createdBy: string;
  readonly editedBy: string;
  readonly values: RecordValues;
};
export function assertRecordViewsPolicy(p: RecordViewsPolicy) {
  if (
    p.version !== RECORD_VIEWS_POLICY.version ||
    Object.keys(RECORD_VIEWS_POLICY).some(
      (k) =>
        k !== 'version' &&
        (!Number.isSafeInteger(p[k as keyof RecordViewsPolicy]) ||
          Number(p[k as keyof RecordViewsPolicy]) < 1),
    )
  )
    throw new Error('invalid-record-views-policy');
}
export function emptyRecordViewsState(
  policy: RecordViewsPolicy = RECORD_VIEWS_POLICY,
): RecordViewsState {
  assertRecordViewsPolicy(policy);
  return { policy, views: {}, history: {} };
}
export const recordViewVisible = (v: ResidentRecordView, actor: string) =>
  personallyControls(v, actor) || v.visibility === 'public' || v.readers.includes(actor);
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const keys = (v: Record<string, unknown>, allowed: readonly string[], required = allowed) =>
  Object.keys(v).every((k) => allowed.includes(k)) && required.every((k) => Object.hasOwn(v, k));
const fieldName = (v: unknown): v is string => typeof v === 'string' && validInformationId(v);

/** Parse a closed expression language against an actual source schema, never against text claims. */
export function parseRecordViewDefinition(
  value: unknown,
  fields: RecordFields,
  p: RecordViewsPolicy,
): RecordViewDefinition | undefined {
  if (
    !object(value) ||
    !keys(
      value,
      ['sourceRegisterId', 'select', 'where', 'derive', 'orderBy', 'aggregate'],
      ['sourceRegisterId', 'select'],
    ) ||
    !fieldName(value.sourceRegisterId)
  )
    return undefined;
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return undefined;
  }
  if (serialized.length > p.maxDefinitionChars) return undefined;
  let nodes = 0;
  const parseExpression = (raw: unknown, depth: number): ViewExpression | undefined => {
    if (!object(raw) || depth > p.maxDepth || ++nodes > p.maxNodes) return undefined;
    if (
      keys(raw, ['constant']) &&
      typeof raw.constant === 'number' &&
      Number.isFinite(raw.constant)
    )
      return { constant: raw.constant };
    if (keys(raw, ['field']) && fieldName(raw.field) && fields[raw.field] === 'number')
      return { field: raw.field };
    if (
      !keys(raw, ['op', 'left', 'right']) ||
      typeof raw.op !== 'string' ||
      !['add', 'subtract', 'multiply', 'divide'].includes(raw.op)
    )
      return undefined;
    const left = parseExpression(raw.left, depth + 1),
      right = parseExpression(raw.right, depth + 1);
    if (!left || !right) return undefined;
    return { op: raw.op as 'add' | 'subtract' | 'multiply' | 'divide', left, right };
  };
  const rawDerived = value.derive === undefined ? {} : value.derive;
  if (!object(rawDerived) || Object.keys(rawDerived).length > p.maxDerived) return undefined;
  const derive: Record<string, ViewExpression> = {},
    allFields: Record<string, 'string' | 'number' | 'boolean'> = { ...fields };
  for (const [name, expression] of Object.entries(rawDerived)) {
    if (!fieldName(name) || Object.hasOwn(fields, name)) return undefined;
    const parsed = parseExpression(expression, 1);
    if (!parsed) return undefined;
    derive[name] = parsed;
    allFields[name] = 'number';
  }
  if (
    !Array.isArray(value.select) ||
    value.select.length > p.maxColumns ||
    new Set(value.select).size !== value.select.length ||
    !value.select.every((k: unknown) => fieldName(k) && Object.hasOwn(allFields, k))
  )
    return undefined;
  const where: ViewFilter[] = [],
    rawWhere = value.where === undefined ? [] : value.where;
  if (!Array.isArray(rawWhere) || rawWhere.length > p.maxFilters) return undefined;
  for (const raw of rawWhere as unknown[]) {
    if (
      !object(raw) ||
      !keys(raw, ['field', 'op', 'value']) ||
      !fieldName(raw.field) ||
      !Object.hasOwn(allFields, raw.field) ||
      typeof raw.value !== allFields[raw.field]
    )
      return undefined;
    if (typeof raw.value === 'number' && !Number.isFinite(raw.value)) return undefined;
    if (typeof raw.value === 'string' && raw.value.length > 2000) return undefined;
    const op = raw.op;
    if (typeof op !== 'string') return undefined;
    if (
      op !== 'eq' &&
      op !== 'ne' &&
      !(op === 'contains' && allFields[raw.field] === 'string') &&
      !(['gt', 'gte', 'lt', 'lte'].includes(String(op)) && allFields[raw.field] === 'number')
    )
      return undefined;
    where.push({
      field: raw.field,
      op: op as ViewFilter['op'],
      value: raw.value as ViewFilter['value'],
    });
  }
  const orderBy: { field: string; direction: 'asc' | 'desc' }[] = [],
    rawOrder = value.orderBy === undefined ? [] : value.orderBy;
  if (!Array.isArray(rawOrder) || rawOrder.length > p.maxSort) return undefined;
  for (const raw of rawOrder as unknown[]) {
    if (
      !object(raw) ||
      !keys(raw, ['field', 'direction']) ||
      !fieldName(raw.field) ||
      !Object.hasOwn(allFields, raw.field) ||
      (raw.direction !== 'asc' && raw.direction !== 'desc') ||
      orderBy.some((s) => s.field === raw.field)
    )
      return undefined;
    orderBy.push({ field: raw.field, direction: raw.direction });
  }
  let aggregate: ViewAggregate | undefined;
  if (value.aggregate !== undefined) {
    const raw = value.aggregate;
    if (!object(raw)) return undefined;
    if (keys(raw, ['op']) && raw.op === 'count') aggregate = { op: 'count' };
    else if (
      keys(raw, ['op', 'field']) &&
      typeof raw.op === 'string' &&
      ['sum', 'mean', 'min', 'max'].includes(raw.op) &&
      fieldName(raw.field) &&
      allFields[raw.field] === 'number'
    )
      aggregate = { op: raw.op as 'sum' | 'mean' | 'min' | 'max', field: raw.field };
    else return undefined;
  }
  if (!value.select.length && !aggregate) return undefined;
  return {
    sourceRegisterId: value.sourceRegisterId,
    select: [...(value.select as string[])],
    where,
    derive,
    orderBy,
    ...(aggregate ? { aggregate } : {}),
  };
}
