import type { AccountingTransaction } from '@aivilization/economy';
export const COMMERCE_POLICY = {
  version: 'resident-commerce-v1',
  maxText: 8000,
  maxParticipants: 20,
  maxAmount: 1000000,
} as const;
export type CommercePolicy = {
  version: 'resident-commerce-v1';
  maxText: number;
  maxParticipants: number;
  maxAmount: number;
};
export function assertCommercePolicy(p: CommercePolicy) {
  if (
    p.version !== 'resident-commerce-v1' ||
    [p.maxText, p.maxParticipants, p.maxAmount].some((n) => !Number.isSafeInteger(n) || n < 1)
  )
    throw new Error('invalid-commerce-policy');
}
export type Offer = {
  id: string;
  sellerId: string;
  kind: 'goods' | 'service';
  deliveryMode?: 'in-person' | 'remote';
  commodity: string;
  description: string;
  unitPrice: number;
  maxQuantity: number;
  revision: number;
  active: boolean;
  at: number;
};
export type Order = {
  id: string;
  offerId: string;
  offerRevision: number;
  sellerId: string;
  buyerId: string;
  kind: Offer['kind'];
  deliveryMode?: 'in-person' | 'remote';
  settlement?: {
    version: 'order-settlement-v1';
    authorId: string;
    refundAmount: number;
    terms: string;
    orderRevision: number;
    status: 'proposed' | 'accepted' | 'declined';
    at: number;
  };
  commodity: string;
  terms: string;
  quantity: number;
  total: number;
  revision: number;
  status:
    | 'pending'
    | 'accepted'
    | 'paid'
    | 'delivered'
    | 'completed'
    | 'cancelled'
    | 'disputed'
    | 'refunded'
    | 'settled';
  escrow: number;
  stockHeld: number;
  paid: number;
  refunded: number;
  delivered: boolean;
  at: number;
  statements: readonly { authorId: string; kind: string; content: string; at: number }[];
};
export type PaymentRequest = {
  id: string;
  requesterId: string;
  payers: readonly string[];
  amountEach: number;
  paidBy: readonly string[];
  description: string;
  closed: boolean;
  revision: number;
  at: number;
};
export type Deposit = {
  id: string;
  payerId: string;
  beneficiaryId: string;
  amount: number;
  held: number;
  purpose: string;
  status: 'held' | 'returned' | 'settled';
  revision: number;
  at: number;
};
export type CommerceState = {
  policy: CommercePolicy;
  offers: Readonly<Record<string, Offer>>;
  orders: Readonly<Record<string, Order>>;
  requests: Readonly<Record<string, PaymentRequest>>;
  deposits: Readonly<Record<string, Deposit>>;
};
export type CommerceEvent =
  | { type: 'CommerceEnabled'; policy: CommercePolicy }
  | { type: 'OfferChanged'; offer: Offer }
  | { type: 'OrderChanged'; order: Order }
  | { type: 'PaymentRequestChanged'; request: PaymentRequest }
  | { type: 'DepositChanged'; deposit: Deposit };
export type StockTransfer = { from: string; to: string; commodity: string; quantity: number };
export type CommerceDecision =
  | {
      accepted: true;
      events: readonly CommerceEvent[];
      transactions: readonly AccountingTransaction[];
      stockTransfers: readonly StockTransfer[];
    }
  | { accepted: false; reason: string };
export type CommerceCommand =
  | {
      type: 'offers.publish';
      id: string;
      kind: Offer['kind'];
      deliveryMode?: 'in-person' | 'remote';
      commodity: string;
      description: string;
      unitPrice: number;
      maxQuantity: number;
    }
  | { type: 'offers.withdraw'; id: string; expectedRevision: number }
  | { type: 'orders.create'; id: string; offerId: string; offerRevision: number; quantity: number }
  | {
      type:
        | 'orders.accept'
        | 'orders.pay'
        | 'orders.deliver'
        | 'orders.confirm'
        | 'orders.cancel'
        | 'orders.dispute'
        | 'orders.refund'
        | 'orders.propose-settlement'
        | 'orders.respond-settlement';
      id: string;
      expectedRevision: number;
      content?: string;
      amount?: number;
      accept?: boolean;
    }
  | { type: 'payments.transfer'; targetId: string; amount: number; note: string }
  | {
      type: 'payments.request';
      id: string;
      payers: readonly string[];
      amountEach: number;
      description: string;
    }
  | { type: 'payments.pay' | 'payments.cancel'; id: string; expectedRevision: number }
  | { type: 'deposits.lock'; id: string; beneficiaryId: string; amount: number; purpose: string }
  | { type: 'deposits.release' | 'deposits.settle'; id: string; expectedRevision: number };
export type CommercePorts = {
  exists: (id: string) => boolean;
  balance: (id: string) => number;
  stock: (id: string, commodity: string) => number;
  coLocated: (a: string, b: string) => boolean;
  commodityExists: (name: string) => boolean;
};
export function emptyCommerceState(policy: CommercePolicy = COMMERCE_POLICY): CommerceState {
  assertCommercePolicy(policy);
  return { policy, offers: {}, orders: {}, requests: {}, deposits: {} };
}
export function commerceEscrowBalance(s: CommerceState) {
  return (
    Object.values(s.orders).reduce((n, o) => n + o.escrow, 0) +
    Object.values(s.deposits).reduce((n, d) => n + d.held, 0)
  );
}
export function applyCommerceEvent(s: CommerceState | undefined, e: CommerceEvent): CommerceState {
  if (e.type === 'CommerceEnabled') {
    if (s) throw new Error('commerce-already-enabled');
    return emptyCommerceState(e.policy);
  }
  if (!s) throw new Error('commerce-not-enabled');
  const check = (previous: number | undefined, next: number) => {
    if ((previous ?? 0) + 1 !== next) throw new Error('commerce-revision-gap');
  };
  switch (e.type) {
    case 'OfferChanged':
      check(s.offers[e.offer.id]?.revision, e.offer.revision);
      return { ...s, offers: { ...s.offers, [e.offer.id]: e.offer } };
    case 'OrderChanged':
      check(s.orders[e.order.id]?.revision, e.order.revision);
      return { ...s, orders: { ...s.orders, [e.order.id]: e.order } };
    case 'PaymentRequestChanged':
      check(s.requests[e.request.id]?.revision, e.request.revision);
      return { ...s, requests: { ...s.requests, [e.request.id]: e.request } };
    case 'DepositChanged':
      check(s.deposits[e.deposit.id]?.revision, e.deposit.revision);
      return { ...s, deposits: { ...s.deposits, [e.deposit.id]: e.deposit } };
  }
}
