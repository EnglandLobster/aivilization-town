import type { AccountingTransaction } from '@aivilization/economy';
import type { MaterialCustodyProof } from '@aivilization/materials';
import { freightFactsEqual, freightMoneyMicros, validFreightTerms } from './facts';
import { freightCreated, freightReceiptId, transitionFreight } from './transitions';
import {
  activeFreight,
  emptyLogisticsState,
  type Freight,
  type FreightTerms,
  type LogisticsEvent,
  type LogisticsState,
} from './model';

function termsOf(f: Freight): FreightTerms {
  const { status, createdBy, createdAt, at, revision, funded, escrow, paid, refunded, ...terms } =
    f;
  void status;
  void createdBy;
  void createdAt;
  void at;
  void revision;
  void funded;
  void escrow;
  void paid;
  void refunded;
  return terms;
}
export function applyLogisticsEvent(
  s: LogisticsState | undefined,
  e: LogisticsEvent,
): LogisticsState {
  if (e.type === 'LogisticsEnabled') {
    if (s) throw Error('logistics-already-enabled');
    return emptyLogisticsState(e.policy);
  }
  if (!s) throw Error('logistics-not-enabled');
  if (e.type === 'FreightChanged') {
    const f = e.freight,
      old = s.freight[f.id];
    if (
      f.revision !== (old?.revision ?? 0) + 1 ||
      (old && !activeFreight(old)) ||
      !Number.isSafeInteger(f.at) ||
      f.at < (old?.at ?? 0) ||
      freightMoneyMicros(f.funded) !==
        freightMoneyMicros(f.escrow) + freightMoneyMicros(f.paid) + freightMoneyMicros(f.refunded)
    )
      throw Error('invalid-freight-event');
    return { ...s, freight: { ...s.freight, [f.id]: f } };
  }
  if (s.receipts[e.receipt.id]) throw Error('duplicate-freight-receipt');
  return { ...s, receipts: { ...s.receipts, [e.receipt.id]: e.receipt } };
}
/** v1 mechanical proof validates immutable terms, transitions, exact funding/payment/refund and material instructions. */
export function applyLogisticsCommit(
  before: LogisticsState | undefined,
  events: readonly LogisticsEvent[],
  transactions: readonly AccountingTransaction[] = [],
  materialProofs: readonly MaterialCustodyProof[] = [],
) {
  let s = before;
  const expectedTransactions: AccountingTransaction[] = [],
    expectedProofs: MaterialCustodyProof[] = [];
  for (let i = 0; i < events.length; i++) {
    const event = events[i]!;
    if (event.type === 'LogisticsEnabled') {
      s = applyLogisticsEvent(s, event);
      continue;
    }
    const receiptEvent = events[++i];
    if (!s || event.type !== 'FreightChanged' || receiptEvent?.type !== 'FreightReceiptRecorded')
      throw Error('invalid-freight-commit-packet');
    const f = event.freight,
      r = receiptEvent.receipt,
      old = s.freight[f.id];
    if (
      r.id !== freightReceiptId(f.id, f.revision) ||
      r.freightId !== f.id ||
      r.at !== f.at ||
      !r.actorId
    )
      throw Error('freight-receipt-mismatch');
    if (!old && (!validFreightTerms(f, f.at) || r.operation !== 'offer' || r.releaseUnboundSource))
      throw Error('invalid-freight-creation');
    const expected = old
      ? transitionFreight(old, r)
      : freightCreated(
          {
            ...termsOf(f),
            status: 'offered',
            createdBy: r.actorId,
            createdAt: r.at,
            at: r.at,
            revision: 1,
            funded: 0,
            escrow: 0,
            paid: 0,
            refunded: 0,
          },
          r,
        );
    if (!expected.accepted || !freightFactsEqual(expected.events, [event, receiptEvent]))
      throw Error('freight-transition-facts-mismatch');
    expectedTransactions.push(...expected.transactions);
    expectedProofs.push(...expected.materialProofs);
    s = applyLogisticsEvent(s, event);
    s = applyLogisticsEvent(s, receiptEvent);
  }
  if (!s) throw Error('logistics-not-enabled');
  if (!freightFactsEqual(expectedTransactions, transactions))
    throw Error('freight-accounting-facts-mismatch');
  if (!freightFactsEqual(expectedProofs, materialProofs))
    throw Error('freight-material-facts-mismatch');
  return s;
}
