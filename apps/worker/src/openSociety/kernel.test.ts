import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { OpenSocietyRuntime } from './runtime';
import { createOpenSocietyManifest } from './manifest';
import { OPEN_SOCIETY_TOOLS } from './catalog';
import { capabilityRuleIds } from './rulebook';
const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const f of cleanup.reverse()) f();
  cleanup.length = 0;
});
function setup(enabled = true) {
  const root = mkdtempSync(join(tmpdir(), 'society-kernel-'));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const r = new OpenSocietyRuntime(
    root,
    createOpenSocietyManifest({ count: 4, societyKernel: enabled }),
  );
  cleanup.push(() => r.close());
  const [a, b, c, outsider] = r.manifest.residents.map((v) => v.id) as [
    string,
    string,
    string,
    string,
  ];
  let ordinal = 0;
  const call = (
    actor: string,
    name: string,
    args: Record<string, unknown>,
    requestId = `req-${++ordinal}`,
  ) => {
    r.beginTurn(actor);
    const result = r.invoke(actor, { name, arguments: args, requestId });
    r.finishTurn(actor, { summary: 'test' });
    return result;
  };
  const ok = (actor: string, name: string, args: Record<string, unknown>, requestId?: string) => {
    const result = call(actor, name, args, requestId);
    expect(result.ok, `${name}: ${result.error}`).toBe(true);
    return result;
  };
  const replay = () => {
    const state = structuredClone(r.state),
      bytes = readFileSync(join(root, 'journal.jsonl'));
    r.close();
    const reopened = new OpenSocietyRuntime(root);
    cleanup.push(() => reopened.close());
    expect(reopened.state).toEqual(state);
    expect(readFileSync(join(root, 'journal.jsonl'))).toEqual(bytes);
  };
  const define = (invalidRecord = false) => {
    ok(b, 'registers.create', {
      id: 'ledger',
      title: '我们的共同记录',
      visibility: 'private',
      readers: [c],
      editors: [],
      fields: { statement: 'string' },
    });
    ok(a, 'programs.publish', {
      id: 'coop',
      title: '自愿合作',
      purpose: '原文约定不自行扣钱',
      runners: [a],
      definition: {
        steps: [
          {
            principalId: b,
            capability: 'payments.transfer',
            arguments: { targetId: c, amount: 7, note: '自愿支付' },
          },
          {
            principalId: b,
            capability: 'records.append',
            arguments: {
              registerId: 'ledger',
              values: invalidRecord ? { wrong: true } : { statement: '我们的记录，不是系统认证' },
            },
          },
          {
            principalId: b,
            capability: 'messages.send',
            arguments: { recipientId: c, content: '这是我授权发送的原话' },
          },
        ],
      },
    });
  };
  const grant = (count = 3, expiresAt = 300_000) =>
    ok(b, 'mandates.grant', {
      id: 'consent',
      programId: 'coop',
      programRevision: 1,
      runnerId: a,
      maxRuns: count,
      expiresAt,
    });
  return { r, root, a, b, c, outsider, call, ok, replay, define, grant };
}
test('all capabilities have rule ownership; raw records and procedures are not forced into normal context', () => {
  for (const tool of OPEN_SOCIETY_TOOLS) expect(capabilityRuleIds(tool).length).toBeGreaterThan(0);
  expect(
    capabilityRuleIds(OPEN_SOCIETY_TOOLS.find((t) => t.name === 'world.build_housing')!),
  ).toContain('housing');
  const t = setup();
  t.define();
  expect(t.ok(t.a, 'rules.read', { id: 'resident-programs' }).data).toMatchObject({
    enabled: true,
    kind: 'resident-institution',
  });
  const context = t.r.context(t.outsider);
  expect(JSON.stringify(context)).not.toContain('我们的共同记录');
  expect(t.call(t.outsider, 'registers.read', { id: 'ledger' })).toMatchObject({
    ok: false,
    error: 'record-not-found',
  });
  expect(t.call(t.outsider, 'programs.read', { id: 'coop' })).toMatchObject({
    ok: false,
    error: 'program-not-found',
  });
});
test('delegated payment, shared record and original message commit atomically with real provenance, bounded uses and idempotency', () => {
  const t = setup();
  t.define();
  expect(t.call(t.a, 'programs.run', { id: 'coop', expectedRevision: 1 })).toMatchObject({
    ok: false,
    error: 'program-mandate-required',
  });
  t.grant();
  const beforeB = t.r.state.world.agents[t.b]!.balance,
    beforeC = t.r.state.world.agents[t.c]!.balance,
    supply = t.r.state.world.moneySupply;
  const result = t.ok(t.a, 'programs.run', { id: 'coop', expectedRevision: 1 }, 'one-run');
  expect(t.r.state.world.agents[t.b]!.balance).toBe(beforeB - 7);
  expect(t.r.state.world.agents[t.c]!.balance).toBe(beforeC + 7);
  expect(t.r.state.world.moneySupply).toBe(supply);
  expect(t.r.state.coordination!.mandates.consent!.usedRuns).toBe(1);
  expect(Object.values(t.r.state.sharedRecords!.records)[0]).toMatchObject({
    editedBy: t.a,
    authorityId: t.b,
  });
  expect(Object.values(t.r.state.information.messages)[0]).toMatchObject({
    senderId: t.b,
    executedBy: t.a,
    mandateId: 'consent',
    content: '这是我授权发送的原话',
  });
  expect(t.ok(t.a, 'programs.run', { id: 'coop', expectedRevision: 1 }, 'one-run')).toEqual(result);
  expect(t.r.state.world.agents[t.b]!.balance).toBe(beforeB - 7);
  const commit = t.r.journal.commits.find((c) => c.requestId === 'one-run')!;
  expect(commit.worldEvents?.length).toBeGreaterThan(0);
  expect(commit.sharedRecordsEvents).toHaveLength(1);
  expect(commit.informationEvents).toHaveLength(1);
  expect(
    t.r.state.experiences[t.b]?.some((e) => e.summary.includes('authorized-program-execution')),
  ).toBe(true);
  t.replay();
});
test('late domain rejection rolls back payment, record, message and usage; ACL changes are rechecked', () => {
  const t = setup();
  t.define(true);
  t.grant();
  const before = structuredClone(t.r.state.world);
  expect(t.call(t.a, 'programs.run', { id: 'coop', expectedRevision: 1 })).toMatchObject({
    ok: false,
    error: 'invalid-record-values',
  });
  expect(t.r.state.world).toEqual(before);
  expect(Object.keys(t.r.state.sharedRecords!.records)).toHaveLength(0);
  expect(Object.keys(t.r.state.information.messages)).toHaveLength(0);
  expect(t.r.state.coordination!.mandates.consent!.usedRuns).toBe(0);
  expect(Object.values(t.r.state.coordination!.runs)[0]?.status).toBe('failed');
  t.replay();
});
test('scheduled procedures preserve cadence across large and segmented advances and do not execute during replay', () => {
  const run = (segmented: boolean) => {
    const t = setup();
    t.define();
    t.grant(2);
    t.ok(t.a, 'programs.schedule', {
      id: 'every',
      programId: 'coop',
      programRevision: 1,
      startAt: 60_000,
      intervalMs: 60_000,
      runs: 2,
    });
    if (segmented) {
      expect(t.r.advanceTime(60_000, 'time-1').ok).toBe(true);
      expect(t.r.advanceTime(60_000, 'time-2').ok).toBe(true);
    } else expect(t.r.advanceTime(120_000, 'time-all').ok).toBe(true);
    const result = {
      coordination: t.r.state.coordination,
      records: t.r.state.sharedRecords,
      messages: t.r.state.information.messages,
      balances: Object.values(t.r.state.world.agents).map((a) => a.balance),
      supply: t.r.state.world.moneySupply,
    };
    expect(t.r.state.coordination!.schedules.every).toMatchObject({
      status: 'completed',
      completedRuns: 2,
    });
    expect(t.r.state.coordination!.mandates.consent!.usedRuns).toBe(2);
    expect(Object.values(t.r.state.sharedRecords!.records)).toHaveLength(2);
    t.replay();
    return result;
  };
  expect(run(false)).toEqual(run(true));
});
test('revocation stops scheduled work; cancellation prevents later runs, and old manifests opt in without rewriting their bytes', () => {
  const t = setup();
  t.define();
  t.grant();
  t.ok(t.a, 'programs.schedule', {
    id: 'every',
    programId: 'coop',
    programRevision: 1,
    startAt: 60_000,
    intervalMs: 60_000,
    runs: 2,
  });
  t.ok(t.b, 'mandates.revoke', { id: 'consent', expectedRevision: 1 });
  expect(t.r.advanceTime(120_000, 'time').ok).toBe(true);
  expect(t.r.state.coordination!.schedules.every?.status).toBe('failed');
  expect(t.r.state.coordination!.mandates.consent?.usedRuns).toBe(0);
  expect(Object.values(t.r.state.sharedRecords!.records)).toHaveLength(0);
  t.replay();
  const old = setup(false),
    bytes = readFileSync(join(old.root, 'manifest.json'));
  expect(old.r.state.sharedRecords).toBeUndefined();
  expect(old.r.enableSocietyKernel().ok).toBe(true);
  const first = old.r.enableSocietyKernel();
  expect(old.r.enableSocietyKernel()).toEqual(first);
  expect(old.r.state.coordination).toBeDefined();
  expect(readFileSync(join(old.root, 'manifest.json'))).toEqual(bytes);
  old.replay();
});

