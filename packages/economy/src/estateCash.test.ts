import { expect, test } from 'vitest';
import {
  applyEstateCashEvent,
  captureEstateCash,
  settleEstateCash,
  closeEstateCash,
  assertEstateCashState,
  estateCashBalance,
} from './estateCash';
import {
  ESTATE_CASH_POLICY as POLICY,
  ESTATE_CASH_BANK_POLICY,
  ESTATE_RESPONSIBILITY_DOMAINS as DOMAINS,
  type EstateCashDecision,
  type EstateCashEvent,
  type EstateCashState,
  type EstateCashCaptureSource,
  type EstateCashSourceReference,
} from './estateCashModel';
import {
  calculateCirculatingMoneyDelta,
  createMoneyTransfer,
  economicAccount,
  type AccountingTransaction,
} from './accounting';
function fixture(balance = 100.123456789) {
  let state = applyEstateCashEvent(undefined, { type: 'EstateCashEnabled', policy: POLICY });
  let personal = balance,
    clearing = 0;
  const events: EstateCashEvent[] = [{ type: 'EstateCashEnabled', policy: POLICY }];
  const source: EstateCashCaptureSource = {
    populationEventId: 'real-death',
    ownerId: 'a',
    cause: 'death',
    populationPolicyVersion: 'explicit-population-v2',
    at: 100,
    personalBalance: balance,
  };
  const commit = (d: EstateCashDecision) => {
    expect(d.accepted, JSON.stringify(d)).toBe(true);
    if (!d.accepted) throw Error(d.reason);
    for (const tx of d.transactions) {
      expect(calculateCirculatingMoneyDelta(tx)).toBe(0);
      for (const e of tx.entries) {
        if (e.account.sector === 'agent') personal += e.amount;
        else if (e.account.sector === 'public-service') clearing += e.amount;
      }
    }
    events.push(...d.events);
    state = d.events.reduce(applyEstateCashEvent, state);
    return d;
  };
  const capture = () => commit(captureEstateCash(state, 'a-estate', source));
  const reference = (revision = 1): EstateCashSourceReference => ({
    context: 'periodic-obligations',
    id: 'promise',
    revision,
    policyVersion: 'resident-periodic-obligations-v1',
  });
  const transaction = (amount: number, id = 'periodic-cash-1'): AccountingTransaction =>
    createMoneyTransfer({
      transactionId: id,
      reason: 'actual-once-only-due',
      from: economicAccount(
        amount > 0 ? 'public-service' : 'estate',
        amount > 0 ? 'resident-periodic-obligations' : 'a-estate',
      ),
      to: economicAccount(
        amount > 0 ? 'estate' : 'public-service',
        amount > 0 ? 'a-estate' : 'resident-periodic-obligations',
      ),
      amount: Math.abs(amount),
    });
  const settle = (amount: number, revision = 1) =>
    settleEstateCash(state, {
      id: 'a-estate',
      previousRevision: state.accounts['a-estate']!.revision,
      at: 200 + revision,
      source: reference(revision),
      transaction: transaction(amount, `actual-${revision}`),
    });
  const reads = () =>
    DOMAINS.map((domain) => ({ domain, status: 'observed' as const, references: [] }));
  const close = () =>
    closeEstateCash(state, {
      id: 'a-estate',
      previousRevision: state.accounts['a-estate']!.revision,
      at: 300,
      responsibilityReads: reads(),
    });
  const replay = () => {
    const restored = events.reduce<EstateCashState | undefined>(
      (s, e) => applyEstateCashEvent(s, JSON.parse(JSON.stringify(e)) as EstateCashEvent),
      undefined,
    );
    expect(restored).toEqual(state);
    assertEstateCashState(restored!);
  };
  return {
    get state() {
      return state;
    },
    get personal() {
      return personal;
    },
    get clearing() {
      return clearing;
    },
    source,
    events,
    commit,
    capture,
    reference,
    transaction,
    settle,
    reads,
    close,
    replay,
  };
}
test('captures exact original cash into a separate circulating custody account, with no default heir, destruction, rounding or fake body', () => {
  const t = fixture();
  t.capture();
  expect(t.personal).toBe(0);
  expect(estateCashBalance(t.state)).toBe(100.123456789);
  expect(t.state.accounts['a-estate']).toMatchObject({
    ownerId: 'a',
    status: 'held',
    revision: 1,
    capture: t.source,
  });
  expect(captureEstateCash(t.state, 'duplicate', t.source).accepted).toBe(false);
  expect(captureEstateCash(t.state, 'a-estate', t.source).accepted).toBe(false);
  expect(Object.keys(t.state.accounts)).toEqual(['a-estate']);
  t.replay();
});
test('zero cash preserves a truthful custody record with no invented zero-value transaction; previous absent state remains absent', () => {
  const t = fixture(0),
    d = captureEstateCash(t.state, 'a-estate', t.source);
  expect(d.accepted).toBe(true);
  if (!d.accepted) throw Error('fixture');
  expect(d.transactions).toEqual([]);
  t.commit(d);
  expect(estateCashBalance(t.state)).toBe(0);
  t.replay();
  expect(() => applyEstateCashEvent(undefined, d.events[0]!)).toThrow('estate-cash-not-enabled');
});
test('finite original consumer payments and later refunds preserve owning source cursor and real once-only cash', () => {
  const t = fixture();
  t.capture();
  t.commit(t.settle(-25, 1));
  t.commit(t.settle(5, 2));
  expect(t.state.accounts['a-estate']!.balance).toBeCloseTo(80.123456789, 8);
  expect(t.personal).toBe(0);
  expect(t.clearing).toBe(20);
  expect(t.settle(-25, 2)).toMatchObject({
    accepted: false,
    reason: 'estate-owning-source-already-settled',
  });
  expect(t.state.accounts['a-estate']!.revision).toBe(3);
  t.replay();
});
test('refuses overdraft, lost small deltas at huge balances, wrong clearing sector, old version and a receiver pretending to withdraw another estate', () => {
  const t = fixture(20);
  t.capture();
  expect(t.settle(-25).accepted).toBe(false);
  const input = {
    id: 'a-estate',
    previousRevision: 1,
    at: 200,
    source: t.reference(),
    transaction: t.transaction(-10),
  };
  expect(
    settleEstateCash(t.state, { ...input, source: { ...input.source, policyVersion: 'unknown' } })
      .accepted,
  ).toBe(false);
  expect(
    settleEstateCash(t.state, {
      ...input,
      transaction: createMoneyTransfer({
        transactionId: 'unscoped',
        reason: 'not-original-consumer',
        from: economicAccount('estate', 'a-estate'),
        to: economicAccount('agent', 'beneficiary'),
        amount: 10,
      }),
    }).accepted,
  ).toBe(false);
  expect(
    settleEstateCash(t.state, {
      ...input,
      transaction: {
        ...input.transaction,
        entries: input.transaction.entries.map((e) =>
          e.account.sector === 'estate' ? { ...e, account: economicAccount('estate', 'other') } : e,
        ),
      },
    }).accepted,
  ).toBe(false);
  expect(t.state.accounts['a-estate']!.balance).toBe(20);
  t.replay();
  const x = fixture(1e30);
  x.capture();
  expect(x.settle(-1).accepted).toBe(false);
  expect(estateCashBalance(x.state)).toBe(1e30);
  x.replay();
});
test('zero cash is insufficient for closure if any domain is unobserved, missing, duplicated, or still owns an actual right or obligation', () => {
  const t = fixture(0);
  t.capture();
  const base = { id: 'a-estate', previousRevision: 1, at: 300 };
  expect(
    closeEstateCash(t.state, { ...base, responsibilityReads: t.reads().slice(1) }).accepted,
  ).toBe(false);
  const unknown = t
    .reads()
    .map((r) => (r.domain === 'credit' ? { ...r, status: 'unavailable' as const } : r));
  expect(closeEstateCash(t.state, { ...base, responsibilityReads: unknown })).toMatchObject({
    accepted: false,
    reason: 'estate-responsibility-observation-unavailable',
  });
  const pending = t
    .reads()
    .map((r) =>
      r.domain === 'logistics' ? { ...r, references: [{ id: 'real-cargo', revision: 3 }] } : r,
    );
  expect(closeEstateCash(t.state, { ...base, responsibilityReads: pending })).toMatchObject({
    accepted: false,
    reason: 'estate-has-unsettled-responsibilities',
  });
  expect(
    closeEstateCash(t.state, {
      ...base,
      responsibilityReads: [...t.reads().slice(1), t.reads()[1]!],
    }).accepted,
  ).toBe(false);
  t.commit(t.close());
  expect(t.state.accounts['a-estate']!.status).toBe('closed');
  expect(t.settle(1).accepted).toBe(false);
  t.replay();
});
test('nonzero remaining cash cannot disappear on close and capture cannot accept finite/range/source mutation or manufacture a second personal estate', () => {
  const t = fixture();
  t.capture();
  expect(t.close().accepted).toBe(false);
  for (const personalBalance of [-1, NaN, Infinity])
    expect(
      captureEstateCash(t.state, 'bad', {
        ...t.source,
        ownerId: 'd',
        populationEventId: 'other',
        personalBalance,
      }).accepted,
    ).toBe(false);
  expect(
    captureEstateCash(t.state, 'bad', { ...t.source, populationEventId: 'different' }).accepted,
  ).toBe(false);
  const zero = fixture(0);
  zero.capture();
  expect(() =>
    assertEstateCashState({
      ...zero.state,
      accounts: {
        'a-estate': { ...zero.state.accounts['a-estate']!, status: 'closed', balance: 1 },
      },
    }),
  ).toThrow('estate-cash-source-or-status-mismatch');
  t.replay();
});
test('replay mechanically rejects forged preservation transaction, duplicate source settlement and rewritten cash/account ownership', () => {
  const t = fixture(),
    d = captureEstateCash(t.state, 'a-estate', t.source);
  if (!d.accepted) throw Error('fixture');
  const e = d.events[0]!;
  if (e.type !== 'EstateCashCaptured' || !e.transaction) throw Error('fixture');
  const transaction = e.transaction;
  expect(() =>
    applyEstateCashEvent(t.state, {
      ...e,
      transaction: {
        ...transaction,
        entries: transaction.entries.map((v) => ({ ...v, amount: v.amount * 2 })),
      },
    }),
  ).toThrow('estate-capture-transaction-mismatch');
  t.commit(d);
  const s = t.settle(-10);
  if (!s.accepted) throw Error('fixture');
  t.commit(s);
  expect(() =>
    applyEstateCashEvent(t.state, { ...s.events[0]!, previousRevision: 2 } as EstateCashEvent),
  ).toThrow('estate-owning-source-already-settled');
  expect(() =>
    assertEstateCashState({
      ...t.state,
      accounts: { 'a-estate': { ...t.state.accounts['a-estate']!, ownerId: 'someone' } },
    }),
  ).toThrow('estate-cash-source-or-status-mismatch');
  t.replay();
});

