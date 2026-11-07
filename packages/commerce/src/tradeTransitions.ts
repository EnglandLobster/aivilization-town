import { validControllerId } from '@aivilization/authority';
import type { AccountingTransaction } from '@aivilization/economy';
import {
  EVIDENCE_TRADE_POLICY,
  tradeRejected as no,
  type EvidenceTradeDecision,
  type TradeEvidence,
  type TradeOrder,
  type TradeReceipt,
  type TradeTerms,
} from './tradeModel';
import {
  tradeFactsEqual,
  tradeMoneyDifference,
  tradeMoneyMicros,
  tradeSourceEarned,
  tradeSourceReady,
  validTradeEvidence,
  validTradeTerms,
} from './tradeFacts';
import { tradeMoneyTransfer } from './tradeMoney';

export const tradeReceiptId = (id: string, revision: number) => `trade-${id}-${revision}`;
export const terminalTrade = (o: TradeOrder) =>
  ['completed', 'refunded', 'settled', 'cancelled', 'expired'].includes(o.status);
function packet(
  order: TradeOrder,
  receipt: TradeReceipt,
  transactions: readonly AccountingTransaction[],
  evidence?: TradeEvidence,
  before?: TradeOrder,
): EvidenceTradeDecision {
  return {
    accepted: true,
    events: [
      { type: 'TradeOrderChanged', order },
      {
        type: 'TradeReceiptRecorded',
        receipt: {
          ...receipt,
          settlement: {
            fromStatus: before?.status ?? null,
            toStatus: order.status,
            funded: tradeMoneyDifference(order.funded, before?.funded ?? 0),
            paid: tradeMoneyDifference(order.paid, before?.paid ?? 0),
            refunded: tradeMoneyDifference(order.refunded, before?.refunded ?? 0),
            escrowBefore: before?.escrow ?? 0,
            escrowAfter: order.escrow,
          },
        },
      },
    ],
    transactions,
    evidenceReads: evidence ? [{ receiptId: receipt.id, evidence }] : [],
  };
}
export function validTradeReceipt(terms: TradeTerms, r: TradeReceipt, revision: number): boolean {
  if (
    r.id !== tradeReceiptId(terms.id, revision) ||
    r.orderRevision !== revision ||
    r.orderId !== terms.id ||
    !validControllerId(r.actorId) ||
    !Number.isSafeInteger(r.at) ||
    r.at < 0
  )
    return false;
  if (r.role === 'system')
    return r.actorId === 'system' && !r.decisionId && ['observe', 'expire'].includes(r.operation);
  if (r.role === 'public-funder')
    return (
      terms.payer.sector === 'treasury' &&
      terms.source.kind === 'freight' &&
      r.operation === 'fund' &&
      typeof r.decisionId === 'string' &&
      /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,159}$/.test(r.decisionId) &&
      !Object.hasOwn(Object.prototype, r.decisionId)
    );
  if (r.role !== 'seller' && r.role !== 'buyer') return false;
  const c = terms.source[r.role];
  return c.kind === 'resident'
    ? c.id === r.actorId && r.decisionId === undefined
    : !!r.decisionId && validControllerId(r.decisionId);
}
export function createTradeOrder(
  t: TradeTerms,
  r: TradeReceipt,
  evidence: TradeEvidence,
): EvidenceTradeDecision {
  if (
    !validTradeTerms(t, r.at) ||
    !validTradeReceipt(t, r, 1) ||
    r.operation !== 'offer' ||
    r.role !== 'seller' ||
    !validTradeEvidence(evidence, r.at) ||
    !tradeFactsEqual(t.source, evidence.basis) ||
    !tradeSourceReady(evidence)
  )
    return no('invalid-trade-offer');
  return packet(
    {
      ...t,
      createdBy: r.actorId,
      createdAt: r.at,
      revision: 1,
      at: r.at,
      status: 'offered',
      evidence,
      resolved: false,
      funded: 0,
      earned: 0,
      escrow: 0,
      paid: 0,
      refunded: 0,
      statements: [],
    },
    r,
    [],
    evidence,
  );
}
/** Closed versioned state transition over recorded facts. Authorization and source reads are supplied independently. */
export function transitionTradeOrder(
  old: TradeOrder,
  r: TradeReceipt,
  evidence?: TradeEvidence,
): EvidenceTradeDecision {
  if (
    terminalTrade(old) ||
    old.revision >= Number.MAX_SAFE_INTEGER ||
    !validTradeReceipt(old, r, old.revision + 1) ||
    r.at < old.at
  )
    return no('trade-ended-or-invalid-receipt');
  const reads = ['accept', 'fund', 'observe'].includes(r.operation);
  if (
    reads !== !!evidence ||
    (evidence &&
      (!validTradeEvidence(evidence, r.at) ||
        !tradeFactsEqual(old.source, evidence.basis) ||
        (evidence.sourceVersion === 'premises-provision-v1' &&
          evidence.provision !== undefined &&
          evidence.provision.orderId !== old.id) ||
        evidence.revision < old.evidence.revision ||
        (evidence.revision === old.evidence.revision && !tradeFactsEqual(evidence, old.evidence))))
  )
    return no('trade-source-facts-mismatch');
  let next: TradeOrder = { ...old, revision: old.revision + 1, at: r.at };
  const transactions: AccountingTransaction[] = [];
  const refund = (amount: number) => {
    if (amount > 0) transactions.push(tradeMoneyTransfer(r.id, 'refund', old.payer, amount));
    next = {
      ...next,
      escrow: tradeMoneyDifference(next.escrow, amount),
      refunded: (tradeMoneyMicros(next.refunded) + tradeMoneyMicros(amount)) / 1e6,
    };
  };
  const pay = (amount: number) => {
    if (amount > 0) transactions.push(tradeMoneyTransfer(r.id, 'pay', old.revenue, amount));
    next = {
      ...next,
      escrow: tradeMoneyDifference(next.escrow, amount),
      paid: (tradeMoneyMicros(next.paid) + tradeMoneyMicros(amount)) / 1e6,
    };
  };
  const statement = (kind: 'dispute' | 'settlement') => {
    if (
      r.role === 'system' ||
      r.role === 'public-funder' ||
      !r.content?.trim() ||
      r.content.length > EVIDENCE_TRADE_POLICY.maxTermsChars ||
      old.statements.length >= EVIDENCE_TRADE_POLICY.maxStatements
    )
      return false;
    next = {
      ...next,
      statements: [
        ...old.statements,
        { authorId: r.actorId, role: r.role, kind, content: r.content, at: r.at },
      ],
    };
    return true;
  };
  switch (r.operation) {
    case 'accept':
      if (
        r.role !== 'buyer' ||
        old.status !== 'offered' ||
        r.at >= old.acceptBy ||
        !tradeSourceReady(evidence!)
      )
        return no('trade-buyer-unstarted-offer-required');
      if (old.payer.sector === 'treasury') {
        next = { ...next, status: 'accepted', evidence: evidence! };
        break;
      }
      transactions.push(tradeMoneyTransfer(r.id, 'fund', old.payer, old.amount));
      next = {
        ...next,
        status: 'funded',
        funded: old.amount,
        escrow: old.amount,
        evidence: evidence!,
      };
      break;
    case 'fund':
      if (
        r.role !== 'public-funder' ||
        old.payer.sector !== 'treasury' ||
        old.status !== 'accepted' ||
        r.at >= old.acceptBy ||
        !tradeSourceReady(evidence!)
      )
        return no('public-trade-accepted-unstarted-contract-required');
      transactions.push(tradeMoneyTransfer(r.id, 'fund', old.payer, old.amount));
      next = {
        ...next,
        status: 'funded',
        funded: old.amount,
        escrow: old.amount,
        evidence: evidence!,
        fundingDecisionId: r.decisionId!,
      };
      break;
    case 'withdraw':
      if (
        !['offered', 'accepted'].includes(old.status) ||
        r.role === 'system' ||
        r.role === 'public-funder'
      )
        return no('trade-unfunded-offer-required');
      next = { ...next, status: 'cancelled' };
      break;
    case 'expire':
      if (!['offered', 'accepted'].includes(old.status) || r.at < old.acceptBy)
        return no('trade-unaccepted-expiry-required');
      next = { ...next, status: 'expired' };
      break;
    case 'observe': {
      if (!['funded', 'disputed'].includes(old.status) || old.resolved)
        return no('trade-unresolved-funding-required');
      const earned = tradeSourceEarned(evidence!, old.amount);
      if (earned === undefined) return no('trade-source-not-terminal');
      refund(tradeMoneyDifference(old.amount, earned));
      next = {
        ...next,
        earned,
        resolved: true,
        evidence: evidence!,
        status:
          earned === 0
            ? 'refunded'
            : old.status === 'disputed'
              ? 'disputed'
              : 'awaiting-confirmation',
      };
      break;
    }
    case 'confirm':
      if (r.role !== 'buyer' || old.status !== 'awaiting-confirmation' || !old.resolved)
        return no('trade-buyer-delivery-confirmation-required');
      pay(old.escrow);
      next = { ...next, status: 'completed' };
      break;
    case 'waive':
      if (
        r.role !== 'seller' ||
        !old.resolved ||
        !['awaiting-confirmation', 'disputed'].includes(old.status)
      )
        return no('trade-seller-resolved-waiver-required');
      refund(old.escrow);
      next = { ...next, status: 'refunded' };
      break;
    case 'dispute':
      if (
        !['funded', 'awaiting-confirmation', 'disputed'].includes(old.status) ||
        !statement('dispute')
      )
        return no('invalid-trade-dispute');
      next = { ...next, status: 'disputed' };
      break;
    case 'propose-settlement':
      if (
        !old.resolved ||
        old.escrow <= 0 ||
        !['awaiting-confirmation', 'disputed'].includes(old.status) ||
        r.refund === undefined ||
        !Number.isFinite(r.refund) ||
        r.refund < 0 ||
        r.refund > old.escrow ||
        !r.content?.trim() ||
        r.content.length > EVIDENCE_TRADE_POLICY.maxTermsChars
      )
        return no('invalid-trade-settlement');
      try {
        tradeMoneyMicros(r.refund);
      } catch {
        return no('invalid-trade-settlement-amount');
      }
      if (r.role === 'system' || r.role === 'public-funder')
        return no('invalid-trade-settlement-party');
      // Negotiated disposal of existing escrow must remain possible after the dispute admission quota.
      // Its original text is retained in the immutable receipt and current settlement, without growing the dispute list.
      next = {
        ...next,
        settlement: {
          role: r.role,
          authorId: r.actorId,
          refund: r.refund,
          terms: r.content,
          orderRevision: next.revision,
          status: 'proposed',
        },
      };
      break;
    case 'respond-settlement': {
      const p = old.settlement;
      if (
        !old.resolved ||
        !p ||
        p.status !== 'proposed' ||
        p.orderRevision !== old.revision ||
        r.role === 'system' ||
        r.role === 'public-funder' ||
        r.role === p.role ||
        typeof r.accept !== 'boolean'
      )
        return no('trade-independent-current-settlement-required');
      next = { ...next, settlement: { ...p, status: r.accept ? 'accepted' : 'declined' } };
      if (r.accept) {
        refund(p.refund);
        pay(next.escrow);
        next = { ...next, status: 'settled' };
      }
      break;
    }
    default:
      return no('invalid-trade-transition');
  }
  if (
    tradeMoneyMicros(next.funded) !==
    tradeMoneyMicros(next.escrow) + tradeMoneyMicros(next.paid) + tradeMoneyMicros(next.refunded)
  )
    throw Error('trade-settlement-conservation');
  return packet(next, r, transactions, evidence, old);
}
