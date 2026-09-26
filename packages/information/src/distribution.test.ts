import { expect, test } from 'vitest';
import { applyInformationEvent, decideInformationCommand } from './aggregate';
import {
  DEFAULT_INFORMATION_POLICY,
  emptyInformationState,
  type InformationCommand,
} from './model';
import {
  applyDistributionEvent,
  decideDistributionCommand,
  recordDocumentPublication,
} from './distributionAggregate';
import {
  DEFAULT_DISTRIBUTION_POLICY,
  emptyDistributionState,
  assertDistributionPolicy,
  type DistributionCommand,
  type DistributionEvent,
} from './distributionModel';
import { listDistributionFeed, readDistributionPublication } from './distributionRead';

function fixture(maxSubscriptions = 100) {
  let information = emptyInformationState();
  const policy = { ...DEFAULT_DISTRIBUTION_POLICY, maxSubscriptions };
  let state = emptyDistributionState(policy);
  const events: DistributionEvent[] = [];
  const actorExists = (id: string) => ['a', 'b', 'c'].includes(id);
  const apply = (event: DistributionEvent) => {
    events.push(event);
    state = applyDistributionEvent(state, event);
  };
  const info = (actorId: string, command: InformationCommand) => {
    const decision = decideInformationCommand({
      state: information,
      actorId,
      command,
      at: 0,
      policy: DEFAULT_INFORMATION_POLICY,
      agentExists: actorExists,
    });
    if (!decision.accepted) throw new Error(decision.reason);
    for (const event of decision.events) {
      information = applyInformationEvent(information, event);
      if (event.type === 'DocumentCreated' || event.type === 'DocumentUpdated')
        apply(recordDocumentPublication(state, event.document));
    }
  };
  info('a', {
    type: 'space.create',
    id: 'public',
    title: '公开',
    visibility: 'public',
    posting: 'everyone',
    members: [],
  });
  info('a', {
    type: 'space.create',
    id: 'private',
    title: '私密',
    visibility: 'private',
    posting: 'members',
    members: ['b'],
  });
  const command = (actorId: string, command: DistributionCommand) => {
    const decision = decideDistributionCommand({
      state,
      information,
      actorId,
      command,
      at: 0,
      actorExists,
    });
    if (decision.accepted) decision.events.forEach(apply);
    return decision;
  };
  const publish = (content = '  原话\n$HOME `字面量`  ', spaceId = 'public', path = 'post.md') =>
    info('a', { type: 'file.create', spaceId, path, title: '作者的标题', content });
  return {
    get information() {
      return information;
    },
    get state() {
      return state;
    },
    events,
    policy,
    command,
    info,
    publish,
  };
}

test('subscriptions deliver only future matching originals, deduplicate and preserve simulation-time order', () => {
  const f = fixture();
  f.publish('before', 'public', 'before.md');
  f.command('b', { type: 'subscription.follow', kind: 'author', targetId: 'a' });
  f.command('b', { type: 'subscription.follow', kind: 'space', targetId: 'public' });
  f.publish();
  f.publish('third', 'public', 'third.md');
  const feed = listDistributionFeed(f.state, f.information, 'b');
  expect(feed.map((item) => item.sequence)).toEqual([3, 2]);
  expect(feed.every((item) => !('content' in item) && !('comment' in item))).toBe(true);
  expect(listDistributionFeed(f.state, f.information, 'c')).toEqual([]);
  expect(listDistributionFeed(f.state, f.information, 'a')).toEqual([]);
  expect(f.command('b', { type: 'subscription.follow', kind: 'author', targetId: 'a' })).toEqual({
    accepted: true,
    events: [],
  });
});

test('notification read is personal, idempotent and does not modify another resident cognition', () => {
  const f = fixture();
  for (const actor of ['b', 'c'])
    f.command(actor, { type: 'subscription.follow', kind: 'author', targetId: 'a' });
  f.publish();
  expect(f.command('b', { type: 'notification.read', activityId: 'publication-1' }).accepted).toBe(
    true,
  );
  expect(listDistributionFeed(f.state, f.information, 'b', true)).toEqual([]);
  expect(listDistributionFeed(f.state, f.information, 'c', true)).toHaveLength(1);
  expect(f.command('b', { type: 'notification.read', activityId: 'publication-1' })).toEqual({
    accepted: true,
    events: [],
  });
  expect(f.command('a', { type: 'notification.read', activityId: 'publication-1' })).toEqual({
    accepted: false,
    reason: 'notification-not-found',
  });
  expect(f.state.readByOwner).toEqual({ b: { 'publication-1': 0 } });
});

