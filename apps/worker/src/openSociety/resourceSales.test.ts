import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  RESOURCE_SALES_POLICY,
  resourceSaleRequest,
  type ResourceSaleCommand,
} from '@aivilization/commerce';
import type { ResourcePrincipal, PrincipalOperationRequest } from '@aivilization/authority';
import { worldResourceSaleSource, applyWorldEvent } from '@aivilization/world';
import { openPermitsFixture } from './testFixtures/openPermits';
function fixture(enabled = true, wear: { wearIntervalMs?: number; wearPerInterval?: number } = {}) {
  const t = openPermitsFixture(true, { principals: true, paidPermits: true, ...wear });
  expect(t.r.enablePremisesPrincipals().ok).toBe(true);
  if (enabled) expect(t.r.enableResourceSales().ok).toBe(true);
  const control = (command: Record<string, unknown>) => ({
    resourceKind: 'premises',
    resourceId: 'home',
    resourceRevision: t.building().revision,
    controlVersion: t.building().control.version,
    command,
  });
  const handover = (target: ResourcePrincipal) =>
    t.ok(t.b, 'principals.control', {
      request: control({
        type: 'offer',
        target,
        terms: '这份真实建筑交接',
        expiresAt: t.r.state.world.clock.now + 1000000,
      }),
    });
  const offer = (
    payer: Extract<ResourceSaleCommand, { type: 'offer' }>['payer'] = { sector: 'agent', id: t.c },
    revenue: Extract<ResourceSaleCommand, { type: 'offer' }>['revenue'] = {
      sector: 'agent',
      id: t.b,
    },
  ): ResourceSaleCommand => ({
    type: 'offer',
    id: 'sale',
    title: '真实房屋报价',
    terms: '住行与劳动仍本人决定',
    resource: { kind: 'premises', id: 'home', expectedRevision: t.building().revision },
    payer,
    revenue,
    amount: 25,
    acceptBy: t.building().control.offer!.expiresAt,
  });
  const request = (c: ResourceSaleCommand) =>
    resourceSaleRequest(
      t.r.state.world.resourceSales!,
      c,
      worldResourceSaleSource(t.r.state.world, 'home'),
    );
  const approvePublic = (r: PrincipalOperationRequest) => {
    const id = 'purchase';
    t.ok(t.a, 'governance.propose', {
      id,
      text: '只购买这份确切房屋，不授权强制入住',
      action: { kind: 'manage-resource', expectedRevision: r.resourceRevision, request: r },
      closesAt: t.r.state.world.clock.now + 60000,
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
  };
  return { ...t, permitOffer: t.offer, control, handover, offer, request, approvePublic };
}
test('explicit activation preserves actual old world, bodies, ownership, cash and original manifest; old mode does not acquire fiscal scope', () => {
  const t = fixture(false),
    before = structuredClone(t.r.state.world),
    bytes = readFileSync(join(t.root, 'manifest.json'));
  expect(before.resourceSales).toBeUndefined();
  expect(before.publicGovernance!.authority.grant.resourceSales).toBeUndefined();
  expect(t.r.enableResourceSales().ok).toBe(true);
  expect(t.r.enableResourceSales().ok).toBe(true);
  const { resourceSales, publicGovernance, ...rest } = t.r.state.world,
    { publicGovernance: oldGovernance, ...oldRest } = before;
  expect(rest).toEqual(oldRest);
  expect(resourceSales?.sales).toEqual({});
  const { resourceSales: grant, ...oldGrant } = publicGovernance!.authority.grant;
  expect(oldGrant).toEqual(oldGovernance!.authority.grant);
  expect(grant?.version).toBe('public-paid-resource-control-v1');
  expect(readFileSync(join(t.root, 'manifest.json'))).toEqual(bytes);
  t.replay();
});
test('actual independently accepted resident purchase conserves cash/material/time and preserves author/old permission; quote cannot bypass via free control', () => {
  const t = fixture();
  t.ok(t.b, 'permits.offer', t.permitOffer('old', { users: [t.d], granteeId: t.d }));
  t.ok(t.d, 'permits.accept', { id: 'old', expectedRevision: 1 });
  t.handover({ kind: 'resident', id: t.c });
  const before = structuredClone(t.r.state.world),
    building = structuredClone(t.building());
  t.ok(t.b, 'principals.operate', { request: t.request(t.offer()) });
  expect(t.call(t.c, 'principals.control', { request: t.control({ type: 'accept' }) }).error).toBe(
    'paid-resource-sale-acceptance-required',
  );
  expect(t.call(t.a, 'principals.read', { kind: 'resource-sale', id: 'sale' }).ok).toBe(false);
  t.ok(t.c, 'principals.read', { kind: 'resource-sale', id: 'sale' });
  const prior = structuredClone(t.r.state.world),
    q = t.request({ type: 'accept', id: 'sale', expectedRevision: 1 });
  expect(t.call(t.d, 'principals.operate', { request: q }).ok).toBe(false);
  t.ok(t.c, 'principals.operate', { request: q });
  const after = t.r.state.world;
  expect(after.agents[t.c]!.balance).toBe(before.agents[t.c]!.balance - 25);
  expect(after.agents[t.b]!.balance).toBe(before.agents[t.b]!.balance + 25);
  expect(after.moneySupply).toBe(before.moneySupply);
  expect(after.materials).toEqual(before.materials);
  expect(after.premisesRights).toEqual(before.premisesRights);
  expect(t.building()).toMatchObject({
    ownerId: building.ownerId,
    locationId: building.locationId,
    condition: building.condition,
    blueprint: building.blueprint,
    embodied: building.embodied,
    access: building.access,
    control: { controller: { kind: 'resident', id: t.c } },
  });
  for (const actor of [t.a, t.b, t.c, t.d])
    expect(after.agents[actor]!.locationId).toBe(before.agents[actor]!.locationId);
  const event = [...t.r.journal.commits]
    .reverse()
    .flatMap((c) => c.worldEvents ?? [])
    .find((e) => e.type === 'ResidentResourceSalesCommitted' && e.payload.controlChange);
  if (event?.type !== 'ResidentResourceSalesCommitted') throw Error('actual paid packet required');
  expect(event.payload.transactions).toHaveLength(2);
  expect(() =>
    applyWorldEvent(prior, {
      ...event,
      type: 'ResidentResourcePrincipalControlCommitted',
      payload: { actorId: t.c, change: event.payload.controlChange! },
    }),
  ).toThrow('paid-resource-sale-acceptance-required');
  expect(() =>
    applyWorldEvent(prior, { ...event, payload: { ...event.payload, transactions: [] } }),
  ).toThrow();
  const { controlChange: omittedControl, ...missingControl } = event.payload;
  expect(omittedControl).toBeDefined();
  expect(() => applyWorldEvent(prior, { ...event, payload: missingControl })).toThrow();
  expect(() =>
    applyWorldEvent(prior, {
      ...event,
      payload: {
        ...event.payload,
        event: {
          ...event.payload.event,
          type: 'ResourceSalesEnabled',
          policy: { ...RESOURCE_SALES_POLICY },
        },
      },
    }),
  ).toThrow();
  expect(t.call(t.c, 'principals.operate', { request: q }).ok).toBe(false);
  t.replay();
});
test('buying for public ownership needs actual fiscal-plus-control decision, pays builder not executor, consumes approval once and moves nobody', () => {
  const t = fixture(),
    grant = t.r.state.world.publicGovernance!.authority.grant;
  t.handover({ kind: 'public', id: grant.id });
  t.ok(t.b, 'principals.operate', {
    request: t.request(t.offer({ sector: 'treasury', id: 'public-treasury' })),
  });
  const q = t.request({ type: 'accept', id: 'sale', expectedRevision: 1 });
  expect(t.call(t.d, 'principals.operate', { request: q }).ok).toBe(false);
  const action = t.approvePublic(q),
    before = structuredClone(t.r.state.world);
  t.ok(t.d, 'governance.execute', action);
  expect(t.building().control.controller).toEqual({ kind: 'public', id: grant.id });
  expect(t.r.state.world.treasury).toBe(before.treasury! - 25);
  expect(t.r.state.world.agents[t.b]!.balance).toBe(before.agents[t.b]!.balance + 25);
  expect(t.r.state.world.agents[t.d]!.balance).toBe(before.agents[t.d]!.balance);
  expect(t.r.state.world.publicGovernance!.authority.proposals.purchase!.status).toBe('executed');
  expect(t.r.state.world.moneySupply).toBe(before.moneySupply);
  expect(t.call(t.d, 'governance.execute', action).ok).toBe(false);
  t.replay();
});
test('decline preserves price binding; owner withdraw cancels same handover atomically; source drift/funds/injected body never half-settle', () => {
  const t = fixture();
  t.handover({ kind: 'resident', id: t.c });
  t.ok(t.b, 'principals.operate', { request: t.request(t.offer()) });
  t.ok(t.c, 'principals.operate', {
    request: t.request({ type: 'decline', id: 'sale', expectedRevision: 1 }),
  });
  expect(t.call(t.c, 'principals.control', { request: t.control({ type: 'accept' }) }).error).toBe(
    'paid-resource-sale-acceptance-required',
  );
  t.ok(t.b, 'principals.control', { request: t.control({ type: 'cancel' }) });
  t.replay();
  const u = fixture();
  u.handover({ kind: 'resident', id: u.c });
  u.ok(u.b, 'principals.operate', { request: u.request(u.offer()) });
  const before = structuredClone(u.r.state.world);
  u.ok(u.b, 'principals.operate', {
    request: u.request({ type: 'withdraw', id: 'sale', expectedRevision: 1 }),
  });
  expect(u.building().control.offer).toBeUndefined();
  expect(u.building().control.controller).toEqual({ kind: 'resident', id: u.b });
  expect(u.r.state.world.agents).toEqual(before.agents);
  expect(u.r.state.world.resourceSales!.sales.sale!.status).toBe('withdrawn');
  u.replay();
});

test('a real collective purchase charges the common account, changes collective control, and consumes exactly one whole-price vote', () => {
  const t = fixture(),
    at = t.r.state.world.clock.now;
  t.ok(t.b, 'collectives.create', {
    id: 'club',
    configuration: {
      title: '真实共同住房',
      terms: '自主协作',
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
  t.ok(t.a, 'funds.contribute', {
    id: 'pool',
    expectedRevision: 1,
    amount: 40,
    note: '不制造股权或选票',
  });
  t.handover({ kind: 'collective', id: 'club' });
  t.ok(t.b, 'principals.operate', {
    request: t.request(t.offer({ sector: 'collective', id: 'pool' })),
  });
  const request = t.request({ type: 'accept', id: 'sale', expectedRevision: 1 }),
    before = structuredClone(t.r.state.world);
  expect(t.call(t.c, 'principals.operate', { request }).ok).toBe(false);
  t.ok(t.b, 'collectives.propose', {
    id: 'pay',
    collectiveId: 'club',
    expectedVersion: 1,
    terms: '仅此房屋25现金',
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
      id: 'pay',
      expectedRevision: t.r.state.collectives!.decisions.pay!.revision,
      vote: 'yes',
    });
  t.ok(t.b, 'collectives.decide', {
    id: 'pay',
    expectedRevision: t.r.state.collectives!.decisions.pay!.revision,
  });
  t.ok(t.c, 'collectives.execute', {
    id: 'pay',
    expectedRevision: t.r.state.collectives!.decisions.pay!.revision,
  });
  expect(t.r.state.world.commonAccounts!.accounts.pool!.balance).toBe(15);
  expect(t.r.state.world.agents[t.b]!.balance).toBe(before.agents[t.b]!.balance + 25);
  expect(t.r.state.world.agents[t.c]!.balance).toBe(before.agents[t.c]!.balance);
  expect(t.building().control.controller).toEqual({ kind: 'collective', id: 'club' });
  expect(t.r.state.collectives!.decisions.pay!.status).toBe('executed');
  expect(t.r.state.world.moneySupply).toBe(before.moneySupply);
  expect(
    t.call(t.c, 'collectives.execute', {
      id: 'pay',
      expectedRevision: t.r.state.collectives!.decisions.pay!.revision,
    }).ok,
  ).toBe(false);
  t.replay();
});
test('enterprise asset purchase and sale use own accounting events without debiting manager, inventing another building, or reopening old approval', () => {
  const t = fixture();
  t.ok(t.b, 'world.found_enterprise', {
    enterpriseId: 'firm',
    name: '真正经营者',
    occupationName: '建造',
    initialCapital: 100,
    maxEmployees: 3,
  });
  t.handover({ kind: 'enterprise', id: 'firm' });
  t.ok(t.b, 'principals.operate', {
    request: t.request(t.offer({ sector: 'enterprise', id: 'firm' })),
  });
  const before = structuredClone(t.r.state.world);
  t.ok(t.b, 'principals.operate', {
    request: t.request({ type: 'accept', id: 'sale', expectedRevision: 1 }),
  });
  expect(t.r.state.world.enterprises.firm!.balance).toBe(75);
  expect(t.r.state.world.agents[t.b]!.balance).toBe(before.agents[t.b]!.balance + 25);
  expect(t.r.state.world.enterprises.firm!.resourceSalesAccounting!.receipts.sale!.side).toBe(
    'payer',
  );
  expect(t.building().control.controller).toEqual({ kind: 'enterprise', id: 'firm' });
  t.handover({ kind: 'resident', id: t.c });
  const sell = {
    ...t.offer({ sector: 'agent', id: t.c }, { sector: 'enterprise', id: 'firm' }),
    id: 'resale',
  };
  t.ok(t.b, 'principals.operate', { request: t.request(sell) });
  const managerBefore = t.r.state.world.agents[t.b]!.balance;
  t.ok(t.c, 'principals.operate', {
    request: t.request({ type: 'accept', id: 'resale', expectedRevision: 1 }),
  });
  expect(t.r.state.world.enterprises.firm!.balance).toBe(100);
  expect(t.r.state.world.agents[t.b]!.balance).toBe(managerBefore);
  expect(t.r.state.world.enterprises.firm!.cumulativePurchases).toBe(25);
  expect(t.r.state.world.enterprises.firm!.cumulativeSales).toBe(25);
  expect(t.r.state.world.enterprises.firm!.resourceSalesAccounting!.receipts.resale!.side).toBe(
    'revenue',
  );
  expect(Object.keys(t.r.state.world.premises!.buildings)).toEqual(['home']);
  expect(t.r.state.world.moneySupply).toBe(before.moneySupply);
  t.replay();
});
test('insufficient actual cash and changed physical source reject the entire purchase; expiry preserves cash and prevents free expired handover', () => {
  const t = fixture();
  t.handover({ kind: 'resident', id: t.c });
  t.ok(t.b, 'principals.operate', { request: t.request(t.offer()) });
  t.ok(t.c, 'payments.transfer', {
    targetId: t.d,
    amount: t.r.state.world.agents[t.c]!.balance,
    note: '本人另行支出',
  });
  const before = structuredClone(t.r.state.world),
    q = t.request({ type: 'accept', id: 'sale', expectedRevision: 1 });
  expect(t.call(t.c, 'principals.operate', { request: q }).error).toBe(
    'insufficient-resource-sale-funds',
  );
  expect(t.r.state.world).toEqual(before);
  t.ok(t.d, 'payments.transfer', { targetId: t.c, amount: 25, note: '本人赠与' });
  t.time(1000000);
  expect(t.r.state.world.resourceSales!.sales.sale!.status).toBe('expired');
  expect(t.call(t.c, 'principals.control', { request: t.control({ type: 'accept' }) }).ok).toBe(
    false,
  );
  expect(t.building().control.controller).toEqual({ kind: 'resident', id: t.b });
  t.replay();
});
test('actual physical wear makes the agreed source stale without stealing money or bypassing the price through a free acceptance', () => {
  const t = fixture(true, { wearIntervalMs: 100000, wearPerInterval: 250 });
  t.handover({ kind: 'resident', id: t.c });
  t.ok(t.b, 'principals.operate', { request: t.request(t.offer()) });
  t.time(100000);
  const before = structuredClone(t.r.state.world);
  expect(
    t.call(t.c, 'principals.operate', {
      request: t.request({ type: 'accept', id: 'sale', expectedRevision: 1 }),
    }).error,
  ).toBe('resource-sale-owning-source-changed');
  expect(t.r.state.world).toEqual(before);
  expect(t.call(t.c, 'principals.control', { request: t.control({ type: 'accept' }) }).error).toBe(
    'paid-resource-sale-acceptance-required',
  );
  t.ok(t.b, 'principals.operate', {
    request: t.request({ type: 'withdraw', id: 'sale', expectedRevision: 1 }),
  });
  expect(t.building().control.offer).toBeUndefined();
  expect(t.building().condition).toBe(before.premises!.buildings.home!.condition);
  t.replay();
});

test('independent adapter migration preserves a pending legacy sale and public grant, then settles the same offer', () => {
  const t = fixture();
  t.handover({ kind: 'resident', id: t.c });
  t.ok(t.b, 'principals.operate', { request: t.request(t.offer()) });
  const before = structuredClone(t.r.state.world);
  expect(t.r.enableResourceAdapters(['premises']).ok).toBe(true);
  expect(t.r.state.world.resourceAdapters?.kinds).toEqual(['premises', 'stock']);
  expect(t.r.state.world.resourceSales!.sales).toEqual(before.resourceSales!.sales);
  expect(t.r.state.world.publicGovernance).toEqual(before.publicGovernance);
  expect(t.r.state.world.agents).toEqual(before.agents);
  expect(t.r.state.world.premises).toEqual(before.premises);
  t.ok(t.c, 'principals.operate', {
    request: t.request({ type: 'accept', id: 'sale', expectedRevision: 1 }),
  });
  expect(t.building().control.controller).toEqual({ kind: 'resident', id: t.c });
  expect(t.r.state.world.agents[t.b]!.balance).toBe(before.agents[t.b]!.balance + 25);
  expect(t.r.state.world.moneySupply).toBe(before.moneySupply);
  expect(t.r.state.world.publicGovernance).toEqual(before.publicGovernance);
  t.replay();
});
