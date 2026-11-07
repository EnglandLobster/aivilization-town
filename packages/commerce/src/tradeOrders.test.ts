import { describe, expect, it } from 'vitest';
import type { Controller } from '@aivilization/authority';
import {
  EVIDENCE_TRADE_POLICY,
  TRADE_PUBLIC_FUNDING_POLICY,
  advanceEvidenceTrade,
  applyEvidenceTradeCommit,
  decideEvidenceTrade,
  emptyEvidenceTradeState,
  evidenceTradeEscrowBalance,
  tradeAccountObligations,
  tradeReservedCommonIncoming,
  tradeSourceStartFailure,
  type EvidenceTradeCommand,
  type EvidenceTradeDecision,
  type EvidenceTradePorts,
  type EvidenceTradeState,
  type TradeEvidence,
} from './index';
const seller: Controller = { kind: 'resident', id: 'seller' },
  buyer: Controller = { kind: 'resident', id: 'buyer' };
const freight = (): Extract<TradeEvidence, { sourceVersion: 'resident-logistics-v1' }> => ({
  sourceVersion: 'resident-logistics-v1',
  revision: 3,
  at: 100,
  status: 'funded',
  basis: {
    kind: 'freight',
    id: 'freight-one',
    seller,
    buyer,
    createdAt: 10,
    sourceStockId: 'source',
    destinationStockId: 'destination',
    sourceLocationId: 'west',
    destinationLocationId: 'east',
    items: { Wood: 3 },
    deadline: 10000,
  },
});
function harness(initial: TradeEvidence = freight()) {
  let state = emptyEvidenceTradeState(),
    source = initial,
    balance = 100;
  const journal: Extract<EvidenceTradeDecision, { accepted: true }>[] = [];
  const ports: EvidenceTradePorts = {
    exists: (id) => ['seller', 'buyer', 'carrier', 'member'].includes(id),
    controllerAvailable: () => true,
    authorize: () => undefined,
    account: (a) => ({
      balance,
      status: 'open',
      controller:
        a.sector === 'agent' ? { kind: 'resident', id: a.id } : { kind: 'collective', id: a.id },
    }),
    evidence: (ref) =>
      ref.kind === source.basis.kind && ref.id === source.basis.id ? source : undefined,
  };
  const run = (
    actor: string,
    command: EvidenceTradeCommand,
    at = 200,
    custom: EvidenceTradePorts = ports,
  ) => decideEvidenceTrade(state, actor, at, command, custom);
  const commit = (d: EvidenceTradeDecision) => {
    if (!d.accepted) throw Error(d.reason);
    state = applyEvidenceTradeCommit(state, d.events, d.transactions, d.evidenceReads);
    journal.push(d);
    for (const t of d.transactions)
      expect(t.entries.reduce((n, e) => n + e.amount, 0)).toBeCloseTo(0, 10);
    return d;
  };
  const offer = (
    extra: Partial<Extract<EvidenceTradeCommand, { type: 'offer' }>> = {},
    actor = 'seller',
    custom = ports,
  ) =>
    commit(
      run(
        actor,
        {
          type: 'offer',
          id: 'order',
          source: {
            kind: source.basis.kind,
            id: source.basis.id,
            expectedRevision: source.revision,
          },
          payer: { sector: 'agent', id: 'buyer' },
          revenue: { sector: 'agent', id: 'seller' },
          amount: 30,
          acceptBy: 1000,
          title: 'Original title',
          terms: 'Resident price and terms',
          ...extra,
        },
        200,
        custom,
      ),
    );
  const command = (type: 'accept' | 'observe' | 'confirm' | 'withdraw' | 'waive') => ({
    type,
    id: 'order',
    expectedRevision: state.orders.order!.revision,
  });
  return {
    get state() {
      return state;
    },
    get source() {
      return source;
    },
    set source(e: TradeEvidence) {
      source = e;
    },
    get order() {
      return state.orders.order!;
    },
    set balance(n: number) {
      balance = n;
    },
    ports,
    journal,
    run,
    commit,
    offer,
    command,
  };
}
const denied = (d: EvidenceTradeDecision, reason: string) =>
  expect(d).toEqual({ accepted: false, reason });

