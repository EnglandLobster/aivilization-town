import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { createOpenSocietyManifest } from './manifest';
import { OpenSocietyRuntime } from './runtime';

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const close of cleanup.reverse()) close();
  cleanup.length = 0;
});
function setup(inventorySize = 0) {
  const root = mkdtempSync(join(tmpdir(), 'resident-context-delivery-'));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const original = createOpenSocietyManifest({ count: 2, continuity: true });
  const [a, b] = original.residents.map((r) => r.id) as [string, string];
  const manifest =
    inventorySize === 0
      ? original
      : {
          ...original,
          initialWorld: {
            ...original.initialWorld,
            agents: {
              ...original.initialWorld.agents,
              [a]: {
                ...original.initialWorld.agents[a]!,
                inventory: Object.fromEntries(
                  Array.from({ length: inventorySize }, (_, i) => [
                    `fixture-item-${String(i).padStart(2, '0')}`,
                    i + 1,
                  ]),
                ),
              },
            },
          },
        };
  const runtime = new OpenSocietyRuntime(root, manifest);
  cleanup.push(() => runtime.close());
  let count = 0;
  const call = (actor: string, name: string, args: Record<string, unknown>) => {
    runtime.beginTurn(actor);
    const result = runtime.invoke(actor, {
      name,
      arguments: args,
      requestId: `request-${++count}`,
    });
    runtime.finishTurn(actor, { summary: 'handoff' });
    expect(result.ok, result.error).toBe(true);
    return result.data;
  };
  return { runtime, a, b, call };
}

test('default self remains bounded while an explicit query retains complete personal details', () => {
  const { runtime, a, call } = setup(20);
  const context = runtime.context(a);
  const full = call(a, 'world.observe', { view: 'self' }) as { inventory: Record<string, number> };
  expect(Object.keys(context.self.inventory)).toHaveLength(12);
  expect(context.self).toMatchObject({ inventoryTotal: 20, inventoryTruncated: true });
  expect(Object.keys(full.inventory)).toHaveLength(20);
  expect(context.self.inventory).not.toHaveProperty('fixture-item-19');
  expect(full.inventory['fixture-item-19']).toBe(20);
  expect(context).not.toHaveProperty('candidateActions');
  expect(Object.keys(context.self)).not.toContain('banking');
  expect(context.delivery.version).toBe('resident-context-delivery-v1');
});

test('automatic previews neither read originals nor expose unrequested public text or private state', () => {
  const { runtime, a, b, call } = setup();
  const post = 'PUBLIC-ORIGINAL-ONLY-ON-DEMAND';
  call(b, 'files.create', { spaceId: 'app-reviews', path: 'posts/context.md', content: post });
  const original = '私信'.repeat(500) + 'ORIGINAL-END';
  call(b, 'messages.send', { recipientId: a, content: original });
  const before = structuredClone(runtime.state);
  const context = runtime.context(a);
  expect(runtime.state).toEqual(before);
  expect(JSON.stringify(context)).not.toContain(post);
  expect(context.inbox.items[0]).toMatchObject({
    preview: original.slice(0, 400),
    truncated: true,
  });
  expect(context.inbox.items[0]).not.toHaveProperty('content');
  expect(context.nearbyPeople.items.every((person) => !('balance' in person))).toBe(true);
  expect(call(a, 'files.read', { spaceId: 'app-reviews', path: 'posts/context.md' })).toMatchObject(
    { content: post },
  );
  expect(call(a, 'messages.read', { id: context.inbox.items[0]!.id })).toMatchObject({
    content: original,
  });
});

test('self-authored notes and reminders preview literally, retain full originals, and sort reminders by time', () => {
  const { runtime, a, call } = setup();
  const text = '自己的原文'.repeat(180);
  call(a, 'cognition.update', {
    key: 'own-plan',
    kind: 'goal',
    statement: text,
    confidence: 0.5,
    evidenceIds: [],
    expectedRevision: 0,
    active: true,
    pinned: true,
  });
  call(a, 'schedule.remind', { id: 'later', at: 20000, text });
  call(a, 'schedule.remind', { id: 'sooner', at: 10000, text: '可以不做' });
  const context = runtime.context(a);
  expect(context.cognition.items[0]).toMatchObject({
    statement: text.slice(0, 700),
    truncated: true,
    pinned: true,
  });
  expect(context.reminders.map((r) => r.at)).toEqual([10000, 20000]);
  expect(context.reminders[1]).toMatchObject({ text: text.slice(0, 700), truncated: true });
  expect(call(a, 'cognition.list', {})).toMatchObject({
    items: [expect.objectContaining({ statement: text })],
  });
  const reminders = call(a, 'schedule.list', {}) as { items: { text: string }[] };
  expect(reminders.items.some((reminder) => reminder.text === text)).toBe(true);
});
