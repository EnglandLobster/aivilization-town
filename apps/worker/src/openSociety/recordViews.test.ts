import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { createOpenSocietyManifest } from './manifest';
import { OpenSocietyRuntime } from './runtime';

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanup.reverse()) fn();
  cleanup.length = 0;
});
function setup(enabled = true) {
  const root = mkdtempSync(join(tmpdir(), 'resident-views-'));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const r = new OpenSocietyRuntime(
    root,
    createOpenSocietyManifest({ count: 3, recordViews: enabled }),
  );
  cleanup.push(() => r.close());
  const [a, b, c] = r.manifest.residents.map((v) => v.id) as [string, string, string];
  let ordinal = 0;
  const call = (actor: string, name: string, args: Record<string, unknown>) => {
    r.beginTurn(actor);
    const result = r.invoke(actor, { name, arguments: args, requestId: `view-${++ordinal}` });
    r.finishTurn(actor, { summary: 'Record view acceptance' });
    return result;
  };
  const ok = (actor: string, name: string, args: Record<string, unknown>) => {
    const result = call(actor, name, args);
    expect(result.ok, `${name}: ${result.error}`).toBe(true);
    return result;
  };
  const seed = () => {
    ok(a, 'registers.create', {
      id: 'notes',
      title: '原始记事',
      visibility: 'private',
      readers: [b],
      editors: [],
      fields: { title: 'string', number: 'number' },
    });
    for (const [key, number] of [
      ['one', 4],
      ['two', 2],
    ] as const)
      ok(a, 'records.put', {
        registerId: 'notes',
        key,
        expectedRevision: 0,
        values: { title: key, number },
      });
    ok(b, 'views.publish', {
      id: 'directory',
      title: '我定义的目录',
      visibility: 'public',
      readers: [],
      definition: {
        sourceRegisterId: 'notes',
        select: ['title', 'number'],
        orderBy: [{ field: 'number', direction: 'asc' }],
        aggregate: { op: 'sum', field: 'number' },
      },
    });
  };
  const replay = () => {
    const expected = structuredClone(r.state),
      bytes = readFileSync(join(root, 'journal.jsonl'));
    r.close();
    const other = new OpenSocietyRuntime(root);
    cleanup.push(() => other.close());
    expect(other.state).toEqual(expected);
    expect(readFileSync(join(root, 'journal.jsonl'))).toEqual(bytes);
  };
  return { r, root, a, b, c, call, ok, seed, replay };
}
test('a resident data application preserves source attribution, pagination and actual reading without world effects', () => {
  const t = setup();
  t.seed();
  const world = structuredClone(t.r.state.world),
    records = structuredClone(t.r.state.sharedRecords);
  const args = { id: 'directory', expectedRevision: 1, limit: 1 };
  expect(t.ok(t.b, 'views.query', args)).toMatchObject({
    data: {
      provenance: 'resident-computation',
      inputProvenance: 'resident-claim',
      authorId: t.b,
      total: 2,
      items: [{ key: 'two', values: { title: 'two', number: 2 } }],
      aggregate: { value: 6 },
    },
  });
  t.ok(t.b, 'views.query', args);
  t.ok(t.b, 'views.query', { ...args, offset: 1 });
  expect(
    t.r.state.experiences[t.b]!.filter((e) => e.summary.startsWith('views.query succeeded')),
  ).toHaveLength(2);
  expect(t.r.state.world).toEqual(world);
  expect(t.r.state.sharedRecords).toEqual(records);
  expect(JSON.stringify(t.r.context(t.c))).not.toContain('我定义的目录');
  t.replay();
});
test('public view metadata and aggregates cannot expose a private source; revocation applies to previously authorized readers', () => {
  const t = setup();
  t.seed();
  expect(t.ok(t.c, 'views.list', {})).toMatchObject({ data: { total: 0 } });
  expect(t.call(t.c, 'views.query', { id: 'directory', expectedRevision: 1 })).toMatchObject({
    ok: false,
    error: 'view-not-found',
  });
  t.ok(t.a, 'registers.configure', {
    id: 'notes',
    expectedRevision: 1,
    visibility: 'private',
    readers: [t.b],
    editors: [],
  });
  expect(t.ok(t.b, 'views.read', { id: 'directory' }).ok).toBe(true);
  t.ok(t.a, 'registers.configure', {
    id: 'notes',
    expectedRevision: 2,
    visibility: 'private',
    readers: [],
    editors: [],
  });
  expect(t.call(t.b, 'views.history', { id: 'directory' })).toMatchObject({
    ok: false,
    error: 'view-not-found',
  });
  expect(t.call(t.b, 'views.query', { id: 'directory', expectedRevision: 1 })).toMatchObject({
    ok: false,
    error: 'view-not-found',
  });
  t.replay();
});
test('old manifests require explicit idempotent enabling and preserve their original bytes on replay', () => {
  const t = setup(false),
    bytes = readFileSync(join(t.root, 'manifest.json'));
  expect(t.r.state.recordViews).toBeUndefined();
  expect(t.call(t.a, 'views.list', {})).toMatchObject({
    ok: false,
    error: 'record-views-not-enabled',
  });
  const result = t.r.enableRecordViews();
  expect(result.ok).toBe(true);
  expect(t.r.enableRecordViews()).toEqual(result);
  expect(
    t.r.journal.commits.filter((c) => c.capability === 'system.enable-record-views'),
  ).toHaveLength(1);
  t.seed();
  expect(readFileSync(join(t.root, 'manifest.json'))).toEqual(bytes);
  t.replay();
});
test('oversized view originals are not silently truncated into a false reading receipt', () => {
  const t = setup();
  t.ok(t.a, 'registers.create', {
    id: 'large',
    title: '大原文',
    visibility: 'public',
    readers: [],
    editors: [],
    fields: { a: 'string', b: 'string', c: 'string', d: 'string' },
  });
  for (let i = 0; i < Math.ceil(t.r.manifest.policy.maxResultChars / 7600) + 1; i++)
    t.ok(t.a, 'records.put', {
      registerId: 'large',
      key: `row-${i}`,
      expectedRevision: 0,
      values: {
        a: 'x'.repeat(1900),
        b: 'y'.repeat(1900),
        c: 'z'.repeat(1900),
        d: 'w'.repeat(1900),
      },
    });
  t.ok(t.a, 'views.publish', {
    id: 'large-view',
    title: '原文展开',
    visibility: 'public',
    readers: [],
    definition: { sourceRegisterId: 'large', select: ['a', 'b', 'c', 'd'] },
  });
  const count = t.r.state.experiences[t.b]?.length ?? 0;
  expect(t.call(t.b, 'views.query', { id: 'large-view', expectedRevision: 1 })).toMatchObject({
    ok: false,
    error: 'read-result-too-large',
  });
  expect(t.r.state.experiences[t.b]?.length ?? 0).toBe(count);
  expect(t.ok(t.b, 'views.query', { id: 'large-view', expectedRevision: 1, limit: 1 }).ok).toBe(
    true,
  );
});