function bankEstateFixture(balance = 100) {
  const initial = applyEstateCashEvent(undefined, {
    type: 'EstateCashEnabled',
    policy: ESTATE_CASH_BANK_POLICY,
  });
  const d = captureEstateCash(initial, 'bank-estate', {
    populationEventId: 'actual-bank-borrower-death',
    ownerId: 'a',
    cause: 'death',
    populationPolicyVersion: 'explicit-population-v2',
    at: 100,
    personalBalance: balance,
  });
  if (!d.accepted) throw Error(d.reason);
  return d.events.reduce(applyEstateCashEvent, initial);
}
const bankSource = (revision = 1): EstateCashSourceReference => ({
  context: 'credit',
  id: 'original-loan',
  revision,
  policyVersion: 'resident-estate-credit-settlement-v1',
});
const bankLedger = (fromEstate = true, id = 'original-bank-settlement') =>
  createMoneyTransfer({
    transactionId: id,
    reason: 'actual-original-bank-position',
    from: economicAccount(fromEstate ? 'estate' : 'bank', fromEstate ? 'bank-estate' : 'town-bank'),
    to: economicAccount(fromEstate ? 'bank' : 'estate', fromEstate ? 'town-bank' : 'bank-estate'),
    amount: 10,
  });
test('explicit cash v2 can settle the actual fixed town-bank consumer in both directions while v1 does not inherit bank spending scope', () => {
  let s = bankEstateFixture();
  const paid = settleEstateCash(s, {
    id: 'bank-estate',
    previousRevision: 1,
    at: 200,
    source: bankSource(),
    transaction: bankLedger(),
  });
  expect(paid.accepted).toBe(true);
  if (!paid.accepted) throw Error(paid.reason);
  s = paid.events.reduce(applyEstateCashEvent, s);
  expect(s.accounts['bank-estate']?.balance).toBe(90);
  expect(paid.transactions.map(calculateCirculatingMoneyDelta)).toEqual([0]);
  const refund = settleEstateCash(s, {
    id: 'bank-estate',
    previousRevision: 2,
    at: 300,
    source: bankSource(2),
    transaction: bankLedger(false, 'original-bank-refund'),
  });
  expect(refund.accepted).toBe(true);
  if (!refund.accepted) throw Error(refund.reason);
  expect(refund.events.reduce(applyEstateCashEvent, s).accounts['bank-estate']?.balance).toBe(100);
  const old = fixture(100);
  old.capture();
  expect(
    settleEstateCash(old.state, {
      id: 'a-estate',
      previousRevision: 1,
      at: 200,
      source: bankSource(),
      transaction: createMoneyTransfer({
        transactionId: 'bank-v1-bypass',
        reason: 'unsupported',
        from: economicAccount('estate', 'a-estate'),
        to: economicAccount('bank', 'town-bank'),
        amount: 10,
      }),
    }),
  ).toEqual({ accepted: false, reason: 'estate-original-bank-scope-required' });
});
test('cash v2 does not allow a substituted bank, sector, source version or unrelated public clearing account', () => {
  const s = bankEstateFixture();
  for (const destination of [
    economicAccount('bank', 'other-bank'),
    economicAccount('public-service', 'town-bank'),
    economicAccount('public-service', 'resident-periodic-obligations'),
  ])
    expect(
      settleEstateCash(s, {
        id: 'bank-estate',
        previousRevision: 1,
        at: 200,
        source: bankSource(),
        transaction: createMoneyTransfer({
          transactionId: 'wrong-bank-source',
          reason: 'unsupported',
          from: economicAccount('estate', 'bank-estate'),
          to: destination,
          amount: 10,
        }),
      }).accepted,
    ).toBe(false);
  expect(
    settleEstateCash(s, {
      id: 'bank-estate',
      previousRevision: 1,
      at: 200,
      source: { ...bankSource(), policyVersion: 'credit-v1' },
      transaction: bankLedger(),
    }).accepted,
  ).toBe(false);
});
test('new bank scope is recorded explicitly and its receipts replay, while old policy snapshots cannot claim that scope through an invented source cursor', () => {
  const s = bankEstateFixture();
  expect(s.policy.version).toBe('resident-estate-cash-v2');
  assertEstateCashState(s);
  const d = settleEstateCash(s, {
    id: 'bank-estate',
    previousRevision: 1,
    at: 200,
    source: bankSource(),
    transaction: bankLedger(),
  });
  if (!d.accepted) throw Error(d.reason);
  const next = d.events.reduce(applyEstateCashEvent, s);
  assertEstateCashState(next);
  expect(JSON.parse(JSON.stringify(next))).toEqual(next);
  expect(() => assertEstateCashState({ ...next, policy: POLICY })).toThrow(
    'invalid-estate-recorded-settlement',
  );
  expect(() =>
    applyEstateCashEvent(s, { type: 'EstateCashEnabled', policy: ESTATE_CASH_BANK_POLICY }),
  ).toThrow('invalid-estate-cash-activation');
});
test('legacy clearing consumers keep their exact original transfer semantics under either separately recorded cash policy', () => {
  const s = bankEstateFixture();
  const d = settleEstateCash(s, {
    id: 'bank-estate',
    previousRevision: 1,
    at: 200,
    source: {
      context: 'periodic-obligations',
      id: 'old-promise',
      revision: 1,
      policyVersion: 'resident-periodic-obligations-v1',
    },
    transaction: createMoneyTransfer({
      transactionId: 'original-periodic-payout',
      reason: 'old-consumer',
      from: economicAccount('estate', 'bank-estate'),
      to: economicAccount('public-service', 'resident-periodic-obligations'),
      amount: 10,
    }),
  });
  expect(d.accepted).toBe(true);
  if (!d.accepted) throw Error(d.reason);
  expect(d.events.reduce(applyEstateCashEvent, s).accounts['bank-estate']?.balance).toBe(90);
});
