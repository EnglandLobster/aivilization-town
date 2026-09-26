import { createMoneyTransfer, economicAccount } from '@aivilization/economy';
import {
  assertCommercePolicy,
  type CommerceCommand,
  type CommerceDecision,
  type CommercePorts,
  type CommerceState,
  type CommerceEvent,
} from './model';
import { decideOrder } from './orders';
export function decideCommerce(
  s: CommerceState,
  a: string,
  at: number,
  c: CommerceCommand,
  p: CommercePorts,
  transactionId: string,
): CommerceDecision {
  assertCommercePolicy(s.policy);
  const no = (reason: string): CommerceDecision => ({ accepted: false, reason });
  const yes = (...events: CommerceEvent[]): CommerceDecision => ({
    accepted: true,
    events,
    transactions: [],
    stockTransfers: [],
  });
  const positive = (n: number) => Number.isFinite(n) && n > 0 && n <= s.policy.maxAmount;
  const text = (v: string) => v.trim().length > 0 && v.length <= s.policy.maxText;
  const transfer = (from: string, to: string, amount: number) =>
    createMoneyTransfer({
      transactionId,
      reason: c.type,
      from: economicAccount(
        from === 'escrow' ? 'public-service' : 'agent',
        from === 'escrow' ? 'resident-commerce' : from,
      ),
      to: economicAccount(
        to === 'escrow' ? 'public-service' : 'agent',
        to === 'escrow' ? 'resident-commerce' : to,
      ),
      amount,
    });
  if (!p.exists(a) || !Number.isSafeInteger(at) || at < 0) return no('invalid-actor-or-time');
  if ('id' in c && (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(c.id) || c.id === 'constructor'))
    return no('invalid-id');
  if (c.type.startsWith('orders.'))
    return decideOrder(
      s,
      a,
      at,
      c as Extract<CommerceCommand, { type: `orders.${string}` }>,
      p,
      transactionId,
    );
  if (c.type === 'offers.publish') {
    if (
      Object.hasOwn(s.offers, c.id) ||
      !text(c.description) ||
      !positive(c.unitPrice) ||
      !Number.isSafeInteger(c.maxQuantity) ||
      c.maxQuantity < 1 ||
      c.maxQuantity > 1000000
    )
      return no('invalid-offer');
    if (c.kind === 'goods' && !p.commodityExists(c.commodity)) return no('unknown-commodity');
    if (c.kind !== 'goods' && c.kind !== 'service') return no('invalid-offer-kind');
    if (
      c.deliveryMode !== undefined &&
      (!['in-person', 'remote'].includes(c.deliveryMode) ||
        (c.kind === 'goods' && c.deliveryMode === 'remote'))
    )
      return no('invalid-delivery-mode');
    return yes({
      type: 'OfferChanged',
      offer: {
        id: c.id,
        sellerId: a,
        kind: c.kind,
        ...(c.deliveryMode === undefined ? {} : { deliveryMode: c.deliveryMode }),
        commodity: c.commodity,
        description: c.description,
        unitPrice: c.unitPrice,
        maxQuantity: c.maxQuantity,
        revision: 1,
        active: true,
        at,
      },
    });
  }
  if (c.type === 'offers.withdraw') {
    const o = s.offers[c.id];
    if (!o || o.sellerId !== a) return no('offer-not-yours');
    if (o.revision !== c.expectedRevision) return no('revision-conflict');
    return yes({ type: 'OfferChanged', offer: { ...o, active: false, revision: o.revision + 1 } });
  }
  if (c.type === 'payments.transfer') {
    if (!p.exists(c.targetId) || c.targetId === a || !positive(c.amount) || !text(c.note))
      return no('invalid-transfer');
    if (p.balance(a) < c.amount) return no('insufficient-balance');
    return {
      accepted: true,
      events: [],
      transactions: [transfer(a, c.targetId, c.amount)],
      stockTransfers: [],
    };
  }
  if (c.type === 'payments.request') {
    if (
      Object.hasOwn(s.requests, c.id) ||
      !positive(c.amountEach) ||
      !text(c.description) ||
      c.payers.length < 1 ||
      c.payers.length > s.policy.maxParticipants ||
      new Set(c.payers).size !== c.payers.length ||
      c.payers.some((id) => id === a || !p.exists(id))
    )
      return no('invalid-payment-request');
    return yes({
      type: 'PaymentRequestChanged',
      request: {
        id: c.id,
        requesterId: a,
        payers: c.payers,
        amountEach: c.amountEach,
        paidBy: [],
        description: c.description,
        closed: false,
        revision: 1,
        at,
      },
    });
  }
  if (c.type === 'payments.pay' || c.type === 'payments.cancel') {
    const r = s.requests[c.id];
    if (!r) return no('payment-request-not-found');
    if (r.revision !== c.expectedRevision) return no('revision-conflict');
    if (r.closed) return no('request-closed');
    if (c.type === 'payments.cancel') {
      if (a !== r.requesterId) return no('requester-required');
      return yes({
        type: 'PaymentRequestChanged',
        request: { ...r, closed: true, revision: r.revision + 1 },
      });
    }
    if (!r.payers.includes(a) || r.paidBy.includes(a)) return no('not-a-pending-payer');
    if (p.balance(a) < r.amountEach) return no('insufficient-balance');
    const paidBy = [...r.paidBy, a];
    return {
      accepted: true,
      events: [
        {
          type: 'PaymentRequestChanged',
          request: {
            ...r,
            paidBy,
            closed: paidBy.length === r.payers.length,
            revision: r.revision + 1,
          },
        },
      ],
      transactions: [transfer(a, r.requesterId, r.amountEach)],
      stockTransfers: [],
    };
  }
  if (c.type === 'deposits.lock') {
    if (
      Object.hasOwn(s.deposits, c.id) ||
      !p.exists(c.beneficiaryId) ||
      c.beneficiaryId === a ||
      !positive(c.amount) ||
      !text(c.purpose)
    )
      return no('invalid-deposit');
    if (p.balance(a) < c.amount) return no('insufficient-balance');
    return {
      accepted: true,
      events: [
        {
          type: 'DepositChanged',
          deposit: {
            id: c.id,
            payerId: a,
            beneficiaryId: c.beneficiaryId,
            amount: c.amount,
            held: c.amount,
            purpose: c.purpose,
            status: 'held',
            revision: 1,
            at,
          },
        },
      ],
      transactions: [transfer(a, 'escrow', c.amount)],
      stockTransfers: [],
    };
  }
  if (c.type === 'deposits.release' || c.type === 'deposits.settle') {
    const d = s.deposits[c.id];
    if (!d || d.status !== 'held') return no('deposit-not-held');
    if (d.revision !== c.expectedRevision) return no('revision-conflict');
    if (a !== (c.type === 'deposits.release' ? d.beneficiaryId : d.payerId))
      return no('deposit-authorization-required');
    return {
      accepted: true,
      events: [
        {
          type: 'DepositChanged',
          deposit: {
            ...d,
            held: 0,
            status: c.type === 'deposits.release' ? 'returned' : 'settled',
            revision: d.revision + 1,
          },
        },
      ],
      transactions: [
        transfer('escrow', c.type === 'deposits.release' ? d.payerId : d.beneficiaryId, d.held),
      ],
      stockTransfers: [],
    };
  }
  return no('unknown-commerce-command');
}
