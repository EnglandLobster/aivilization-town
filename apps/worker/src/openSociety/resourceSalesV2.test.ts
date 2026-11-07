import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  resourceSaleRequest,
  type ResourceSaleCommand,
  type ResourceSaleKind,
} from '@aivilization/commerce';
import {
  resourcePrincipalSnapshot,
  type ResourcePrincipal,
  type PrincipalOperationRequest,
} from '@aivilization/authority';
import { authorizedDriver, vehiclePrincipalRequest } from '@aivilization/mobility';
import { applyWorldEvent, worldResourceSaleSource } from '@aivilization/world';
import { openPremisesFixture, premisesCleanup } from './testFixtures/openPremises';
import { OpenSocietyRuntime } from './runtime';
import { openPermitsFixture } from './testFixtures/openPermits';
import { openFreightFixture } from './testFixtures/openFreight';

function priceHelpers<
  T extends ReturnType<typeof openPremisesFixture> | ReturnType<typeof openFreightFixture>,
>(t: T, kind: ResourceSaleKind, id: string) {
  const resource = () =>
    kind === 'stock'
      ? t.r.state.world.materials!.stocks[id]!
      : t.r.state.world.residentMobility!.vehicles[id]!;
  const control = (command: Record<string, unknown>) => ({
    resourceKind: kind,
    resourceId: id,
    resourceRevision: resource().revision,
    controlVersion: resourcePrincipalSnapshot(resource()).version,
    command,
  });
  const request = (c: ResourceSaleCommand) =>
    resourceSaleRequest(
      t.r.state.world.resourceSales!,
      c,
      worldResourceSaleSource(t.r.state.world, id, kind),
    );
  const offer = (
    saleId = 'sale',
    payer: Extract<ResourceSaleCommand, { type: 'offer' }>['payer'] = { sector: 'agent', id: t.d },
    revenue: Extract<ResourceSaleCommand, { type: 'offer' }>['revenue'] = {
      sector: 'agent',
      id: t.a,
    },
  ): ResourceSaleCommand => ({
    type: 'offer',
    id: saleId,
    title: '真实保管权价格',
    terms: '不强迫身体、不瞬移',
    resource: { kind, id, expectedRevision: resource().revision },
    payer,
    revenue,
    amount: 25,
    acceptBy: resource().control!.offer!.expiresAt,
  });
  const handover = (target: ResourcePrincipal, actor = t.a) =>
    t.ok(actor, 'principals.control', {
      request: control({
        type: 'offer',
        target,
        terms: '保留来源与义务',
        expiresAt: t.r.state.world.clock.now + 1000000,
      }),
    });
  return { resource, control, request, offer, handover };
}
function fixture(kind: 'stock' | 'vehicle', v2 = true) {
  const t = openPremisesFixture(true, false, {}, true, { principals: true });
  expect(t.r.enablePremisesPrincipals().ok).toBe(true);
  expect(t.r.enableVehiclePrincipals().ok).toBe(true);
  expect(t.r.enableResourceSales().ok).toBe(true);
  if (v2) expect(t.r.enableResourceSalesV2().ok).toBe(true);
  if (kind === 'stock') {
    t.ok(t.a, 'stocks.create', { id: 'actual', title: '已有实物', locationId: t.location });
    t.ok(t.a, 'stocks.deposit', { id: 'actual', expectedRevision: 1, items: { Wood: 8 } });
    t.ok(t.a, 'stocks.configure', {
      id: 'actual',
      expectedRevision: 2,
      contributors: [t.c],
      readers: [t.c],
    });
  }
  const replay = () => {
    const before = structuredClone(t.r.state),
      bytes = readFileSync(join(t.root, 'journal.jsonl'));
    t.r.close();
    const r = new OpenSocietyRuntime(t.root);
    premisesCleanup.push(() => r.close());
    expect(r.state).toEqual(before);
    expect(readFileSync(join(t.root, 'journal.jsonl'))).toEqual(bytes);
  };
  return { ...t, ...priceHelpers(t, kind, kind === 'stock' ? 'actual' : 'seed-car-1'), replay };
}
function approvePublic(
  t: ReturnType<typeof fixture>,
  request: PrincipalOperationRequest,
  id: string,
) {
  const at = t.r.state.world.clock.now;
  t.ok(t.a, 'governance.propose', {
    id,
    text: '这个确切资产与财政款项',
    action: { kind: 'manage-resource', expectedRevision: request.resourceRevision, request },
    closesAt: at + 60000,
    expectedProcedureRevision: t.r.state.world.publicGovernance!.authority.procedureRevision,
  });
  for (const actor of [t.a, t.b, t.c])
    t.ok(actor, 'governance.vote', {
      id,
      choice: 'yes',
      expectedRevision: t.r.state.world.publicGovernance!.authority.proposals[id]!.revision,
    });
  t.time(60000);
  t.ok(t.d, 'governance.close', {
    id,
    expectedRevision: t.r.state.world.publicGovernance!.authority.proposals[id]!.revision,
  });
  return {
    id,
    expectedRevision: t.r.state.world.publicGovernance!.authority.proposals[id]!.revision,
  };
}
test.each(['stock', 'vehicle'] as const)(
  'new public %s acquisition requires fresh independent fiscal consent and atomically uses treasury rather than executor money',
  (kind) => {
    const t = fixture(kind),
      grant = t.r.state.world.publicGovernance!.authority.grant;
    t.handover({ kind: 'public', id: grant.id });
    t.ok(t.a, 'principals.operate', {
      request: t.request(t.offer('sale', { sector: 'treasury', id: 'public-treasury' })),
    });
    const q = t.request({ type: 'accept', id: 'sale', expectedRevision: 1 });
    expect(t.call(t.d, 'principals.operate', { request: q }).ok).toBe(false);
    const execute = approvePublic(t, q, 'purchase'),
      before = structuredClone(t.r.state.world);
    expect(before.publicGovernance!.authority.proposals.purchase!.resourceSalesScopeVersion).toBe(
      'public-paid-resource-control-v2',
    );
    t.ok(t.d, 'governance.execute', execute);
    expect(t.resource().control!.controller).toEqual({ kind: 'public', id: grant.id });
    expect(t.r.state.world.treasury).toBe(before.treasury! - 25);
    expect(t.r.state.world.agents[t.a]!.balance).toBe(before.agents[t.a]!.balance + 25);
    expect(t.r.state.world.agents[t.d]!.balance).toBe(before.agents[t.d]!.balance);
    expect(t.r.state.world.moneySupply).toBe(before.moneySupply);
    expect(t.call(t.d, 'governance.execute', execute).ok).toBe(false);
    t.replay();
  },
);
test.each(['stock', 'vehicle'] as const)(
  'collective %s purchase charges only its common account through one exact decision and one v2 receipt',
  (kind) => {
    const t = fixture(kind),
      at = t.r.state.world.clock.now;
    t.ok(t.b, 'collectives.create', {
      id: 'club',
      configuration: {
        title: '居民共同资产',
        terms: '自主决定',
        members: [t.b, t.c],
        voters: [t.b, t.c],
        threshold: 2,
        quorum: 2,
        timing: 'early',
        revote: true,
      },
      expiresAt: at + 1000000,
    });
    t.ok(t.c, 'collectives.respond', { id: 'club', expectedRevision: 1, accept: true });
    t.ok(t.b, 'funds.open', { id: 'pool', collectiveId: 'club', title: '共同现金' });
    t.ok(t.b, 'funds.contribute', {
      id: 'pool',
      expectedRevision: 1,
      amount: 40,
      note: '不默认造股权',
    });
    t.handover({ kind: 'collective', id: 'club' });
    t.ok(t.a, 'principals.operate', {
      request: t.request(t.offer('sale', { sector: 'collective', id: 'pool' })),
    });
    const request = t.request({ type: 'accept', id: 'sale', expectedRevision: 1 }),
      before = structuredClone(t.r.state.world);
    expect(t.call(t.b, 'principals.operate', { request }).ok).toBe(false);
    t.ok(t.b, 'collectives.propose', {
      id: 'purchase',
      collectiveId: 'club',
      expectedVersion: 1,
      terms: '完整价格与保管责任',
      action: {
        kind: 'resource',
        capability: 'principals.operate',
        resourceId: request.resourceId,
        arguments: { request },
      },
      closesAt: at + 100000,
      executeBefore: at + 1000000,
    });
    for (const actor of [t.b, t.c])
      t.ok(actor, 'collectives.vote', {
        id: 'purchase',
        vote: 'yes',
        expectedRevision: t.r.state.collectives!.decisions.purchase!.revision,
      });
    t.ok(t.b, 'collectives.decide', {
      id: 'purchase',
      expectedRevision: t.r.state.collectives!.decisions.purchase!.revision,
    });
    const execute = {
      id: 'purchase',
      expectedRevision: t.r.state.collectives!.decisions.purchase!.revision,
    };
    t.ok(t.c, 'collectives.execute', execute);
    expect(t.resource().control!.controller).toEqual({ kind: 'collective', id: 'club' });
    expect(t.r.state.world.commonAccounts!.accounts.pool!.balance).toBe(15);
    expect(t.r.state.world.agents[t.b]!.balance).toBe(before.agents[t.b]!.balance);
    expect(t.r.state.world.agents[t.c]!.balance).toBe(before.agents[t.c]!.balance);
    expect(t.r.state.world.agents[t.a]!.balance).toBe(before.agents[t.a]!.balance + 25);
    expect(t.r.state.world.moneySupply).toBe(before.moneySupply);
    expect(t.call(t.c, 'collectives.execute', execute).ok).toBe(false);
    t.replay();
  },
);
test('explicit v2 preserves every existing resource, balance, body, manifest and original v1 price; no direct v2 seed bypass', () => {
  const t = openPermitsFixture(true, { principals: true });
  expect(t.r.enablePremisesPrincipals().ok).toBe(true);
  expect(t.r.enableVehiclePrincipals().ok).toBe(true);
  expect(t.r.enableResourceSales().ok).toBe(true);
  const b = t.building();
  t.ok(t.b, 'principals.control', {
    request: {
      resourceKind: 'premises',
      resourceId: 'home',
      resourceRevision: b.revision,
      controlVersion: b.control.version,
      command: {
        type: 'offer',
        target: { kind: 'resident', id: t.d },
        terms: '旧价格不被改写',
        expiresAt: t.r.state.world.clock.now + 1000000,
      },
    },
  });
  const source = worldResourceSaleSource(t.r.state.world, 'home')!;
  const command: ResourceSaleCommand = {
    type: 'offer',
    id: 'old',
    title: '旧报价',
    terms: '原意',
    resource: { kind: 'premises', id: 'home', expectedRevision: source.revision },
    payer: { sector: 'agent', id: t.d },
    revenue: { sector: 'agent', id: t.b },
    amount: 25,
    acceptBy: source.offer.expiresAt,
  };
  t.ok(t.b, 'principals.operate', {
    request: resourceSaleRequest(t.r.state.world.resourceSales!, command, source),
  });
  const before = structuredClone(t.r.state.world),
    bytes = readFileSync(join(t.root, 'manifest.json'));
  expect(t.r.enableResourceSalesV2().ok).toBe(true);
  expect(t.r.enableResourceSalesV2().ok).toBe(true);
  const { resourceSales, publicGovernance, ...rest } = t.r.state.world;
  const { resourceSales: oldPrices, publicGovernance: oldPublic, ...oldRest } = before;
  expect(rest).toEqual(oldRest);
  expect(resourceSales!.sales).toEqual(oldPrices!.sales);
  expect(publicGovernance!.authority.proposals).toEqual(oldPublic!.authority.proposals);
  expect(readFileSync(join(t.root, 'manifest.json'))).toEqual(bytes);
  t.ok(t.d, 'principals.operate', {
    request: resourceSaleRequest(
      resourceSales!,
      { type: 'accept', id: 'old', expectedRevision: 1 },
      source,
    ),
  });
  expect(t.building().control.controller).toEqual({ kind: 'resident', id: t.d });
  t.replay();
});
test.each(['stock', 'vehicle'] as const)(
  'real %s purchase changes only actual control and balanced cash, preserving author, location, ACL and body consent',
  (kind) => {
    const t = fixture(kind);
    t.handover({ kind: 'resident', id: t.d });
    const old = structuredClone(t.resource());
    const entry = t.ok(t.a, 'principals.read', { kind, id: old.id }).data;
    expect(entry).toHaveProperty('resourceSaleOfferSource');
    t.ok(t.a, 'principals.operate', { request: t.request(t.offer()) });
    expect(
      t.call(t.d, 'principals.control', { request: t.control({ type: 'accept' }) }).error,
    ).toBe('paid-resource-sale-acceptance-required');
    expect(t.call(t.c, 'principals.read', { kind: 'resource-sale', id: 'sale' }).ok).toBe(false);
    const accept = t.request({ type: 'accept', id: 'sale', expectedRevision: 1 }),
      before = structuredClone(t.r.state.world);
    expect(t.call(t.c, 'principals.operate', { request: accept }).ok).toBe(false);
    t.ok(t.d, 'principals.operate', { request: accept });
    expect(t.resource()).toMatchObject({
      ownerId: old.ownerId,
      locationId: old.locationId,
      control: { controller: { kind: 'resident', id: t.d } },
    });
    expect(t.r.state.world.moneySupply).toBe(before.moneySupply);
    for (const actor of [t.a, t.b, t.c, t.d]) {
      expect(t.r.state.world.agents[actor]!.inventory).toEqual(before.agents[actor]!.inventory);
      expect(t.r.state.world.agents[actor]!.physiology).toEqual(before.agents[actor]!.physiology);
      expect(t.r.state.world.agents[actor]!.locationId).toEqual(before.agents[actor]!.locationId);
    }
    expect(t.r.state.world.agents[t.d]!.balance).toBe(before.agents[t.d]!.balance - 25);
    expect(t.r.state.world.agents[t.a]!.balance).toBe(before.agents[t.a]!.balance + 25);
    if (kind === 'stock') {
      expect(t.r.state.world.materials!.stocks.actual!.inventory).toEqual({ Wood: 8 });
      expect(t.r.state.world.materials!.stocks.actual!.readers).toEqual([t.c]);
      expect(t.r.state.world.residentMobility).toEqual(before.residentMobility);
    } else {
      expect(t.r.state.world.materials).toEqual(before.materials);
      expect(authorizedDriver(t.r.state.world.residentMobility!.vehicles[old.id]!, t.d)).toBe(
        false,
      );
    }
    const event = t.r.journal.commits
      .flatMap((c) => c.worldEvents ?? [])
      .reverse()
      .find((e) => e.type === 'ResidentResourceSalesCommitted')!;
    if (event.type !== 'ResidentResourceSalesCommitted') throw Error('actual owning packet');
    expect(event.payload.policyVersion).toBe('resident-resource-sales-v2');
    expect(event.payload.transactions).toHaveLength(2);
    expect(() =>
      applyWorldEvent(before, {
        ...event,
        payload: { ...event.payload, policyVersion: 'resident-resource-sales-v1' },
      }),
    ).toThrow();
    expect(() =>
      applyWorldEvent(before, { ...event, payload: { ...event.payload, transactions: [] } }),
    ).toThrow();
    expect(t.call(t.d, 'principals.operate', { request: accept }).ok).toBe(false);
    t.replay();
  },
);
test.each(['stock', 'vehicle'] as const)(
  'old mode cannot quote %s; declined price remains bound and withdrawal cancels its original handover',
  (kind) => {
    const t = fixture(kind, false);
    t.handover({ kind: 'resident', id: t.d });
    expect(t.call(t.a, 'principals.operate', { request: t.request(t.offer()) }).error).toBe(
      'resource-sale-kind-not-enabled',
    );
    expect(t.ok(t.a, 'principals.read', { kind, id: t.resource().id }).data).not.toHaveProperty(
      'resourceSaleOfferSource',
    );
    expect(t.r.enableResourceSalesV2().ok).toBe(true);
    t.ok(t.a, 'principals.operate', { request: t.request(t.offer()) });
    t.ok(t.d, 'principals.operate', {
      request: t.request({ type: 'decline', id: 'sale', expectedRevision: 1 }),
    });
    expect(
      t.call(t.d, 'principals.control', { request: t.control({ type: 'accept' }) }).error,
    ).toBe('paid-resource-sale-acceptance-required');
    t.ok(t.a, 'principals.control', { request: t.control({ type: 'cancel' }) });
    t.handover({ kind: 'resident', id: t.d });
    t.ok(t.a, 'principals.operate', { request: t.request(t.offer('new')) });
    t.ok(t.a, 'principals.operate', {
      request: t.request({ type: 'withdraw', id: 'new', expectedRevision: 1 }),
    });
    expect(t.resource().control!.offer).toBeUndefined();
    expect(t.resource().control!.controller).toEqual({ kind: 'resident', id: t.a });
    t.replay();
  },
);
test('actual stock changes stale the price without consuming buyer funds or silently changing the agreed items', () => {
  const t = fixture('stock');
  t.handover({ kind: 'resident', id: t.d });
  t.ok(t.a, 'principals.operate', { request: t.request(t.offer()) });
  t.ok(t.c, 'stocks.deposit', {
    id: 'actual',
    expectedRevision: t.resource().revision,
    items: { Wood: 1 },
  });
  const before = structuredClone(t.r.state.world);
  expect(
    t.call(t.d, 'principals.operate', {
      request: t.request({ type: 'accept', id: 'sale', expectedRevision: 1 }),
    }).error,
  ).toBe('resource-sale-owning-source-changed');
  expect(t.r.state.world).toEqual(before);
  t.ok(t.a, 'principals.operate', {
    request: t.request({ type: 'withdraw', id: 'sale', expectedRevision: 1 }),
  });
  expect(t.resource().control!.offer).toBeUndefined();
  t.replay();
});
test('actual stock recipient capacity rejects the whole price packet without paying, transferring or deleting existing stocks', () => {
  const t = fixture('stock');
  const limit = t.r.state.world.materials!.policy.maxStocksPerController;
  for (let i = 0; i < limit; i++)
    t.ok(t.d, 'stocks.create', {
      id: `buyer-${i}`,
      title: '实际已占用保管名额',
      locationId: t.location,
    });
  t.handover({ kind: 'resident', id: t.d });
  t.ok(t.a, 'principals.operate', { request: t.request(t.offer()) });
  const before = structuredClone(t.r.state.world);
  expect(
    t.call(t.d, 'principals.operate', {
      request: t.request({ type: 'accept', id: 'sale', expectedRevision: 1 }),
    }).error,
  ).toBe('material-stock-limit');
  expect(t.r.state.world).toEqual(before);
  t.replay();
});
test('stock price preserves reserved material and loaded custody, including actual return to the same source after control changes', () => {
  const t = openFreightFixture(true, true, 1000000000, true);
  t.prepare(true);
  t.op(t.b, 'load');
  expect(t.r.enableResourcePrincipals().ok).toBe(true);
  expect(t.r.enablePremises().ok).toBe(true);
  expect(t.r.enablePremisesPrincipals().ok).toBe(true);
  expect(t.r.enableVehiclePrincipals().ok).toBe(true);
  expect(t.r.enableResourceSales().ok).toBe(true);
  expect(t.r.enableResourceSalesV2().ok).toBe(true);
  const p = priceHelpers(t, 'stock', 'src');
  p.handover({ kind: 'resident', id: t.d });
  t.ok(t.a, 'principals.operate', { request: p.request(p.offer()) });
  const source = t.r.state.world.resourceSales!.sales.sale!.source;
  if (source.kind !== 'stock') throw Error('stock source');
  expect(source.inventory).toEqual({ Wood: 4 });
  expect(source.encumbrances).toEqual(
    expect.arrayContaining([
      {
        kind: 'material-custody',
        id: 'parcel',
        revision: t.r.state.world.materials!.custodies!.records.parcel!.revision,
      },
      { kind: 'freight', id: 'parcel', revision: t.freight().revision },
    ]),
  );
  const before = structuredClone(t.r.state.world);
  t.ok(t.d, 'principals.operate', {
    request: p.request({ type: 'accept', id: 'sale', expectedRevision: 1 }),
  });
  expect(t.r.state.world.materials!.custodies).toEqual(before.materials!.custodies);
  expect(t.r.state.world.materials!.reservations).toEqual(before.materials!.reservations);
  expect(t.r.state.world.logistics).toEqual(before.logistics);
  expect(t.r.state.world.materials!.stocks.src!.inventory).toEqual({ Wood: 4 });
  t.op(t.a, 'cancel');
  t.op(t.b, 'return');
  expect(t.r.state.world.materials!.stocks.src!.inventory).toEqual({ Wood: 8 });
  expect(t.r.state.world.materials!.stocks.src!.control.controller).toEqual({
    kind: 'resident',
    id: t.d,
  });
  expect(t.freight()).toMatchObject({ status: 'returned', paid: 3, refunded: 5, escrow: 0 });
  t.replay();
});
test.each(['stock', 'vehicle'] as const)(
  'enterprise buys and resells actual %s with own v2 accounting, leaving manager cash, material and driver authority distinct',
  (kind) => {
    const t = fixture(kind);
    t.ok(t.b, 'world.found_enterprise', {
      enterpriseId: 'firm',
      name: '真实采购经营者',
      occupationName: '采购',
      initialCapital: 100,
      maxEmployees: 2,
    });
    t.handover({ kind: 'enterprise', id: 'firm' });
    t.ok(t.a, 'principals.operate', {
      request: t.request(t.offer('sale', { sector: 'enterprise', id: 'firm' })),
    });
    const before = structuredClone(t.r.state.world);
    t.ok(t.b, 'principals.operate', {
      request: t.request({ type: 'accept', id: 'sale', expectedRevision: 1 }),
    });
    expect(t.r.state.world.enterprises.firm!.balance).toBe(75);
    expect(t.r.state.world.enterprises.firm!.resourceSalesAccounting?.policyVersion).toBe(
      'enterprise-resource-sales-cash-accounting-v2',
    );
    expect(t.r.state.world.agents[t.b]!.balance).toBe(before.agents[t.b]!.balance);
    t.handover({ kind: 'resident', id: t.d }, t.b);
    t.ok(t.b, 'principals.operate', {
      request: t.request(
        t.offer('resale', { sector: 'agent', id: t.d }, { sector: 'enterprise', id: 'firm' }),
      ),
    });
    t.ok(t.d, 'principals.operate', {
      request: t.request({ type: 'accept', id: 'resale', expectedRevision: 1 }),
    });
    expect(t.r.state.world.enterprises.firm!.balance).toBe(100);
    expect(t.r.state.world.agents[t.b]!.balance).toBe(before.agents[t.b]!.balance);
    expect(t.r.state.world.moneySupply).toBe(before.moneySupply);
    t.replay();
  },
);
test('paid vehicle custody preserves actual loaded freight and its original fees; purchase cannot revoke the responsible driver or seize the entrusted goods', () => {
  const t = openFreightFixture(true, true, 1000000000, true);
  t.prepare(true);
  t.op(t.b, 'load');
  expect(t.r.enableResourcePrincipals().ok).toBe(true);
  expect(t.r.enablePremises().ok).toBe(true);
  expect(t.r.enablePremisesPrincipals().ok).toBe(true);
  expect(t.r.enableVehiclePrincipals().ok).toBe(true);
  expect(t.r.enableResourceSales().ok).toBe(true);
  expect(t.r.enableResourceSalesV2().ok).toBe(true);
  const p = priceHelpers(t, 'vehicle', 'seed-car-1');
  p.handover({ kind: 'resident', id: t.d });
  t.ok(t.a, 'principals.operate', { request: p.request(p.offer()) });
  const before = structuredClone(t.r.state.world);
  t.ok(t.d, 'principals.operate', {
    request: p.request({ type: 'accept', id: 'sale', expectedRevision: 1 }),
  });
  expect(t.r.state.world.materials).toEqual(before.materials);
  expect(t.r.state.world.logistics).toEqual(before.logistics);
  const v = t.r.state.world.residentMobility!.vehicles['seed-car-1']!;
  expect(
    t.call(t.d, 'principals.operate', {
      request: vehiclePrincipalRequest(v, {
        type: 'vehicles.revoke',
        id: v.id,
        expectedRevision: v.revision,
        residentId: t.b,
      }),
    }).error,
  ).toBe('vehicle-actual-cargo-custody');
  expect(t.r.state.world.agents[t.d]!.inventory).toEqual(before.agents[t.d]!.inventory);
  t.op(t.a, 'cancel');
  t.op(t.b, 'return');
  expect(t.freight()).toMatchObject({ status: 'returned', paid: 3, refunded: 5, escrow: 0 });
  t.replay();
});