test('shares pin original revisions and preserve the sharer comment independently', () => {
  const f = fixture();
  f.command('c', { type: 'subscription.follow', kind: 'author', targetId: 'b' });
  f.publish();
  const original = f.information.documents['public/post.md']!;
  const comment = '  我的转发原话\n不同意其中一点。 ';
  expect(
    f.command('b', { type: 'publication.share', documentId: original.id, revision: 1, comment })
      .accepted,
  ).toBe(true);
  f.info('a', {
    type: 'file.update',
    spaceId: 'public',
    path: 'post.md',
    expectedRevision: 1,
    content: '作者修订',
  });
  const read = readDistributionPublication(f.state, f.information, 'c', 'publication-2');
  expect(read).toMatchObject({ publisherId: 'b', authorId: 'a', comment, original });
  expect(listDistributionFeed(f.state, f.information, 'c').map((item) => item.id)).toEqual([
    'publication-2',
  ]);
  f.info('a', { type: 'file.delete', spaceId: 'public', path: 'post.md', expectedRevision: 2 });
  expect(listDistributionFeed(f.state, f.information, 'c')).toEqual([]);
  expect(readDistributionPublication(f.state, f.information, 'c', 'publication-2')).toBeUndefined();
  expect(f.state.publications['publication-2']?.documentRevision).toBe(1);
});

test('private-source ACL is checked for feeds, reads, subscriptions and sharing', () => {
  const f = fixture();
  for (const actor of ['b', 'c'])
    f.command(actor, { type: 'subscription.follow', kind: 'author', targetId: 'a' });
  expect(
    f.command('c', { type: 'subscription.follow', kind: 'space', targetId: 'private' }),
  ).toEqual({ accepted: false, reason: 'target-not-found' });
  f.publish('秘密', 'private');
  expect(listDistributionFeed(f.state, f.information, 'b')).toHaveLength(1);
  expect(listDistributionFeed(f.state, f.information, 'c')).toEqual([]);
  expect(readDistributionPublication(f.state, f.information, 'c', 'publication-1')).toBeUndefined();
  expect(
    f.command('b', { type: 'publication.share', documentId: 'private/post.md', revision: 1 }),
  ).toEqual({ accepted: false, reason: 'private-source-cannot-be-shared' });
  // Future membership/ACL events will produce this read snapshot; no past event is reinterpreted.
  const revoked = {
    ...f.information,
    spaces: { ...f.information.spaces, private: { ...f.information.spaces.private!, members: [] } },
  };
  expect(listDistributionFeed(f.state, revoked, 'b')).toEqual([]);
  expect(readDistributionPublication(f.state, revoked, 'b', 'publication-1')).toBeUndefined();
});

test('limits, invalid targets/revisions and policy bounds reject without events', () => {
  const f = fixture(1);
  expect(f.command('b', { type: 'subscription.follow', kind: 'author', targetId: 'b' })).toEqual({
    accepted: false,
    reason: 'cannot-follow-self',
  });
  expect(
    f.command('b', { type: 'subscription.follow', kind: 'author', targetId: 'missing' }),
  ).toEqual({ accepted: false, reason: 'target-not-found' });
  f.command('b', { type: 'subscription.follow', kind: 'author', targetId: 'a' });
  expect(
    f.command('b', { type: 'subscription.follow', kind: 'space', targetId: 'public' }),
  ).toEqual({ accepted: false, reason: 'subscription-limit' });
  f.publish();
  expect(
    f.command('b', {
      type: 'publication.share',
      documentId: 'public/post.md',
      revision: 1,
      comment: 'x'.repeat(2000),
    }).accepted,
  ).toBe(true);
  expect(
    f.command('b', {
      type: 'publication.share',
      documentId: 'public/post.md',
      revision: 1,
      comment: 'x'.repeat(2001),
    }),
  ).toEqual({ accepted: false, reason: 'invalid-comment-length' });
  expect(
    f.command('b', { type: 'publication.share', documentId: 'public/post.md', revision: 1.5 }),
  ).toEqual({ accepted: false, reason: 'invalid-document-revision' });
  expect(
    f.command('b', { type: 'publication.share', documentId: 'public/post.md', revision: 99 }),
  ).toEqual({ accepted: false, reason: 'source-not-found' });
  for (const overrides of [
    { maxSubscriptions: 0 },
    { maxCommentLength: NaN },
    { contextItems: 31 },
  ])
    expect(() => assertDistributionPolicy({ ...f.policy, ...overrides })).toThrow(
      'invalid-distribution-policy',
    );
});

test('unfollow and refollow reset the cursor; replay applies recorded facts exactly', () => {
  const f = fixture();
  f.command('b', { type: 'subscription.follow', kind: 'author', targetId: 'a' });
  f.publish();
  f.command('b', { type: 'subscription.unfollow', kind: 'author', targetId: 'a' });
  expect(listDistributionFeed(f.state, f.information, 'b')).toEqual([]);
  f.command('b', { type: 'subscription.follow', kind: 'author', targetId: 'a' });
  expect(listDistributionFeed(f.state, f.information, 'b')).toEqual([]);
  f.publish('新的', 'public', 'new.md');
  expect(listDistributionFeed(f.state, f.information, 'b').map((item) => item.sequence)).toEqual([
    2,
  ]);
  expect(f.events.reduce(applyDistributionEvent, emptyDistributionState(f.policy))).toEqual(
    f.state,
  );
  expect(
    applyDistributionEvent(undefined, { type: 'DistributionEnabled', policy: f.policy }),
  ).toEqual(emptyDistributionState(f.policy));
  expect(() => applyDistributionEvent(undefined, f.events[0]!)).toThrow('distribution-not-enabled');
  expect(() => applyDistributionEvent(f.state, f.events.at(-1)!)).toThrow(
    'publication-sequence-conflict',
  );
});
