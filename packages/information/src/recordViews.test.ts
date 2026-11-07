import { expect, test } from 'vitest';
import {
  applySharedRecordsEvent,
  decideSharedRecords,
  emptySharedRecordsState,
  sharedRegisterRecords,
  type SharedRecordsCommand,
} from './sharedRecords';
import {
  emptyRecordViewsState,
  parseRecordViewDefinition,
  RECORD_VIEWS_POLICY,
  type RecordViewCommand,
  type RecordViewEvent,
} from './recordViewModel';
import {
  applyRecordViewEvent,
  decideRecordView,
  evaluateRecordView,
  canReadRecordView,
} from './recordViews';

function setup() {
  let records = emptySharedRecordsState(),
    state = emptyRecordViewsState();
  const events: RecordViewEvent[] = [];
  const exists = (id: string) => ['a', 'b', 'c', 'd'].includes(id);
  const record = (command: SharedRecordsCommand) => {
    const result = decideSharedRecords({ state: records, actorId: 'a', at: 1, command, exists });
    if (!result.accepted) throw new Error(result.reason);
    records = result.events.reduce(applySharedRecordsEvent, records);
  };
  record({
    type: 'registers.create',
    id: 'source',
    title: 'Resident statements',
    visibility: 'private',
    readers: ['b', 'c'],
    editors: [],
    fields: { title: 'string', rating: 'number', cost: 'number', active: 'boolean' },
  });
  for (const [key, rating, cost] of [
    ['one', 4, 2],
    ['two', 5, 3],
    ['three', 4, 2],
  ] as const)
    record({
      type: 'records.put',
      registerId: 'source',
      key,
      expectedRevision: 0,
      values: { title: key, rating, cost, active: true },
    });
  const command = (c: RecordViewCommand, actorId = 'b') => {
    const result = decideRecordView({ state, records, actorId, at: 2, command: c, exists });
    if (result.accepted) {
      events.push(...result.events);
      state = result.events.reduce(applyRecordViewEvent, state);
    }
    return result;
  };
  const definition = {
    sourceRegisterId: 'source',
    select: ['title', 'weighted'],
    derive: {
      weighted: {
        op: 'subtract',
        left: { op: 'multiply', left: { field: 'rating' }, right: { constant: 2 } },
        right: { field: 'cost' },
      },
    },
    where: [{ field: 'active', op: 'eq', value: true }],
    orderBy: [{ field: 'weighted', direction: 'desc' }],
    aggregate: { op: 'sum', field: 'weighted' },
  };
  const publish = (raw: unknown = definition, id = 'view') =>
    command({
      type: 'views.publish',
      id,
      expectedRevision: 0,
      title: 'My comparison, not a platform verdict',
      visibility: 'public',
      readers: [],
      definition: raw,
    });
  const query = (actorId = 'c', offset = 0, limit = 30) =>
    evaluateRecordView({ state, records, actorId, id: 'view', expectedRevision: 1, offset, limit });
  return {
    record,
    command,
    publish,
    query,
    definition,
    events,
    get records() {
      return records;
    },
    get state() {
      return state;
    },
  };
}
test('a resident defines filtering, arithmetic, ordering and whole-input aggregation with traceable claims and stable pagination', () => {
  const t = setup();
  expect(t.publish().accepted).toBe(true);
  const before = structuredClone(t.records),
    result = t.query('c', 1, 1);
  expect(result).toMatchObject({
    accepted: true,
    result: {
      provenance: 'resident-computation',
      inputProvenance: 'resident-claim',
      authorId: 'b',
      source: { registerId: 'source', registerRevision: 1, dataRevision: 3 },
      total: 3,
      items: [{ key: 'one', revision: 1, createdBy: 'a', values: { title: 'one', weighted: 6 } }],
      aggregate: { op: 'sum', value: 19 },
    },
  });
  expect(t.records).toEqual(before);
  const all = t.query();
  if (!all.accepted) throw new Error(all.reason);
  expect(all.result.items.map((r) => r.key)).toEqual(['two', 'one', 'three']);
});
test('view access never amplifies source access, including counts and historical revisions after revocation', () => {
  const t = setup();
  t.publish();
  expect(t.query('d')).toEqual({ accepted: false, reason: 'view-not-found' });
  expect(
    t.command(
      {
        type: 'views.revise',
        id: 'view',
        expectedRevision: 1,
        title: 'Steal',
        visibility: 'public',
        readers: [],
        definition: t.definition,
      },
      'c',
    ),
  ).toEqual({ accepted: false, reason: 'view-not-found' });
  t.record({
    type: 'registers.configure',
    id: 'source',
    expectedRevision: 1,
    visibility: 'private',
    readers: [],
    editors: [],
  });
  expect(t.query()).toEqual({ accepted: false, reason: 'view-not-found' });
  expect(t.query('b')).toEqual({ accepted: false, reason: 'view-not-found' });
  expect(canReadRecordView(t.state.history.view![0]!, 'b', t.records)).toBe(false);
  expect(t.query('a').accepted).toBe(true);
});
test('source versions, tombstones and an optional legacy index stay consistent and replay definitions without reexecuting computation', () => {
  const t = setup();
  t.publish();
  t.record({ type: 'records.delete', registerId: 'source', key: 'two', expectedRevision: 1 });
  expect(t.query()).toMatchObject({
    accepted: true,
    result: { source: { dataRevision: 4 }, total: 2, aggregate: { value: 12 } },
  });
  expect(sharedRegisterRecords(t.records, 'source')).toHaveLength(3);
  const { recordKeysByRegister: ignored, ...legacy } = t.records;
  void ignored;
  expect(sharedRegisterRecords(legacy, 'source')).toEqual(
    sharedRegisterRecords(t.records, 'source'),
  );
  expect(t.events.reduce(applyRecordViewEvent, emptyRecordViewsState())).toEqual(t.state);
  expect(t.command({ type: 'views.disable', id: 'view', expectedRevision: 0 })).toEqual({
    accepted: false,
    reason: 'revision-conflict',
  });
  expect(t.command({ type: 'views.disable', id: 'view', expectedRevision: 1 }).accepted).toBe(true);
  expect(t.query()).toEqual({ accepted: false, reason: 'view-disabled' });
  expect(t.state.history.view).toHaveLength(2);
});
test('closed schemas reject unknown authority, typed coercion, cyclic formulas, source-field replacement and oversized programs', () => {
  const t = setup(),
    schema = t.records.registers.source!.fields;
  const invalid = [
    { ...t.definition, shell: 'do something' },
    { ...t.definition, where: null },
    { ...t.definition, derive: null },
    { ...t.definition, orderBy: null },
    { ...t.definition, select: ['missing'] },
    { ...t.definition, derive: { rating: { constant: 1 } } },
    { ...t.definition, derive: { x: { field: 'x' } } },
    {
      ...t.definition,
      derive: { x: { op: ['add'], left: { constant: 1 }, right: { constant: 1 } } },
    },
    { ...t.definition, where: [{ field: 'rating', op: ['gt'], value: 1 }] },
    { ...t.definition, where: [{ field: 'rating', op: 'eq', value: '5' }] },
    { ...t.definition, aggregate: { op: ['sum'], field: 'rating' } },
    { ...t.definition, derive: { x: { constant: Infinity } } },
    {
      ...t.definition,
      orderBy: [
        { field: 'cost', direction: 'desc' },
        { field: 'cost', direction: 'asc' },
      ],
    },
    { ...t.definition, select: ['constructor'] },
  ];
  for (const raw of invalid)
    expect(parseRecordViewDefinition(raw, schema, RECORD_VIEWS_POLICY)).toBeUndefined();
  expect(
    parseRecordViewDefinition(t.definition, schema, { ...RECORD_VIEWS_POLICY, maxDepth: 2 }),
  ).toBeUndefined();
  expect(
    parseRecordViewDefinition(t.definition, schema, { ...RECORD_VIEWS_POLICY, maxNodes: 3 }),
  ).toBeUndefined();
  expect(
    parseRecordViewDefinition(t.definition, schema, {
      ...RECORD_VIEWS_POLICY,
      maxDefinitionChars: 50,
    }),
  ).toBeUndefined();
  const before = structuredClone(t.state);
  expect(t.publish(invalid[0]).accepted).toBe(false);
  expect(t.state).toEqual(before);
});
test('empty aggregates are explicit and computation/scan budgets refuse rather than return partial totals', () => {
  for (const op of ['count', 'sum', 'mean', 'min', 'max'] as const) {
    const t = setup();
    t.publish({
      ...t.definition,
      select: [],
      where: [{ field: 'rating', op: 'gt', value: 99 }],
      aggregate: op === 'count' ? { op } : { op, field: 'weighted' },
    });
    expect(t.query()).toMatchObject({
      accepted: true,
      result: {
        total: 0,
        items: [],
        aggregate: { value: ['count', 'sum'].includes(op) ? 0 : null },
      },
    });
  }
  const t = setup();
  t.publish();
  for (const [key, reason] of [
    ['maxScannedRecords', 'view-scan-budget-exceeded'],
    ['maxEvaluations', 'view-computation-budget-exceeded'],
  ] as const)
    expect(
      evaluateRecordView({
        state: { ...t.state, policy: { ...t.state.policy, [key]: 1 } },
        records: t.records,
        actorId: 'b',
        id: 'view',
        expectedRevision: 1,
        offset: 0,
        limit: 1,
      }),
    ).toEqual({ accepted: false, reason });
  expect(t.query('b', 0, 31)).toEqual({ accepted: false, reason: 'invalid-view-page' });
});
test('division by zero and overflowing resident calculations cannot create authoritative or misleading results', () => {
  for (const [derive, reason] of [
    [
      { weighted: { op: 'divide', left: { field: 'rating' }, right: { constant: 0 } } },
      'view-division-by-zero',
    ],
    [
      { weighted: { op: 'multiply', left: { constant: 1e308 }, right: { field: 'rating' } } },
      'view-nonfinite-result',
    ],
  ] as const) {
    const t = setup();
    expect(t.publish({ ...t.definition, derive }).accepted).toBe(true);
    expect(t.query()).toEqual({ accepted: false, reason });
  }
});

test('definitions own their arrays and per-author lifetime quotas remain enforced after disabling', () => {
  const t = setup(),
    raw = structuredClone(t.definition);
  expect(t.publish(raw).accepted).toBe(true);
  raw.select.push('rating');
  expect(t.state.views.view!.definition.select).toEqual(['title', 'weighted']);
  expect(t.command({ type: 'views.disable', id: 'view', expectedRevision: 1 }).accepted).toBe(true);
  const d = decideRecordView({
    state: { ...t.state, policy: { ...t.state.policy, maxViewsPerOwner: 1 } },
    records: t.records,
    actorId: 'b',
    at: 3,
    command: {
      type: 'views.publish',
      id: 'another',
      expectedRevision: 0,
      title: 'Another',
      visibility: 'public',
      readers: [],
      definition: t.definition,
    },
    exists: () => true,
  });
  expect(d).toEqual({ accepted: false, reason: 'view-quota' });
  expect(() => emptyRecordViewsState({ ...RECORD_VIEWS_POLICY, maxNodes: 0 })).toThrow(
    'invalid-record-views-policy',
  );
});
