import {
  personallyControls,
  resourceAdministration,
  revisedResourceControl,
  type ControlAuthorizationPort,
} from '@aivilization/authority';
import { validInformationId } from './model';
import {
  canReadRegister,
  sharedRegisterRecords,
  type SharedRecordsState,
  type RecordValues,
} from './sharedRecords';
import {
  assertRecordViewsPolicy,
  emptyRecordViewsState,
  parseRecordViewDefinition,
  recordViewVisible,
  type RecordViewsState,
  type RecordViewCommand,
  type RecordViewDecision,
  type RecordViewEvent,
  type ResidentRecordView,
  type ViewExpression,
  type ViewFilter,
  type ViewRow,
} from './recordViewModel';

export function canReadRecordView(
  v: ResidentRecordView,
  actor: string,
  records: SharedRecordsState,
): boolean {
  const source = records.registers[v.definition.sourceRegisterId];
  return recordViewVisible(v, actor) && !!source && canReadRegister(source, actor);
}
export function decideRecordView(input: {
  state: RecordViewsState;
  records: SharedRecordsState;
  actorId: string;
  at: number;
  command: RecordViewCommand;
  exists: (id: string) => boolean;
  controlAuthorization?: ControlAuthorizationPort;
}): RecordViewDecision {
  const { state: s, records, actorId: actor, at, command: c, exists } = input;
  assertRecordViewsPolicy(s.policy);
  const no = (reason: string): RecordViewDecision => ({ accepted: false, reason });
  if (!validInformationId(actor) || !exists(actor) || !Number.isSafeInteger(at) || at < 0)
    return no('invalid-actor-or-time');
  if (
    !validInformationId(c.id) ||
    !Number.isSafeInteger(c.expectedRevision) ||
    c.expectedRevision < 0
  )
    return no('invalid-view-command');
  const prior = s.views[c.id];
  const admin = prior
    ? resourceAdministration(prior, actor, input.controlAuthorization)
    : undefined;
  if (c.type === 'views.publish') {
    if (prior) return no('view-id-unavailable');
    if (
      Object.values(s.views).filter((v) => personallyControls(v, actor)).length >=
      s.policy.maxViewsPerOwner
    )
      return no('view-quota');
  } else if (!prior || !admin) return no('view-not-found');
  if (c.expectedRevision !== (prior?.revision ?? 0)) return no('revision-conflict');
  if (c.expectedRevision === Number.MAX_SAFE_INTEGER) return no('revision-limit');
  if (c.type === 'views.disable')
    return {
      accepted: true,
      events: [
        {
          type: 'RecordViewChanged',
          view: {
            ...prior!,
            ...(prior?.control && admin
              ? { control: revisedResourceControl(prior, admin, at)! }
              : {}),
            active: false,
            revision: c.expectedRevision + 1,
            at,
          },
        },
      ],
    };
  if (
    !c.title.trim() ||
    c.title.length > 120 ||
    !['public', 'private'].includes(c.visibility) ||
    c.readers.length > s.policy.maxReaders ||
    new Set(c.readers).size !== c.readers.length ||
    !c.readers.every((id) => validInformationId(id) && exists(id))
  )
    return no('invalid-view-settings');
  const raw = c.definition;
  if (
    !raw ||
    typeof raw !== 'object' ||
    !('sourceRegisterId' in raw) ||
    typeof raw.sourceRegisterId !== 'string' ||
    !validInformationId(raw.sourceRegisterId)
  )
    return no('invalid-view-definition');
  const source = records.registers[raw.sourceRegisterId];
  if (!source || !canReadRegister(source, actor)) return no('record-not-found');
  const definition = parseRecordViewDefinition(raw, source.fields, s.policy);
  if (!definition) return no('invalid-view-definition');
  return {
    accepted: true,
    events: [
      {
        type: 'RecordViewChanged',
        view: {
          id: c.id,
          ownerId: prior?.ownerId ?? actor,
          ...(prior?.control && admin
            ? {
                control: revisedResourceControl(prior, admin, at)!,
                definedBy: actor,
                ...(admin.decisionId ? { definitionDecisionId: admin.decisionId } : {}),
              }
            : {}),
          title: c.title,
          visibility: c.visibility,
          readers: [...c.readers],
          definition,
          revision: c.expectedRevision + 1,
          active: true,
          at,
        },
      },
    ],
  };
}
export function applyRecordViewEvent(
  state: RecordViewsState | undefined,
  e: RecordViewEvent,
): RecordViewsState {
  if (e.type === 'RecordViewsEnabled') {
    if (state) throw new Error('record-views-already-enabled');
    return emptyRecordViewsState(e.policy);
  }
  if (!state) throw new Error('record-views-not-enabled');
  const v = e.view;
  if (v.revision !== (state.views[v.id]?.revision ?? 0) + 1)
    throw new Error('record-view-revision-gap');
  return {
    ...state,
    views: { ...state.views, [v.id]: v },
    history: { ...state.history, [v.id]: [...(state.history[v.id] ?? []), v] },
  };
}
class ViewFailure extends Error {}
const compare = (a: string | number | boolean, b: string | number | boolean) =>
  a === b ? 0 : a < b ? -1 : 1;