test('every resource owner must consent; late insufficient funds cannot partially settle a multi-principal program', () => {
  const t = setup();
  t.ok(t.a, 'programs.publish', {
    id: 'joint',
    title: '共同支出',
    purpose: '各自决定',
    runners: [t.a],
    definition: {
      steps: [
        {
          principalId: t.b,
          capability: 'payments.transfer',
          arguments: { targetId: t.a, amount: 1, note: 'first' },
        },
        {
          principalId: t.c,
          capability: 'payments.transfer',
          arguments: { targetId: t.a, amount: 1_000_000, note: 'unfunded' },
        },
      ],
    },
  });
  t.ok(t.b, 'mandates.grant', {
    id: 'b-grant',
    programId: 'joint',
    programRevision: 1,
    runnerId: t.a,
    maxRuns: 1,
    expiresAt: 1000,
  });
  expect(t.call(t.a, 'programs.run', { id: 'joint', expectedRevision: 1 }).error).toBe(
    'program-mandate-required',
  );
  t.ok(t.c, 'mandates.grant', {
    id: 'c-grant',
    programId: 'joint',
    programRevision: 1,
    runnerId: t.a,
    maxRuns: 1,
    expiresAt: 1000,
  });
  const before = structuredClone(t.r.state.world);
  expect(t.call(t.a, 'programs.run', { id: 'joint', expectedRevision: 1 }).ok).toBe(false);
  expect(t.r.state.world).toEqual(before);
  expect(Object.values(t.r.state.coordination!.mandates).every((m) => m.usedRuns === 0)).toBe(true);
  t.replay();
});

