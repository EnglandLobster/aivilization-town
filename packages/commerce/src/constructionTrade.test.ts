import { emptyEvidenceTradeState } from './tradeModel';
import {
  evidenceTradeEscrowBalance,
  tradeAccountObligations,
  tradeReservedCommonIncoming,
} from './tradeMoney';
import { expect, test } from 'vitest';
import type { ResourcePrincipal, PrincipalAuthoritySource } from '@aivilization/authority';
import {
  expireConstructionTradeOffers,
  emptyConstructionTradeState,
  decideConstructionTrade,
  applyConstructionTradeEvent,
  constructionTradeEscrowMicros,
  constructionTradeIncomingMicros,
  constructionTradeAccountObligations,
} from './constructionTrade';
import type {
  ConstructionTradeCommand,
  ConstructionTradePorts,
  ConstructionTradeEvent,
} from './constructionTradeModel';
import type { ConstructionTradeEvidence } from './constructionTradeFacts';
function fixture(buyer: ResourcePrincipal = { kind: 'resident', id: 'buyer' }) {
  let state = emptyConstructionTradeState(),
    actor = 'seller',
    balance = 100,
    capacity = 100,
    authorized = true;
  let evidence: ConstructionTradeEvidence = {
    sourceVersion: 'resident-premises-v1',
    basis: {
      projectId: 'p',
      kind: 'build',
      siteId: 's',
      buildingId: 'b',
      beneficiary: buyer,
      specificationHash: 'a'.repeat(64),
      requiredWorkMs: 1000,
    },
    revision: 1,
    at: 0,
    progressMs: 0,
    status: 'open',
  };
  const payer = {
    sector:
      buyer.kind === 'public'
        ? ('treasury' as const)
        : buyer.kind === 'resident'
          ? ('agent' as const)
          : buyer.kind,
    id: buyer.kind === 'public' ? 'public-treasury' : buyer.id,
  };
  const ports: ConstructionTradePorts = {
    exists: () => true,
    evidence: () => evidence,
    account: (a) => ({
      principal: a.id === 'seller' ? { kind: 'resident', id: 'seller' } : buyer,
      balance,
      incomingCapacity: capacity,
      status: 'open',
    }),
    authorize: (principal, request) => {
      if (!authorized) return undefined;
      const source: PrincipalAuthoritySource =
        principal.kind === 'resident'
          ? { kind: 'personal' }
          : principal.kind === 'public'
            ? { kind: 'public', proposalId: 'independent-public-decision', procedureRevision: 1 }
            : principal.kind === 'enterprise'
              ? { kind: 'enterprise', managementVersion: 1, managementDecisionId: null }
              : {
                  kind: 'collective',
                  decisionId: 'independent-collective-decision',
                  charterVersion: 1,
                };
      return { actorId: actor, principal, request, source };
    },
  };
  const offer: ConstructionTradeCommand = {
    type: 'offer',
    terms: {
      id: 'o',
      projectId: 'p',
      sourceRevision: 1,
      seller: { kind: 'resident', id: 'seller' },
      buyer,
      payer,
      revenue: { sector: 'agent', id: 'seller' },
      amount: 30,
      acceptBy: 100,
      title: 'build',
      terms: 'fixed project delivery',
    },
  };
  const events: ConstructionTradeEvent[] = [];
  const act = (a: string, c: ConstructionTradeCommand, id: string, at = 0) => {
    actor = a;
    return decideConstructionTrade(state, a, at, id, c, ports);
  };
  const commit = (a: string, c: ConstructionTradeCommand, id: string, at = 0) => {
    const d = act(a, c, id, at);
    expect(d.accepted, d.accepted ? '' : d.reason).toBe(true);
    if (!d.accepted) throw Error(d.reason);
    for (const e of d.events) {
      state = applyConstructionTradeEvent(state, e);
      events.push(e);
    }
    for (const t of d.transactions)
      expect(t.entries.reduce((n, e) => n + e.amount, 0)).toBeCloseTo(0, 10);
    return d;
  };
  const cmd = (
    type: 'accept' | 'observe' | 'withdraw',
    side: 'buyer' | 'seller' = 'buyer',
  ): ConstructionTradeCommand => ({
    type,
    id: 'o',
    expectedRevision: state.orders.o!.revision,
    side,
  });
  return {
    get state() {
      return state;
    },
    get evidence() {
      return evidence;
    },
    set evidence(e: ConstructionTradeEvidence) {
      evidence = e;
    },
    get payer() {
      return payer;
    },
    set balance(v: number) {
      balance = v;
    },
    set capacity(v: number) {
      capacity = v;
    },
    set authorized(v: boolean) {
      authorized = v;
    },
    events,
    offer,
    act,
    commit,
    cmd,
  };
}
test('independent funding and physical completion settle once with balanced transactions and deterministic replay', () => {
  const f = fixture();
  f.commit('seller', f.offer, 'offer');
  const accept = f.cmd('accept');
  const funded = f.commit('buyer', accept, 'fund');
  expect(funded.transactions).toHaveLength(1);
  expect(constructionTradeEscrowMicros(f.state)).toBe(30000000);
  expect(f.act('buyer', accept, 'fund')).toEqual({ accepted: true, events: [], transactions: [] });
  expect(f.act('seller', accept, 'fund')).toMatchObject({
    accepted: false,
    reason: 'construction-trade-receipt-conflict',
  });
  f.evidence = { ...f.evidence, revision: 2, at: 1000, progressMs: 1000, status: 'completed' };
  f.commit('seller', f.cmd('observe', 'seller'), 'complete', 1000);
  expect(f.state.orders.o).toMatchObject({
    status: 'completed',
    paidMicros: 30000000,
    escrowMicros: 0,
    refundedMicros: 0,
  });
  let replay = emptyConstructionTradeState();
  for (const e of f.events)
    replay = applyConstructionTradeEvent(
      replay,
      JSON.parse(JSON.stringify(e)) as ConstructionTradeEvent,
    );
  expect(replay).toEqual(f.state);
  expect(applyConstructionTradeEvent(replay, f.events.at(-1)!)).toEqual(replay);
  expect(() =>
    applyConstructionTradeEvent(emptyConstructionTradeState(), f.events.at(-1)!),
  ).toThrow('revision');
});
test('partial work and cancellation retain escrow until the other subject accepts an exact split', () => {
  const f = fixture();
  f.commit('seller', f.offer, 'offer');
  f.commit('buyer', f.cmd('accept'), 'fund');
  f.evidence = { ...f.evidence, revision: 2, at: 500, progressMs: 500, status: 'cancelled' };
  f.commit('buyer', f.cmd('observe'), 'cancel-observation', 500);
  expect(f.state.orders.o).toMatchObject({
    status: 'disputed',
    escrowMicros: 30000000,
    paidMicros: 0,
  });
  expect(constructionTradeAccountObligations(f.state, f.payer)).toBe(true);
  expect(constructionTradeIncomingMicros(f.state, f.payer)).toBe(30000000);
  f.commit(
    'seller',
    {
      type: 'propose-settlement',
      id: 'o',
      expectedRevision: 3,
      side: 'seller',
      proposalId: 'split',
      paySeller: 12.000001,
      text: '双方自定补偿',
    },
    'split',
    500,
  );
  expect(
    f.act(
      'seller',
      {
        type: 'accept-settlement',
        id: 'o',
        expectedRevision: 4,
        side: 'seller',
        proposalId: 'split',
      },
      'self',
      500,
    ),
  ).toMatchObject({
    accepted: false,
    reason: 'construction-trade-independent-settlement-required',
  });
  f.commit(
    'buyer',
    { type: 'accept-settlement', id: 'o', expectedRevision: 4, side: 'buyer', proposalId: 'split' },
    'agree',
    500,
  );
  expect(f.state.orders.o).toMatchObject({
    status: 'settled',
    paidMicros: 12000001,
    refundedMicros: 17999999,
    escrowMicros: 0,
  });
  expect(constructionTradeAccountObligations(f.state, f.payer)).toBe(false);
});
test('stale, expired, unauthorized and underfunded commands leave the aggregate untouched', () => {
  const f = fixture();
  f.commit('seller', f.offer, 'offer');
  const before = structuredClone(f.state);
  expect(f.act('buyer', f.cmd('accept'), 'late', 100).accepted).toBe(false);
  f.balance = 29;
  expect(f.act('buyer', f.cmd('accept'), 'poor').accepted).toBe(false);
  f.balance = 100;
  f.capacity = 29;
  expect(f.act('buyer', f.cmd('accept'), 'capacity').accepted).toBe(false);
  f.capacity = 100;
  f.authorized = false;
  expect(f.act('buyer', f.cmd('accept'), 'revoked')).toMatchObject({
    accepted: false,
    reason: 'construction-trade-unauthorized',
  });
  f.authorized = true;
  expect(
    f.act('buyer', { type: 'accept', id: 'o', expectedRevision: 2, side: 'buyer' }, 'stale')
      .accepted,
  ).toBe(false);
  expect(f.state).toEqual(before);
});
test('public and organization accounts require their own exact independent authority and retain obligations after withdrawal', () => {
  for (const buyer of [
    { kind: 'public', id: 'town' },
    { kind: 'collective', id: 'club' },
    { kind: 'enterprise', id: 'firm' },
  ] as const) {
    const f = fixture(buyer);
    f.commit('seller', f.offer, 'offer');
    f.commit('executor', f.cmd('accept'), 'fund');
    const fundedEvent = f.events[1]!;
    if (fundedEvent.type !== 'ConstructionTradeCommitted') throw Error('fixture');
    expect(fundedEvent.authorization.principal).toEqual(buyer);
    f.commit('executor', f.cmd('withdraw'), 'withdraw', 1000);
    expect(f.state.orders.o).toMatchObject({ status: 'disputed', escrowMicros: 30000000 });
    expect(constructionTradeAccountObligations(f.state, f.payer)).toBe(true);
  }
});
test('allows independent competing offers but rejects started work, source substitution and unearned delivery', () => {
  const f = fixture();
  f.commit('seller', f.offer, 'offer');
  if (f.offer.type !== 'offer') throw Error('fixture');
  expect(
    f.act('seller', { type: 'offer', terms: { ...f.offer.terms, id: 'second' } }, 'duplicate')
      .accepted,
  ).toBe(true);
  f.evidence = { ...f.evidence, revision: 2, at: 1, progressMs: 1 };
  expect(f.act('buyer', f.cmd('accept'), 'started', 1).accepted).toBe(false);
  f.evidence = { ...f.evidence, status: 'completed' };
  expect(f.act('buyer', f.cmd('accept'), 'false-completion', 1).accepted).toBe(false);
  f.evidence = {
    ...f.evidence,
    status: 'open',
    basis: { ...f.evidence.basis, specificationHash: 'b'.repeat(64) },
  };
  expect(f.act('buyer', f.cmd('accept'), 'substitution', 1).accepted).toBe(false);
});

