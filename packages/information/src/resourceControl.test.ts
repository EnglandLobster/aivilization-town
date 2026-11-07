import { expect, test } from 'vitest';
import {
  RESOURCE_CONTROL_POLICY,
  effectiveController,
  type ControlCommand,
  type ControlAuthorizationPort,
} from '@aivilization/authority';
import {
  emptyInformationState,
  DEFAULT_INFORMATION_POLICY,
  canReadSpace,
  type InformationCommand,
} from './model';
import { decideInformationCommand, applyInformationEvent } from './aggregate';
import {
  emptySharedRecordsState,
  decideSharedRecords,
  applySharedRecordsEvent,
  canReadRegister,
} from './sharedRecords';
import {
  decideInformationResourceControl,
  decideInformationResourceManagement,
  parseInformationResourceOperation,
  getInformationResource,
  type InformationResourceEffects,
  type InformationResources,
  type InformationResourceKind,
} from './resourceControl';
const people = ['a', 'b', 'c'];
const exists = (id: string) => people.includes(id);
const authorized: ControlAuthorizationPort = (c) =>
  c.kind === 'collective' && c.id === 'club' ? { actorId: 'b', decisionId: 'decision' } : undefined;
function fixture() {
  let s: InformationResources = {
    information: emptyInformationState(),
    informationPolicy: DEFAULT_INFORMATION_POLICY,
    sharedRecords: emptySharedRecordsState(),
  };
  const apply = (e: InformationResourceEffects) => {
    s = {
      ...s,
      information: (e.informationEvents ?? []).reduce(applyInformationEvent, s.information),
      sharedRecords: (e.sharedRecordsEvents ?? []).reduce(
        applySharedRecordsEvent,
        s.sharedRecords!,
      ),
    };
  };
  for (const command of [
    {
      type: 'space.create',
      id: 's',
      title: 'private workspace',
      visibility: 'private',
      posting: 'owner',
      members: [],
    },
    { type: 'file.create', spaceId: 's', path: 'original.md', content: '原作者的原话' },
  ] satisfies InformationCommand[]) {
    const d = decideInformationCommand({
      state: s.information,
      actorId: 'a',
      at: 0,
      policy: s.informationPolicy,
      agentExists: exists,
      command,
    });
    if (!d.accepted) throw Error(d.reason);
    apply({ informationEvents: d.events });
  }
  const register = decideSharedRecords({
    state: s.sharedRecords!,
    actorId: 'a',
    at: 0,
    exists,
    command: {
      type: 'registers.create',
      id: 'r',
      title: '私有依据',
      visibility: 'private',
      readers: ['b'],
      editors: [],
      fields: { value: 'number' },
    },
  });
  if (!register.accepted) throw Error(register.reason);
  apply({ sharedRecordsEvents: register.events });
  const record = decideSharedRecords({
    state: s.sharedRecords!,
    actorId: 'a',
    at: 0,
    exists,
    command: {
      type: 'records.put',
      registerId: 'r',
      key: 'one',
      expectedRevision: 0,
      values: { value: 2 },
    },
  });
  if (!record.accepted) throw Error(record.reason);
  apply({ sharedRecordsEvents: record.events });
  const control = (
    kind: InformationResourceKind,
    id: string,
    actorId: string,
    command: ControlCommand,
  ) => {
    const d = decideInformationResourceControl({
      state: s,
      kind,
      id,
      expectedRevision: getInformationResource(s, kind, id)!.revision,
      actorId,
      at: 10,
      policy: RESOURCE_CONTROL_POLICY,
      command,
      authorize: authorized,
      available: (c) => (c.kind === 'resident' ? exists(c.id) : c.id === 'club'),
    });
    if (d.accepted) apply(d.effects);
    return d;
  };
  const adopt = (kind: InformationResourceKind, id: string) => {
    expect(
      control(kind, id, 'a', {
        type: 'offer',
        expectedVersion: 1,
        target: { kind: 'collective', id: 'club' },
        expiresAt: 100,
        terms: '交接管理，保留原文',
      }).accepted,
    ).toBe(true);
    expect(control(kind, id, 'b', { type: 'accept', expectedVersion: 2 }).accepted).toBe(true);
  };
  return {
    get state() {
      return s;
    },
    apply,
    control,
    adopt,
  };
}
test.each([
  ['space', 's'],
  ['register', 'r'],
] as const)(
  '%s control changes through its own events and preserves original authorship',
  (kind, id) => {
    const t = fixture(),
      before = structuredClone(t.state);
    t.adopt(kind, id);
    const r = getInformationResource(t.state, kind, id)!;
    expect(r.ownerId).toBe('a');
    expect(effectiveController(r)).toEqual({ kind: 'collective', id: 'club' });
    expect(r.control).toMatchObject({ version: 3, changedBy: 'b', decisionId: 'decision' });
    expect(t.state.information.documents['s/original.md']).toEqual(
      before.information.documents['s/original.md'],
    );
    expect(t.state.sharedRecords!.records['r/one']).toEqual(before.sharedRecords!.records['r/one']);
    expect(
      t.control(kind, id, 'a', {
        type: 'offer',
        expectedVersion: 3,
        target: { kind: 'resident', id: 'c' },
        expiresAt: 100,
        terms: '旧创建者尝试夺回',
      }),
    ).toMatchObject({ accepted: false, reason: 'resource-controller-authority-required' });
  },
);
test('collective control never implicitly grants private usage to old owners, members or the executor', () => {
  const t = fixture();
  t.adopt('space', 's');
  t.adopt('register', 'r');
  expect(canReadSpace(t.state.information.spaces.s!, 'a')).toBe(false);
  expect(canReadSpace(t.state.information.spaces.s!, 'b')).toBe(false);
  expect(canReadRegister(t.state.sharedRecords!.registers.r!, 'a')).toBe(false);
  expect(canReadRegister(t.state.sharedRecords!.registers.r!, 'b')).toBe(true);
  const create = decideInformationCommand({
    state: t.state.information,
    actorId: 'a',
    at: 20,
    policy: DEFAULT_INFORMATION_POLICY,
    agentExists: exists,
    command: { type: 'file.create', spaceId: 's', path: 'stolen.md', content: '不能绕过当前ACL' },
  });
  expect(create.accepted).toBe(false);
  const steal = decideSharedRecords({
    state: t.state.sharedRecords!,
    actorId: 'a',
    at: 20,
    exists,
    command: {
      type: 'registers.configure',
      id: 'r',
      expectedRevision: 3,
      visibility: 'public',
      readers: [],
      editors: ['a'],
    },
  });
  expect(steal.accepted).toBe(false);
  const op = parseInformationResourceOperation('register', {
    type: 'configure',
    visibility: 'private',
    readers: ['b', 'c'],
    editors: ['c'],
  })!;
  const d = decideInformationResourceManagement({
    state: t.state,
    id: 'r',
    expectedRevision: 3,
    expectedControlVersion: 3,
    actorId: 'b',
    at: 20,
    operation: op,
    authorize: authorized,
    exists,
  });
  if (!d.accepted) throw Error(d.reason);
  t.apply(d.effects);
  expect(canReadRegister(t.state.sharedRecords!.registers.r!, 'c')).toBe(true);
  const write = decideSharedRecords({
    state: t.state.sharedRecords!,
    actorId: 'c',
    at: 30,
    exists,
    command: {
      type: 'records.put',
      registerId: 'r',
      key: 'one',
      expectedRevision: 1,
      values: { value: 5 },
    },
  });
  if (!write.accepted) throw Error(write.reason);
  t.apply({ sharedRecordsEvents: write.events });
  expect(t.state.sharedRecords!.records['r/one']).toMatchObject({
    createdBy: 'a',
    editedBy: 'c',
    authorityId: 'c',
    revision: 2,
  });
});
test('changing settings invalidates a pending control offer', () => {
  const t = fixture();
  t.adopt('space', 's');
  expect(
    t.control('space', 's', 'b', {
      type: 'offer',
      expectedVersion: 3,
      target: { kind: 'resident', id: 'c' },
      expiresAt: 100,
      terms: '提议',
    }).accepted,
  ).toBe(true);
  const op = parseInformationResourceOperation('space', {
    type: 'configure',
    visibility: 'private',
    posting: 'members',
    members: ['b'],
  })!;
  const d = decideInformationResourceManagement({
    state: t.state,
    id: 's',
    expectedRevision: getInformationResource(t.state, 'space', 's')!.revision,
    expectedControlVersion: 4,
    actorId: 'b',
    at: 20,
    operation: op,
    authorize: authorized,
    exists,
  });
  if (!d.accepted) throw Error(d.reason);
  t.apply(d.effects);
  expect(t.state.information.spaces.s!.control).toMatchObject({ version: 5 });
  expect(t.state.information.spaces.s!.control).not.toHaveProperty('offer');
  expect(t.control('space', 's', 'c', { type: 'accept', expectedVersion: 5 }).accepted).toBe(false);
});
test('closed administrative operations do not admit balance, membership or author rewrites', () => {
  for (const op of [
    { type: 'configure', visibility: 'public', posting: 'everyone', members: [], balance: 20 },
    { type: 'setOwner', ownerId: 'a' },
    { type: 'file.update', authorId: 'b', content: 'forged' },
    { type: 'disable', authority: true },
  ])
    expect(parseInformationResourceOperation('space', op)).toBeUndefined();
  const t = fixture(),
    op = parseInformationResourceOperation('space', {
      type: 'configure',
      visibility: 'private',
      posting: 'members',
      members: ['b'],
    })!;
  const d = decideInformationResourceManagement({
    state: t.state,
    id: 's',
    expectedRevision: 1,
    expectedControlVersion: 1,
    actorId: 'a',
    at: 5,
    operation: op,
    authorize: () => undefined,
    exists,
  });
  if (!d.accepted) throw Error(d.reason);
  t.apply(d.effects);
  expect(t.state.information.spaces.s).not.toHaveProperty('control');
  expect(canReadSpace(t.state.information.spaces.s!, 'b')).toBe(true);
});
