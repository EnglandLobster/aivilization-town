import { it, expect } from 'vitest';
import {
  applyCommerceEvent,
  emptyCommerceState,
  commerceEscrowBalance,
  type CommerceCommand,
  type CommerceEvent,
} from './model';
import { decideCommerce } from './aggregate';
it('reserves inventory, escrows payment, delivers only at a real shared location and conserves money', () => {
  let s = emptyCommerceState(),
    balances: Record<string, number> = { a: 100, b: 100 },
    stock: Record<string, number> = { a: 2, b: 0 },
    colocated = true;
  const events: CommerceEvent[] = [];
  const call = (a: string, c: CommerceCommand) => {
    const d = decideCommerce(
      s,
      a,
      0,
      c,
      {
        exists: (id) => id in balances,
        balance: (id) => balances[id] ?? 0,
        stock: (id) => stock[id] ?? 0,
        commodityExists: () => true,
        coLocated: () => colocated,
      },
      'tx',
    );
    if (d.accepted) {
      for (const t of d.transactions) {
        expect(t.entries.reduce((n, e) => n + e.amount, 0)).toBe(0);
        for (const e of t.entries)
          if (e.account.sector === 'agent') {
            const id = e.account.accountId.slice(6);
            balances = { ...balances, [id]: balances[id]! + e.amount };
          }
      }
      for (const t of d.stockTransfers) {
        if (t.from !== 'escrow') stock = { ...stock, [t.from]: stock[t.from]! - t.quantity };
        if (t.to !== 'escrow') stock = { ...stock, [t.to]: stock[t.to]! + t.quantity };
      }
      s = d.events.reduce(applyCommerceEvent, s);
      events.push(...d.events);
      expect(balances.a! + balances.b! + commerceEscrowBalance(s)).toBe(200);
      expect(
        stock.a! + stock.b! + Object.values(s.orders).reduce((n, o) => n + o.stockHeld, 0),
      ).toBe(2);
    }
    return d;
  };
  call('a', {
    type: 'offers.publish',
    id: 'f',
    kind: 'goods',
    commodity: 'food',
    description: '原话',
    unitPrice: 10,
    maxQuantity: 2,
  });
  call('b', { type: 'orders.create', id: 'o', offerId: 'f', offerRevision: 1, quantity: 2 });
  expect(call('b', { type: 'orders.accept', id: 'o', expectedRevision: 1 }).accepted).toBe(false);
  call('a', { type: 'orders.accept', id: 'o', expectedRevision: 1 });
  expect(stock.a).toBe(0);
  call('b', { type: 'orders.create', id: 'o2', offerId: 'f', offerRevision: 1, quantity: 1 });
  expect(call('a', { type: 'orders.accept', id: 'o2', expectedRevision: 1 })).toMatchObject({
    accepted: false,
    reason: 'insufficient-stock',
  });
  call('b', { type: 'orders.pay', id: 'o', expectedRevision: 2 });
  expect(balances.b).toBe(80);
  expect(balances.a).toBe(100);
  colocated = false;
  expect(
    call('a', { type: 'orders.deliver', id: 'o', expectedRevision: 3, content: '交付' }).accepted,
  ).toBe(false);
  colocated = true;
  call('a', { type: 'orders.deliver', id: 'o', expectedRevision: 3, content: '交付' });
  expect(stock.b).toBe(2);
  call('b', { type: 'orders.confirm', id: 'o', expectedRevision: 4 });
  expect(balances.a).toBe(120);
  expect(commerceEscrowBalance(s)).toBe(0);
  expect(
    call('a', { type: 'orders.refund', id: 'o', expectedRevision: 5, amount: 21 }).accepted,
  ).toBe(false);
  call('a', { type: 'orders.refund', id: 'o', expectedRevision: 5, amount: 5 });
  expect(balances.b).toBe(85);
  expect(events.reduce(applyCommerceEvent, emptyCommerceState())).toEqual(s);
});
it('payment requests and deposits require independent authorization and bounded amounts', () => {
  let s = emptyCommerceState();
  const ports = {
    exists: (id: string) => ['a', 'b', 'c'].includes(id),
    balance: () => 100,
    stock: () => 0,
    coLocated: () => true,
    commodityExists: () => true,
  };
  const call = (a: string, c: CommerceCommand) => {
    const d = decideCommerce(s, a, 0, c, ports, 'tx');
    if (d.accepted) s = d.events.reduce(applyCommerceEvent, s);
    return d;
  };
  call('a', {
    type: 'payments.request',
    id: 'r',
    payers: ['b', 'c'],
    amountEach: 5,
    description: '均摊',
  });
  expect(call('a', { type: 'payments.pay', id: 'r', expectedRevision: 1 }).accepted).toBe(false);
  call('b', { type: 'payments.pay', id: 'r', expectedRevision: 1 });
  expect(s.requests.r?.paidBy).toEqual(['b']);
  expect(call('b', { type: 'payments.pay', id: 'r', expectedRevision: 2 }).accepted).toBe(false);
  call('c', { type: 'payments.pay', id: 'r', expectedRevision: 2 });
  expect(s.requests.r?.closed).toBe(true);
  expect(
    call('a', { type: 'payments.transfer', targetId: 'b', amount: Infinity, note: 'bad' }).accepted,
  ).toBe(false);
  call('b', { type: 'deposits.lock', id: 'd', beneficiaryId: 'a', amount: 10, purpose: '押金' });
  expect(call('b', { type: 'deposits.release', id: 'd', expectedRevision: 1 }).accepted).toBe(
    false,
  );
  call('a', { type: 'deposits.release', id: 'd', expectedRevision: 1 });
  expect(s.deposits.d?.held).toBe(0);
});

