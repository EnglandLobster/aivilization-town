import { expect, test } from 'vitest';
import {
  type ResourcePrincipal,
  type PrincipalAuthorization,
  type PrincipalOperationRequest,
} from '@aivilization/authority';
import {
  RESOURCE_SALES_POLICY,
  type ResourceSaleSource,
  type ResourceSalePorts,
  type ResourceSaleCommand,
  type ResourceSaleEvent,
} from './resourceSaleModel';
import {
  emptyResourceSalesState,
  decideResourceSale,
  applyResourceSaleEvent,
  expireResourceSale,
} from './resourceSales';
import { resourceSaleForControl, resourceSaleControlEffect } from './resourceSaleFacts';
const seller: ResourcePrincipal = { kind: 'resident', id: 'seller' },
  buyer: ResourcePrincipal = { kind: 'public', id: 'town' };
const source: ResourceSaleSource = {
  version: 'premises-sale-source-v1',
  kind: 'premises',
  id: 'home',
  revision: 2,
  controlVersion: 2,
  seller,
  offer: {
    target: buyer,
    expiresAt: 1000000,
    terms: 'Specific building transfer',
    offeredAt: 0,
    authorization: {
      actorId: 'seller',
      principal: seller,
      request: {
        resourceKind: 'premises',
        resourceId: 'home',
        resourceRevision: 1,
        controlVersion: 1,
        command: {
          type: 'offer',
          target: buyer,
          expiresAt: 1000000,
          terms: 'Specific building transfer',
        },
      },
      source: { kind: 'personal' },
    },
  },
  authorId: 'builder',
  locationId: 'premises-home',
  blueprint: {
    primaryUse: 'residence',
    floorArea: 8,
    capacity: 2,
    fixtures: { workstations: 0, careStations: 0, teachingStations: 0, storageUnits: 0 },
  },
  condition: 1000,
  buildingStatus: 'operational',
  openProjects: [],
  encumbrances: [{ kind: 'permit', id: 'old-lease', revision: 4 }],
};
function setup() {
  let state = emptyResourceSalesState(),
    actual = structuredClone(source),
    payerBalance = 100,
    revenueBalance = 0,
    maximumBalance = 1000000;
  const events: ResourceSaleEvent[] = [],
    authorize = (
      principal: ResourcePrincipal,
      request: PrincipalOperationRequest,
    ): PrincipalAuthorization<PrincipalOperationRequest> | undefined =>
      principal.kind === 'resident' && principal.id === 'seller'
        ? { actorId: 'seller', principal, request, source: { kind: 'personal' } }
        : principal.kind === 'public' && principal.id === 'town'
          ? {
              actorId: 'public-runner',
              principal,
              request,
              source: { kind: 'public', proposalId: 'purchase', procedureRevision: 2 },
            }
          : undefined;
  const ports: ResourceSalePorts = {
    exists: (id) => ['seller', 'public-runner', 'third'].includes(id),
    available: () => true,
    source: () => actual,
    account: (a) =>
      a.sector === 'treasury'
        ? { principal: buyer, balance: payerBalance, status: 'open', maximumBalance: 1000000 }
        : a.id === 'seller'
          ? { principal: seller, balance: revenueBalance, status: 'open', maximumBalance }
          : undefined,
    authorize,
  };
  const c: ResourceSaleCommand = {
    type: 'offer',
    id: 'purchase',
    title: 'Builder offer',
    terms: 'Real public acquisition',
    resource: { kind: 'premises', id: 'home', expectedRevision: 2 },
    payer: { sector: 'treasury', id: 'public-treasury' },
    revenue: { sector: 'agent', id: 'seller' },
    amount: 25,
    acceptBy: 1000000,
  };
  const run = (
    command: ResourceSaleCommand,
    actor = command.type === 'offer' || command.type === 'withdraw' ? 'seller' : 'public-runner',
    at = 0,
    p = ports,
  ) => {
    const d = decideResourceSale(state, actor, at, command, p);
    if (d.accepted) {
      for (const e of d.events) {
        state = applyResourceSaleEvent(state, e);
        events.push(e);
      }
    }
    return d;
  };
  const offered = () => {
    expect(run(c).accepted).toBe(true);
    return state.sales.purchase!;
  };
  return {
    ports,
    c,
    events,
    run,
    offered,
    get state() {
      return state;
    },
    get actual() {
      return actual;
    },
    setActual(v: ResourceSaleSource) {
      actual = v;
    },
    setPayer(n: number) {
      payerBalance = n;
    },
    setRevenue(n: number, max = 1000000) {
      revenueBalance = n;
      maximumBalance = max;
    },
    replay: () =>
      expect(events.reduce(applyResourceSaleEvent, emptyResourceSalesState())).toEqual(state),
  };
}
test('actual seller and public buyer independently approve fixed price/control; immediate balanced transfer never creates another physical asset', () => {
  const t = setup();
  t.offered();
  expect(t.state.sales.purchase!.paidMicros).toBe(0);
  expect(t.run({ type: 'accept', id: 'purchase', expectedRevision: 1 }).accepted).toBe(true);
  const sale = t.state.sales.purchase!,
    event = t.events[1]!;
  expect(sale).toMatchObject({
    status: 'settled',
    paidMicros: 25000000,
    acceptedAuthorization: {
      actorId: 'public-runner',
      source: { kind: 'public', proposalId: 'purchase' },
    },
  });
  if (event.type !== 'ResourceSaleCommitted') throw Error('expected committed sale');
  expect(event.transactions).toHaveLength(2);
  expect(event.transactions[0]!.entries.reduce((n, e) => n + e.amount, 0)).toBe(0);
  expect(event.transactions[0]!.entries.map((e) => e.account.sector)).toEqual([
    'treasury',
    'public-service',
  ]);
  expect(event.transactions[1]!.entries.map((e) => e.account.sector)).toEqual([
    'public-service',
    'agent',
  ]);
  expect(
    event.transactions
      .flatMap((t) => t.entries)
      .filter((e) => e.account.sector === 'public-service')
      .reduce((n, e) => n + e.amount, 0),
  ).toBe(0);
  for (const transaction of event.transactions)
    expect(transaction.entries.reduce((n, e) => n + e.amount, 0)).toBe(0);
  expect(sale.source.authorId).toBe('builder');
  expect(sale.source.encumbrances).toEqual(source.encumbrances);
  expect(t.actual).toEqual(source);
  t.replay();
});
test('wrong actor, price, account ownership, deadline and version cannot authorize a resource exchange', () => {
  const t = setup();
  for (const amount of [0, -1, Infinity, NaN, 1000001])
    expect(t.run({ ...t.c, type: 'offer', amount }).accepted).toBe(false);
  expect(t.run({ ...t.c, type: 'offer', acceptBy: 999999 }).accepted).toBe(false);
  expect(
    t.run({
      ...t.c,
      type: 'offer',
      resource: { kind: 'premises', id: 'home', expectedRevision: 1 },
    }).accepted,
  ).toBe(false);
  expect(
    t.run({ ...t.c, type: 'offer', revenue: { sector: 'treasury', id: 'public-treasury' } })
      .accepted,
  ).toBe(false);
  expect(Object.keys(t.state.sales)).toHaveLength(0);
  t.offered();
  const before = structuredClone(t.state);
  expect(t.run({ type: 'accept', id: 'purchase', expectedRevision: 1 }, 'third').accepted).toBe(
    false,
  );
  expect(t.run({ type: 'accept', id: 'purchase', expectedRevision: 2 }).accepted).toBe(false);
  expect(
    t.run({ type: 'accept', id: 'purchase', expectedRevision: 1 }, 'public-runner', 1000000)
      .accepted,
  ).toBe(false);
  expect(t.state).toEqual(before);
  t.replay();
});
test('unavailable funds or reserved revenue space reject the whole decision; accounts are never stored as an alternative balance ledger', () => {
  const t = setup();
  t.offered();
  const before = structuredClone(t.state);
  t.setPayer(24.999999);
  expect(t.run({ type: 'accept', id: 'purchase', expectedRevision: 1 })).toMatchObject({
    accepted: false,
    reason: 'insufficient-resource-sale-funds',
  });
  t.setPayer(100);
  t.setRevenue(999999);
  expect(t.run({ type: 'accept', id: 'purchase', expectedRevision: 1 })).toMatchObject({
    accepted: false,
    reason: 'resource-sale-revenue-capacity',
  });
  expect(t.state).toEqual(before);
  t.setRevenue(999975);
  expect(t.run({ type: 'accept', id: 'purchase', expectedRevision: 1 }).accepted).toBe(true);
  t.replay();
});
test('real source/obligation/condition changes invalidate buyer acceptance rather than silently inheriting different assets or permissions', () => {
  const t = setup();
  t.offered();
  const before = structuredClone(t.state);
  for (const change of [
    { revision: 3 },
    { condition: 750 },
    { encumbrances: [...source.encumbrances, { kind: 'permit', id: 'new-lease', revision: 1 }] },
    { blueprint: { ...source.blueprint, capacity: 1 } },
  ]) {
    t.setActual({ ...source, ...change });
    expect(t.run({ type: 'accept', id: 'purchase', expectedRevision: 1 })).toMatchObject({
      accepted: false,
      reason: 'resource-sale-owning-source-changed',
    });
    expect(t.state).toEqual(before);
  }
  for (const change of [
    { condition: 0 },
    { buildingStatus: 'closed' as const },
    { openProjects: [{ id: 'unfinished', revision: 1 }] },
  ]) {
    const other = setup();
    other.setActual({ ...source, ...change });
    expect(other.run(other.c)).toMatchObject({
      accepted: false,
      reason: 'resource-sale-resource-not-deliverable',
    });
  }
});
test('seller withdrawal declares exact cancellation at the actual revision; buyer decline never obtains seller cancellation or free receipt', () => {
  const t = setup();
  t.offered();
  t.setActual({ ...source, revision: 3, condition: 750 });
  expect(t.run({ type: 'withdraw', id: 'purchase', expectedRevision: 1 }).accepted).toBe(true);
  const e = t.events[1]!;
  if (e.type !== 'ResourceSaleCommitted') throw Error('fixture');
  expect(e.authorization?.request.operation.arguments.controlEffect).toMatchObject({
    resourceRevision: 3,
    controlVersion: 2,
    command: { type: 'cancel' },
  });
  expect(resourceSaleForControl(t.state, 'premises', 'home', 2)?.status).toBe('withdrawn');
  expect(resourceSaleForControl(t.state, 'premises', 'home', 3)).toBeUndefined();
  const b = setup();
  b.offered();
  expect(b.run({ type: 'decline', id: 'purchase', expectedRevision: 1 }).accepted).toBe(true);
  expect(
    resourceSaleControlEffect(
      b.state.sales.purchase!,
      { type: 'decline', id: 'purchase', expectedRevision: 2 },
      source,
    ),
  ).toBeUndefined();
  expect(resourceSaleForControl(b.state, 'premises', 'home', 2)?.status).toBe('declined');
  t.replay();
  b.replay();
});
test('expiry and schema activation preserve legacy absence and explicit original binding; replay rejects forged price or physical proof', () => {
  const t = setup();
  t.offered();
  expect(expireResourceSale(t.state, 'purchase', 999999)).toEqual({ accepted: true, events: [] });
  const expiry = expireResourceSale(t.state, 'purchase', 1000000);
  expect(expiry.accepted).toBe(true);
  if (!expiry.accepted) throw Error('fixture');
  const expired = expiry.events.reduce(applyResourceSaleEvent, t.state);
  expect(expired.sales.purchase!.status).toBe('expired');
  expect(expired.sales.purchase!.paidMicros).toBe(0);
  expect(
    applyResourceSaleEvent(undefined, {
      type: 'ResourceSalesEnabled',
      policy: RESOURCE_SALES_POLICY,
    }),
  ).toEqual(emptyResourceSalesState());
  expect(() =>
    applyResourceSaleEvent(t.state, {
      type: 'ResourceSalesEnabled',
      policy: RESOURCE_SALES_POLICY,
    }),
  ).toThrow();
  expect(t.run({ type: 'accept', id: 'purchase', expectedRevision: 1 }).accepted).toBe(true);
  const event = t.events[1]!;
  if (event.type !== 'ResourceSaleCommitted') throw Error('fixture');
  const old = t.events.slice(0, 1).reduce(applyResourceSaleEvent, emptyResourceSalesState());
  expect(() =>
    applyResourceSaleEvent(old, { ...event, sale: { ...event.sale, amount: 20 } }),
  ).toThrow();
  expect(() => applyResourceSaleEvent(old, { ...event, transactions: [] })).toThrow(
    'resource-sale-revision-time-or-accounts-mismatch',
  );
  expect(() =>
    applyResourceSaleEvent(old, { ...event, sourceRead: { ...source, condition: 500 } }),
  ).toThrow('invalid-resource-sale-transition');
  t.replay();
});

test('closed caller command rejects identity/source/effect injection before reading or changing authoritative state', () => {
  const t = setup(),
    before = structuredClone(t.state);
  for (const extra of [
    { actorId: 'seller' },
    { source },
    { transactions: [] },
    { authorization: { kind: 'personal' } },
  ]) {
    const malformed = { ...t.c, ...extra };
    expect(t.run(malformed).accepted).toBe(false);
    expect(t.state).toEqual(before);
  }
  const extraResource = {
    ...t.c,
    type: 'offer' as const,
    resource: { ...t.c.resource, extra: 'hidden' },
  };
  expect(t.run(extraResource).accepted).toBe(false);
  t.offered();
  const injected = {
    type: 'accept' as const,
    id: 'purchase',
    expectedRevision: 1,
    actorId: 'public-runner',
  };
  expect(t.run(injected).accepted).toBe(false);
  expect(t.state.sales.purchase!.status).toBe('offered');
  t.replay();
});