describe('evidence orders preserve the boundary between original statements, real fulfillment and settlement', () => {
  it('holds an unaccepted source, escrows independently, reads actual delivery, then waits for buyer confirmation', () => {
    const h = harness();
    h.offer();
    expect(tradeSourceStartFailure(h.state, h.source.basis)).toBe(
      'trade-payment-or-offer-release-required',
    );
    denied(h.run('seller', h.command('accept')), 'trade-party-authority-required');
    denied(h.run('carrier', h.command('accept')), 'trade-party-authority-required');
    h.commit(h.run('buyer', h.command('accept')));
    expect(tradeSourceStartFailure(h.state, h.source.basis)).toBeUndefined();
    expect(evidenceTradeEscrowBalance(h.state)).toBe(30);
    denied(h.run('buyer', h.command('confirm')), 'trade-buyer-delivery-confirmation-required');
    denied(h.run('buyer', h.command('observe')), 'trade-source-not-terminal');
    h.source = { ...freight(), revision: 5, at: 300, status: 'delivered' };
    h.commit(h.run('buyer', h.command('observe'), 300));
    expect(h.order).toMatchObject({
      status: 'awaiting-confirmation',
      resolved: true,
      earned: 30,
      escrow: 30,
      paid: 0,
    });
    const c = h.command('confirm');
    h.commit(h.run('buyer', c, 300));
    expect(h.order).toMatchObject({ status: 'completed', escrow: 0, paid: 30, refunded: 0 });
    denied(h.run('buyer', c, 300), 'trade-revision-conflict');
    denied(h.run('buyer', h.command('confirm'), 300), 'trade-ended-or-invalid-receipt');
  });
  it('cannot erase in-transit custody by withdrawing, expiring, or claiming a delivery', () => {
    const h = harness();
    h.offer();
    h.commit(h.run('buyer', h.command('accept')));
    h.source = { ...freight(), revision: 5, at: 500, status: 'return-required' };
    denied(h.run('buyer', h.command('withdraw'), 500), 'trade-unfunded-offer-required');
    denied(h.run('buyer', h.command('observe'), 500), 'trade-source-not-terminal');
    expect(advanceEvidenceTrade(h.state, 'order', 20000, h.ports)).toEqual({
      accepted: true,
      events: [],
      transactions: [],
      evidenceReads: [],
    });
    expect(h.order.escrow).toBe(30);
    h.source = { ...freight(), revision: 6, at: 20000, status: 'returned' };
    h.commit(advanceEvidenceTrade(h.state, 'order', 20000, h.ports));
    expect(h.order).toMatchObject({ status: 'refunded', earned: 0, escrow: 0, refunded: 30 });
    expect(advanceEvidenceTrade(h.state, 'order', 20000, h.ports)).toEqual({
      accepted: true,
      events: [],
      transactions: [],
      evidenceReads: [],
    });
  });
  it('prices only recorded service overlap, returning unused time with deterministic micro-unit rounding', () => {
    const h = harness({
      sourceVersion: 'resident-service-engagements-v1',
      revision: 3,
      at: 100,
      status: 'funded',
      progressMs: 0,
      hasPresence: false,
      basis: {
        kind: 'service',
        id: 'care',
        seller,
        buyer,
        createdAt: 10,
        providerId: 'seller',
        recipientId: 'buyer',
        locationId: 'room',
        pricePerHour: 0,
        maxDurationMs: 6000,
        startAt: 0,
        endAt: 10000,
      },
    });
    h.offer({ amount: 1.000001 });
    h.commit(h.run('buyer', h.command('accept')));
    if (h.source.sourceVersion !== 'resident-service-engagements-v1') throw Error('fixture');
    h.source = { ...h.source, revision: 5, at: 2000, status: 'ended', progressMs: 2000 };
    h.commit(advanceEvidenceTrade(h.state, 'order', 2000, h.ports));
    expect(h.order).toMatchObject({
      earned: 0.333333,
      refunded: 0.666668,
      escrow: 0.333333,
      status: 'awaiting-confirmation',
    });
    h.commit(h.run('buyer', h.command('confirm'), 2000));
    expect(h.order.paid).toBe(0.333333);
    expect(
      h.journal
        .flatMap((d) => d.transactions)
        .flatMap((t) => t.entries)
        .filter((e) => e.account.accountId === 'agent:buyer')
        .reduce((n, e) => n + e.amount, 0),
    ).toBeCloseTo(-0.333333, 9);
  });
  it('retains disputes through actual fulfillment, rejects self acceptance and stale settlement versions', () => {
    const h = harness();
    h.offer();
    h.commit(h.run('buyer', h.command('accept')));
    h.commit(
      h.run('buyer', {
        type: 'dispute',
        id: 'order',
        expectedRevision: h.order.revision,
        content: 'I dispute the described grade',
      }),
    );
    denied(
      h.run('seller', {
        type: 'propose-settlement',
        id: 'order',
        expectedRevision: h.order.revision,
        content: 'Split',
        refund: 10,
      }),
      'invalid-trade-settlement',
    );
    h.source = { ...freight(), revision: 5, at: 300, status: 'delivered' };
    h.commit(advanceEvidenceTrade(h.state, 'order', 300, h.ports));
    expect(h.order.status).toBe('disputed');
    denied(h.run('buyer', h.command('confirm'), 300), 'trade-buyer-delivery-confirmation-required');
    const propose = () => ({
      type: 'propose-settlement' as const,
      id: 'order',
      expectedRevision: h.order.revision,
      content: 'Buyer gets ten, seller twenty',
      refund: 10,
    });
    h.commit(h.run('seller', propose(), 300));
    denied(
      h.run(
        'seller',
        {
          type: 'respond-settlement',
          id: 'order',
          expectedRevision: h.order.revision,
          accept: true,
        },
        300,
      ),
      'trade-independent-current-settlement-required',
    );
    h.commit(
      h.run(
        'buyer',
        {
          type: 'dispute',
          id: 'order',
          expectedRevision: h.order.revision,
          content: 'Another original statement',
        },
        300,
      ),
    );
    denied(
      h.run(
        'buyer',
        {
          type: 'respond-settlement',
          id: 'order',
          expectedRevision: h.order.revision,
          accept: true,
        },
        300,
      ),
      'trade-independent-current-settlement-required',
    );
    h.commit(h.run('seller', propose(), 300));
    h.commit(
      h.run(
        'buyer',
        {
          type: 'respond-settlement',
          id: 'order',
          expectedRevision: h.order.revision,
          accept: true,
        },
        300,
      ),
    );
    expect(h.order).toMatchObject({ status: 'settled', paid: 20, refunded: 10, escrow: 0 });
    expect(h.order.statements.map((s) => s.content)).toContain('I dispute the described grade');
  });
  it('requires current collective decisions and reserves both refund and revenue account headroom only after funding', () => {
    const original = freight();
    const initial: typeof original = {
      ...original,
      basis: {
        ...original.basis,
        seller: { kind: 'collective', id: 'makers' },
        buyer: { kind: 'collective', id: 'buyers' },
      },
    };
    const h = harness(initial);
    const ports = (id: string): EvidenceTradePorts => ({
      ...h.ports,
      authorize: (c) =>
        c.kind === 'collective' && c.id === id
          ? { actorId: 'member', decisionId: `decision-${id}` }
          : undefined,
    });
    const args = {
      payer: { sector: 'collective' as const, id: 'buyers' },
      revenue: { sector: 'collective' as const, id: 'makers' },
    };
    h.offer(args, 'member', ports('makers'));
    expect(tradeAccountObligations(h.state, 'makers')).toBe(false);
    expect(tradeReservedCommonIncoming(h.state, 'buyers')).toBe(0);
    denied(h.run('member', h.command('accept')), 'trade-party-authority-required');
    h.commit(h.run('member', h.command('accept'), 200, ports('buyers')));
    expect(tradeAccountObligations(h.state, 'makers')).toBe(true);
    expect(tradeReservedCommonIncoming(h.state, 'buyers')).toBe(30);
    expect(tradeReservedCommonIncoming(h.state, 'makers')).toBe(30);
    expect(h.journal.at(-1)!.events.at(-1)).toMatchObject({
      receipt: { actorId: 'member', role: 'buyer', decisionId: 'decision-buyers' },
    });
  });
  it('expires unaccepted offers explicitly, frees the start hold, and never reuses the old source', () => {
    const h = harness();
    h.offer();
    denied(h.run('buyer', h.command('accept'), 1000), 'trade-buyer-unstarted-offer-required');
    h.commit(advanceEvidenceTrade(h.state, 'order', 1000, h.ports));
    expect(h.order.status).toBe('expired');
    expect(tradeSourceStartFailure(h.state, h.source.basis)).toBeUndefined();
    const created = h.journal[0]!.events.find((e) => e.type === 'TradeOrderChanged');
    if (!created || created.type !== 'TradeOrderChanged') throw Error('fixture');
    const o = created.order;
    denied(
      h.run(
        'seller',
        {
          type: 'offer',
          id: 'another',
          title: o.title,
          terms: o.terms,
          source: { kind: o.source.kind, id: o.source.id, expectedRevision: 3 },
          payer: o.payer,
          revenue: o.revenue,
          amount: o.amount,
          acceptBy: 5000,
        },
        1000,
      ),
      'trade-id-or-source-already-used-or-limit',
    );
  });
  it('checks balances, immutable source identity and source revisions before acquiring obligations', () => {
    const h = harness();
    h.offer();
    h.balance = 29;
    denied(h.run('buyer', h.command('accept')), 'insufficient-trade-balance');
    h.balance = 30;
    h.source = {
      ...freight(),
      basis: { ...freight().basis, buyer: { kind: 'resident', id: 'carrier' } },
      revision: 4,
    };
    denied(h.run('buyer', h.command('accept')), 'trade-source-facts-mismatch');
    h.source = { ...freight(), revision: 4, status: 'loaded' };
    denied(h.run('buyer', h.command('accept')), 'trade-buyer-unstarted-offer-required');
    h.source = { ...freight(), revision: 2 };
    denied(h.run('buyer', h.command('accept')), 'trade-source-facts-mismatch');
    expect(h.order.status).toBe('offered');
  });
  it('replays recorded facts independent of object key order, rejecting forged ledgers, receipts and source packets', () => {
    const h = harness();
    h.offer();
    const paid = h.commit(h.run('buyer', h.command('accept')));
    h.source = { ...freight(), revision: 5, at: 300, status: 'delivered' };
    h.commit(advanceEvidenceTrade(h.state, 'order', 300, h.ports));
    h.commit(h.run('buyer', h.command('confirm'), 300));
    let replay: EvidenceTradeState | undefined;
    replay = applyEvidenceTradeCommit(replay, [
      { type: 'EvidenceTradeEnabled', policy: EVIDENCE_TRADE_POLICY },
    ]);
    const reorder = (x: unknown): unknown =>
      Array.isArray(x)
        ? x.map(reorder)
        : x && typeof x === 'object'
          ? Object.fromEntries(
              Object.entries(x)
                .reverse()
                .map(([k, v]) => [k, reorder(v)]),
            )
          : x;
    for (const d of h.journal) {
      const reordered = JSON.parse(JSON.stringify(reorder(d))) as typeof d;
      replay = applyEvidenceTradeCommit(
        replay,
        reordered.events,
        reordered.transactions,
        reordered.evidenceReads,
      );
    }
    expect(replay).toEqual(h.state);
    const initial = applyEvidenceTradeCommit(
      emptyEvidenceTradeState(),
      h.journal[0]!.events,
      [],
      h.journal[0]!.evidenceReads,
    );
    expect(() => applyEvidenceTradeCommit(initial, paid.events, [], paid.evidenceReads)).toThrow(
      'trade-accounting-facts-mismatch',
    );
    expect(() => applyEvidenceTradeCommit(initial, paid.events, paid.transactions, [])).toThrow(
      'trade-transition-facts-mismatch',
    );
    expect(() =>
      applyEvidenceTradeCommit(initial, paid.events, paid.transactions, [
        ...paid.evidenceReads,
        ...paid.evidenceReads,
      ]),
    ).toThrow('duplicate-trade-evidence-read');
    const altered = paid.events.map((e) =>
      e.type === 'TradeOrderChanged'
        ? { ...e, order: { ...e.order, title: 'Rewritten without agreement' } }
        : e,
    );
    expect(() =>
      applyEvidenceTradeCommit(initial, altered, paid.transactions, paid.evidenceReads),
    ).toThrow('trade-transition-facts-mismatch');
    expect(() =>
      applyEvidenceTradeCommit(h.state, paid.events, paid.transactions, paid.evidenceReads),
    ).toThrow('invalid-trade-revision-or-ledger');
    expect(() => applyEvidenceTradeCommit(undefined, [])).toThrow('evidence-trade-not-enabled');
  });
  it('rejects nonfinite prices and already charged or participating service sources', () => {
    for (const amount of [NaN, Infinity, -1, 0, 0.0000001, 1000001]) {
      const h = harness();
      expect(() => h.offer({ amount })).toThrow('invalid-trade-terms-or-parties');
    }
    const e: TradeEvidence = {
      sourceVersion: 'resident-service-engagements-v1',
      revision: 3,
      at: 100,
      status: 'funded',
      progressMs: 0,
      hasPresence: false,
      basis: {
        kind: 'service',
        id: 'class',
        seller,
        buyer,
        createdAt: 10,
        providerId: 'seller',
        recipientId: 'buyer',
        locationId: 'room',
        pricePerHour: 1,
        maxDurationMs: 6000,
        startAt: 0,
        endAt: 10000,
      },
    };
    expect(() => harness(e).offer()).toThrow('invalid-trade-terms-or-parties');
    expect(() =>
      harness({ ...e, basis: { ...e.basis, pricePerHour: 0 }, hasPresence: true }).offer(),
    ).toThrow('invalid-trade-offer');
  });
  it('allows seller waiver after actual delivery without reversing physical effects', () => {
    const h = harness();
    h.offer();
    h.commit(h.run('buyer', h.command('accept')));
    h.source = { ...freight(), revision: 5, at: 300, status: 'delivered' };
    h.commit(advanceEvidenceTrade(h.state, 'order', 300, h.ports));
    h.commit(h.run('seller', h.command('waive'), 300));
    expect(h.order).toMatchObject({
      status: 'refunded',
      refunded: 30,
      earned: 30,
      evidence: { status: 'delivered' },
    });
    expect(
      h.journal
        .at(-1)!
        .events.every((e) => ['TradeOrderChanged', 'TradeReceiptRecorded'].includes(e.type)),
    ).toBe(true);
  });
});

