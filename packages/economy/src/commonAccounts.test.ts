import { expect, test } from 'vitest';
import { assertMoneySupplyDelta } from './accounting';
import {
  COMMON_ACCOUNTS_POLICY,
  commonAccountsBalance,
  emptyCommonAccountsState,
  parseCommonAccountOperation,
  type CommonAccountAuthority,
  type CommonAccountCommand,
  type CommonAccountEvent,
  type CommonAccountsPolicy,
} from './commonAccountModel';
import {
  applyCommonAccountEvent,
  commonAccountNextBalance,
  decideCommonAccount,
} from './commonAccounts';
const authority = (collectiveId = 'club'): CommonAccountAuthority => ({
  collectiveId,
  decisionId: 'approved',
  decisionRevision: 4,
  charterVersion: 1,
});
function fixture(policy: CommonAccountsPolicy = COMMON_ACCOUNTS_POLICY) {
  let s = emptyCommonAccountsState(policy),
    ordinal = 0,
    owed = false;
  const external: Record<string, number> = {
    'agent:a': 200,
    'agent:b': 100,
    'enterprise:e': 50,
    'treasury:public-treasury': 100,
  };
  const events: CommonAccountEvent[] = [];
  const ports = {
    isMember: (id: string, a: string) =>
      (id === 'club' && a === 'a') || (id === 'other' && a === 'b'),
    residentBalance: (id: string) => external[`agent:${id}`],
    recipientBalance: (r: { sector: string; id: string }) => external[`${r.sector}:${r.id}`],
    unresolvedObligations: () => owed,
  };
  const act = (command: CommonAccountCommand, actorId = 'a', requestId = `r${++ordinal}`) =>
    decideCommonAccount({ state: s, actorId, at: 10, requestId, command, ports });
  const total = () => Object.values(external).reduce((a, b) => a + b, 0) + commonAccountsBalance(s);
  const ok = (command: CommonAccountCommand, actorId = 'a') => {
    const before = total(),
      d = act(command, actorId);
    expect(d.accepted, JSON.stringify(d)).toBe(true);
    if (d.accepted) {
      for (const e of d.events) {
        s = applyCommonAccountEvent(s, e);
        events.push(e);
      }
      for (const t of d.transactions) {
        assertMoneySupplyDelta({ transaction: t, moneySupplyDelta: 0 });
        for (const e of t.entries)
          if (e.account.sector !== 'collective') external[e.account.accountId]! += e.amount;
      }
      expect(total()).toBeCloseTo(before, 9);
    }
    return d;
  };
  const open = () => ok({ type: 'open', id: 'pool', collectiveId: 'club', title: '共同款项' });
  const contribute = (amount = 50) =>
    ok(
      {
        type: 'contribute',
        id: 'pool',
        expectedRevision: s.accounts.pool!.revision,
        amount,
        note: '自愿出资',
      },
      'b',
    );
  const pay = (amount = 20, recipient = { sector: 'agent' as const, id: 'b' }) =>
    ok({
      type: 'transfer',
      id: 'pool',
      controlVersion: s.accounts.pool!.controlVersion,
      amount,
      recipient,
      note: '按共同决定',
      authority: authority(),
    });
  const replay = () =>
    expect(events.reduce(applyCommonAccountEvent, emptyCommonAccountsState(policy))).toEqual(s);
  return {
    get s() {
      return s;
    },
    external,
    act,
    ok,
    open,
    contribute,
    pay,
    replay,
    obligations: (v: boolean) => {
      owed = v;
    },
  };
}
test('a stable collective controls an empty account; an outsider contributes only their own real funds', () => {
  const t = fixture();
  expect(t.act({ type: 'open', id: 'pool', collectiveId: 'club', title: 'x' }, 'b')).toMatchObject({
    accepted: false,
    reason: 'active-collective-member-required',
  });
  t.open();
  expect(t.s.accounts.pool).toMatchObject({ balance: 0, controlVersion: 1, createdBy: 'a' });
  t.contribute();
  expect(t.external['agent:b']).toBe(50);
  expect(t.s.accounts.pool!.balance).toBe(50);
  expect(t.s.accounts.pool!.collectiveId).toBe('club');
  expect(t.s.receipts.r3!.authority).toBeUndefined();
  t.replay();
});
test('authorization refers to the controlling collective and changed account control invalidates older operations', () => {
  const t = fixture();
  t.open();
  t.contribute();
  const transfer = {
    type: 'transfer' as const,
    id: 'pool',
    controlVersion: 1,
    recipient: { sector: 'agent' as const, id: 'b' },
    amount: 10,
    note: 'x',
    authority: authority('other'),
  };
  expect(t.act(transfer)).toMatchObject({
    accepted: false,
    reason: 'exact-collective-authority-required',
  });
  t.ok({ type: 'beginSettlement', id: 'pool', controlVersion: 1, authority: authority() });
  expect(t.act({ ...transfer, authority: authority() })).toMatchObject({
    accepted: false,
    reason: 'common-account-control-version-conflict',
  });
  t.pay();
  t.replay();
});
test('insufficient funds and unavailable recipients produce no half-transfer; later funding keeps control version', () => {
  const t = fixture();
  t.open();
  const initial = structuredClone(t.s),
    command = {
      type: 'transfer' as const,
      id: 'pool',
      controlVersion: 1,
      recipient: { sector: 'agent' as const, id: 'b' },
      amount: 30,
      note: 'x',
      authority: authority(),
    };
  expect(t.act(command)).toMatchObject({
    accepted: false,
    reason: 'insufficient-common-account-balance',
  });
  expect(t.s).toEqual(initial);
  t.contribute();
  expect(t.s.accounts.pool!.controlVersion).toBe(1);
  t.ok(command);
  expect(
    t.act({ ...command, amount: 5, recipient: { sector: 'agent', id: 'missing' } }),
  ).toMatchObject({ accepted: false, reason: 'recipient-not-available' });
  expect(t.s.accounts.pool!.balance).toBe(20);
  t.replay();
});
test('collective, enterprise and treasury counterparties are all circulating accounts', () => {
  const t = fixture();
  t.open();
  t.contribute(100);
  t.ok({ type: 'open', id: 'second', collectiveId: 'other', title: '另一集体' }, 'b');
  for (const recipient of [
    { sector: 'collective', id: 'second' },
    { sector: 'enterprise', id: 'e' },
    { sector: 'treasury', id: 'public-treasury' },
  ] as const)
    t.ok({
      type: 'transfer',
      id: 'pool',
      controlVersion: 1,
      recipient,
      amount: 20,
      note: '实际转移',
      authority: authority(),
    });
  expect(t.s.accounts.pool!.balance).toBe(40);
  expect(t.s.accounts.second!.balance).toBe(20);
  expect(t.external['enterprise:e']).toBe(70);
  expect(t.external['treasury:public-treasury']).toBe(120);
  expect(
    t.act({
      type: 'transfer',
      id: 'pool',
      controlVersion: 1,
      recipient: { sector: 'collective', id: 'pool' },
      amount: 1,
      note: 'x',
      authority: authority(),
    }),
  ).toMatchObject({ accepted: false, reason: 'invalid-recipient-account' });
  t.replay();
});
test('settlement stops incoming obligations and cannot close while money or external obligations remain', () => {
  const t = fixture();
  t.open();
  t.contribute();
  const close = { type: 'close' as const, id: 'pool', controlVersion: 1, authority: authority() };
  expect(t.act(close)).toMatchObject({
    accepted: false,
    reason: 'common-account-settlement-required',
  });
  t.ok({ type: 'beginSettlement', id: 'pool', controlVersion: 1, authority: authority() });
  expect(t.act({ ...close, controlVersion: 2 })).toMatchObject({
    accepted: false,
    reason: 'common-account-not-settled',
  });
  expect(
    t.act({ type: 'contribute', id: 'pool', expectedRevision: 3, amount: 1, note: 'x' }, 'b'),
  ).toMatchObject({ accepted: false, reason: 'common-account-not-receiving' });
  t.pay(50);
  t.obligations(true);
  expect(t.act({ ...close, controlVersion: 2 })).toMatchObject({
    accepted: false,
    reason: 'common-account-not-settled',
  });
  t.obligations(false);
  t.ok({ ...close, controlVersion: 2 });
  expect(t.s.accounts.pool).toMatchObject({ status: 'closed', balance: 0, controlVersion: 3 });
  expect(t.act({ ...close, controlVersion: 3 })).toMatchObject({
    accepted: false,
    reason: 'common-account-closed',
  });
  t.replay();
});
test('funding admission budgets never trap existing money or prevent settlement', () => {
  const t = fixture({ ...COMMON_ACCOUNTS_POLICY, maxFundingReceiptsPerAccount: 1 });
  t.open();
  t.contribute();
  expect(
    t.act({ type: 'contribute', id: 'pool', expectedRevision: 2, amount: 1, note: 'x' }, 'b'),
  ).toMatchObject({ accepted: false, reason: 'common-account-funding-quota-exceeded' });
  t.ok({ type: 'beginSettlement', id: 'pool', controlVersion: 1, authority: authority() });
  t.pay(25);
  t.pay(25);
  t.ok({ type: 'close', id: 'pool', controlVersion: 2, authority: authority() });
  expect(t.external['agent:b']).toBe(100);
  t.replay();
});
test('finite amounts, representable deltas, exact revisions and duplicate receipts protect balances', () => {
  const t = fixture();
  t.open();
  for (const amount of [NaN, Infinity, -1, 0, COMMON_ACCOUNTS_POLICY.maxTransfer + 1])
    expect(
      t.act({ type: 'contribute', id: 'pool', expectedRevision: 1, amount, note: 'x' }, 'b'),
    ).toMatchObject({ accepted: false, reason: 'invalid-common-account-transfer' });
  expect(
    t.act({ type: 'contribute', id: 'pool', expectedRevision: 2, amount: 1, note: 'x' }, 'b'),
  ).toMatchObject({ accepted: false, reason: 'revision-conflict' });
  expect(
    t.act({ type: 'contribute', id: 'pool', expectedRevision: 1, amount: 101, note: 'x' }, 'b'),
  ).toMatchObject({ accepted: false, reason: 'insufficient-personal-balance' });
  expect(
    t.act({ type: 'contribute', id: 'pool', expectedRevision: 1, amount: 1, note: 'x' }, 'b', 'r1'),
  ).toMatchObject({ accepted: false, reason: 'duplicate-common-account-receipt' });
  expect(commonAccountNextBalance(1e20, 1, Number.MAX_VALUE)).toBeUndefined();
  expect(commonAccountNextBalance(1, -2, 100)).toBeUndefined();
  expect(commonAccountNextBalance(Infinity, -1, 100)).toBeUndefined();
  expect(() =>
    applyCommonAccountEvent(t.s, { type: 'CommonAccountChanged', account: t.s.accounts.pool! }),
  ).toThrow('common-account-revision-gap');
  t.replay();
});
test('resource parser is closed and cannot accept caller-supplied authority or another treasury alias', () => {
  const value = {
    controlVersion: 1,
    recipient: { sector: 'agent', id: 'a' },
    amount: 1,
    note: '原话',
  };
  expect(
    parseCommonAccountOperation('funds.transfer', 'pool', value, COMMON_ACCOUNTS_POLICY),
  ).toMatchObject({ type: 'transfer', ...value });
  for (const v of [
    { ...value, authority: true },
    { ...value, amount: '1' },
    { ...value, recipient: { sector: 'treasury', id: 'mine' } },
    { ...value, controlVersion: 0 },
  ])
    expect(
      parseCommonAccountOperation('funds.transfer', 'pool', v, COMMON_ACCOUNTS_POLICY),
    ).toBeUndefined();
  expect(
    parseCommonAccountOperation(
      'funds.close',
      'pool',
      { controlVersion: 1 },
      COMMON_ACCOUNTS_POLICY,
    ),
  ).toEqual({ type: 'close', id: 'pool', controlVersion: 1 });
  expect(
    parseCommonAccountOperation('funds.mint', 'pool', value, COMMON_ACCOUNTS_POLICY),
  ).toBeUndefined();
});
