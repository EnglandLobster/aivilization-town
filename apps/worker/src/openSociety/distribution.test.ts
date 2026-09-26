import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { OpenSocietyRuntime } from './runtime';
import { createOpenSocietyManifest } from './manifest';
import { applyOpenSocietyEffects } from './state';

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const close of cleanup.reverse()) close();
  cleanup.length = 0;
});
function setup(enabled = true) {
  const root = mkdtempSync(join(tmpdir(), 'distribution-world-'));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const runtime = new OpenSocietyRuntime(
    root,
    createOpenSocietyManifest({ count: 3, distribution: enabled }),
  );
  cleanup.push(() => runtime.close());
  const [a, b, c] = runtime.manifest.residents.map((resident) => resident.id) as [
    string,
    string,
    string,
  ];
  for (const actor of [a, b, c]) runtime.beginTurn(actor);
  let ordinal = 0;
  const invoke = (
    actor: string,
    name: string,
    args: Record<string, unknown>,
    requestId = `distribution-${++ordinal}`,
  ) => runtime.invoke(actor, { name, arguments: args, requestId });
  const post = (path = 'post.md', content = '原话\n不自动摘要') =>
    invoke(a, 'files.create', {
      spaceId: 'app-reviews',
      path: `posts/${path}`,
      title: '作者标题',
      content,
    });
  return { root, runtime, a, b, c, invoke, post };
}

test('subscribed publication and original file commit atomically, notify within budget, and replay exactly', () => {
  const { root, runtime, a, b, c, invoke, post } = setup();
  expect(runtime.manifest.provenance.distribution).toBe('information-distribution-v1');
  expect(runtime.state.distribution?.sequence).toBe(0); // No platform-guide notifications.
  invoke(b, 'subscriptions.follow', { kind: 'author', targetId: a });
  invoke(c, 'subscriptions.follow', { kind: 'author', targetId: b });
  const cognition = structuredClone(runtime.state.cognition);
  const wake = runtime.state.residents[b]!.nextWakeAt;
  expect(post().ok).toBe(true);
  const commit = runtime.journal.commits.at(-1)!;
  expect(commit.informationEvents?.[0]?.type).toBe('DocumentCreated');
  expect(commit.distributionEvents?.[0]?.type).toBe('PublicationRecorded');
  expect(invoke(b, 'notifications.list', {})).toMatchObject({
    ok: true,
    data: { total: 1, items: [{ documentRevision: 1, publisherId: a, read: false }] },
  });
  expect(invoke(c, 'notifications.list', {})).toMatchObject({ data: { total: 0 } });
  const read = invoke(b, 'notifications.read', { id: 'publication-1' }, 'ack-once');
  expect(read).toMatchObject({
    ok: true,
    data: { read: true, original: { content: '原话\n不自动摘要' } },
  });
  const revision = runtime.state.revision;
  expect(invoke(b, 'notifications.read', { id: 'publication-1' }, 'ack-once')).toEqual(read);
  expect(runtime.state.revision).toBe(revision);
  expect(invoke(b, 'notifications.list', {})).toMatchObject({ data: { total: 0 } });
  expect(
    invoke(b, 'feed.share', {
      documentId: 'app-reviews/posts/post.md',
      revision: 1,
      comment: '转发者原话',
    }),
  ).toMatchObject({ ok: true, data: { publisherId: b, authorId: a, comment: '转发者原话' } });
  expect(invoke(c, 'notifications.list', {})).toMatchObject({
    data: { total: 1, items: [{ kind: 'shared', publisherId: b, authorId: a }] },
  });
  for (let i = 0; i < 8; i++) post(`new-${i}.md`, `原文 ${i}`);
  const context = runtime.context(b);
  expect(context.notifications?.items).toHaveLength(6);
  expect(context.notifications?.unreadTotal).toBe(8);
  expect(context.notifications?.items[0]?.sequence).toBe(10);
  expect(context.notifications?.items[0]).not.toHaveProperty('content');
  expect(runtime.state.residents[b]!.nextWakeAt).toBe(wake);
  expect(runtime.state.cognition).toEqual(cognition);
  expect(runtime.state.world.moneySupply).toBe(runtime.manifest.initialWorld.moneySupply);
  const snapshot = structuredClone(runtime.state);
  runtime.close();
  const replay = new OpenSocietyRuntime(root);
  expect(replay.state).toEqual(snapshot);
  replay.close();
});

test('old manifests/states remain disabled until explicit idempotent enable; no backfill', () => {
  const { root, runtime, a, b, invoke, post } = setup(false);
  expect(runtime.state).not.toHaveProperty('distribution');
  expect(runtime.context(b)).not.toHaveProperty('notifications');
  expect(invoke(b, 'feed.list', {})).toMatchObject({
    ok: false,
    error: 'distribution-not-enabled',
  });
  post('before.md');
  const oldState = structuredClone(runtime.state);
  expect(applyOpenSocietyEffects(oldState, {})).not.toHaveProperty('distribution');
  const enabled = runtime.enableDistribution();
  const revision = runtime.state.revision;
  expect(runtime.enableDistribution()).toEqual(enabled);
  expect(runtime.state.revision).toBe(revision);
  expect(runtime.manifest).not.toHaveProperty('distributionPolicy');
  expect(runtime.state.distribution?.sequence).toBe(0);
  invoke(b, 'subscriptions.follow', { kind: 'author', targetId: a });
  post('after.md');
  expect(invoke(b, 'feed.list', {})).toMatchObject({
    data: { total: 1, items: [{ documentId: 'app-reviews/posts/after.md' }] },
  });
  const snapshot = structuredClone(runtime.state);
  runtime.close();
  const replay = new OpenSocietyRuntime(root);
  expect(replay.state).toEqual(snapshot);
  expect(replay.enableDistribution()).toEqual(enabled);
  replay.close();
});

test('rejected writes/shares produce no publication; deleted source cannot be read through a fresh notification', () => {
  const { runtime, a, b, c, invoke, post } = setup();
  invoke(b, 'subscriptions.follow', { kind: 'space', targetId: 'app-reviews' });
  post();
  expect(
    invoke(b, 'files.update', {
      spaceId: 'app-reviews',
      path: 'posts/post.md',
      expectedRevision: 1,
      content: 'forged',
    }),
  ).toMatchObject({ ok: false, error: 'permission-denied' });
  expect(runtime.state.distribution?.sequence).toBe(1);
  expect(runtime.journal.commits.at(-1)?.distributionEvents).toBeUndefined();
  expect(invoke(c, 'notifications.read', { id: 'publication-1' })).toMatchObject({
    ok: false,
    error: 'notification-not-found',
  });
  expect(runtime.state.distribution?.readByOwner[c]).toBeUndefined();
  invoke(a, 'files.delete', { spaceId: 'app-reviews', path: 'posts/post.md', expectedRevision: 1 });
  expect(invoke(b, 'feed.list', {})).toMatchObject({ data: { total: 0 } });
  expect(invoke(b, 'feed.read', { id: 'publication-1' })).toMatchObject({
    ok: false,
    error: 'publication-not-found',
  });
  expect(
    invoke(b, 'feed.share', { documentId: 'app-reviews/posts/post.md', revision: 1 }),
  ).toMatchObject({ ok: false, error: 'source-not-found' });
  expect(runtime.state.distribution?.sequence).toBe(1);
});