it('an exact collective decision remains that party consent when its executor also personally represents the counterparty', () => {
  const original = freight(),
    initial: typeof original = {
      ...original,
      basis: { ...original.basis, buyer: { kind: 'collective', id: 'team' } },
    };
  const h = harness(initial);
  h.offer({ payer: { sector: 'collective', id: 'team' } });
  const acting: EvidenceTradePorts = {
    ...h.ports,
    actingFor: { kind: 'collective', id: 'team' },
    authorize: (c) =>
      c.kind === 'collective' && c.id === 'team'
        ? { actorId: 'seller', decisionId: 'team-decision' }
        : undefined,
  };
  h.commit(h.run('seller', h.command('accept'), 200, acting));
  h.source = { ...initial, revision: 5, at: 300, status: 'delivered' };
  h.commit(h.run('seller', h.command('observe'), 300, acting));
  h.commit(
    h.run(
      'seller',
      {
        type: 'propose-settlement',
        id: 'order',
        expectedRevision: h.order.revision,
        content: 'Independently agreed split',
        refund: 5,
      },
      300,
    ),
  );
  h.commit(
    h.run(
      'seller',
      { type: 'respond-settlement', id: 'order', expectedRevision: h.order.revision, accept: true },
      300,
      acting,
    ),
  );
  expect(h.order).toMatchObject({ status: 'settled', paid: 25, refunded: 5 });
  expect(h.journal.at(-1)!.events.at(-1)).toMatchObject({
    receipt: { actorId: 'seller', role: 'buyer', decisionId: 'team-decision' },
  });
});

