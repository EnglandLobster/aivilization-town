import { describe, expect, test } from 'vitest';
import { applyInformationEvent, decideInformationCommand } from './aggregate';
import {
  DEFAULT_INFORMATION_POLICY,
  emptyInformationState,
  type InformationCommand,
  type InformationState,
  type InformationEvent,
} from './model';

function decide(state: InformationState, actorId: string, command: InformationCommand) {
  return decideInformationCommand({
    state,
    actorId,
    command,
    at: 100,
    policy: DEFAULT_INFORMATION_POLICY,
    agentExists: (id) => ['alice', 'bob', 'eve'].includes(id),
  });
}
function apply(state: InformationState, actorId: string, command: InformationCommand) {
  const decision = decide(state, actorId, command);
  if (!decision.accepted) throw new Error(decision.reason);
  return decision.events.reduce(applyInformationEvent, state);
}
const space: InformationCommand = {
  type: 'space.create',
  id: 'food',
  title: 'Food',
  visibility: 'public',
  posting: 'everyone',
  members: [],
};
describe('information aggregates', () => {
  test('public contributions retain independent authors, optimistic revisions and deletion history', () => {
    let state = apply(emptyInformationState(), 'alice', space);
    state = apply(state, 'bob', {
      type: 'file.create',
      spaceId: 'food',
      path: 'reviews/bob.md',
      content: 'I liked it',
    });
    expect(state.documents['food/reviews/bob.md']?.authorId).toBe('bob');
    expect(
      decide(state, 'alice', {
        type: 'file.update',
        spaceId: 'food',
        path: 'reviews/bob.md',
        content: 'Changed',
        expectedRevision: 1,
      }),
    ).toEqual({ accepted: false, reason: 'permission-denied' });
    expect(
      decide(state, 'bob', {
        type: 'file.update',
        spaceId: 'food',
        path: 'reviews/bob.md',
        content: 'Changed',
        expectedRevision: 0,
      }),
    ).toEqual({ accepted: false, reason: 'revision-conflict' });
    state = apply(state, 'bob', {
      type: 'file.update',
      spaceId: 'food',
      path: 'reviews/bob.md',
      content: 'I changed my mind',
      expectedRevision: 1,
    });
    state = apply(state, 'alice', {
      type: 'file.delete',
      spaceId: 'food',
      path: 'reviews/bob.md',
      expectedRevision: 2,
    });
    expect(state.documents['food/reviews/bob.md']).toMatchObject({
      revision: 3,
      deleted: true,
      authorId: 'bob',
    });
    expect(state.history['food/reviews/bob.md']?.map((doc) => doc.content)).toEqual([
      'I liked it',
      'I changed my mind',
      'I changed my mind',
    ]);
  });
  test('private spaces and owner-only posting protect content without leaking existence', () => {
    const state = apply(emptyInformationState(), 'alice', {
      ...space,
      visibility: 'private',
      posting: 'members',
      members: ['bob'],
    });
    expect(
      decide(state, 'eve', { type: 'file.create', spaceId: 'food', path: 'x', content: 'x' }),
    ).toMatchObject({ accepted: false, reason: 'not-found' });
    expect(
      decide(state, 'bob', { type: 'file.create', spaceId: 'food', path: 'x', content: 'x' })
        .accepted,
    ).toBe(true);
    const ownerOnly = apply(emptyInformationState(), 'alice', { ...space, posting: 'owner' });
    expect(
      decide(ownerOnly, 'bob', { type: 'file.create', spaceId: 'food', path: 'x', content: 'x' }),
    ).toMatchObject({ accepted: false, reason: 'permission-denied' });
  });
  test.each(['../x', '/etc/passwd', 'a/../../x', 'a\\b', 'a//b', '.', 'a/\u0000b'])(
    'rejects unsafe logical path %s',
    (path) => {
      const state = apply(emptyInformationState(), 'alice', space);
      expect(
        decide(state, 'alice', { type: 'file.create', spaceId: 'food', path, content: 'x' }),
      ).toMatchObject({ accepted: false, reason: 'invalid-path' });
    },
  );
  test('content boundaries and caller existence are enforced', () => {
    const state = apply(emptyInformationState(), 'alice', space);
    expect(
      decide(state, 'bob', {
        type: 'file.create',
        spaceId: 'food',
        path: 'x',
        content: 'x'.repeat(8000),
      }).accepted,
    ).toBe(true);
    expect(
      decide(state, 'bob', {
        type: 'file.create',
        spaceId: 'food',
        path: 'x',
        content: 'x'.repeat(8001),
      }),
    ).toMatchObject({ reason: 'invalid-content-length' });
    expect(decide(state, 'outsider', space)).toMatchObject({ reason: 'invalid-actor-or-time' });
  });
  test('messages bind sender and only recipient marks read; stranger cannot retrieve a private fact', () => {
    const state = apply(emptyInformationState(), 'alice', {
      type: 'message.send',
      id: 'msg-1',
      recipientId: 'bob',
      content: 'Meet tomorrow?',
    });
    expect(decide(state, 'eve', { type: 'message.read', id: 'msg-1' })).toMatchObject({
      reason: 'not-found',
    });
    expect(decide(state, 'alice', { type: 'message.read', id: 'msg-1' })).toEqual({
      accepted: true,
      events: [],
    });
    const read = apply(state, 'bob', { type: 'message.read', id: 'msg-1' });
    expect(read.messages['msg-1']).toMatchObject({
      senderId: 'alice',
      recipientId: 'bob',
      readAt: 100,
    });
    expect(decide(read, 'bob', { type: 'message.read', id: 'msg-1' })).toEqual({
      accepted: true,
      events: [],
    });
  });
  test('persisted events replay complete state without redeciding permission', () => {
    const events: InformationEvent[] = [];
    let state = emptyInformationState();
    for (const command of [
      space,
      { type: 'file.create', spaceId: 'food', path: 'a.md', content: 'first' },
      {
        type: 'file.update',
        spaceId: 'food',
        path: 'a.md',
        content: 'second',
        expectedRevision: 1,
      },
    ] satisfies InformationCommand[]) {
      const decision = decide(state, 'alice', command);
      if (!decision.accepted) throw new Error(decision.reason);
      events.push(...decision.events);
      state = decision.events.reduce(applyInformationEvent, state);
    }
    expect(events.reduce(applyInformationEvent, emptyInformationState())).toEqual(state);
  });
});
