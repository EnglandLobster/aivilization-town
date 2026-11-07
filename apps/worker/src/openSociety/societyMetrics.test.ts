import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { createOpenSocietyManifest, serializableWorldPolicy } from './manifest';
import { OpenSocietyRuntime } from './runtime';
import { createSocietyMetrics } from './societyMetrics';
import type { OpenSocietyCommit } from './types';

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const f of cleanup.reverse()) f();
  cleanup.length = 0;
});

test('measures wake reasons and sustained resident ties from committed messages only', () => {
  const root = mkdtempSync(join(tmpdir(), 'society-metrics-'));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const manifest = createOpenSocietyManifest({ count: 3, continuity: true });
  const runtime = new OpenSocietyRuntime(root, manifest);
  cleanup.push(() => runtime.close());
  const [a, b] = manifest.residents.map((r) => r.id) as [string, string];
  let n = 0;
  const say = (from: string, to: string) => {
    runtime.beginTurn(from);
    const result = runtime.invoke(from, {
      name: 'messages.send',
      arguments: { recipientId: to, content: 'hello' },
      requestId: `metrics-${++n}`,
    });
    expect(result.ok, result.error).toBe(true);
    runtime.finishTurn(from, { summary: 'sent' });
  };
  say(a, b);
  expect(runtime.advanceTime(86_400_000, 'metrics-day-1').ok).toBe(true);
  say(b, a);
  say(a, b);

  const metrics = createSocietyMetrics(manifest);
  for (const commit of runtime.journal.commits) metrics.add(commit);
  const result = metrics.result();

  expect(result.attention.opportunities).toBe(3);
  expect(result.attention.wakeReasons['free-activity']).toBeGreaterThan(0);
  expect(result.social).toMatchObject({
    pairsInteracting: 1,
    reciprocalPairs: 1,
    sustainedPairs: 1,
    channels: { directMessage: 3 },
    materialTiesPairs: 0,
  });
  expect(result.economy.interdependence).toBe(0);
});

test('separates platform income from resident-to-resident income and credits joint work', () => {
  const manifest = createOpenSocietyManifest({ count: 3, continuity: true });
  const [a, b, c] = manifest.residents.map((r) => r.id) as [string, string, string];
  const commit = (worldEvents: readonly unknown[]) =>
    ({
      actorId: 'system',
      capability: 'system.advance-time',
      at: 1000,
      result: { ok: true },
      worldEvents,
    }) as unknown as OpenSocietyCommit;
  const metrics = createSocietyMetrics(manifest);
  metrics.add(
    commit([
      { type: 'SubsidyPaid', payload: { agentId: a, amount: 60, reason: 'safety-net' } },
      {
        type: 'TradeExecuted',
        payload: { agentId: a, side: 'sell', currencyQuantity: 20 },
      },
      {
        type: 'ResidentCommerceCommitted',
        payload: {
          transactions: [
            {
              transactionId: 'payment-1',
              reason: 'resident-payment',
              entries: [
                { account: { accountId: `agent:${b}`, sector: 'agent' }, amount: -20 },
                { account: { accountId: `agent:${a}`, sector: 'agent' }, amount: 20 },
              ],
            },
          ],
        },
      },
      {
        type: 'ResidentMaterialsCommitted',
        payload: {
          events: [
            {
              type: 'MaterialProductionChanged',
              production: {
                id: 'batch',
                status: 'completed',
                productName: '我们的面包',
                recipe: { outputs: { Bread: 1 } },
                completed: 4,
                workers: [b, c],
              },
            },
          ],
        },
      },
    ]),
  );
  const result = metrics.result();
  expect(result.economy.inflow).toEqual({ fromResidents: 20, marketSales: 20, subsidy: 60 });
  expect(result.economy.interdependence).toBe(0.2);
  expect(result.production).toMatchObject({ completedBatches: 1, jointBatches: 1 });
  expect(result.production.byResident[0]).toMatchObject({ products: 1, topShare: 1 });
  expect(result.social.channels).toEqual({ payment: 1, jointProduction: 1 });
  expect(result.social.materialTiesPairs).toBe(2);
});

test('escrowed orders and stock handovers count as material ties between the named residents', () => {
  const manifest = createOpenSocietyManifest({ count: 3, continuity: true });
  const [a, b, c] = manifest.residents.map((r) => r.id) as [string, string, string];
  const metrics = createSocietyMetrics(manifest);
  const order = { id: 'o1', buyerId: a, sellerId: b, status: 'paid' };
  metrics.add({
    actorId: a,
    capability: 'orders.create',
    at: 1000,
    result: { ok: true },
    worldEvents: [
      { type: 'ResidentCommerceCommitted', payload: { events: [{ type: 'OrderChanged', order }] } },
      {
        type: 'ResidentCommerceCommitted',
        payload: {
          events: [{ type: 'OrderChanged', order: { ...order, status: 'completed' } }],
        },
      },
      {
        type: 'ResidentMaterialsCommitted',
        payload: {
          events: [
            {
              type: 'MaterialReceiptRecorded',
              receipt: {
                actorId: c,
                transfers: [{ from: { kind: 'stock', id: 's' }, to: { kind: 'resident', id: a } }],
              },
            },
          ],
        },
      },
    ],
  } as unknown as OpenSocietyCommit);
  const result = metrics.result();
  expect(result.commerce).toEqual({ ordersCreated: 1, ordersCompleted: 1 });
  expect(result.social.channels).toEqual({ order: 1, goodsHandover: 1 });
  expect(result.social.materialTiesPairs).toBe(2);
});