function matches(filter: ViewFilter, values: RecordValues): boolean {
  const value = values[filter.field]!;
  switch (filter.op) {
    case 'eq':
      return value === filter.value;
    case 'ne':
      return value !== filter.value;
    case 'contains':
      return (value as string).includes(filter.value as string);
    case 'gt':
      return compare(value, filter.value) > 0;
    case 'gte':
      return compare(value, filter.value) >= 0;
    case 'lt':
      return compare(value, filter.value) < 0;
    case 'lte':
      return compare(value, filter.value) <= 0;
  }
}
export function evaluateRecordView(input: {
  state: RecordViewsState;
  records: SharedRecordsState;
  actorId: string;
  id: string;
  expectedRevision: number;
  offset: number;
  limit: number;
}) {
  const { state: s, records, actorId: actor, id, expectedRevision, offset, limit } = input;
  assertRecordViewsPolicy(s.policy);
  const no = (reason: string) => ({ accepted: false as const, reason });
  if (!validInformationId(id)) return no('view-not-found');
  const v = s.views[id];
  if (!v || !canReadRecordView(v, actor, records)) return no('view-not-found');
  if (!v.active) return no('view-disabled');
  if (v.revision !== expectedRevision) return no('revision-conflict');
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 30
  )
    return no('invalid-view-page');
  const source = records.registers[v.definition.sourceRegisterId]!;
  const all = sharedRegisterRecords(records, source.id);
  if (all.length > s.policy.maxScannedRecords) return no('view-scan-budget-exceeded');
  const sourceDataRevision = all.reduce((sum, r) => sum + r.revision, 0);
  if (!Number.isSafeInteger(sourceDataRevision)) return no('view-source-version-overflow');
  let evaluations = 0;
  const tick = () => {
    if (++evaluations > s.policy.maxEvaluations)
      throw new ViewFailure('view-computation-budget-exceeded');
  };
  const numeric = (expression: ViewExpression, values: RecordValues): number => {
    tick();
    if ('constant' in expression) return expression.constant;
    if ('field' in expression) return values[expression.field] as number;
    const a = numeric(expression.left, values),
      b = numeric(expression.right, values);
    if (expression.op === 'divide' && b === 0) throw new ViewFailure('view-division-by-zero');
    const result =
      expression.op === 'add'
        ? a + b
        : expression.op === 'subtract'
          ? a - b
          : expression.op === 'multiply'
            ? a * b
            : a / b;
    if (!Number.isFinite(result)) throw new ViewFailure('view-nonfinite-result');
    return result;
  };
  try {
    const matchesRows: ViewRow[] = [];
    for (const r of all) {
      tick();
      if (r.deleted) continue;
      const values: Record<string, string | number | boolean> = { ...r.values };
      for (const [name, expression] of Object.entries(v.definition.derive))
        values[name] = numeric(expression, r.values);
      if (
        !v.definition.where.every((f) => {
          tick();
          return matches(f, values);
        })
      )
        continue;
      matchesRows.push({
        key: r.key,
        revision: r.revision,
        createdBy: r.createdBy,
        editedBy: r.editedBy,
        values,
      });
    }
    matchesRows.sort((a, b) => {
      for (const field of v.definition.orderBy) {
        const c = compare(a.values[field.field]!, b.values[field.field]!);
        if (c) return field.direction === 'asc' ? c : -c;
      }
      return compare(a.key, b.key);
    });
    let aggregateValue: number | null | undefined;
    const aggregate = v.definition.aggregate;
    if (aggregate) {
      if (aggregate.op === 'count') aggregateValue = matchesRows.length;
      else {
        const values = matchesRows.map((r) => r.values[aggregate.field] as number);
        if (!values.length) aggregateValue = aggregate.op === 'sum' ? 0 : null;
        else if (aggregate.op === 'min') aggregateValue = Math.min(...values);
        else if (aggregate.op === 'max') aggregateValue = Math.max(...values);
        else {
          const sum = values.reduce((sum, value) => sum + value, 0);
          aggregateValue = aggregate.op === 'mean' ? sum / values.length : sum;
          if (!Number.isFinite(aggregateValue)) throw new ViewFailure('view-nonfinite-result');
        }
      }
    }
    return {
      accepted: true as const,
      result: {
        provenance: 'resident-computation' as const,
        inputProvenance: 'resident-claim' as const,
        viewId: v.id,
        viewRevision: v.revision,
        authorId: v.definedBy ?? v.ownerId,
        ...(v.definitionDecisionId ? { definitionDecisionId: v.definitionDecisionId } : {}),
        source: {
          registerId: source.id,
          registerRevision: source.revision,
          dataRevision: sourceDataRevision,
        },
        scanned: all.length,
        evaluations,
        total: matchesRows.length,
        offset,
        limit,
        items: matchesRows.slice(offset, offset + limit).map((r) => ({
          ...r,
          values: Object.fromEntries(v.definition.select.map((key) => [key, r.values[key]!])),
        })),
        ...(aggregate ? { aggregate: { ...aggregate, value: aggregateValue! } } : {}),
      },
    };
  } catch (error) {
    if (error instanceof ViewFailure) return no(error.message);
    throw error;
  }
}
