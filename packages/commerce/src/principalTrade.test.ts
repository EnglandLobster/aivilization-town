import type { AccountingTransaction } from '@aivilization/economy';
import { expect, test } from 'vitest';
import { type PrincipalAuthoritySource, type ResourcePrincipal } from '@aivilization/authority';
import {
  EVIDENCE_TRADE_POLICY_V2,
  emptyEvidenceTradeState,
  type EvidenceTradeState,
} from './tradeModel';
import {
  PRINCIPAL_EVIDENCE_TRADE_POLICY,
  type PrincipalTradePorts,
  type PrincipalTradeCommand,
  type PrincipalPermitTradeEvidence,
  type PrincipalTradeEvent,
} from './principalTradeModel';
import {
  applyPrincipalEvidenceTradeCommit,
  decidePrincipalEvidenceTrade,
  advancePrincipalEvidenceTrade,
  principalTradeAccountObligations,
  principalTradeReservedIncomingMicros,
} from './principalTrade';
import { evidenceTradeEscrowBalance } from './tradeMoney';
import { tradeSourceStartFailure } from './tradeOrders';
function fixture(buyer: ResourcePrincipal = { kind: 'resident', id: 'user' }) {
  let state = applyPrincipalEvidenceTradeCommit(emptyEvidenceTradeState(EVIDENCE_TRADE_POLICY_V2), [
    { type: 'PrincipalEvidenceTradeEnabled', policy: PRINCIPAL_EVIDENCE_TRADE_POLICY },
  ]);
  let evidence: PrincipalPermitTradeEvidence = {
    sourceVersion: 'principal-premises-provision-v2',
    revision: 1,
    permitRevision: 1,
    at: 0,
    status: 'offered',
    basis: {
      kind: 'permit',
      id: 'permit',
      seller: { kind: 'enterprise', id: 'firm' },
      buyer,
      createdAt: 0,
      buildingId: 'hall',
      issuerVersion: 1,
      users: ['user'],
      scopes: ['operate'],
      mode: 'shared',
      title: 'workshop',
      terms: 'fixed permission',
      startAt: 10,
      endAt: 110,
      acceptBy: 20,
      principalVersion: 'resident-premises-principal-permits-v2',
    },
  };
  let actorId = 'manager';
  const history: {
    events: readonly PrincipalTradeEvent[];
    transactions: readonly AccountingTransaction[];
  }[] = [];
  const ports: PrincipalTradePorts = {
    exists: () => true,
    available: () => true,
    evidence: () => evidence,
    account: (a) => ({
      principal:
        a.sector === 'enterprise'
          ? { kind: 'enterprise', id: a.id }
          : a.sector === 'treasury'
            ? { kind: 'public', id: 'town' }
            : a.sector === 'collective'
              ? { kind: 'collective', id: 'club' }
              : { kind: 'resident', id: a.id },
      balance: 100,
      status: 'open',
    }),
    authorize: (principal, request) => {
      const source: PrincipalAuthoritySource =
        principal.kind === 'resident'
          ? { kind: 'personal' }
          : principal.kind === 'enterprise'
            ? { kind: 'enterprise', managementVersion: 1, managementDecisionId: null }
            : principal.kind === 'collective'
              ? { kind: 'collective', decisionId: 'independent', charterVersion: 1 }
              : { kind: 'public', proposalId: 'approved', procedureRevision: 1 };
      return { actorId, principal, request, source };
    },
  };
  const offer: Extract<PrincipalTradeCommand, { type: 'offer' }> = {
    type: 'offer',
    id: 'order',
    title: 'real fee',
    terms: 'pay for actual available permission, not attendance',
    source: { kind: 'permit', id: 'permit', expectedRevision: 1 },
    payer:
      buyer.kind === 'resident'
        ? { sector: 'agent', id: buyer.id }
        : buyer.kind === 'public'
          ? { sector: 'treasury', id: 'public-treasury' }
          : {
              sector: buyer.kind === 'enterprise' ? 'enterprise' : 'collective',
              id: buyer.kind === 'collective' ? 'shared' : buyer.id,
            },
    revenue: { sector: 'enterprise', id: 'firm' },
    amount: 3.000001,
    acceptBy: 20,
  };
  const commit = (d: ReturnType<typeof decidePrincipalEvidenceTrade>) => {
    if (d.accepted && d.events.length) {
      state = applyPrincipalEvidenceTradeCommit(state, d.events, d.transactions);
      history.push(d);
    }
    return d;
  };
  const run = (
    actor: string,
    at: number,
    c: PrincipalTradeCommand,
    p: Partial<PrincipalTradePorts> = {},
  ) => {
    actorId = actor;
    return commit(decidePrincipalEvidenceTrade(state, actor, at, c, { ...ports, ...p }));
  };
  const funded = () => {
    expect(run('manager', 0, offer).accepted).toBe(true);
    expect(run('user', 1, { type: 'accept', id: 'order', expectedRevision: 1 }).accepted).toBe(
      true,
    );
  };
  const progress = (
    at: number,
    availableMs: number,
    unavailableMs: number,
    status: 'accepted' | 'released' | 'expired' = 'accepted',
  ) => {
    evidence = {
      ...evidence,
      status,
      revision: 3 + at,
      permitRevision: 2,
      at,
      acceptedAt: 1,
      ...(status === 'accepted' ? {} : { closedAt: at }),
      provision: { orderId: 'order', revision: 1 + at, settledAt: at, availableMs, unavailableMs },
    };
  };
  return {
    get state() {
      return state;
    },
    get evidence() {
      return evidence;
    },
    ports,
    offer,
    run,
    history,
    funded,
    progress,
    observe: (at: number) => commit(advancePrincipalEvidenceTrade(state, 'order', at, ports)),
    replay: () => {
      let s: EvidenceTradeState = applyPrincipalEvidenceTradeCommit(
        emptyEvidenceTradeState(EVIDENCE_TRADE_POLICY_V2),
        [{ type: 'PrincipalEvidenceTradeEnabled', policy: PRINCIPAL_EVIDENCE_TRADE_POLICY }],
      );
      const stored = JSON.parse(JSON.stringify(history)) as typeof history;
      for (const h of stored) s = applyPrincipalEvidenceTradeCommit(s, h.events, h.transactions);
      expect(s).toEqual(state);
    },
  };
}
test('explicit companion preserves old policy and escrow; correct accounts and independent authority fund exactly once', () => {
  const f = fixture();
  expect(f.state.policy.version).toBe('resident-evidence-trade-v2');
  expect(f.run('manager', 0, f.offer, { authorize: () => undefined }).accepted).toBe(false);
  expect(f.run('manager', 0, f.offer).accepted).toBe(true);
  expect(tradeSourceStartFailure(f.state, { kind: 'permit', id: 'permit' })).toBe(
    'trade-payment-or-offer-release-required',
  );
  expect(f.run('manager', 1, { type: 'accept', id: 'order', expectedRevision: 1 }).accepted).toBe(
    false,
  );
  expect(
    f.run(
      'user',
      1,
      { type: 'accept', id: 'order', expectedRevision: 1 },
      { account: (a) => ({ ...f.ports.account(a)!, balance: 0 }) },
    ),
  ).toMatchObject({ accepted: false, reason: 'insufficient-principal-trade-balance' });
  expect(f.run('user', 1, { type: 'accept', id: 'order', expectedRevision: 1 }).accepted).toBe(
    true,
  );
  expect(evidenceTradeEscrowBalance(f.state)).toBe(3.000001);
  expect(f.run('user', 1, { type: 'accept', id: 'order', expectedRevision: 1 }).accepted).toBe(
    false,
  );
  f.replay();
});
test('public, collective and enterprise buyers use their own real accounts, not the executor balance', () => {
  for (const kind of ['public', 'collective', 'enterprise'] as const) {
    const f = fixture({
      kind,
      id: kind === 'public' ? 'town' : kind === 'collective' ? 'club' : 'buyer-firm',
    });
    f.funded();
    const tx = f.history[1]!.transactions[0]!;
    expect(tx.entries.some((e) => e.account.sector === f.offer.payer.sector && e.amount < 0)).toBe(
      true,
    );
    expect(tx.entries.reduce((n, e) => n + e.amount, 0)).toBe(0);
    f.replay();
  }
});
test('wrong principal revenue/payer, unavailable and settling accounts or nonfinite balances reject before funding', () => {
  for (const override of [
    { account: () => undefined },
    {
      account: () => ({
        principal: { kind: 'resident' as const, id: 'manager' },
        balance: 100,
        status: 'open' as const,
      }),
    },
    {
      account: (a: Parameters<PrincipalTradePorts['account']>[0]) => ({
        principal: {
          kind: a.sector === 'enterprise' ? ('enterprise' as const) : ('resident' as const),
          id: a.id,
        },
        balance: NaN,
        status: 'open' as const,
      }),
    },
    {
      account: (a: Parameters<PrincipalTradePorts['account']>[0]) => ({
        principal: {
          kind: a.sector === 'enterprise' ? ('enterprise' as const) : ('resident' as const),
          id: a.id,
        },
        balance: 100,
        status: 'settling' as const,
      }),
    },
    { available: () => false },
  ]) {
    const f = fixture();
    expect(f.run('manager', 0, f.offer, override).accepted).toBe(false);
    expect(f.state.principalOrders!.orders).toEqual({});
  }
});
test('recorded permission availability pays exact cumulative integer shares and early release refunds only unfulfilled time', () => {
  const f = fixture();
  f.funded();
  f.progress(60, 30, 20);
  expect(f.observe(60).accepted).toBe(true);
  expect(f.state.principalOrders!.orders.order).toMatchObject({
    earnedMicros: 900000,
    paidMicros: 900000,
    refundedMicros: 600000,
    escrowMicros: 1500001,
    status: 'funded',
  });
  f.progress(80, 40, 30, 'released');
  expect(f.observe(80).accepted).toBe(true);
  expect(f.state.principalOrders!.orders.order).toMatchObject({
    paidMicros: 1200000,
    refundedMicros: 1800001,
    escrowMicros: 0,
    status: 'settled',
  });
  expect(evidenceTradeEscrowBalance(f.state)).toBe(0);
  f.replay();
});
test('split settlement equals one settlement, settlement cannot fabricate availability or change original accounts', () => {
  const split = fixture(),
    once = fixture();
  split.funded();
  once.funded();
  split.progress(35, 20, 5);
  split.observe(35);
  split.progress(60, 40, 10);
  split.observe(60);
  split.progress(110, 70, 30, 'expired');
  split.observe(110);
  once.progress(110, 70, 30, 'expired');
  once.observe(110);
  for (const field of ['paidMicros', 'refundedMicros', 'escrowMicros', 'earnedMicros'] as const)
    expect(split.state.principalOrders!.orders.order![field]).toBe(
      once.state.principalOrders!.orders.order![field],
    );
  const h = split.history[1]!;
  expect(() =>
    applyPrincipalEvidenceTradeCommit(
      applyPrincipalEvidenceTradeCommit(emptyEvidenceTradeState(EVIDENCE_TRADE_POLICY_V2), [
        { type: 'PrincipalEvidenceTradeEnabled', policy: PRINCIPAL_EVIDENCE_TRADE_POLICY },
      ]),
      h.events,
      h.transactions,
    ),
  ).toThrow();
  split.replay();
  once.replay();
});
test('shared account closure and incoming capacity account for held new order funds', () => {
  const f = fixture({ kind: 'collective', id: 'club' });
  f.funded();
  expect(principalTradeAccountObligations(f.state, { sector: 'collective', id: 'shared' })).toBe(
    true,
  );
  expect(
    principalTradeReservedIncomingMicros(f.state, { sector: 'collective', id: 'shared' }),
  ).toBe(3000001);
  f.progress(110, 100, 0, 'expired');
  f.observe(110);
  expect(principalTradeAccountObligations(f.state, { sector: 'collective', id: 'shared' })).toBe(
    false,
  );
  f.replay();
});
