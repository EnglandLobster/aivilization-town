import { expect, test } from 'vitest';
import {
  createMoneyTransfer,
  economicAccount,
  type AccountingTransaction,
} from '@aivilization/economy';
import type { PrincipalAuthorization, PrincipalOperationRequest } from '@aivilization/authority';
import {
  PERIODIC_OBLIGATIONS_POLICY as POLICY,
  type PeriodicCommand,
  type PeriodicDecision,
  type PeriodicEvent,
  type PeriodicObligationsState,
  type PeriodicAccountFacts,
  type PeriodicTerms,
} from './periodicObligationModel';
import {
  decidePeriodicObligation,
  decidePeriodicDue,
  expirePeriodicObligation,
} from './periodicObligations';
import { applyPeriodicEvent } from './periodicObligationEvents';
import { assertPeriodicObligationsState } from './periodicObligationRecords';
import {
  nextPeriodicDueAt,
  periodicUnpaidMicros,
  periodicAccountObligations,
} from './periodicObligationFacts';
import { decodePeriodicCommand } from './periodicObligationCommand';
function fixture(payerBalance = 125, revenueBalance = 0) {
  const enabled: PeriodicEvent = { type: 'PeriodicObligationsEnabled', policy: POLICY };
  let s = applyPeriodicEvent(undefined, enabled),
    actor = 'a';
  const events: PeriodicEvent[] = [enabled],
    transactions: AccountingTransaction[] = [];
  const accounts: Record<string, PeriodicAccountFacts> = {
    'agent:a': {
      account: { sector: 'agent', id: 'a' },
      principal: { kind: 'resident', id: 'a' },
      status: 'open',
      balance: payerBalance,
      maximumBalance: 1000000,
    },
    'agent:b': {
      account: { sector: 'agent', id: 'b' },
      principal: { kind: 'resident', id: 'b' },
      status: 'open',
      balance: revenueBalance,
      maximumBalance: 1000000,
    },
  };
  const applyMoney = (tx: readonly AccountingTransaction[]) => {
    let clearing = 0;
    for (const t of tx) {
      expect(t.entries.reduce((n, e) => n + e.amount, 0)).toBe(0);
      for (const e of t.entries) {
        if (e.account.sector === 'public-service') {
          clearing += e.amount;
          continue;
        }
        const f = accounts[e.account.accountId];
        if (!f) throw Error('owning fixture cash account required');
        accounts[e.account.accountId] = { ...f, balance: f.balance + e.amount };
        expect(accounts[e.account.accountId]!.balance).toBeGreaterThanOrEqual(0);
      }
    }
    expect(clearing).toBe(0);
  };
  const p = {
    exists: (id: string) => ['a', 'b', 'outsider'].includes(id),
    account: (a: PeriodicTerms['payer']) => accounts[`${a.sector}:${a.id}`],
    authorize: (
      principal: PeriodicAccountFacts['principal'],
      request: PrincipalOperationRequest,
    ): PrincipalAuthorization<PrincipalOperationRequest> | undefined =>
      principal.kind === 'resident' && principal.id === actor
        ? {
            actorId: actor,
            principal,
            request: structuredClone(request),
            source: { kind: 'personal' },
          }
        : undefined,
  };
  const commit = (d: PeriodicDecision) => {
    expect(d.accepted, JSON.stringify(d)).toBe(true);
    if (!d.accepted) throw Error(d.reason);
    s = d.events.reduce(applyPeriodicEvent, s);
    events.push(...d.events);
    applyMoney(d.transactions);
    transactions.push(...d.transactions);
    return d;
  };
  const offer = (extra: Partial<PeriodicTerms> = {}): PeriodicCommand => ({
    type: 'offer',
    id: 'promise',
    title: '居民自定名称',
    terms: '纯有限付款，不取得房屋或成员资格',
    payer: { sector: 'agent', id: 'a' },
    revenue: { sector: 'agent', id: 'b' },
    amount: 25,
    firstDueAt: 100000,
    periodMs: 60000,
    periods: 3,
    acceptBy: 80000,
    ...extra,
  });
  const decide = (c: PeriodicCommand, who = 'a', at = 0) => {
    actor = who;
    return decidePeriodicObligation(s, who, at, c, p);
  };
  const ok = (c: PeriodicCommand, who = 'a', at = 0) => commit(decide(c, who, at));
  const rev = (id = 'promise') => s.contracts[id]!.revision;
  const ready = (extra: Partial<PeriodicTerms> = {}) => {
    ok(offer(extra));
    ok({ type: 'accept', id: extra.id ?? 'promise', expectedRevision: 1 }, 'b', 10);
  };
  const due = (at: number, id = 'promise') => commit(decidePeriodicDue(s, id, at, p));
  const advance = (at: number) => {
    for (;;) {
      const q = Object.values(s.contracts)
        .map((c) => ({ id: c.id, at: nextPeriodicDueAt(c) }))
        .filter((x): x is { id: string; at: number } => x.at !== undefined && x.at <= at)
        .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))[0];
      if (!q) break;
      due(q.at, q.id);
    }
  };
  const fund = (amount: number) =>
    applyMoney([
      createMoneyTransfer({
        transactionId: 'fixture-independent-funding',
        reason: 'Separate owning account transfer in domain-port fixture',
        from: economicAccount('agent', 'b'),
        to: economicAccount('agent', 'a'),
        amount,
      }),
    ]);
  const replay = () => {
    const restored = events.reduce<PeriodicObligationsState | undefined>(
      (state, e) => applyPeriodicEvent(state, JSON.parse(JSON.stringify(e)) as PeriodicEvent),
      undefined,
    );
    expect(restored).toEqual(s);
    assertPeriodicObligationsState(restored!);
  };
  return {
    events,
    transactions,
    accounts,
    offer,
    ok,
    decide,
    ready,
    rev,
    due,
    advance,
    fund,
    replay,
    commit,
    p,
    get state() {
      return s;
    },
  };
}
test('empty explicit activation and independent exact acceptance create a bounded promise, never future money, body, membership or rent', () => {
  const t = fixture(0, 100),
    initial = structuredClone(t.accounts);
  t.ok(t.offer());
  expect(t.decide({ type: 'accept', id: 'promise', expectedRevision: 1 }, 'a', 10).accepted).toBe(
    false,
  );
  t.ok({ type: 'accept', id: 'promise', expectedRevision: 1 }, 'b', 10);
  expect(t.accounts).toEqual(initial);
  expect(t.transactions).toEqual([]);
  expect(t.state.contracts.promise).toMatchObject({
    status: 'active',
    cursor: 0,
    installments: {},
    acceptedAt: 10,
  });
  expect(nextPeriodicDueAt(t.state.contracts.promise!)).toBe(100000);
  t.replay();
});
test('each finite due period pays actual party accounts once, clears to zero and closes future dues without inventing transfers', () => {
  const t = fixture();
  t.ready();
  t.due(99999);
  expect(t.transactions).toEqual([]);
  t.due(100000);
  t.due(100000);
  expect(t.transactions).toHaveLength(2);
  t.advance(1000000);
  expect(t.state.contracts.promise).toMatchObject({
    cursor: 3,
    status: 'ended',
    futureStoppedAt: 220000,
  });
  expect(t.accounts['agent:a']!.balance).toBe(50);
  expect(t.accounts['agent:b']!.balance).toBe(75);
  expect(t.transactions).toHaveLength(6);
  expect(new Set(t.transactions.map((t) => t.transactionId)).size).toBe(6);
  expect(periodicUnpaidMicros(t.state.contracts.promise!)).toBe(0);
  expect(periodicAccountObligations(t.state, { sector: 'agent', id: 'a' })).toEqual([]);
  t.replay();
});
test('insufficient funds record one real owed installment; later funding does not silently retry, and exact clearing settles it once', () => {
  const t = fixture(0, 100);
  t.ready();
  t.due(100000);
  expect(t.state.contracts.promise!.installments['1']).toMatchObject({
    status: 'unpaid',
    unpaidReason: 'periodic-insufficient-funds',
    amountMicros: 25000000,
  });
  expect(t.transactions).toEqual([]);
  t.fund(25);
  t.due(100001);
  expect(periodicUnpaidMicros(t.state.contracts.promise!)).toBe(25000000);
  expect(
    t.decide({ type: 'settle', id: 'promise', expectedRevision: t.rev(), period: 1 }, 'b', 100001)
      .accepted,
  ).toBe(false);
  const command: PeriodicCommand = {
    type: 'settle',
    id: 'promise',
    expectedRevision: t.rev(),
    period: 1,
  };
  t.ok(command, 'a', 100001);
  expect(t.decide(command, 'a', 100002).accepted).toBe(false);
  expect(t.state.contracts.promise!.installments['1']).toMatchObject({
    status: 'paid',
    paidAt: 100001,
    unpaidReason: 'periodic-insufficient-funds',
  });
  expect(t.accounts['agent:a']!.balance + t.accounts['agent:b']!.balance).toBe(100);
  t.replay();
});
test('termination cannot escape a due period and never erases debt; creditor exact waiver ends only its unpaid claim with no money or interest', () => {
  const t = fixture(0, 100);
  t.ready();
  expect(
    t.decide({ type: 'terminate', id: 'promise', expectedRevision: t.rev() }, 'a', 100000),
  ).toMatchObject({ accepted: false, reason: 'periodic-due-must-settle-before-termination' });
  t.due(100000);
  t.ok({ type: 'terminate', id: 'promise', expectedRevision: t.rev() }, 'a', 100000);
  expect(periodicAccountObligations(t.state, { sector: 'agent', id: 'a' })).toEqual(['promise']);
  const before = structuredClone(t.accounts);
  t.advance(1000000);
  expect(t.state.contracts.promise).toMatchObject({
    status: 'terminated',
    cursor: 1,
    futureStoppedAt: 100000,
  });
  expect(
    t.decide({ type: 'waive', id: 'promise', expectedRevision: t.rev(), period: 1 }, 'a', 100001)
      .accepted,
  ).toBe(false);
  t.ok({ type: 'waive', id: 'promise', expectedRevision: t.rev(), period: 1 }, 'b', 100001);
  expect(t.accounts).toEqual(before);
  expect(periodicUnpaidMicros(t.state.contracts.promise!)).toBe(0);
  expect(periodicAccountObligations(t.state, { sector: 'agent', id: 'b' })).toEqual([]);
  t.replay();
});
test('either independent original party may stop future periods, but unaccepted proposals expire/decline/withdraw without debts', () => {
  for (const type of ['withdraw', 'decline'] as const) {
    const t = fixture();
    t.ok(t.offer());
    t.ok({ type, id: 'promise', expectedRevision: 1 }, type === 'withdraw' ? 'a' : 'b', 10);
    expect(t.state.contracts.promise!.status).toBe(type === 'withdraw' ? 'withdrawn' : 'declined');
    expect(t.transactions).toEqual([]);
    t.replay();
  }
  const t = fixture();
  t.ok(t.offer());
  t.commit(expirePeriodicObligation(t.state, 'promise', 80000));
  expect(t.state.contracts.promise!.status).toBe('expired');
  expect(
    t.decide({ type: 'accept', id: 'promise', expectedRevision: t.rev() }, 'b', 80001).accepted,
  ).toBe(false);
  t.replay();
  const u = fixture();
  u.ready();
  u.ok({ type: 'terminate', id: 'promise', expectedRevision: u.rev() }, 'b', 20);
  u.advance(1000000);
  expect(u.transactions).toEqual([]);
  u.replay();
});
test('closed command grammar and finite amount/time/period/total bounds reject forged effect, actor, source, unsafe date and past consent', () => {
  const t = fixture(),
    base = t.offer();
  for (const c of [
    { ...base, actorId: 'other' },
    { ...base, source: {} },
    { ...base, installments: {} },
    { ...base, amount: NaN },
    { ...base, amount: Infinity },
    { ...base, amount: -1 },
    { ...base, amount: 0 },
    { ...base, amount: 0.0000001 },
    { ...base, amount: 1000001 },
    { ...base, periods: 0 },
    { ...base, periods: 129 },
    { ...base, periodMs: 59999 },
    { ...base, periodMs: Infinity },
    { ...base, firstDueAt: 80000 },
    { ...base, firstDueAt: Number.MAX_SAFE_INTEGER },
    { ...base, acceptBy: 0 },
  ])
    expect(t.decide(c).accepted, JSON.stringify(c)).toBe(false);
  expect(() =>
    decodePeriodicCommand({ type: 'due', id: 'promise', expectedRevision: 1 }),
  ).toThrow();
  expect(t.state.contracts).toEqual({});
  t.ok(t.offer());
  expect(
    t.decide({ type: 'accept', id: 'promise', expectedRevision: 1 }, 'b', 80000).accepted,
  ).toBe(false);
});
test('receiver capacity, unavailable actual account and wrong account source cause recorded failure rather than overdraft, forged ownership or hidden payment', () => {
  for (const reason of [
    'periodic-revenue-capacity',
    'periodic-revenue-unavailable',
    'periodic-payer-unavailable',
    'periodic-money-range',
  ] as const) {
    const t = fixture();
    t.ready();
    if (reason === 'periodic-revenue-capacity')
      t.accounts['agent:b'] = { ...t.accounts['agent:b']!, maximumBalance: 24 };
    if (reason === 'periodic-revenue-unavailable')
      t.accounts['agent:b'] = { ...t.accounts['agent:b']!, status: 'unavailable' };
    if (reason === 'periodic-payer-unavailable')
      t.accounts['agent:a'] = { ...t.accounts['agent:a']!, status: 'closed' };
    if (reason === 'periodic-money-range')
      t.accounts['agent:b'] = {
        ...t.accounts['agent:b']!,
        balance: 1e30,
        maximumBalance: Number.MAX_VALUE,
      };
    t.due(100000);
    expect(t.state.contracts.promise!.installments['1']).toMatchObject({
      status: 'unpaid',
      unpaidReason: reason,
    });
    expect(t.transactions).toEqual([]);
    t.replay();
  }
  const t = fixture();
  t.ready();
  t.accounts['agent:b'] = {
    ...t.accounts['agent:b']!,
    principal: { kind: 'resident', id: 'outsider' },
  };
  expect(decidePeriodicDue(t.state, 'promise', 100000, t.p).accepted).toBe(false);
});
test('snapshot and replay reject retroactive acceptance, ledger gaps, future debt deletion, altered installments and fabricated successful payment', () => {
  const t = fixture(0, 100);
  t.ready();
  const before = structuredClone(t.state);
  t.due(100000);
  const e = t.events[t.events.length - 1];
  if (e?.type !== 'PeriodicInstallmentRecorded') throw Error('actual installment');
  expect(() =>
    applyPeriodicEvent(before, {
      ...e,
      installment: { ...e.installment, status: 'paid', paidAt: 100000 },
    }),
  ).toThrow('periodic-due-payment-source-mismatch');
  expect(() =>
    applyPeriodicEvent(before, { ...e, installment: { ...e.installment, amountMicros: 1 } }),
  ).toThrow();
  const c = t.state.contracts.promise!;
  for (const contract of [
    { ...c, acceptedAt: 100000 },
    { ...c, installments: {} },
    { ...c, status: 'terminated' as const, futureStoppedAt: 160000 },
  ])
    expect(() =>
      assertPeriodicObligationsState({ ...t.state, contracts: { promise: contract } }),
    ).toThrow();
  expect(() => applyPeriodicEvent(undefined, e)).toThrow('periodic-obligations-not-enabled');
  t.replay();
});
test('chronological bulk advancement equals individual periods and does not spend shared payer cash twice across contracts', () => {
  const a = fixture(100),
    b = fixture(100);
  for (const t of [a, b]) {
    t.ready({ id: 'one' });
    t.ready({ id: 'two' });
  }
  a.advance(220000);
  for (const at of [100000, 160000, 220000]) b.advance(at);
  expect(a.state).toEqual(b.state);
  expect(a.transactions).toEqual(b.transactions);
  expect(a.accounts).toEqual(b.accounts);
  expect(a.accounts['agent:a']!.balance).toBe(0);
  expect(a.accounts['agent:b']!.balance).toBe(100);
  expect(Object.values(a.state.contracts).reduce((n, c) => n + periodicUnpaidMicros(c), 0)).toBe(
    50000000,
  );
  a.replay();
  b.replay();
});
test('minimum micro payment and maximum finite period count are explicit supported bounds', () => {
  const t = fixture(1);
  t.ready({ amount: 0.000001, periods: 1 });
  t.advance(100000);
  expect(t.state.contracts.promise!.installments['1']!.amountMicros).toBe(1);
  t.replay();
  const u = fixture(128);
  u.ready({ amount: 1, periods: 128 });
  u.advance(100000 + 127 * 60000);
  expect(u.accounts['agent:a']!.balance).toBe(0);
  expect(u.state.contracts.promise).toMatchObject({ cursor: 128, status: 'ended' });
  expect(u.transactions).toHaveLength(256);
  u.replay();
});