it('a full dispute quota cannot force a refund or prevent independent settlement of existing escrow', () => {
  const h = harness();
  h.offer();
  h.commit(h.run('buyer', h.command('accept')));
  h.source = { ...freight(), revision: 5, at: 300, status: 'delivered' };
  h.commit(advanceEvidenceTrade(h.state, 'order', 300, h.ports));
  for (let i = 0; i < EVIDENCE_TRADE_POLICY.maxStatements; i++)
    h.commit(
      h.run(
        'buyer',
        {
          type: 'dispute',
          id: 'order',
          expectedRevision: h.order.revision,
          content: `Original statement ${i}`,
        },
        300,
      ),
    );
  denied(
    h.run(
      'buyer',
      { type: 'dispute', id: 'order', expectedRevision: h.order.revision, content: 'One too many' },
      300,
    ),
    'invalid-trade-dispute',
  );
  h.commit(
    h.run(
      'seller',
      {
        type: 'propose-settlement',
        id: 'order',
        expectedRevision: h.order.revision,
        content: 'Still independently settle existing money',
        refund: 10,
      },
      300,
    ),
  );
  h.commit(
    h.run(
      'buyer',
      { type: 'respond-settlement', id: 'order', expectedRevision: h.order.revision, accept: true },
      300,
    ),
  );
  expect(h.order).toMatchObject({ status: 'settled', paid: 20, refunded: 10 });
  expect(h.order.statements).toHaveLength(EVIDENCE_TRADE_POLICY.maxStatements);
});

