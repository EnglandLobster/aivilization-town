import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import {
  PROGRAM_REACTIONS_POLICY,
  type ProgramCondition,
  type ProgramReactionsPolicy,
  pendingProgramReactions,
} from '@aivilization/collaboration';
import { createOpenSocietyManifest } from './manifest';
import { OpenSocietyRuntime } from './runtime';
import { ProgramReactionRuntime } from './reactionRuntime';
const clean: (() => void)[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const f of clean.reverse()) f();
  clean.length = 0;
});
function setup(policy: Partial<ProgramReactionsPolicy> = {}, enabled = true) {
  const root = mkdtempSync(join(tmpdir(), 'resident-reactions-'));
  clean.push(() => rmSync(root, { recursive: true, force: true }));
  const manifest = createOpenSocietyManifest({ count: 3, programReactions: enabled });
  const r = new OpenSocietyRuntime(root, {
    ...manifest,
    ...(enabled ? { programReactionsPolicy: { ...PROGRAM_REACTIONS_POLICY, ...policy } } : {}),
  });
  clean.push(() => r.close());
  const [a, b, c] = r.manifest.residents.map((v) => v.id) as [string, string, string];
  let n = 0;
  const call = (actor: string, name: string, args: Record<string, unknown>) => {
    r.beginTurn(actor);
    const result = r.invoke(actor, { name, arguments: args, requestId: `react-${++n}` });
    r.finishTurn(actor, { summary: 'Event coordination verification' });
    return result;
  };
  const ok = (actor: string, name: string, args: Record<string, unknown>) => {
    const res = call(actor, name, args);
    expect(res.ok, `${name}: ${res.error}`).toBe(true);
    return res;
  };
  const register = (privateSource = false) =>
    ok(b, 'registers.create', {
      id: 'claims',
      title: '居民自己维护的依据',
      visibility: privateSource ? 'private' : 'public',
      readers: privateSource ? [a] : [],
      editors: [],
      fields: { ready: 'boolean' },
    });
  const put = (ready: boolean, key = 'result') =>
    ok(b, 'records.put', {
      registerId: 'claims',
      key,
      expectedRevision: r.state.sharedRecords!.records[`claims/${key}`]?.revision ?? 0,
      values: { ready },
    });
  const condition: ProgramCondition = {
    source: {
      kind: 'statement',
      registerId: 'claims',
      key: 'result',
      revision: 'latest',
      field: 'ready',
      signerId: b,
    },
    op: 'eq',
    value: true,
  };
  const step = {
    principalId: a,
    capability: 'payments.transfer',
    arguments: { targetId: c, amount: 3, note: '只按本人的预先授权' },
  };
  const publish = (
    conditions: readonly ProgramCondition[] = [condition],
    steps: readonly unknown[] = [step],
    actor = a,
    id = 'p',
    maxRuns = 20,
  ) => {
    ok(actor, 'programs.publish', {
      id,
      title: '自主定义响应',
      purpose: '居民自己选择条件和有限步骤',
      runners: [actor],
      definition: { conditions, steps },
    });
    ok(actor, 'mandates.grant', {
      id: `m-${id}`,
      programId: id,
      programRevision: 1,
      runnerId: actor,
      maxRuns,
      expiresAt: r.state.world.clock.now + 500000,
    });
  };
  const watch = (
    maxReactions = 3,
    actor = a,
    programId = 'p',
    id = 'w',
    expiresAt = r.state.world.clock.now + 100000,
  ) => ok(actor, 'reactions.watch', { id, programId, programRevision: 1, maxReactions, expiresAt });
  const replay = () => {
    const state = structuredClone(r.state),
      bytes = readFileSync(join(root, 'journal.jsonl'));
    r.close();
    const next = new OpenSocietyRuntime(root);
    clean.push(() => next.close());
    expect(next.state).toEqual(state);
    expect(readFileSync(join(root, 'journal.jsonl'))).toEqual(bytes);
    return next;
  };
  return { r, root, a, b, c, call, ok, register, put, publish, watch, condition, step, replay };
}
test('a committed signed change runs authorized payment once; queue and origin, settlement and run are atomic', () => {
  const t = setup();
  t.register();
  t.put(false);
  t.publish();
  t.watch();
  const before = t.r.state.world.agents[t.a]!.balance;
  expect(Object.values(t.r.state.coordination!.runs)).toHaveLength(0);
  const receipt = t.put(true);
  expect(t.r.state.world.agents[t.a]!.balance).toBe(before - 3);
  expect(t.r.state.coordination!.mandates['m-p']!.usedRuns).toBe(1);
  const origin = t.r.journal.commits.find((v) => v.sequence === receipt.revision)!;
  expect(origin.sharedRecordsEvents).toHaveLength(1);
  expect(origin.coordinationEvents?.find((e) => e.type === 'ProgramReactionChanged')).toMatchObject(
    {
      type: 'ProgramReactionChanged',
      reaction: { sourceSequence: origin.sequence, status: 'pending' },
    },
  );
  const execution = t.r.journal.commits.find((v) => v.capability === 'system.program-reaction')!;
  expect(execution.worldEvents?.length).toBeGreaterThan(0);
  expect(
    execution.coordinationEvents?.find((e) => e.type === 'ProgramReactionChanged'),
  ).toMatchObject({ type: 'ProgramReactionChanged', reaction: { status: 'succeeded' } });
  expect(Object.values(t.r.state.coordination!.runs)[0]).toMatchObject({
    reactionId: 'w:1',
    status: 'succeeded',
  });
  const read = t.ok(t.a, 'reactions.read', { id: 'w' });
  expect(read.data).not.toHaveProperty('sourceToken');
  t.ok(t.b, 'payments.transfer', { targetId: t.c, amount: 1, note: '无关交易' });
  expect(t.r.state.coordination!.reactions!.watches.w!.enqueued).toBe(1);
  expect(t.call(t.c, 'reactions.read', { id: 'w' }).error).toBe('watch-not-found');
  const next = t.replay();
  expect(next.resumeReactions()).toEqual({ processed: 0, pending: 0 });
});
test('false conditions record skipped checks without consuming mandates; later true changes still work', () => {
  const t = setup();
  t.register();
  t.put(false);
  t.publish();
  t.watch(2);
  const before = t.r.state.world.agents[t.a]!.balance;
  t.put(false);
  expect(t.r.state.coordination!.reactions!.reactions['w:1']?.status).toBe('skipped');
  expect(t.r.state.coordination!.mandates['m-p']!.usedRuns).toBe(0);
  t.put(true);
  expect(t.r.state.coordination!.reactions!.watches.w).toMatchObject({
    status: 'completed',
    enqueued: 2,
    completed: 2,
    succeeded: 1,
  });
  t.put(true);
  expect(t.r.state.world.agents[t.a]!.balance).toBe(before - 3);
  t.replay();
});
test.each(['permission', 'program', 'mandate'])(
  'losing %s stops a watch without extra payment or leaking source values',
  (kind) => {
    const t = setup();
    t.register(true);
    t.put(true);
    t.publish();
    t.watch();
    const before = t.r.state.world.agents[t.a]!.balance;
    if (kind === 'permission')
      t.ok(t.b, 'registers.configure', {
        id: 'claims',
        expectedRevision: 1,
        visibility: 'private',
        readers: [],
        editors: [],
      });
    else if (kind === 'program')
      t.ok(t.a, 'programs.revise', {
        id: 'p',
        expectedRevision: 1,
        title: '新规则',
        purpose: '新版本另需授权',
        runners: [t.a],
        definition: { conditions: [t.condition], steps: [t.step] },
      });
    else t.ok(t.a, 'mandates.revoke', { id: 'm-p', expectedRevision: 1 });
    expect(t.r.state.coordination!.reactions!.watches.w?.status).toBe('failed');
    expect(t.r.state.world.agents[t.a]!.balance).toBe(before);
    const run = Object.values(t.r.state.coordination!.runs)[0]!;
    expect(run).not.toHaveProperty('conditionEvidence');
    expect(t.r.state.coordination!.mandates['m-p']!.usedRuns).toBe(0);
    const history = t.ok(t.a, 'reactions.history', { id: 'w', limit: 1 });
    expect(JSON.stringify(history.data)).not.toContain('sourceToken');
    t.replay();
  },
);
test('failure of a later business step rolls back earlier transfer and stops the watch', () => {
  const t = setup();
  t.register();
  t.put(false);
  t.publish(
    [t.condition],
    [t.step, { ...t.step, arguments: { ...t.step.arguments, amount: 1000000 } }],
  );
  t.watch();
  const before = t.r.state.world.agents[t.a]!.balance;
  t.put(true);
  expect(t.r.state.world.agents[t.a]!.balance).toBe(before);
  expect(t.r.state.coordination!.reactions!.watches.w?.status).toBe('failed');
  expect(t.r.state.coordination!.mandates['m-p']!.usedRuns).toBe(0);
  const execution = t.r.journal.commits.find((v) => v.capability === 'system.program-reaction')!;
  expect(execution.worldEvents ?? []).toHaveLength(0);
  t.replay();
});
test('source commit survives interruption; replay does not execute, and explicit recovery cannot double-spend', () => {
  const t = setup();
  t.register();
  t.put(false);
  t.publish();
  t.watch();
  const before = t.r.state.world.agents[t.a]!.balance;
  const stall = vi
    .spyOn(ProgramReactionRuntime.prototype, 'resume')
    .mockReturnValue({ processed: 0, pending: 1 });
  t.put(true);
  expect(t.r.state.world.agents[t.a]!.balance).toBe(before);
  expect(pendingProgramReactions(t.r.state.coordination!.reactions!)).toHaveLength(1);
  stall.mockRestore();
  const next = t.replay();
  expect(next.resumeReactions()).toEqual({ processed: 1, pending: 0 });
  expect(next.state.world.agents[t.a]!.balance).toBe(before - 3);
  const bytes = readFileSync(join(t.root, 'journal.jsonl'));
  expect(next.resumeReactions()).toEqual({ processed: 0, pending: 0 });
  next.close();
  const again = new OpenSocietyRuntime(t.root);
  clean.push(() => again.close());
  expect(again.state.world.agents[t.a]!.balance).toBe(before - 3);
  expect(again.resumeReactions().processed).toBe(0);
  expect(readFileSync(join(t.root, 'journal.jsonl'))).toEqual(bytes);
});
test('pending historical changes use current facts, each gets an explicit skipped receipt', () => {
  const t = setup();
  t.register();
  t.put(false);
  t.publish();
  t.watch();
  const before = t.r.state.world.agents[t.a]!.balance;
  const stall = vi
    .spyOn(ProgramReactionRuntime.prototype, 'resume')
    .mockReturnValue({ processed: 0, pending: 2 });
  const first = t.put(true),
    second = t.put(false);
  stall.mockRestore();
  expect(t.r.resumeReactions()).toEqual({ processed: 2, pending: 0 });
  const rows = Object.values(t.r.state.coordination!.reactions!.reactions);
  expect(rows.map((r) => r.sourceSequence)).toEqual([first.revision, second.revision]);
  expect(rows.map((r) => r.status)).toEqual(['skipped', 'skipped']);
  expect(t.r.state.world.agents[t.a]!.balance).toBe(before);
  t.replay();
});
test.each(['before', 'after'])(
  'interruption %s consumer persistence preserves atomic effects and recovers once',
  (stage) => {
    const t = setup();
    t.register();
    t.put(false);
    t.publish();
    t.watch(1);
    const before = t.r.state.world.agents[t.a]!.balance;
    const stall = vi
      .spyOn(ProgramReactionRuntime.prototype, 'resume')
      .mockReturnValue({ processed: 0, pending: 1 });
    t.put(true);
    stall.mockRestore();
    const commit = t.r.journal.commit.bind(t.r.journal);
    const fault = vi.spyOn(t.r.journal, 'commit').mockImplementation((input) => {
      if (input.capability === 'system.program-reaction') {
        if (stage === 'after') commit(input);
        throw new Error('injected-interruption');
      }
      return commit(input);
    });
    expect(() => t.r.resumeReactions()).toThrow('injected-interruption');
    fault.mockRestore();
    expect(t.r.state.world.agents[t.a]!.balance).toBe(stage === 'before' ? before : before - 3);
    const next = t.replay();
    expect(next.resumeReactions().processed).toBe(stage === 'before' ? 1 : 0);
    expect(next.state.world.agents[t.a]!.balance).toBe(before - 3);
    expect(next.state.coordination!.mandates['m-p']!.usedRuns).toBe(1);
  },
);
test('queue overload preserves source commits and reports a stopped watch instead of losing work silently', () => {
  const t = setup({ maxPending: 1 });
  t.register();
  t.put(false);
  t.publish();
  t.watch();
  const stall = vi
    .spyOn(ProgramReactionRuntime.prototype, 'resume')
    .mockReturnValue({ processed: 0, pending: 1 });
  t.put(true);
  const source = t.put(false);
  stall.mockRestore();
  expect(t.r.state.sharedRecords!.records['claims/result']!.revision).toBe(3);
  expect(t.r.state.coordination!.reactions!.watches.w).toMatchObject({
    status: 'failed',
    reason: 'reaction-queue-overloaded',
    stoppedAtSequence: source.revision,
    completed: 1,
  });
  expect(t.r.resumeReactions()).toEqual({ processed: 0, pending: 0 });
  expect(t.r.state.coordination!.mandates['m-p']!.usedRuns).toBe(0);
  t.replay();
});
test('mutually triggering independent residents stay bounded and preserve money with durable continuation', () => {
  const t = setup({ maxPerDrain: 2 });
  for (const [actor, target, id] of [
    [t.a, t.b, 'pa'],
    [t.b, t.a, 'pb'],
  ] as const) {
    t.publish(
      [
        {
          source: { kind: 'personal-fact', actorId: actor, field: 'balance' },
          op: 'gte',
          value: 0,
        },
      ],
      [
        {
          principalId: actor,
          capability: 'payments.transfer',
          arguments: { targetId: target, amount: 1, note: '本人有限授权' },
        },
      ],
      actor,
      id,
    );
    t.watch(5, actor, id, `w-${id}`);
  }
  t.r.beginTurn(t.c);
  const before = t.r.state.revision,
    supply = t.r.state.world.moneySupply;
  const res = t.r.invoke(t.c, {
    name: 'payments.transfer',
    arguments: { targetId: t.a, amount: 1, note: '启动变化' },
    requestId: 'start-loop',
  });
  expect(res.ok).toBe(true);
  expect(t.r.state.revision - before).toBe(3); // origin + one bounded drain of two
  expect(pendingProgramReactions(t.r.state.coordination!.reactions!).length).toBeGreaterThan(0);
  for (let i = 0; i < 10 && pendingProgramReactions(t.r.state.coordination!.reactions!).length; i++)
    expect(t.r.resumeReactions().processed).toBeLessThanOrEqual(2);
  expect(pendingProgramReactions(t.r.state.coordination!.reactions!)).toHaveLength(0);
  expect(Object.values(t.r.state.coordination!.reactions!.watches).map((w) => w.status)).toEqual([
    'completed',
    'completed',
  ]);
  expect(Object.values(t.r.state.coordination!.runs)).toHaveLength(10);
  expect(t.r.state.world.moneySupply).toBe(supply);
  t.replay();
});
test('view input revisions trigger actual aggregate conditions with no duplicate on reads', () => {
  const t = setup();
  t.register();
  t.put(false);
  t.ok(t.a, 'views.publish', {
    id: 'counts',
    title: '自己的统计',
    visibility: 'public',
    readers: [],
    definition: { sourceRegisterId: 'claims', select: ['ready'], aggregate: { op: 'count' } },
  });
  t.publish([{ source: { kind: 'view', viewId: 'counts', viewRevision: 1 }, op: 'gt', value: 1 }]);
  t.watch(1);
  t.put(false, 'second');
  expect(t.r.state.coordination!.reactions!.watches.w).toMatchObject({
    status: 'completed',
    succeeded: 1,
  });
  expect(Object.values(t.r.state.coordination!.runs)[0]!.conditionEvidence?.[0]?.sourceClass).toBe(
    'resident-computation',
  );
  t.replay();
});
test('cancellation consumes no unused mandates, and simulation expiry is independent of advance segmentation', () => {
  const t = setup();
  t.register();
  t.put(false);
  t.publish();
  t.watch();
  expect(t.call(t.b, 'reactions.cancel', { id: 'w', expectedRevision: 1 }).error).toBe(
    'watch-not-found',
  );
  t.ok(t.a, 'reactions.cancel', { id: 'w', expectedRevision: 1 });
  t.put(true);
  expect(t.r.state.coordination!.mandates['m-p']!.usedRuns).toBe(0);
  const run = (segments: number[]) => {
    const s = setup();
    s.register();
    s.put(false);
    s.publish();
    const start = s.r.state.world.clock.now;
    s.watch(3, s.a, 'p', 'w', start + 1000);
    for (const [i, ms] of segments.entries())
      expect(s.r.advanceTime(ms, `advance-${i}`).ok).toBe(true);
    expect(s.r.state.coordination!.reactions!.watches.w).toMatchObject({
      status: 'expired',
      at: start + 1000,
    });
    return s.r.journal.commits
      .flatMap((c) => c.coordinationEvents ?? [])
      .filter((e) => e.type === 'ProgramWatchChanged')
      .at(-1);
  };
  expect(run([2000])).toEqual(run([1000, 1000]));
});
test('old manifest explicit enable is idempotent; source access, exact admission, and read receipts remain bounded', () => {
  const t = setup({}, false),
    bytes = readFileSync(join(t.root, 'manifest.json'));
  expect(t.r.state.coordination).not.toHaveProperty('reactions');
  expect(t.call(t.a, 'reactions.list', {}).error).toBe('program-reactions-not-enabled');
  expect(t.r.enableProgramReactions().ok).toBe(true);
  const count = t.r.journal.commits.length;
  expect(t.r.enableProgramReactions().ok).toBe(true);
  expect(t.r.journal.commits).toHaveLength(count);
  expect(readFileSync(join(t.root, 'manifest.json'))).toEqual(bytes);
  t.register(true);
  t.put(false);
  t.publish();
  expect(
    t.call(t.a, 'reactions.watch', {
      id: 'bad',
      programId: 'p',
      programRevision: 2,
      maxReactions: 3,
      expiresAt: t.r.state.world.clock.now + 1000,
    }).error,
  ).toBe('program-version-inactive');
  t.watch(1);
  t.put(true);
  const before = t.r.state.experiences[t.a]!.length;
  const one = t.ok(t.a, 'reactions.history', { id: 'w', limit: 1 });
  expect(JSON.stringify(one.data)).not.toContain('sourceToken');
  const readCount = t.r.state.experiences[t.a]!.length;
  expect(readCount).toBeGreaterThan(before);
  t.ok(t.a, 'reactions.history', { id: 'w', limit: 1 });
  expect(t.r.state.experiences[t.a]!.length).toBe(readCount);
  t.replay();
});
