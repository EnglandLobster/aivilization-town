import { expect, test } from 'vitest';
import {
  applySharedRecordsEvent,
  canReadRegister,
  decideSharedRecords,
  emptySharedRecordsState,
  type SharedRecordsCommand,
  type SharedRecordsEvent,
} from './sharedRecords';

function setup() {
  let state = emptySharedRecordsState();
  const events: SharedRecordsEvent[] = [];
  const call = (actorId: string, command: SharedRecordsCommand, authorityId?: string) => {
    const d = decideSharedRecords({
      state,
      actorId,
      at: 1,
      command,
      exists: (id) => ['a', 'b', 'c'].includes(id),
      ...(authorityId ? { authorityId } : {}),
    });
    if (d.accepted)
      for (const e of d.events) {
        state = applySharedRecordsEvent(state, e);
        events.push(e);
      }
    return d;
  };
  const create = () =>
    call('a', {
      type: 'registers.create',
      id: 'ledger',
      title: '居民自己的账目',
      fields: { note: 'string', amount: 'number' },
      visibility: 'private',
      readers: [],
      editors: ['b'],
    });
  return {
    call,
    create,
    events,
    get state() {
      return state;
    },
  };
}
test('shared edits preserve original and actual authors, compare revisions and replay; records remain resident claims', () => {
  const t = setup();
  expect(t.create().accepted).toBe(true);
  const write = {
    type: 'records.put' as const,
    registerId: 'ledger',
    key: 'one',
    expectedRevision: 0,
    values: { note: 'claimed payment', amount: 999 },
  };
  expect(t.call('b', write).accepted).toBe(true);
  expect(t.call('a', write)).toEqual({ accepted: false, reason: 'revision-conflict' });
  expect(t.call('c', write)).toEqual({ accepted: false, reason: 'record-not-found' });
  expect(
    t.call('a', { ...write, expectedRevision: 1, values: { note: 'correction', amount: 1 } })
      .accepted,
  ).toBe(true);
  expect(t.state.records['ledger/one']).toMatchObject({
    createdBy: 'b',
    editedBy: 'a',
    revision: 2,
    values: { amount: 1 },
  });
  expect(t.state.history['ledger/one']?.[0]?.values.amount).toBe(999);
  expect(t.events.reduce(applySharedRecordsEvent, emptySharedRecordsState())).toEqual(t.state);
  expect(
    t.call('a', { type: 'records.delete', registerId: 'ledger', key: 'one', expectedRevision: 2 })
      .accepted,
  ).toBe(true);
  expect(t.state.records['ledger/one']?.deleted).toBe(true);
});
test('schema boundaries, prototype keys, nonfinite values and quotas reject without changing state', () => {
  const t = setup();
  t.create();
  const before = structuredClone(t.state);
  expect(
    t.call('a', {
      type: 'registers.create',
      id: 'bad',
      title: 'bad schema',
      visibility: 'public',
      readers: [],
      editors: [],
      fields: { field: ['string'] },
    }),
  ).toEqual({ accepted: false, reason: 'invalid-record-schema' });
  for (const values of [
    { note: 'x', amount: Infinity },
    { note: 'x', amount: 1, extra: true },
    { note: 'x'.repeat(2001), amount: 1 },
    { note: { nested: 'x' }, amount: 1 },
  ]) {
    expect(
      t.call('a', {
        type: 'records.put',
        registerId: 'ledger',
        key: 'one',
        expectedRevision: 0,
        values,
      }).accepted,
    ).toBe(false);
  }
  expect(
    t.call('a', {
      type: 'records.put',
      registerId: 'ledger',
      key: 'constructor',
      expectedRevision: 0,
      values: {},
    }).accepted,
  ).toBe(false);
  expect(t.state).toEqual(before);
  const atLimit = { ...t.state, policy: { ...t.state.policy, maxRecords: 1 } };
  const first = decideSharedRecords({
    state: atLimit,
    actorId: 'a',
    at: 0,
    exists: () => true,
    command: {
      type: 'records.put',
      registerId: 'ledger',
      key: 'one',
      values: { note: '', amount: 0 },
      expectedRevision: 0,
    },
  });
  expect(first.accepted).toBe(true);
  if (!first.accepted) throw new Error('first');
  expect(
    decideSharedRecords({
      state: first.events.reduce(applySharedRecordsEvent, atLimit),
      actorId: 'a',
      at: 0,
      exists: () => true,
      command: {
        type: 'records.put',
        registerId: 'ledger',
        key: 'two',
        values: { note: '', amount: 0 },
        expectedRevision: 0,
      },
    }),
  ).toEqual({ accepted: false, reason: 'record-quota' });
});
test('ACL revocation applies to delegated authority; ownership requires nominated personal acceptance', () => {
  const t = setup();
  t.create();
  expect(
    t.call(
      'c',
      {
        type: 'records.put',
        registerId: 'ledger',
        key: 'one',
        values: { note: 'delegated', amount: 1 },
        expectedRevision: 0,
      },
      'b',
    ).accepted,
  ).toBe(true);
  expect(t.state.records['ledger/one']).toMatchObject({ editedBy: 'c', authorityId: 'b' });
  expect(
    t.call('a', {
      type: 'registers.configure',
      id: 'ledger',
      expectedRevision: 1,
      visibility: 'private',
      readers: [],
      editors: [],
    }).accepted,
  ).toBe(true);
  expect(
    t.call(
      'c',
      {
        type: 'records.put',
        registerId: 'ledger',
        key: 'two',
        values: { note: '', amount: 1 },
        expectedRevision: 0,
      },
      'b',
    ).accepted,
  ).toBe(false);
  expect(
    t.call('a', { type: 'registers.nominate', id: 'ledger', successorId: 'b', expectedRevision: 2 })
      .accepted,
  ).toBe(true);
  expect(t.state.registers.ledger?.ownerId).toBe('a');
  expect(
    t.call('a', { type: 'registers.accept', id: 'ledger', expectedRevision: 3 }).accepted,
  ).toBe(false);
  expect(
    t.call('b', { type: 'registers.accept', id: 'ledger', expectedRevision: 3 }).accepted,
  ).toBe(true);
  expect(t.state.registers.ledger?.ownerId).toBe('b');
  expect(canReadRegister(t.state.registers.ledger!, 'a')).toBe(false);
});