test('handover revokes former owner access even through a live mandate; exact read versions are remembered once', () => {
  const t = setup();
  t.define();
  t.grant();
  t.ok(t.a, 'programs.run', { id: 'coop', expectedRevision: 1 });
  const record = Object.values(t.r.state.sharedRecords!.records)[0]!;
  t.ok(t.c, 'records.read', { registerId: 'ledger', key: record.key });
  t.ok(t.c, 'records.read', { registerId: 'ledger', key: record.key });
  expect(
    t.r.state.experiences[t.c]!.filter((e) => e.summary.startsWith('records.read')),
  ).toHaveLength(1);
  t.ok(t.b, 'registers.nominate', { id: 'ledger', expectedRevision: 1, successorId: t.c });
  t.ok(t.c, 'registers.accept', { id: 'ledger', expectedRevision: 2 });
  const world = structuredClone(t.r.state.world);
  expect(t.call(t.a, 'programs.run', { id: 'coop', expectedRevision: 1 }).error).toBe(
    'record-not-found',
  );
  expect(t.r.state.world).toEqual(world);
  expect(t.r.state.coordination!.mandates.consent!.usedRuns).toBe(1);
  expect(t.call(t.b, 'records.history', { registerId: 'ledger', key: record.key }).ok).toBe(false);
  t.replay();
});

test('schedule cancellation and advance budgets are atomic; changing a program invalidates scheduled authority', () => {
  const t = setup();
  t.define();
  t.grant(100);
  for (const id of ['first', 'second'])
    t.ok(t.a, 'programs.schedule', {
      id,
      programId: 'coop',
      programRevision: 1,
      startAt: 60_000,
      intervalMs: 60_000,
      runs: 100,
    });
  const before = structuredClone(t.r.state);
  expect(t.r.advanceTime(6_000_000, 'too-many')).toMatchObject({
    ok: false,
    error: 'program-advance-budget-exceeded',
  });
  expect(t.r.state).toEqual(before);
  t.ok(t.a, 'programs.cancel', { id: 'second', expectedRevision: 1 });
  t.ok(t.a, 'programs.disable', { id: 'coop', expectedRevision: 1 });
  expect(t.r.advanceTime(120_000, 'advance').ok).toBe(true);
  expect(t.r.state.coordination!.schedules.first?.status).toBe('failed');
  expect(t.r.state.coordination!.schedules.second?.status).toBe('cancelled');
  expect(Object.values(t.r.state.coordination!.runs)).toHaveLength(1);
  t.replay();
});
