import { asAgentId } from '@aivilization/sim-core';
import { COMMON_ACCOUNTS_POLICY, commonAccountsBalance } from '@aivilization/economy';
import { applyEnterpriseDomainEvent } from '@aivilization/enterprise';
import { expect, test } from 'vitest';
import { applyWorldEvent, createWorldProjection } from './projection';
import {
  enableCommonAccountsEvent,
  residentCommonAccountEvent,
  type CommonAccountAuthorizationPort,
  type ResidentCommonAccountCommand,
} from './residentCommonAccounts';
import type { WorldEvent } from './events';
function fixture() {
  const enterprise = applyEnterpriseDomainEvent(undefined, {
    type: 'EnterpriseFounded',
    enterpriseId: 'e',
    ownerAgentId: asAgentId('a'),
    name: '实体经营',
    occupationName: 'maker',
    initialCapital: 50,
    maxEmployees: 3,
    occurredAt: 0,
  });
  const initial = createWorldProjection({
    agents: ['a', 'b'].map((id) => ({
      agentId: asAgentId(id),
      balance: 100,
      inventory: {},
      physiology: { energy: 100, satiety: 100, health: 100 },
      educationScore: 0,
      residentialTier: 1,
      job: null,
    })),
    enterprises: [enterprise],
    treasury: 100,
    moneySupply: 350,
  });
  let w = initial,
    n = 0;
  const events: WorldEvent[] = [];
  const authorization: CommonAccountAuthorizationPort = {
    isActiveMember: (id, a) => id === 'club' && a === 'a',
    authorize: () => ({
      accepted: true,
      authority: {
        collectiveId: 'club',
        decisionId: 'decision',
        decisionRevision: 4,
        charterVersion: 1,
      },
    }),
    unresolvedObligations: () => false,
  };
  const commit = (es: readonly WorldEvent[]) => {
    for (const e of es) {
      w = applyWorldEvent(w, e);
      events.push(e);
    }
    expect(
      Object.values(w.agents).reduce((v, a) => v + a.balance, 0) +
        Object.values(w.enterprises).reduce((v, e) => v + e.balance, 0) +
        (w.treasury ?? 0) +
        commonAccountsBalance(w.commonAccounts),
    ).toBeCloseTo(w.moneySupply, 9);
  };
  const act = (command: ResidentCommonAccountCommand, auth = authorization) =>
    residentCommonAccountEvent({
      projection: w,
      actorId: 'a',
      command,
      authorization: auth,
      requestId: `r${++n}`,
      receiptId: `receipt${n}`,
      simulationId: 's',
      nextSequence: events.length + 1,
    });
  const ok = (command: ResidentCommonAccountCommand) => {
    const d = act(command);
    expect(d.accepted, JSON.stringify(d)).toBe(true);
    if (d.accepted) commit(d.events);
  };
  const enable = () =>
    commit([
      enableCommonAccountsEvent({
        simulationId: 's',
        requestId: 'enable',
        nextSequence: 1,
        at: 0,
        policy: COMMON_ACCOUNTS_POLICY,
      }),
    ]);
  const seed = () => {
    enable();
    ok({ type: 'open', id: 'pool', collectiveId: 'club', title: '共同资金' });
    ok({ type: 'contribute', id: 'pool', expectedRevision: 1, amount: 60, note: '本人真实出资' });
  };
  const replay = () => expect(events.reduce(applyWorldEvent, initial)).toEqual(w);
  return {
    get w() {
      return w;
    },
    events,
    authorization,
    act,
    ok,
    enable,
    seed,
    replay,
  };
}
test('world settlement preserves every circulating account and uses enterprise domain funding', () => {
  const t = fixture();
  t.seed();
  for (const recipient of [
    { sector: 'agent', id: 'b' },
    { sector: 'enterprise', id: 'e' },
    { sector: 'treasury', id: 'public-treasury' },
  ] as const)
    t.ok({
      type: 'transfer',
      id: 'pool',
      controlVersion: 1,
      recipient,
      amount: 10,
      note: '精确决定',
    });
  expect(t.w.agents.a!.balance).toBe(40);
  expect(t.w.agents.b!.balance).toBe(110);
  expect(t.w.enterprises.e!.balance).toBe(60);
  expect(t.w.treasury).toBe(110);
  expect(t.w.commonAccounts!.accounts.pool!.balance).toBe(30);
  expect(t.w.moneySupply).toBe(350);
  const enterpriseEvent = t.events.find(
    (e) => e.type === 'ResidentCommonAccountsCommitted' && e.payload.enterpriseFunding.length > 0,
  );
  expect(enterpriseEvent).toMatchObject({
    payload: {
      enterpriseFunding: [{ enterpriseId: 'e', event: { type: 'EnterpriseFunded', amount: 10 } }],
    },
  });
  t.replay();
});
test('authorization refusal and insufficient funds leave world state unchanged', () => {
  const t = fixture();
  t.seed();
  const before = structuredClone(t.w),
    command = {
      type: 'transfer' as const,
      id: 'pool',
      controlVersion: 1,
      recipient: { sector: 'agent' as const, id: 'b' },
      amount: 10,
      note: 'x',
    };
  expect(
    t.act(command, {
      ...t.authorization,
      authorize: () => ({ accepted: false, reason: 'no-proof' }),
    }),
  ).toEqual({ accepted: false, reason: 'no-proof' });
  expect(t.act({ ...command, amount: 61 })).toEqual({
    accepted: false,
    reason: 'insufficient-common-account-balance',
  });
  expect(t.w).toEqual(before);
  t.replay();
});
test('reducer rejects unmatched balances, receipts and enterprise effects', () => {
  const t = fixture();
  t.seed();
  const d = t.act({
    type: 'transfer',
    id: 'pool',
    controlVersion: 1,
    recipient: { sector: 'enterprise', id: 'e' },
    amount: 10,
    note: 'x',
  });
  expect(d.accepted).toBe(true);
  if (!d.accepted) return;
  const e = d.events[0]!;
  if (e.type !== 'ResidentCommonAccountsCommitted') throw new Error('unexpected event');
  expect(() => applyWorldEvent(t.w, { ...e, payload: { ...e.payload, transactions: [] } })).toThrow(
    'common-account-ledger-mismatch',
  );
  expect(() =>
    applyWorldEvent(t.w, { ...e, payload: { ...e.payload, enterpriseFunding: [] } }),
  ).toThrow('common-account-enterprise-ledger-mismatch');
  expect(() =>
    applyWorldEvent(t.w, {
      ...e,
      payload: {
        ...e.payload,
        events: e.payload.events.filter((v) => v.type !== 'CommonAccountReceiptRecorded'),
      },
    }),
  ).toThrow('common-account-receipt-mismatch');
  t.replay();
});
test('legacy world remains without accounts until an explicit enable event; enable does not mint', () => {
  const t = fixture();
  expect(t.w.commonAccounts).toBeUndefined();
  expect(t.act({ type: 'open', id: 'pool', collectiveId: 'club', title: 'x' })).toEqual({
    accepted: false,
    reason: 'common-accounts-not-enabled',
  });
  t.enable();
  expect(t.w.commonAccounts?.accounts).toEqual({});
  expect(t.w.moneySupply).toBe(350);
  expect(() => applyWorldEvent(t.w, t.events[0]!)).toThrow('common-accounts-already-enabled');
  t.replay();
});
