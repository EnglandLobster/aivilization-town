import { createMoneyTransfer, economicAccount } from '@aivilization/economy';
import type {
  CommerceCommand,
  CommerceDecision,
  CommercePorts,
  CommerceState,
  Order,
  StockTransfer,
} from './model';
export function decideOrder(
  s: CommerceState,
  a: string,
  at: number,
  c: Extract<CommerceCommand, { type: `orders.${string}` }>,
  ports: CommercePorts,
  transactionId: string,
): CommerceDecision {
  const no = (reason: string): CommerceDecision => ({ accepted: false, reason });
  const escrow = economicAccount('public-service', 'resident-commerce');
  const cash = (from: string, to: string, amount: number) =>
    createMoneyTransfer({
      transactionId,
      reason: c.type,
      from: from === 'escrow' ? escrow : economicAccount('agent', from),
      to: to === 'escrow' ? escrow : economicAccount('agent', to),
      amount,
    });
  if (c.type === 'orders.create') {
    const offer = s.offers[c.offerId];
    if (!offer?.active || offer.revision !== c.offerRevision)
      return no('offer-unavailable-or-revised');
    if (offer.sellerId === a) return no('cannot-buy-own-offer');
    if (
      Object.hasOwn(s.orders, c.id) ||
      !Number.isSafeInteger(c.quantity) ||
      c.quantity < 1 ||
      c.quantity > offer.maxQuantity
    )
      return no('invalid-order-quantity-or-id');
    const total = offer.unitPrice * c.quantity;
    if (!Number.isFinite(total) || total > s.policy.maxAmount) return no('order-total-limit');
    const order: Order = {
      id: c.id,
      offerId: offer.id,
      offerRevision: offer.revision,
      sellerId: offer.sellerId,
      buyerId: a,
      kind: offer.kind,
      ...(offer.deliveryMode === undefined ? {} : { deliveryMode: offer.deliveryMode }),
      commodity: offer.commodity,
      terms: offer.description,
      quantity: c.quantity,
      total,
      revision: 1,
      status: 'pending',
      escrow: 0,
      stockHeld: 0,
      paid: 0,
      refunded: 0,
      delivered: false,
      at,
      statements: [],
    };
    return {
      accepted: true,
      events: [{ type: 'OrderChanged', order }],
      transactions: [],
      stockTransfers: [],
    };
  }
  const old = s.orders[c.id];
  if (!old || ![old.buyerId, old.sellerId].includes(a)) return no('order-not-found');
  if (c.expectedRevision !== old.revision) return no('revision-conflict');
  const o = { ...old, revision: old.revision + 1 };
  const transactions = [];
  const stockTransfers: StockTransfer[] = [];
  const seller = a === o.sellerId,
    buyer = a === o.buyerId;
  if (c.type === 'orders.propose-settlement') {
    if (
      !['paid', 'delivered', 'disputed'].includes(o.status) ||
      o.escrow <= 0 ||
      !Number.isFinite(c.amount) ||
      c.amount! < 0 ||
      c.amount! > o.escrow ||
      !c.content?.trim() ||
      c.content.length > s.policy.maxText
    )
      return no('invalid-settlement');
    o.settlement = {
      version: 'order-settlement-v1',
      authorId: a,
      refundAmount: c.amount!,
      terms: c.content,
      orderRevision: o.revision,
      status: 'proposed',
      at,
    };
    o.statements = [
      ...o.statements,
      { authorId: a, kind: 'settlement-proposed', content: c.content, at },
    ];
  } else if (c.type === 'orders.respond-settlement') {
    const proposal = old.settlement;
    if (
      !proposal ||
      proposal.status !== 'proposed' ||
      proposal.orderRevision !== old.revision ||
      typeof c.accept !== 'boolean'
    )
      return no('settlement-missing-or-stale');
    if (c.accept && proposal.authorId === a) return no('counterparty-consent-required');
    o.settlement = { ...proposal, status: c.accept ? 'accepted' : 'declined' };
    if (c.accept) {
      if (proposal.refundAmount > o.escrow) return no('settlement-escrow-changed');
      if (proposal.refundAmount > 0)
        transactions.push({
          ...cash('escrow', o.buyerId, proposal.refundAmount),
          transactionId: transactionId + '-refund',
        });
      const released = o.escrow - proposal.refundAmount;
      if (released > 0)
        transactions.push({
          ...cash('escrow', o.sellerId, released),
          transactionId: transactionId + '-release',
        });
      o.refunded += proposal.refundAmount;
      o.escrow = 0;
      if (o.stockHeld > 0)
        stockTransfers.push({
          from: 'escrow',
          to: o.sellerId,
          commodity: o.commodity,
          quantity: o.stockHeld,
        });
      o.stockHeld = 0;
      o.status = 'settled';
    }
    o.statements = [
      ...o.statements,
      {
        authorId: a,
        kind: c.accept ? 'settlement-accepted' : 'settlement-declined',
        content: proposal.terms,
        at,
      },
    ];
  } else if (c.type === 'orders.accept') {
    if (!seller || o.status !== 'pending') return no('seller-pending-required');
    if (o.kind === 'goods') {
      if (ports.stock(a, o.commodity) < o.quantity) return no('insufficient-stock');
      stockTransfers.push({ from: a, to: 'escrow', commodity: o.commodity, quantity: o.quantity });
      o.stockHeld = o.quantity;
    }
    o.status = 'accepted';
  } else if (c.type === 'orders.pay') {
    if (!buyer || o.status !== 'accepted') return no('buyer-accepted-required');
    if (ports.balance(a) < o.total) return no('insufficient-balance');
    transactions.push(cash(a, 'escrow', o.total));
    o.escrow = o.total;
    o.paid = o.total;
    o.status = 'paid';
  } else if (c.type === 'orders.deliver') {
    if (!seller || o.status !== 'paid') return no('seller-paid-required');
    if (o.deliveryMode !== 'remote' && !ports.coLocated(o.buyerId, o.sellerId))
      return no('participants-must-be-idle-and-colocated');
    if (!c.content?.trim() || c.content.length > s.policy.maxText)
      return no('delivery-statement-required');
    if (o.kind === 'goods') {
      stockTransfers.push({
        from: 'escrow',
        to: o.buyerId,
        commodity: o.commodity,
        quantity: o.stockHeld,
      });
      o.stockHeld = 0;
    }
    o.statements = [...o.statements, { authorId: a, kind: 'delivery', content: c.content, at }];
    o.delivered = true;
    o.status = 'delivered';
  } else if (c.type === 'orders.confirm') {
    if (!buyer || o.status !== 'delivered') return no('buyer-delivered-required');
    if (o.escrow > 0) transactions.push(cash('escrow', o.sellerId, o.escrow));
    o.escrow = 0;
    o.status = 'completed';
  } else if (c.type === 'orders.cancel') {
    if (!['pending', 'accepted', 'paid'].includes(o.status)) return no('order-cannot-cancel');
    if (o.escrow > 0) {
      transactions.push(cash('escrow', o.buyerId, o.escrow));
      o.refunded += o.escrow;
      o.escrow = 0;
    }
    if (o.stockHeld > 0) {
      stockTransfers.push({
        from: 'escrow',
        to: o.sellerId,
        commodity: o.commodity,
        quantity: o.stockHeld,
      });
      o.stockHeld = 0;
    }
    o.status = 'cancelled';
  } else if (c.type === 'orders.dispute') {
    if (
      !['paid', 'delivered', 'completed', 'disputed'].includes(o.status) ||
      !c.content?.trim() ||
      c.content.length > s.policy.maxText
    )
      return no('invalid-dispute');
    o.status = 'disputed';
    o.statements = [...o.statements, { authorId: a, kind: 'dispute', content: c.content, at }];
  } else if (c.type === 'orders.refund') {
    const amount = c.amount ?? 0;
    if (
      !seller ||
      !['paid', 'delivered', 'completed', 'disputed'].includes(o.status) ||
      !Number.isFinite(amount) ||
      amount <= 0 ||
      amount > o.paid - o.refunded
    )
      return no('invalid-refund');
    const held = Math.min(o.escrow, amount),
      own = amount - held;
    if (ports.balance(a) < own) return no('insufficient-balance');
    if (held > 0)
      transactions.push({
        ...cash('escrow', o.buyerId, held),
        transactionId: transactionId + '-escrow',
      });
    if (own > 0)
      transactions.push({ ...cash(a, o.buyerId, own), transactionId: transactionId + '-seller' });
    o.escrow -= held;
    o.refunded += amount;
    if (o.refunded === o.paid) {
      o.status = 'refunded';
      if (o.stockHeld > 0) {
        stockTransfers.push({
          from: 'escrow',
          to: o.sellerId,
          commodity: o.commodity,
          quantity: o.stockHeld,
        });
        o.stockHeld = 0;
      }
    }
  }
  return {
    accepted: true,
    events: [{ type: 'OrderChanged', order: o }],
    transactions,
    stockTransfers,
  };
}
