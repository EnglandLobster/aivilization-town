import { it, expect } from 'vitest';
import {
  emptyCollaborationState,
  decideCollaboration,
  applyCollaborationEvent,
  expireProposals,
  type CollaborationCommand,
  type CollaborationEvent,
} from './proposals';
it('binds all consent to exact terms, preserves raw history and treats fulfillment as a claim', () => {
  let state = emptyCollaborationState();
  const events: CollaborationEvent[] = [];
  const call = (actorId: string, command: CollaborationCommand) => {
    const d = decideCollaboration({
      state,
      actorId,
      at: 0,
      command,
      exists: (id) => ['a', 'b', 'c'].includes(id),
    });
    if (d.accepted) {
      events.push(...d.events);
      state = d.events.reduce(applyCollaborationEvent, state);
    }
    return d;
  };
  call('a', { type: 'create', id: 'p', participants: ['b', 'c'], terms: '原文', expiresAt: 100 });
  call('b', { type: 'respond', id: 'p', accept: true, expectedRevision: 1 });
  call('a', { type: 'revise', id: 'p', terms: '新原文', expiresAt: 200, expectedRevision: 2 });
  expect(state.proposals.p?.consents).toEqual({ a: true });
  expect(call('c', { type: 'respond', id: 'p', accept: true, expectedRevision: 2 })).toMatchObject({
    accepted: false,
    reason: 'revision-conflict',
  });
  call('b', { type: 'respond', id: 'p', accept: true, expectedRevision: 3 });
  call('c', { type: 'respond', id: 'p', accept: true, expectedRevision: 4 });
  expect(state.proposals.p?.status).toBe('accepted');
  call('b', {
    type: 'declare',
    id: 's',
    proposalId: 'p',
    kind: 'disputed',
    content: '我不同意已经履行',
  });
  expect(state.statements.s?.authorId).toBe('b');
  expect(state.proposals.p?.status).toBe('accepted');
  expect(state.history.p?.[0]?.terms).toBe('原文');
  expect(events.reduce(applyCollaborationEvent, emptyCollaborationState())).toEqual(state);
});
it('rejects forged participants and expiry boundaries; expiration is cadence independent', () => {
  let state = emptyCollaborationState();
  const d = decideCollaboration({
    state,
    actorId: 'a',
    at: 0,
    exists: () => true,
    command: { type: 'create', id: 'p', participants: ['b'], terms: 'terms', expiresAt: 10 },
  });
  if (!d.accepted) throw Error('create');
  state = d.events.reduce(applyCollaborationEvent, state);
  expect(
    decideCollaboration({
      state,
      actorId: 'c',
      at: 0,
      exists: () => true,
      command: { type: 'respond', id: 'p', expectedRevision: 1, accept: true },
    }),
  ).toMatchObject({ accepted: false });
  expect(
    decideCollaboration({
      state,
      actorId: 'b',
      at: 10,
      exists: () => true,
      command: { type: 'respond', id: 'p', expectedRevision: 1, accept: true },
    }),
  ).toMatchObject({ accepted: false, reason: 'proposal-not-open' });
  const one = expireProposals(state, 20).reduce(applyCollaborationEvent, state);
  const half = expireProposals(state, 10).reduce(applyCollaborationEvent, state);
  expect(expireProposals(half, 20).reduce(applyCollaborationEvent, half)).toEqual(one);
});