it('public goods separate buyer consent from scoped treasury funding and retain real-delivery confirmation', () => {
  const h = harness();
  let allowed = false;
  const ports: EvidenceTradePorts = {
    ...h.ports,
    publicFunding: {
      balance: 30,
      authorize: (order, actorId) =>
        allowed && actorId === 'member' && order.id === 'order' && order.revision === 2
          ? { decisionId: 'public-purchase' }
          : undefined,
    },
  };
  expect(() =>
    h.offer({ payer: { sector: 'treasury', id: 'public-treasury' } }, 'seller', ports),
  ).toThrow('public-goods-funding-not-enabled');
  h.commit({
    accepted: true,
    events: [{ type: 'TradePublicFundingEnabled', policy: TRADE_PUBLIC_FUNDING_POLICY }],
    transactions: [],
    evidenceReads: [],
  });
  h.offer({ payer: { sector: 'treasury', id: 'public-treasury' } }, 'seller', ports);
  const accepted = h.commit(h.run('buyer', h.command('accept'), 200, ports));
  expect(accepted.transactions).toEqual([]);
  expect(h.order).toMatchObject({ status: 'accepted', funded: 0, escrow: 0 });
  expect(tradeSourceStartFailure(h.state, h.source.basis)).toBe(
    'trade-payment-or-offer-release-required',
  );
  const fund = { type: 'fund' as const, id: 'order', expectedRevision: 2 };
  denied(h.run('member', fund, 200, ports), 'public-trade-funding-authority-required');
  allowed = true;
  denied(
    h.run('member', fund, 200, {
      ...ports,
      publicFunding: { ...ports.publicFunding!, balance: 29.999999 },
    }),
    'insufficient-public-trade-balance',
  );
  const funded = h.commit(h.run('member', fund, 200, ports));
  expect(funded.transactions[0]?.entries.find((e) => e.account.sector === 'treasury')?.amount).toBe(
    -30,
  );
  expect(h.order).toMatchObject({
    status: 'funded',
    escrow: 30,
    fundingDecisionId: 'public-purchase',
  });
  expect(tradeSourceStartFailure(h.state, h.source.basis)).toBeUndefined();
  h.source = { ...freight(), revision: 4, at: 400, status: 'delivered' };
  h.commit(h.run('buyer', h.command('observe'), 400));
  expect(h.order).toMatchObject({ status: 'awaiting-confirmation', escrow: 30 });
  denied(h.run('member', h.command('confirm'), 400), 'trade-party-authority-required');
  h.commit(h.run('buyer', h.command('confirm'), 400));
  expect(h.order).toMatchObject({ status: 'completed', paid: 30, refunded: 0 });
  expect(
    h.journal.reduce(
      (s, d) => applyEvidenceTradeCommit(s, d.events, d.transactions, d.evidenceReads),
      emptyEvidenceTradeState(),
    ),
  ).toEqual(h.state);
});