test('unpaid expiry is deterministic and never clears funded obligations; replay refuses forged accounting', () => {
  const f = fixture();
  f.commit('seller', f.offer, 'offer');
  expect(expireConstructionTradeOffers(f.state, 99)).toMatchObject({ accepted: true, events: [] });
  const expired = expireConstructionTradeOffers(f.state, 100);
  if (!expired.accepted) throw Error(expired.reason);
  const state = applyConstructionTradeEvent(f.state, expired.events[0]!);
  expect(state.orders.o!.status).toBe('cancelled');
  expect(expireConstructionTradeOffers(state, 200)).toMatchObject({ accepted: true, events: [] });
  f.commit('buyer', f.cmd('accept'), 'fund');
  expect(expireConstructionTradeOffers(f.state, 10000)).toMatchObject({
    accepted: true,
    events: [],
  });
  const initial = applyConstructionTradeEvent(emptyConstructionTradeState(), f.events[0]!);
  expect(() => applyConstructionTradeEvent(initial, { ...f.events[1]!, transactions: [] })).toThrow(
    'replay-transactions',
  );
});

test('unsolicited offers neither freeze buyer money nor monopolize a project; only one can be funded', () => {
  const f = fixture();
  f.commit('seller', f.offer, 'offer');
  expect(constructionTradeAccountObligations(f.state, f.payer)).toBe(false);
  if (f.offer.type !== 'offer') throw Error('fixture');
  f.commit(
    'seller',
    { type: 'offer', terms: { ...f.offer.terms, id: 'alternative', amount: 20 } },
    'alternative',
  );
  f.commit('buyer', f.cmd('accept'), 'fund');
  expect(
    f.act(
      'buyer',
      { type: 'accept', id: 'alternative', expectedRevision: 1, side: 'buyer' },
      'double',
    ),
  ).toMatchObject({ accepted: false, reason: 'construction-trade-project-already-bound' });
  expect(constructionTradeEscrowMicros(f.state)).toBe(30000000);
});

test('shared trade totals and common-account closure see construction escrow; old state remains unchanged', () => {
  const f = fixture({ kind: 'collective', id: 'club' });
  f.commit('seller', f.offer, 'offer');
  const legacy = emptyEvidenceTradeState();
  expect(evidenceTradeEscrowBalance(legacy)).toBe(0);
  expect(tradeAccountObligations(legacy, 'club')).toBe(false);
  f.commit('executor', f.cmd('accept'), 'fund');
  const parent = { ...legacy, constructionOrders: f.state };
  expect(evidenceTradeEscrowBalance(parent)).toBe(30);
  expect(tradeReservedCommonIncoming(parent, 'club')).toBe(30);
  expect(tradeAccountObligations(parent, 'club')).toBe(true);
  f.commit('executor', f.cmd('withdraw'), 'withdraw', 1000);
  expect(evidenceTradeEscrowBalance({ ...parent, constructionOrders: f.state })).toBe(30);
  expect(evidenceTradeEscrowBalance(legacy)).toBe(0);
});