test('money is traced through escrow and reconciles with every balance', () => {
  const root = mkdtempSync(join(tmpdir(), 'society-metrics-money-'));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const base = createOpenSocietyManifest({ count: 3, life: true });
  const commodity = Object.values(base.initialWorld.marketPools)[0]!.commodity;
  const initialWorld = {
    ...base.initialWorld,
    agents: Object.fromEntries(
      Object.entries(base.initialWorld.agents).map(([id, agent]) => [
        id,
        { ...agent, inventory: { [commodity]: 2 } },
      ]),
    ),
  };
  const manifest = {
    ...base,
    initialWorld,
    worldPolicies: serializableWorldPolicy(base.seed, initialWorld),
  };
  const runtime = new OpenSocietyRuntime(root, manifest);
  cleanup.push(() => runtime.close());
  const [a, b, c] = manifest.residents.map((r) => r.id) as [string, string, string];
  const start = Object.fromEntries(
    [a, b, c].map((id) => [id, runtime.state.world.agents[id]!.balance]),
  );
  let n = 0;
  const ok = (actor: string, name: string, args: Record<string, unknown>) => {
    runtime.beginTurn(actor);
    const result = runtime.invoke(actor, { name, arguments: args, requestId: `m-${++n}` });
    runtime.finishTurn(actor, { summary: 'test' });
    expect(result.ok, `${name}: ${result.error}`).toBe(true);
  };
  // An escrowed service order: b pays 10, a delivers, b confirms.
  ok(a, 'offers.publish', {
    id: 'offer',
    kind: 'service',
    commodity: 'service',
    description: '帮忙记录',
    unitPrice: 10,
    maxQuantity: 2,
  });
  ok(b, 'orders.create', { id: 'order', offerId: 'offer', offerRevision: 1, quantity: 1 });
  ok(a, 'orders.accept', { id: 'order', expectedRevision: 1 });
  ok(b, 'orders.pay', { id: 'order', expectedRevision: 2 });
  ok(a, 'orders.deliver', { id: 'order', expectedRevision: 3, content: '已提供' });
  ok(b, 'orders.confirm', { id: 'order', expectedRevision: 4 });
  // A direct payment request: c pays a 2.
  ok(a, 'payments.request', { id: 'split', payers: [c], amountEach: 2, description: '均摊' });
  ok(c, 'payments.pay', { id: 'split', expectedRevision: 1 });
  // A goods order paid and then cancelled: c's money comes back.
  ok(a, 'offers.publish', {
    id: 'goods',
    kind: 'goods',
    commodity,
    description: '商品',
    unitPrice: 3,
    maxQuantity: 2,
  });
  ok(c, 'orders.create', { id: 'refunded', offerId: 'goods', offerRevision: 1, quantity: 2 });
  ok(a, 'orders.accept', { id: 'refunded', expectedRevision: 1 });
  ok(c, 'orders.pay', { id: 'refunded', expectedRevision: 2 });
  ok(c, 'orders.cancel', { id: 'refunded', expectedRevision: 3 });
  // A refused step is recorded in the funnel with its reason.
  runtime.beginTurn(c);
  const refused = runtime.invoke(c, {
    name: 'orders.pay',
    arguments: { id: 'refunded', expectedRevision: 4 },
    requestId: `m-${++n}`,
  });
  runtime.finishTurn(c, { summary: 'test' });
  expect(refused.ok).toBe(false);

  const metrics = createSocietyMetrics(manifest);
  for (const commit of runtime.journal.commits) metrics.add(commit);
  const result = metrics.result();
  const { byResident } = result.economy as unknown as {
    byResident: Record<string, { inflow: Record<string, number>; outflow: Record<string, number> }>;
  };
  // The seller's income came from the buyers, through escrow or directly.
  expect(byResident[a]!.inflow.fromResidents).toBe(12);
  // The cancelled order's money is the buyer's own, returned, not income from anyone.
  expect(byResident[c]!.inflow).toEqual({ returned: 6 });
  expect(byResident[c]!.inflow.fromResidents).toBeUndefined();
  const pair = (x: string, y: string) =>
    result.social.pairs.find((p) => p.pair.join() === [x, y].sort().join());
  expect(pair(a, b)?.channels.payment).toBe(1);
  expect(pair(a, c)?.channels.payment).toBe(1);
  expect(result.economy.interdependence).toBe(1);
  // Books balance: attributed inflow minus outflow is each resident's actual balance change.
  const sum = (bag: Record<string, number>) => Object.values(bag).reduce((x, y) => x + y, 0);
  for (const id of [a, b, c])
    expect(sum(byResident[id]!.inflow) - sum(byResident[id]!.outflow)).toBeCloseTo(
      runtime.state.world.agents[id]!.balance - start[id]!,
      6,
    );
  expect(result.coverage.unattributedMoney).toEqual({});
  const trade = result.funnels.residentTrade!;
  expect(trade['offers.publish']).toEqual({ attempts: 2, succeeded: 2, refusals: {} });
  expect(trade['orders.pay']).toMatchObject({ attempts: 3, succeeded: 2 });
  expect(Object.values(trade['orders.pay']!.refusals)).toEqual([1]);
  expect(trade['payments.transfer']).toEqual({ attempts: 0, succeeded: 0, refusals: {} });
  expect(result.funnels.hiring!['world.found_enterprise']!.attempts).toBe(0);
  expect(metrics.result()).toEqual(result);
});
