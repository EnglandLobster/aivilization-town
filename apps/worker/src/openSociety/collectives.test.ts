import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { createOpenSocietyManifest } from './manifest';
import { OpenSocietyRuntime } from './runtime';
const clean: (() => void)[] = [];
afterEach(() => {
  for (const f of clean.reverse()) f();
  clean.length = 0;
});
function setup(enabled = true) {
  const root = mkdtempSync(join(tmpdir(), 'resident-collectives-'));
  clean.push(() => rmSync(root, { recursive: true, force: true }));
  const r = new OpenSocietyRuntime(
    root,
    createOpenSocietyManifest({ count: 4, collectives: enabled }),
  );
  clean.push(() => r.close());
  const [a, b, c, d] = r.manifest.residents.map((x) => x.id) as [string, string, string, string];
  let seq = 0;
  const call = (
    actor: string,
    name: string,
    args: Record<string, unknown>,
    requestId = `c-${++seq}`,
  ) => {
    r.beginTurn(actor);
    const result = r.invoke(actor, { name, arguments: args, requestId });
    r.finishTurn(actor, { summary: 'Collective acceptance' });
    return result;
  };
  const ok = (actor: string, name: string, args: Record<string, unknown>, requestId?: string) => {
    const v = call(actor, name, args, requestId);
    expect(v.ok, `${name}: ${v.error}`).toBe(true);
    return v;
  };
  const configuration = {
    title: '自行组织的共同事务',
    terms: '旧程序是全体两人同意',
    members: [a, b],
    voters: [a, b],
    threshold: 2,
    quorum: 2,
    timing: 'early',
    revote: true,
  };
  const create = (extra: Record<string, unknown> = {}) => {
    ok(a, 'collectives.create', {
      id: 'club',
      configuration: { ...configuration, ...extra },
      expiresAt: r.state.world.clock.now + 10000,
    });
    ok(b, 'collectives.respond', { id: 'club', expectedRevision: 1, accept: true });
  };
  const propose = (
    id = 'change',
    action: unknown = {
      kind: 'amend',
      configuration: { ...configuration, title: '自己选择的名称' },
    },
  ) =>
    ok(a, 'collectives.propose', {
      id,
      collectiveId: 'club',
      expectedVersion: 1,
      terms: '提案原文',
      action,
      closesAt: r.state.world.clock.now + 1000,
      executeBefore: r.state.world.clock.now + 2000,
    });
  const pass = (id = 'change') => {
    ok(a, 'collectives.vote', { id, expectedRevision: 1, vote: 'yes' });
    ok(b, 'collectives.vote', { id, expectedRevision: 2, vote: 'yes' });
    ok(a, 'collectives.decide', { id, expectedRevision: 3 });
  };
  const replay = () => {
    const state = structuredClone(r.state),
      bytes = readFileSync(join(root, 'journal.jsonl'));
    r.close();
    const n = new OpenSocietyRuntime(root);
    clean.push(() => n.close());
    expect(n.state).toEqual(state);
    expect(readFileSync(join(root, 'journal.jsonl'))).toEqual(bytes);
  };
  return { r, root, a, b, c, d, call, ok, configuration, create, propose, pass, replay };
}
test('independent resident decisions update a charter atomically; statements and titles never change world assets', () => {
  const t = setup();
  const world = structuredClone(t.r.state.world);
  t.create();
  t.propose();
  t.pass();
  const result = t.ok(t.b, 'collectives.execute', { id: 'change', expectedRevision: 4 }, 'once');
  expect(t.r.state.collectives!.charters.club).toMatchObject({
    title: '自己选择的名称',
    version: 2,
    authorityDecisionId: 'change',
  });
  expect(t.ok(t.b, 'collectives.execute', { id: 'change', expectedRevision: 4 }, 'once')).toEqual(
    result,
  );
  const commit = t.r.journal.commits.find((v) => v.actorId === t.b && v.requestId === 'once')!;
  expect(commit.collectiveEvents?.map((e) => e.type)).toEqual([
    'CollectiveCharterChanged',
    'CollectiveDecisionChanged',
  ]);
  expect(commit.worldEvents).toBeUndefined();
  expect(t.r.state.world).toEqual(world);
  expect(t.call(t.b, 'collectives.execute', { id: 'change', expectedRevision: 5 }).error).toBe(
    'passed-decision-required',
  );
  t.replay();
});
test('new joining is personal, private originals are bounded and a new member cannot read old charter history', () => {
  const t = setup();
  t.create();
  t.propose('change', {
    kind: 'amend',
    configuration: {
      ...t.configuration,
      members: [t.a, t.b, t.c],
      voters: [t.c],
      threshold: 1,
      quorum: 1,
    },
  });
  t.pass();
  expect(
    t.call(t.a, 'collectives.join', { id: 'change', expectedRevision: 4, accept: true }).error,
  ).toBe('invited-member-required');
  expect(t.call(t.b, 'collectives.execute', { id: 'change', expectedRevision: 4 }).error).toBe(
    'new-member-consent-required',
  );
  expect(t.ok(t.d, 'collectives.list', {})).toMatchObject({ data: { total: 0 } });
  expect(t.call(t.d, 'collectives.decision', { id: 'change' }).error).toBe('decision-not-found');
  expect(t.call(t.d, 'collectives.read', { id: 'constructor' }).error).toBe('reserved-record-id');
  t.ok(t.c, 'collectives.decision', { id: 'change' });
  t.ok(t.c, 'collectives.join', { id: 'change', expectedRevision: 4, accept: true });
  t.ok(t.a, 'collectives.execute', { id: 'change', expectedRevision: 5 });
  expect(t.ok(t.c, 'collectives.history', { id: 'club' })).toMatchObject({
    data: { total: 1, items: [{ version: 2 }] },
  });
  const args = { id: 'club' };
  t.ok(t.c, 'collectives.read', args);
  t.ok(t.c, 'collectives.read', args);
  expect(
    t.r.state.experiences[t.c]!.filter(
      (e) =>
        e.summary.startsWith('collectives.read succeeded') ||
        e.summary.startsWith('collectives.history succeeded'),
    ),
  ).toHaveLength(1);
  expect(JSON.stringify(t.r.context(t.d))).not.toContain('旧程序是全体两人同意');
  t.replay();
});
test('exiting cannot retain future private membership or silently appoint a successor', () => {
  const t = setup();
  t.create({ threshold: 1, quorum: 1 });
  t.propose('old', { kind: 'statement' });
  t.ok(t.b, 'collectives.leave', { id: 'club', expectedRevision: 2 });
  expect(t.call(t.b, 'collectives.read', { id: 'club' }).error).toBe('collective-not-found');
  t.ok(t.a, 'collectives.propose', {
    id: 'new',
    collectiveId: 'club',
    expectedVersion: 2,
    terms: '未来私密提案',
    action: { kind: 'statement' },
    closesAt: t.r.state.world.clock.now + 1000,
    executeBefore: t.r.state.world.clock.now + 2000,
  });
  expect(t.ok(t.b, 'collectives.decisions', { collectiveId: 'club' })).toMatchObject({
    data: { items: [{ id: 'old' }], total: 1 },
  });
  expect(t.call(t.b, 'collectives.decision', { id: 'new' }).error).toBe('decision-not-found');
  t.ok(t.a, 'collectives.leave', { id: 'club', expectedRevision: 3 });
  expect(t.r.state.collectives!.charters.club).toMatchObject({
    members: [],
    voters: [],
    threshold: 1,
  });
  t.replay();
});
test('unsupported resource actions reject before any authority or world mutation', () => {
  const t = setup();
  t.create();
  const before = structuredClone(t.r.state.collectives);
  expect(
    t.call(t.a, 'collectives.propose', {
      id: 'bad',
      collectiveId: 'club',
      expectedVersion: 1,
      terms: '支出',
      action: {
        kind: 'resource',
        capability: 'funds.mint',
        resourceId: 'pool',
        arguments: { amount: 10, targetId: t.b },
      },
      closesAt: t.r.state.world.clock.now + 1000,
      executeBefore: t.r.state.world.clock.now + 2000,
    }).error,
  ).toBe('unsupported-or-invalid-common-account-action');
  expect(t.r.state.collectives).toEqual(before);
  t.replay();
});
test('deadline scheduler has equal collective effects for large and segmented time advances; no background execution', () => {
  const one = setup(),
    many = setup();
  for (const t of [one, many]) {
    t.create({ timing: 'deadline' });
    t.propose();
    t.ok(t.a, 'collectives.vote', { id: 'change', expectedRevision: 1, vote: 'yes' });
    t.ok(t.b, 'collectives.vote', { id: 'change', expectedRevision: 2, vote: 'yes' });
  }
  expect(one.r.advanceTime(2500, 'all').ok).toBe(true);
  expect(many.r.advanceTime(1000, 'first').ok).toBe(true);
  expect(many.r.state.collectives!.decisions.change!.status).toBe('passed');
  expect(many.r.advanceTime(1000, 'second').ok).toBe(true);
  expect(many.r.advanceTime(500, 'third').ok).toBe(true);
  expect(one.r.state.collectives).toEqual(many.r.state.collectives);
  expect(one.r.state.collectives!.charters.club!.version).toBe(1);
  const es = (t: ReturnType<typeof setup>) =>
    t.r.journal.commits
      .filter((c) => c.capability === 'system.advance-time')
      .flatMap((c) => c.collectiveEvents ?? []);
  expect(es(one)).toEqual(es(many));
  one.replay();
  many.replay();
});
