import { expect, test } from 'vitest';
import { applyInformationEvent, decideInformationCommand } from './aggregate';
import {
  DEFAULT_INFORMATION_POLICY,
  emptyInformationState,
  type InformationCommand,
} from './model';
import { indexInformationDocuments } from './documentIndex';

function setup() {
  let state = emptyInformationState();
  const act = (command: InformationCommand, actorId = 'a') => {
    const decision = decideInformationCommand({
      state,
      actorId,
      at: 10,
      command,
      policy: DEFAULT_INFORMATION_POLICY,
      agentExists: (id) => ['a', 'b'].includes(id),
    });
    if (decision.accepted) state = decision.events.reduce(applyInformationEvent, state);
    return decision;
  };
  act({
    type: 'space.create',
    id: 'public',
    title: 'Public',
    visibility: 'public',
    posting: 'everyone',
    members: [],
  });
  return {
    act,
    get state() {
      return state;
    },
  };
}
test('indexes author metadata verbatim, not bodies; old documents remain readable by path', () => {
  const ctx = setup();
  const original = '  我的 原话\n<script>alert(1)</script>\n';
  ctx.act({
    type: 'file.create',
    spaceId: 'public',
    path: 'posts/a.md',
    content: original,
    title: '我的评价',
    tags: ['口味'],
    relatedTo: 'restaurant',
  });
  ctx.act({ type: 'file.create', spaceId: 'public', path: 'posts/b.md', content: '不同意见' }, 'b');
  const rows = indexInformationDocuments(ctx.state, 'b', { relatedTo: 'restaurant', tag: '口味' });
  expect(rows).toHaveLength(1);
  expect(rows[0]?.title).toBe('我的评价');
  expect(rows[0]).not.toHaveProperty('content');
  expect(rows[0]).not.toHaveProperty('summary');
  expect(ctx.state.documents['public/posts/a.md']?.content).toBe(original);
  expect(indexInformationDocuments(ctx.state, 'a', { authorId: 'b' })[0]?.title).toBe('posts/b.md');
  expect(indexInformationDocuments(ctx.state, 'a', { query: 'alert' })).toHaveLength(0);
});
test('revisions preserve metadata and body history; index filters private/deleted records', () => {
  const ctx = setup();
  ctx.act({
    type: 'file.create',
    spaceId: 'public',
    path: 'a.md',
    content: '原文',
    title: '标题',
    tags: ['标签'],
  });
  expect(
    ctx.act(
      {
        type: 'file.update',
        spaceId: 'public',
        path: 'a.md',
        content: '伪造',
        expectedRevision: 1,
      },
      'b',
    ),
  ).toMatchObject({ accepted: false, reason: 'permission-denied' });
  ctx.act({
    type: 'file.update',
    spaceId: 'public',
    path: 'a.md',
    content: '作者修订',
    expectedRevision: 1,
  });
  expect(ctx.state.documents['public/a.md']?.title).toBe('标题');
  expect(ctx.state.history['public/a.md']?.[0]?.content).toBe('原文');
  ctx.act({ type: 'file.delete', spaceId: 'public', path: 'a.md', expectedRevision: 2 });
  ctx.act({
    type: 'space.create',
    id: 'private',
    title: 'Private',
    visibility: 'private',
    posting: 'owner',
    members: [],
  });
  ctx.act({
    type: 'file.create',
    spaceId: 'private',
    path: 'secret.md',
    content: '秘密',
    title: '秘密标题',
  });
  expect(indexInformationDocuments(ctx.state, 'b', {})).toHaveLength(0);
  expect(indexInformationDocuments(ctx.state, 'a', {})).toHaveLength(1);
});
test('rejects oversized metadata and stale revisions; accepts boundary values', () => {
  const ctx = setup();
  const create = { type: 'file.create' as const, spaceId: 'public', path: 'a.md', content: 'x' };
  for (const extra of [
    { title: '' },
    { title: 'x'.repeat(121) },
    { tags: Array.from({ length: 13 }, () => 'x') },
    { tags: ['x'.repeat(41)] },
    { relatedTo: 'x'.repeat(161) },
  ])
    expect(ctx.act({ ...create, ...extra })).toMatchObject({
      accepted: false,
      reason: 'invalid-document-metadata',
    });
  expect(
    ctx.act({
      ...create,
      title: 'x'.repeat(120),
      tags: Array.from({ length: 12 }, () => 'x'.repeat(40)),
      relatedTo: 'x'.repeat(160),
    }).accepted,
  ).toBe(true);
  expect(
    ctx.act({
      type: 'file.update',
      spaceId: 'public',
      path: 'a.md',
      content: 'x',
      expectedRevision: 0,
    }),
  ).toMatchObject({ accepted: false, reason: 'revision-conflict' });
});