it('remote work and negotiated escrow settlement preserve consent, amounts, stale-version safety and replay', () => {
  let s = emptyCommerceState();
  const events: CommerceEvent[] = [];
  const ports = {
    exists: (id: string) => ['a', 'b'].includes(id),
    balance: () => 100,
    stock: () => 1,
    commodityExists: () => true,
    coLocated: () => false,
  };
  const call = (a: string, c: CommerceCommand) => {
    const d = decideCommerce(s, a, 0, c, ports, 'settlement');
    if (d.accepted) {
      for (const t of d.transactions) expect(t.entries.reduce((n, e) => n + e.amount, 0)).toBe(0);
      s = d.events.reduce(applyCommerceEvent, s);
      events.push(...d.events);
    }
    return d;
  };
  expect(
    call('a', {
      type: 'offers.publish',
      id: 'bad',
      kind: 'goods',
      commodity: 'Apple',
      description: '货物不能远程传送',
      unitPrice: 10,
      maxQuantity: 1,
      deliveryMode: 'remote',
    }).accepted,
  ).toBe(false);
  call('a', {
    type: 'offers.publish',
    id: 'f',
    kind: 'service',
    commodity: 'service',
    description: '写作',
    unitPrice: 10,
    maxQuantity: 1,
    deliveryMode: 'remote',
  });
  call('b', { type: 'orders.create', id: 'o', offerId: 'f', offerRevision: 1, quantity: 1 });
  call('a', { type: 'orders.accept', id: 'o', expectedRevision: 1 });
  call('b', { type: 'orders.pay', id: 'o', expectedRevision: 2 });
  expect(
    call('a', { type: 'orders.deliver', id: 'o', expectedRevision: 3, content: '远程作品' })
      .accepted,
  ).toBe(true);
  call('b', { type: 'orders.dispute', id: 'o', expectedRevision: 4, content: '修改建议' });
  expect(
    call('a', {
      type: 'orders.propose-settlement',
      id: 'o',
      expectedRevision: 5,
      amount: 11,
      content: '不能超额退钱',
    }).accepted,
  ).toBe(false);
  call('a', {
    type: 'orders.propose-settlement',
    id: 'o',
    expectedRevision: 5,
    amount: 2,
    content: '退2，余款结算',
  });
  expect(
    call('a', { type: 'orders.respond-settlement', id: 'o', expectedRevision: 6, accept: true }),
  ).toMatchObject({ accepted: false, reason: 'counterparty-consent-required' });
  call('a', { type: 'orders.refund', id: 'o', expectedRevision: 6, amount: 1 });
  expect(
    call('b', { type: 'orders.respond-settlement', id: 'o', expectedRevision: 7, accept: true }),
  ).toMatchObject({ accepted: false, reason: 'settlement-missing-or-stale' });
  call('b', {
    type: 'orders.propose-settlement',
    id: 'o',
    expectedRevision: 7,
    amount: 1,
    content: '已退1，再退1',
  });
  const result = call('a', {
    type: 'orders.respond-settlement',
    id: 'o',
    expectedRevision: 8,
    accept: true,
  });
  expect(result.accepted).toBe(true);
  if (!result.accepted) throw new Error(result.reason);
  expect(result.transactions).toHaveLength(2);
  expect(s.orders.o).toMatchObject({ status: 'settled', escrow: 0, refunded: 2 });
  expect(events.reduce(applyCommerceEvent, emptyCommerceState())).toEqual(s);
});