it('unfunded public goods can expire or be withdrawn and cancelled transport returns public escrow only to its original treasury', () => {
  for (const operation of ['expire', 'withdraw', 'return'] as const) {
    const h = harness();
    h.commit({
      accepted: true,
      events: [{ type: 'TradePublicFundingEnabled', policy: TRADE_PUBLIC_FUNDING_POLICY }],
      transactions: [],
      evidenceReads: [],
    });
    const ports: EvidenceTradePorts = {
      ...h.ports,
      publicFunding: { balance: 30, authorize: () => ({ decisionId: 'public-purchase' }) },
    };
    h.offer({ payer: { sector: 'treasury', id: 'public-treasury' } }, 'seller', ports);
    h.commit(h.run('buyer', h.command('accept'), 200, ports));
    if (operation === 'expire') h.commit(advanceEvidenceTrade(h.state, 'order', 1000, ports));
    else if (operation === 'withdraw') h.commit(h.run('buyer', h.command('withdraw'), 300));
    else {
      h.commit(h.run('member', { type: 'fund', id: 'order', expectedRevision: 2 }, 300, ports));
      h.source = { ...freight(), revision: 4, at: 400, status: 'returned' };
      const refund = h.commit(h.run('buyer', h.command('observe'), 400));
      expect(
        refund.transactions[0]?.entries.find((e) => e.account.sector === 'treasury')?.amount,
      ).toBe(30);
      expect(h.order).toMatchObject({ refunded: 30, paid: 0, escrow: 0 });
    }
    expect(tradeSourceStartFailure(h.state, h.source.basis)).toBeUndefined();
    expect(
      h.journal.reduce(
        (s, d) => applyEvidenceTradeCommit(s, d.events, d.transactions, d.evidenceReads),
        emptyEvidenceTradeState(),
      ),
    ).toEqual(h.state);
  }
});
