import { expect, test } from 'vitest';
import type {
  PrincipalAuthorization,
  PrincipalOperationRequest,
  ResourcePrincipal,
} from '@aivilization/authority';
import {
  emptyResourceSalesState,
  applyResourceSaleEvent,
  decideResourceSale,
  extendResourceSalesPolicy,
} from './resourceSales';
import { resourceSaleControlEffect, resourceSaleForControl } from './resourceSaleFacts';
import {
  RESOURCE_SALES_POLICY,
  RESOURCE_SALES_POLICY_V2,
  type ResourceSaleSource,
  type ResourceSaleKind,
  type ResourceSaleCommand,
  type ResourceSalePorts,
  type ResourceSalesState,
  type ResourceSaleEvent,
} from './resourceSaleModel';
function source(kind: ResourceSaleKind): ResourceSaleSource {
  const seller: ResourcePrincipal = { kind: 'resident', id: 'seller' },
    target: ResourcePrincipal = { kind: 'resident', id: 'buyer' },
    common = {
      id: 'asset',
      revision: 2,
      controlVersion: 2,
      seller,
      authorId: 'creator',
      locationId: 'place',
      encumbrances: [{ kind: 'old-obligation', id: 'existing', revision: 2 }],
      offer: {
        target,
        expiresAt: 1000,
        offeredAt: 0,
        terms: '实际控制交接',
        authorization: {
          actorId: 'seller',
          principal: seller,
          source: { kind: 'personal' as const },
          request: {
            resourceKind: kind,
            resourceId: 'asset',
            resourceRevision: 1,
            controlVersion: 1,
            command: { type: 'offer' as const, target, expiresAt: 1000, terms: '实际控制交接' },
          },
        },
      },
    };
  if (kind === 'premises')
    return {
      ...common,
      version: 'premises-sale-source-v1',
      kind,
      condition: 1000,
      buildingStatus: 'operational',
      blueprint: { primaryUse: 'residence', capacity: 2, floorArea: 8, fixtures: {} },
      openProjects: [],
    };
  if (kind === 'stock')
    return {
      ...common,
      version: 'stock-sale-source-v1',
      kind,
      stockStatus: 'open',
      inventory: { Wood: 3 },
      contributors: ['supplier'],
      readers: ['reader'],
    };
  return {
    ...common,
    version: 'vehicle-sale-source-v1',
    kind,
    seats: 3,
    authorized: ['driver'],
    cargoCapacity: {
      version: 'vehicle-cargo-capacity-v1',
      units: 10,
      source: 'scenario-seed',
      sourceId: 'actual-origin',
    },
    busy: false,
  };
}
function fixture(kind: ResourceSaleKind) {
  let state: ResourceSalesState = emptyResourceSalesState(),
    actual = source(kind);
  const events: ResourceSaleEvent[] = [
    { type: 'ResourceSalesEnabled', policy: RESOURCE_SALES_POLICY },
  ];
  const ports: ResourceSalePorts = {
    exists: (id) => ['seller', 'buyer', 'driver'].includes(id),
    available: () => true,
    source: () => actual,
    account: (a) => ({
      principal: { kind: 'resident', id: a.id },
      balance: 100,
      status: 'open',
      maximumBalance: 1000,
    }),
    authorize: (p, r) =>
      ({
        actorId: p.id,
        principal: p,
        request: r,
        source: { kind: 'personal' },
      }) satisfies PrincipalAuthorization<PrincipalOperationRequest>,
  };
  const c: Extract<ResourceSaleCommand, { type: 'offer' }> = {
    type: 'offer',
    id: 'sale',
    title: '实际资产报价',
    terms: '不搬运、强迫劳动或消除旧责任',
    resource: { kind, id: 'asset', expectedRevision: 2 },
    payer: { sector: 'agent', id: 'buyer' },
    revenue: { sector: 'agent', id: 'seller' },
    amount: 25,
    acceptBy: 1000,
  };
  const apply = (d: ReturnType<typeof decideResourceSale>) => {
    if (!d.accepted) return d;
    for (const e of d.events) {
      state = applyResourceSaleEvent(state, e);
      events.push(e);
    }
    return d;
  };
  return {
    c,
    ports,
    events,
    get state() {
      return state;
    },
    get actual() {
      return actual;
    },
    change(s: ResourceSaleSource) {
      actual = s;
    },
    extend: () => apply(extendResourceSalesPolicy(state)),
    run: (
      c: ResourceSaleCommand,
      actor = c.type === 'accept' || c.type === 'decline' ? 'buyer' : 'seller',
    ) => apply(decideResourceSale(state, actor, 1, c, ports)),
    replay: () =>
      expect(
        events.reduce<ResourceSalesState | undefined>(applyResourceSaleEvent, undefined),
      ).toEqual(state),
  };
}
test('v2 is explicit and keeps original v1 quotes/history/price/scope; old mode cannot silently sell stock or vehicle', () => {
  const legacy = fixture('premises');
  expect(legacy.run(legacy.c).accepted).toBe(true);
  const old = structuredClone(legacy.state.sales);
  expect(legacy.extend().accepted).toBe(true);
  expect(legacy.state.sales).toEqual(old);
  expect(legacy.state.policy).toEqual(RESOURCE_SALES_POLICY_V2);
  expect(legacy.extend().accepted).toBe(false);
  expect(legacy.run({ type: 'accept', id: 'sale', expectedRevision: 1 }).accepted).toBe(true);
  legacy.replay();
  for (const kind of ['stock', 'vehicle'] as const) {
    const t = fixture(kind);
    expect(t.run(t.c)).toMatchObject({ accepted: false, reason: 'resource-sale-kind-not-enabled' });
    expect(t.state.sales).toEqual({});
    expect(t.extend().accepted).toBe(true);
    expect(t.run(t.c).accepted).toBe(true);
    expect(t.state.sales.sale!.source).toEqual(t.actual);
  }
});
test('stock and vehicle use the same independently signed immediate price, without granting travel, labor, authorship, ACL or entrusted goods', () => {
  for (const kind of ['stock', 'vehicle'] as const) {
    const t = fixture(kind);
    t.extend();
    const actual = structuredClone(t.actual);
    expect(t.run(t.c).accepted).toBe(true);
    expect(t.run({ type: 'accept', id: 'sale', expectedRevision: 1 }).accepted).toBe(true);
    const s = t.state.sales.sale!;
    expect(s.paidMicros).toBe(25000000);
    expect(
      resourceSaleControlEffect(s, { type: 'accept', id: s.id, expectedRevision: 1 }),
    ).toMatchObject({
      resourceKind: kind,
      resourceId: 'asset',
      resourceRevision: 2,
      command: { type: 'accept' },
    });
    expect(t.actual).toEqual(actual);
    expect(s.source.authorId).toBe('creator');
    expect(s.source.encumbrances).toEqual(actual.encumbrances);
    const committed = t.events.at(-1)!;
    if (committed.type !== 'ResourceSaleCommitted') throw Error('price receipt required');
    expect(committed.transactions).toHaveLength(2);
    for (const x of committed.transactions)
      expect(x.entries.reduce((n, e) => n + e.amount, 0)).toBe(0);
    const offered = t.events.find((e) => e.type === 'ResourceSaleCommitted');
    if (!offered) throw Error('offer');
    expect(() => applyResourceSaleEvent(emptyResourceSalesState(), offered)).toThrow(
      'resource-sale-kind-not-enabled',
    );
    t.replay();
  }
});
test('actual source inventory/driver/obligation changes or unavailable body assets reject whole acceptance and cannot free-bypass price', () => {
  for (const kind of ['stock', 'vehicle'] as const) {
    const t = fixture(kind);
    t.extend();
    t.run(t.c);
    const before = structuredClone(t.state),
      original = t.actual;
    t.change({
      ...original,
      encumbrances: [...original.encumbrances, { kind: 'new-obligation', id: 'new', revision: 1 }],
    });
    expect(t.run({ type: 'accept', id: 'sale', expectedRevision: 1 })).toMatchObject({
      accepted: false,
      reason: 'resource-sale-owning-source-changed',
    });
    expect(t.state).toEqual(before);
    t.change(original);
    t.run({ type: 'decline', id: 'sale', expectedRevision: 1 });
    expect(resourceSaleForControl(t.state, kind, 'asset', 2)?.status).toBe('declined');
  }
  const stock = fixture('stock');
  stock.extend();
  const s = stock.actual;
  if (s.kind !== 'stock') throw Error('stock');
  stock.change({ ...s, stockStatus: 'settling' });
  expect(stock.run(stock.c).accepted).toBe(false);
  const vehicle = fixture('vehicle');
  vehicle.extend();
  const v = vehicle.actual;
  if (v.kind !== 'vehicle') throw Error('vehicle');
  vehicle.change({ ...v, busy: true });
  expect(vehicle.run(vehicle.c).accepted).toBe(false);
});
test('wrong resource source cannot turn a stock request into a building or accept negative/forged cargo/inventory/ACL facts', () => {
  const t = fixture('stock');
  t.extend();
  t.change(source('premises'));
  expect(t.run(t.c)).toMatchObject({
    accepted: false,
    reason: 'resource-sale-source-target-mismatch',
  });
  t.change(source('stock'));
  const s = t.actual;
  if (s.kind !== 'stock') throw Error('stock');
  for (const inventory of [{ Wood: -1 }, { Wood: Infinity }, { Wood: NaN }]) {
    t.change({ ...s, inventory });
    expect(t.run(t.c).accepted).toBe(false);
    expect(t.state.sales).toEqual({});
  }
  const vehicle = fixture('vehicle');
  vehicle.extend();
  const v = vehicle.actual;
  if (v.kind !== 'vehicle') throw Error('vehicle');
  vehicle.change({
    ...v,
    cargoCapacity: {
      version: 'vehicle-cargo-capacity-v1',
      source: 'scenario-seed',
      sourceId: 'origin',
      units: -1,
    },
  });
  expect(vehicle.run(vehicle.c).accepted).toBe(false);
});
