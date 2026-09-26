import { describe, it, expect } from 'vitest';
import {
  applyCommunicationEvent,
  emptyCommunicationState,
  decideCommunication,
  canReadGroup,
  communicationBlocked,
  type CommunicationCommand,
  type CommunicationEvent,
} from './communication';
describe('communication consent and replay', () => {
  function setup() {
    let s = emptyCommunicationState();
    const events: CommunicationEvent[] = [];
    const call = (a: string, c: CommunicationCommand) => {
      const d = decideCommunication({
        state: s,
        actorId: a,
        at: 0,
        command: c,
        exists: (id) => ['a', 'b', 'c'].includes(id),
      });
      if (d.accepted) {
        events.push(...d.events);
        s = d.events.reduce(applyCommunicationEvent, s);
      }
      return d;
    };
    return {
      call,
      get state() {
        return s;
      },
      events,
    };
  }
  it('requires invitee consent and current membership; transfer and closure preserve originals', () => {
    const f = setup();
    expect(f.call('a', { type: 'create', id: 'g', title: '原文群' }).accepted).toBe(true);
    f.call('a', { type: 'invite', id: 'i', groupId: 'g', residentId: 'b' });
    expect(f.call('a', { type: 'accept', id: 'i', expectedRevision: 1 })).toMatchObject({
      accepted: false,
      reason: 'invitation-not-yours',
    });
    expect(canReadGroup(f.state, 'b', 'g')).toBe(false);
    expect(f.call('b', { type: 'accept', id: 'i', expectedRevision: 2 })).toMatchObject({
      accepted: false,
      reason: 'revision-conflict',
    });
    f.call('b', { type: 'accept', id: 'i', expectedRevision: 1 });
    f.call('b', { type: 'send', id: 'm', groupId: 'g', content: '我的原话\n保留' });
    expect(f.state.messages.m?.content).toBe('我的原话\n保留');
    expect(f.call('a', { type: 'leave', groupId: 'g', expectedRevision: 2 })).toMatchObject({
      accepted: false,
      reason: 'transfer-or-close-first',
    });
    f.call('a', { type: 'transfer', groupId: 'g', targetId: 'b', expectedRevision: 2 });
    f.call('a', { type: 'leave', groupId: 'g', expectedRevision: 3 });
    expect(canReadGroup(f.state, 'a', 'g')).toBe(false);
    f.call('b', { type: 'close', groupId: 'g', expectedRevision: 4 });
    expect(f.call('b', { type: 'send', id: 'n', groupId: 'g', content: 'late' })).toMatchObject({
      accepted: false,
      reason: 'group-closed',
    });
    expect(f.events.reduce(applyCommunicationEvent, emptyCommunicationState())).toEqual(f.state);
  });
  it('authorizes applications, blocking, limits and no duplicate pending invites', () => {
    const f = setup();
    f.call('a', { type: 'create', id: 'g', title: 'group' });
    f.call('b', { type: 'join-request', id: 'i', groupId: 'g', residentId: 'b' });
    expect(f.call('b', { type: 'accept', id: 'i', expectedRevision: 1 }).accepted).toBe(false);
    f.call('a', { type: 'reject', id: 'i', expectedRevision: 1 });
    f.call('b', { type: 'block', targetId: 'a' });
    expect(communicationBlocked(f.state, 'b', 'a')).toBe(true);
    expect(f.call('a', { type: 'invite', id: 'j', groupId: 'g', residentId: 'b' })).toMatchObject({
      accepted: false,
      reason: 'communication-blocked',
    });
    f.call('b', { type: 'unblock', targetId: 'a' });
    f.call('a', { type: 'invite', id: 'j', groupId: 'g', residentId: 'b' });
    expect(f.call('a', { type: 'invite', id: 'k', groupId: 'g', residentId: 'b' })).toEqual({
      accepted: true,
      events: [],
    });
    const full = { ...f.state, policy: { ...f.state.policy, maxMembers: 1 } };
    expect(
      decideCommunication({
        state: full,
        actorId: 'b',
        at: 0,
        command: { type: 'accept', id: 'j', expectedRevision: 1 },
        exists: () => true,
      }),
    ).toMatchObject({ accepted: false, reason: 'group-full' });
    expect(
      f.call('a', { type: 'send', id: 'x', groupId: 'g', content: 'x'.repeat(8001) }).accepted,
    ).toBe(false);
  });
});

it('read acknowledgements cover exact visible messages and preserve gaps and legacy empty state', () => {
  let s = emptyCommunicationState();
  const events: CommunicationEvent[] = [];
  const call = (actorId: string, command: CommunicationCommand) => {
    const d = decideCommunication({ state: s, actorId, at: 0, command, exists: () => true });
    if (d.accepted) {
      s = d.events.reduce(applyCommunicationEvent, s);
      events.push(...d.events);
    }
    return d;
  };
  call('a', { type: 'create', id: 'g', title: '原文' });
  call('a', { type: 'send', id: 'm1', groupId: 'g', content: '第一条' });
  call('a', { type: 'send', id: 'm2', groupId: 'g', content: '第二条' });
  expect(call('b', { type: 'read', messageIds: ['m2'] }).accepted).toBe(false);
  expect(call('a', { type: 'read', messageIds: ['missing'] }).accepted).toBe(false);
  expect(call('a', { type: 'read', messageIds: ['m2'] }).accepted).toBe(true);
  expect(s.readMessageIds?.a).toEqual(['m2']);
  expect(call('a', { type: 'read', messageIds: ['m2'] })).toMatchObject({
    accepted: true,
    events: [],
  });
  expect(events.reduce(applyCommunicationEvent, emptyCommunicationState())).toEqual(s);
});
