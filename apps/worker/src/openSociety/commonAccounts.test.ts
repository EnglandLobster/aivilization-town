import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { commonAccountsBalance } from '@aivilization/economy';
import { commerceEscrowBalance } from '@aivilization/commerce';
import { createEconomicCompositionPayload } from '../marketMetrics';
import { createOpenSocietyManifest } from './manifest';
import { OpenSocietyRuntime } from './runtime';
const clean: (() => void)[] = [];
afterEach(() => {
  for (const fn of clean.reverse()) fn();
  clean.length = 0;
});
function setup(enabled = true) {
  const root = mkdtempSync(join(tmpdir(), 'resident-funds-'));
  clean.push(() => rmSync(root, { recursive: true, force: true }));
  const r = new OpenSocietyRuntime(
    root,
    createOpenSocietyManifest({ count: 4, commonAccounts: enabled }),
  );
  clean.push(() => r.close());
  const [a, b, c, d] = r.manifest.residents.map((x) => x.id) as [string, string, string, string];
  let n = 0,
    m = 0;
  const call = (
    actor: string,
    name: string,
    args: Record<string, unknown>,
    requestId = `fund-${++n}`,
  ) => {
    r.beginTurn(actor);
    const result = r.invoke(actor, { name, arguments: args, requestId });
    r.finishTurn(actor, { summary: 'Common resource verification' });
    return result;
  };
  const ok = (actor: string, name: string, args: Record<string, unknown>, requestId?: string) => {
    const result = call(actor, name, args, requestId);
    expect(result.ok, `${name}: ${result.error}`).toBe(true);
    return result;
  };
  const configuration = {
    title: '自己决定共同资金用途',
    terms: '两人共同决定',
    members: [a, b],
    voters: [a, b],
    threshold: 2,
    quorum: 2,
    timing: 'early',
    revote: true,
  };
  const seed = () => {
    ok(a, 'collectives.create', {
      id: 'club',
      configuration,
      expiresAt: r.state.world.clock.now + 100000,
    });
    ok(b, 'collectives.respond', { id: 'club', expectedRevision: 1, accept: true });
    ok(a, 'funds.open', { id: 'pool', collectiveId: 'club', title: '居民共同账户' });
  };
  const contribute = (amount: number, actor = c, note = '自愿出资') =>
    ok(actor, 'funds.contribute', {
      id: 'pool',
      expectedRevision: r.state.world.commonAccounts!.accounts.pool!.revision,
      amount,
      note,
    });
  const approve = (capability: string, args: Record<string, unknown>, id = `decision-${++m}`) => {
    const charter = r.state.collectives!.charters.club!;
    ok(a, 'collectives.propose', {
      id,
      collectiveId: 'club',
      expectedVersion: charter.version,
      terms: '大家对这一个精确动作作决定',
      action: { kind: 'resource', capability, resourceId: 'pool', arguments: args },
      closesAt: r.state.world.clock.now + 10000,
      executeBefore: r.state.world.clock.now + 20000,
    });
    for (const voter of charter.voters)
      ok(voter, 'collectives.vote', {
        id,
        expectedRevision: r.state.collectives!.decisions[id]!.revision,
        vote: 'yes',
      });
    ok(a, 'collectives.decide', {
      id,
      expectedRevision: r.state.collectives!.decisions[id]!.revision,
    });
    return id;
  };
  const pay = (amount: number, recipient = { sector: 'agent', id: d }) =>
    approve('funds.transfer', {
      controlVersion: r.state.world.commonAccounts!.accounts.pool!.controlVersion,
      recipient,
      amount,
      note: '真实共同支出',
    });
  const execute = (id: string, requestId?: string) =>
    ok(
      a,
      'collectives.execute',
      { id, expectedRevision: r.state.collectives!.decisions[id]!.revision },
      requestId,
    );
  const reconcile = () => {
    const w = r.state.world;
    const total =
      Object.values(w.agents).reduce((t, x) => t + x.balance, 0) +
      Object.values(w.enterprises).reduce((t, x) => t + x.balance, 0) +
      (w.treasury ?? 0) +
      (w.bank?.balance ?? 0) +
      Object.values(w.publicBudget?.serviceBalances ?? {}).reduce((a, b) => a + b, 0) +
      (w.residentCommerce ? commerceEscrowBalance(w.residentCommerce) : 0) +
      commonAccountsBalance(w.commonAccounts);
    expect(total).toBeCloseTo(w.moneySupply, 7);
    expect(
      createEconomicCompositionPayload({ projection: w, recordedAt: w.clock.now }).composition
        .collectives,
    ).toBe(commonAccountsBalance(w.commonAccounts));
  };
  const replay = () => {
    const state = structuredClone(r.state),
      bytes = readFileSync(join(root, 'journal.jsonl'));
    r.close();
    const next = new OpenSocietyRuntime(root);
    clean.push(() => next.close());
    expect(next.state).toEqual(state);
    expect(readFileSync(join(root, 'journal.jsonl'))).toEqual(bytes);
  };
  return {
    r,
    root,
    a,
    b,
    c,
    d,
    call,
    ok,
    configuration,
    seed,
    contribute,
    approve,
    pay,
    execute,
    reconcile,
    replay,
  };
}
test('real common spending and proof consumption commit together exactly once; outsider funding grants no ledger access', () => {
  const t = setup();
  t.seed();
  const before = t.r.state.world.agents[t.c]!.balance,
    target = t.r.state.world.agents[t.d]!.balance;
  t.contribute(40);
  expect(t.r.state.world.agents[t.c]!.balance).toBe(before - 40);
  expect(t.ok(t.c, 'funds.read', { id: 'pool' })).toMatchObject({
    data: { balanceVisible: false },
  });
  expect(t.ok(t.c, 'funds.read', { id: 'pool' }).data).not.toHaveProperty('balance');
  expect(t.ok(t.c, 'funds.list', {})).toMatchObject({ data: { total: 0 } });
  expect(t.call(t.c, 'funds.ledger', { id: 'pool' }).error).toBe(
    'common-account-ledger-not-authorized',
  );
  const id = t.pay(15);
  expect(t.call(t.d, 'collectives.execute', { id, expectedRevision: 4 }).error).toBe(
    'decision-not-found',
  );
  const result = t.execute(id, 'pay-once');
  const again = t.ok(t.a, 'collectives.execute', { id, expectedRevision: 4 }, 'pay-once');
  expect(again).toEqual(result);
  expect(t.r.state.world.agents[t.d]!.balance).toBe(target + 15);
  expect(t.r.state.world.commonAccounts!.accounts.pool!.balance).toBe(25);
  expect(t.call(t.a, 'collectives.execute', { id, expectedRevision: 5 }).error).toBe(
    'passed-decision-required',
  );
  const commit = t.r.journal.commits.find((c) => c.actorId === t.a && c.requestId === 'pay-once')!;
  expect(commit.worldEvents).toHaveLength(1);
  expect(commit.collectiveEvents).toHaveLength(1);
  const experience = t.r.state.experiences[t.d]!.find((e) =>
    e.summary.startsWith('ResidentCommonAccountsCommitted:'),
  )!;
  expect(experience.provenance).toBe('firsthand');
  expect(experience.summary).toContain('collective:pool');
  expect(experience.summary).not.toContain('balance');
  t.reconcile();
  t.replay();
});
test('insufficient funds leave the decision unconsumed; later voluntary funding permits the same precise decision', () => {
  const t = setup();
  t.seed();
  const id = t.pay(30),
    before = structuredClone(t.r.state.world);
  expect(t.call(t.a, 'collectives.execute', { id, expectedRevision: 4 }).error).toBe(
    'insufficient-common-account-balance',
  );
  expect(t.r.state.world).toEqual(before);
  expect(t.r.state.collectives!.decisions[id]!.status).toBe('passed');
  t.contribute(50);
  expect(t.r.state.world.commonAccounts!.accounts.pool!.controlVersion).toBe(1);
  t.execute(id);
  expect(t.r.state.world.commonAccounts!.accounts.pool!.balance).toBe(20);
  t.reconcile();
  t.replay();
});
test('changing the charter hands off actual control and invalidates previous unexecuted spending authority', () => {
  const t = setup();
  t.seed();
  t.contribute(40);
  const old = t.pay(10);
  t.ok(t.a, 'collectives.propose', {
    id: 'handover',
    collectiveId: 'club',
    expectedVersion: 1,
    terms: '由另一位成员决定',
    action: {
      kind: 'amend',
      configuration: { ...t.configuration, voters: [t.b], threshold: 1, quorum: 1 },
    },
    closesAt: t.r.state.world.clock.now + 10000,
    executeBefore: t.r.state.world.clock.now + 20000,
  });
  t.ok(t.a, 'collectives.vote', { id: 'handover', expectedRevision: 1, vote: 'yes' });
  t.ok(t.b, 'collectives.vote', { id: 'handover', expectedRevision: 2, vote: 'yes' });
  t.ok(t.a, 'collectives.decide', { id: 'handover', expectedRevision: 3 });
  t.execute('handover');
  expect(t.call(t.a, 'collectives.execute', { id: old, expectedRevision: 4 }).error).toBe(
    'collective-authority-version-changed',
  );
  expect(t.r.state.world.commonAccounts!.accounts.pool!.balance).toBe(40);
  const next = t.pay(12);
  t.execute(next);
  expect(t.r.state.collectives!.decisions[next]!.votes).toEqual({ [t.b]: 'yes' });
  expect(t.r.state.world.commonAccounts!.accounts.pool!.collectiveId).toBe('club');
  t.reconcile();
  t.replay();
});
test('settlement stops deposits, invalidates previous control versions and refuses closing a nonzero balance', () => {
  const t = setup();
  t.seed();
  t.contribute(20);
  const old = t.pay(5);
  const settle = t.approve('funds.beginSettlement', { controlVersion: 1 });
  t.execute(settle);
  expect(
    t.call(t.c, 'funds.contribute', { id: 'pool', expectedRevision: 3, amount: 1, note: 'x' })
      .error,
  ).toBe('common-account-not-receiving');
  expect(t.call(t.a, 'collectives.execute', { id: old, expectedRevision: 4 }).error).toBe(
    'common-account-control-version-conflict',
  );
  const close = t.approve('funds.close', { controlVersion: 2 });
  expect(t.call(t.a, 'collectives.execute', { id: close, expectedRevision: 4 }).error).toBe(
    'common-account-not-settled',
  );
  const pay = t.pay(20);
  t.execute(pay);
  t.execute(close);
  expect(t.r.state.world.commonAccounts!.accounts.pool).toMatchObject({
    balance: 0,
    status: 'closed',
    controlVersion: 3,
  });
  expect(t.ok(t.a, 'funds.ledger', { id: 'pool' })).toMatchObject({ data: { total: 5 } });
  t.reconcile();
  t.replay();
});
test('common transfers to treasury enter the same money supply and composition', () => {
  const t = setup();
  t.seed();
  t.contribute(30);
  const treasury = t.r.state.world.treasury!;
  t.execute(t.pay(12, { sector: 'treasury', id: 'public-treasury' }));
  expect(t.r.state.world.treasury).toBe(treasury + 12);
  t.reconcile();
  t.replay();
});
test('ledger pages preserve actual reading and reject oversized originals without a false receipt', () => {
  const t = setup();
  t.seed();
  for (let i = 0; i < 13; i++) t.contribute(1, t.a, 'x'.repeat(1900));
  const before = t.r.state.experiences[t.b]?.length ?? 0;
  expect(t.call(t.b, 'funds.ledger', { id: 'pool', limit: 30 }).error).toBe(
    'read-result-too-large',
  );
  expect(t.r.state.experiences[t.b]?.length ?? 0).toBe(before);
  t.ok(t.b, 'funds.ledger', { id: 'pool', limit: 1 });
  t.ok(t.b, 'funds.ledger', { id: 'pool', limit: 1 });
  expect(
    t.r.state.experiences[t.b]!.filter((e) => e.summary.startsWith('funds.ledger succeeded')),
  ).toHaveLength(1);
  expect(
    t.r.state.experiences[t.b]!.find((e) => e.summary.startsWith('funds.ledger succeeded'))!
      .provenance,
  ).toBe('firsthand');
  t.reconcile();
  t.replay();
});

test('request identifiers are scoped to the authenticated actor in durable world facts', () => {
  const t = setup();
  t.seed();
  for (const actor of [t.a, t.b]) {
    t.ok(
      actor,
      'funds.contribute',
      {
        id: 'pool',
        expectedRevision: t.r.state.world.commonAccounts!.accounts.pool!.revision,
        amount: 3,
        note: 'same local request identifier from independent residents',
      },
      'shared-request',
    );
  }
  const events = t.r.journal.commits
    .flatMap((c) => c.worldEvents ?? [])
    .filter(
      (e) =>
        e.type === 'ResidentCommonAccountsCommitted' &&
        e.payload.events.some(
          (v) => v.type === 'CommonAccountReceiptRecorded' && v.receipt.operation === 'contribute',
        ),
    );
  expect(events).toHaveLength(2);
  expect(new Set(events.map((e) => e.id)).size).toBe(2);
  expect(t.r.state.world.commonAccounts!.accounts.pool!.balance).toBe(6);
  t.reconcile();
  t.replay();
});
