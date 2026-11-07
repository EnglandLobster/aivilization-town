import { sameController } from '@aivilization/authority';
import type { AccountingTransaction } from '@aivilization/economy';
import {
  emptyEvidenceTradeState,
  assertEvidenceTradePolicy,
  TRADE_PUBLIC_FUNDING_POLICY,
  type EvidenceTradeEvent,
  type EvidenceTradeState,
  type TradeEvidenceRead,
  type TradeOrder,
  type TradeTerms,
} from './tradeModel';
import { tradeFactsEqual, tradeMoneyMicros } from './tradeFacts';
import { createTradeOrder, tradeReceiptId, transitionTradeOrder } from './tradeTransitions';

function termsOf(o: TradeOrder): TradeTerms {
  return {
    id: o.id,
    title: o.title,
    terms: o.terms,
    source: o.source,
    payer: o.payer,
    revenue: o.revenue,
    amount: o.amount,
    acceptBy: o.acceptBy,
  };
}
/** A packet has exactly one state transition and its receipt. Cross-domain facts must be independently checked by the application. */
export function applyEvidenceTradeCommit(
  before: EvidenceTradeState | undefined,
  events: readonly EvidenceTradeEvent[],
  transactions: readonly AccountingTransaction[] = [],
  evidenceReads: readonly TradeEvidenceRead[] = [],
): EvidenceTradeState {
  let s = before;
  const expectedTransactions: AccountingTransaction[] = [],
    usedEvidence = new Set<string>();
  if (new Set(evidenceReads.map((e) => e.receiptId)).size !== evidenceReads.length)
    throw Error('duplicate-trade-evidence-read');
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    if (e.type === 'TradePublicFundingEnabled') {
      if (
        !s ||
        s.publicFunding ||
        events.length !== 1 ||
        !tradeFactsEqual(e.policy, TRADE_PUBLIC_FUNDING_POLICY)
      )
        throw Error('invalid-trade-public-funding-activation');
      s = { ...s, publicFunding: { ...e.policy } };
      continue;
    }
    if (e.type === 'EvidenceTradePolicyUpgraded') {
      if (
        !s ||
        s.policy.version !== e.fromVersion ||
        e.fromVersion !== 'resident-evidence-trade-v1' ||
        e.policy.version !== 'resident-evidence-trade-v2' ||
        events.length !== 1
      )
        throw Error('invalid-trade-policy-upgrade');
      assertEvidenceTradePolicy(e.policy);
      s = { ...s, policy: e.policy };
      continue;
    }
    if (e.type === 'EvidenceTradeEnabled') {
      if (s || events.length !== 1) throw Error('invalid-trade-enablement');
      s = emptyEvidenceTradeState(e.policy);
      continue;
    }
    const r = events[++i];
    if (!s || e.type !== 'TradeOrderChanged' || r?.type !== 'TradeReceiptRecorded')
      throw Error('invalid-trade-commit-packet');
    const o = e.order,
      old = s.orders[o.id],
      receipt = r.receipt;
    if (o.payer.sector === 'treasury' && (!s.publicFunding || o.source.kind !== 'freight'))
      throw Error('public-goods-funding-not-enabled');
    if (o.source.kind === 'permit' && s.policy.version !== 'resident-evidence-trade-v2')
      throw Error('trade-permit-requires-v2');
    if (
      o.revision !== (old?.revision ?? 0) + 1 ||
      receipt.id !== tradeReceiptId(o.id, o.revision) ||
      s.receipts[receipt.id] ||
      receipt.at !== o.at ||
      tradeMoneyMicros(o.funded) !==
        tradeMoneyMicros(o.escrow) + tradeMoneyMicros(o.paid) + tradeMoneyMicros(o.refunded)
    )
      throw Error('invalid-trade-revision-or-ledger');
    const read = evidenceReads.find((p) => p.receiptId === receipt.id);
    if (read) usedEvidence.add(read.receiptId);
    if (
      !old &&
      (!read ||
        s.principalOrders?.orders[o.id] ||
        (o.source.kind === 'permit' &&
          Object.values(s.principalOrders?.orders ?? {}).some(
            (p) => p.source.id === o.source.id,
          )) ||
        Object.keys(s.orders).length >= s.policy.maxOrders ||
        Object.values(s.orders).some(
          (v) => v.source.id === o.source.id && v.source.kind === o.source.kind,
        ) ||
        Object.values(s.orders).filter((v) => sameController(v.source.seller, o.source.seller))
          .length >= s.policy.maxPerSeller)
    )
      throw Error('invalid-trade-source-or-creation-limit');
    const result = old
      ? transitionTradeOrder(old, receipt, read?.evidence)
      : createTradeOrder(termsOf(o), receipt, read!.evidence);
    if (
      !result.accepted ||
      !tradeFactsEqual(result.events, [e, r]) ||
      !tradeFactsEqual(result.evidenceReads, read ? [read] : [])
    )
      throw Error('trade-transition-facts-mismatch');
    expectedTransactions.push(...result.transactions);
    s = {
      ...s,
      orders: { ...s.orders, [o.id]: o },
      receipts: { ...s.receipts, [receipt.id]: receipt },
    };
  }
  if (!s) throw Error('evidence-trade-not-enabled');
  if (usedEvidence.size !== evidenceReads.length) throw Error('unused-trade-evidence-read');
  if (!tradeFactsEqual(expectedTransactions, transactions))
    throw Error('trade-accounting-facts-mismatch');
  return s;
}
