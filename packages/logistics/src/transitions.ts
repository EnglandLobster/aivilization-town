import {
  createMoneyTransfer,
  economicAccount,
  type AccountingTransaction,
} from '@aivilization/economy';
import type { MaterialCustodyProof } from '@aivilization/materials';
import {
  activeFreight,
  loadedFreight,
  type Freight,
  type FreightReceipt,
  type LogisticsDecision,
} from './model';
import { freightMoneyDifference } from './facts';
export const LOGISTICS_ESCROW = economicAccount('public-service', 'resident-logistics');
export const freightReceiptId = (id: string, revision: number) => `freight-${id}-${revision}`;
export function freightProof(
  f: Freight,
  receipt: FreightReceipt,
  operation: MaterialCustodyProof['operation'],
): MaterialCustodyProof {
  return {
    id: f.id,
    consumerId: f.id,
    sourceReservationId: f.materialRef.id,
    sourceStockId: f.sourceStockId,
    destinationStockId: f.destinationStockId,
    items: f.items,
    beneficiary: f.controller,
    operation,
    evidenceId: receipt.id,
  };
}
export function freightCreated(f: Freight, receipt: FreightReceipt): LogisticsDecision {
  return {
    accepted: true,
    events: [
      { type: 'FreightChanged', freight: f },
      {
        type: 'FreightReceiptRecorded',
        receipt: {
          ...receipt,
          settlement: {
            fromStatus: null,
            toStatus: 'offered',
            funded: 0,
            paid: 0,
            refunded: 0,
            escrowBefore: 0,
            escrowAfter: 0,
          },
        },
      },
    ],
    transactions: [],
    materialProofs: [],
  };
}
/** Mechanical v1 consequences only; caller has independently checked authority and physical facts. */
export function transitionFreight(f: Freight, r: FreightReceipt): LogisticsDecision {
  const no = (reason: string): LogisticsDecision => ({ accepted: false, reason });
  if (
    !activeFreight(f) ||
    !Number.isSafeInteger(r.at) ||
    r.at < f.at ||
    f.revision >= Number.MAX_SAFE_INTEGER
  )
    return no('freight-ended-or-invalid-time');
  if (r.operation === 'expire' && r.at < f.deadline) return no('freight-not-expired');
  if (
    r.operation !== 'cancel' &&
    r.operation !== 'expire' &&
    r.operation !== 'return' &&
    r.at >= f.deadline
  )
    return no('freight-deadline-passed');
  if (
    r.releaseUnboundSource &&
    (f.status !== 'offered' || !['cancel', 'expire'].includes(r.operation))
  )
    return no('invalid-freight-source-release');
  let next: Freight = { ...f, revision: f.revision + 1, at: r.at };
  const transactions: AccountingTransaction[] = [],
    materialProofs: MaterialCustodyProof[] = [];
  const transfer = (id: string, amount: number, kind: 'fund' | 'fee' | 'refund') => {
    if (amount > 0)
      transactions.push(
        createMoneyTransfer({
          transactionId: `${r.id}-${id}`,
          reason: `freight-${kind}`,
          from: kind === 'fund' ? economicAccount(f.payer.sector, f.payer.id) : LOGISTICS_ESCROW,
          to:
            kind === 'fund'
              ? LOGISTICS_ESCROW
              : kind === 'fee'
                ? economicAccount('agent', f.carrierId)
                : economicAccount(f.payer.sector, f.payer.id),
          amount,
        }),
      );
  };
  const settle = (fee: number) => {
    const refund = freightMoneyDifference(f.escrow, fee);
    if (refund < 0) throw Error('freight-escrow-underflow');
    transfer('fee', fee, 'fee');
    transfer('refund', refund, 'refund');
    next = { ...next, escrow: 0, paid: fee, refunded: refund };
  };
  if (r.operation === 'accept' && f.status === 'offered') {
    next = { ...next, status: 'accepted' };
    materialProofs.push(freightProof(f, r, 'reserve'));
  } else if (r.operation === 'fund' && f.status === 'accepted') {
    const amount = Math.max(f.deliveryFee, f.returnFee);
    next = { ...next, status: 'funded', funded: amount, escrow: amount };
    transfer('fund', amount, 'fund');
  } else if (r.operation === 'load' && f.status === 'funded') {
    next = { ...next, status: 'loaded' };
    materialProofs.push(freightProof(f, r, 'load'));
  } else if (r.operation === 'deliver' && f.status === 'loaded') {
    next = { ...next, status: 'delivered' };
    materialProofs.push(freightProof(f, r, 'deliver'));
    settle(f.deliveryFee);
  } else if (r.operation === 'return' && loadedFreight(f)) {
    next = { ...next, status: 'returned' };
    materialProofs.push(freightProof(f, r, 'return'));
    settle(f.returnFee);
  } else if (r.operation === 'cancel' || r.operation === 'expire') {
    if (f.status === 'return-required') return no('freight-already-awaiting-return');
    if (loadedFreight(f)) next = { ...next, status: 'return-required' };
    else {
      next = { ...next, status: 'cancelled' };
      if (f.status !== 'offered') materialProofs.push(freightProof(f, r, 'cancel'));
      else if (r.releaseUnboundSource) materialProofs.push(freightProof(f, r, 'release'));
      settle(0);
    }
  } else return no('invalid-freight-transition');
  return {
    accepted: true,
    events: [
      { type: 'FreightChanged', freight: next },
      {
        type: 'FreightReceiptRecorded',
        receipt: {
          ...r,
          settlement: {
            fromStatus: f.status,
            toStatus: next.status,
            funded: freightMoneyDifference(next.funded, f.funded),
            paid: freightMoneyDifference(next.paid, f.paid),
            refunded: freightMoneyDifference(next.refunded, f.refunded),
            escrowBefore: f.escrow,
            escrowAfter: next.escrow,
          },
        },
      },
    ],
    transactions,
    materialProofs,
  };
}
