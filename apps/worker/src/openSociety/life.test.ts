import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { asLocationId } from '@aivilization/sim-core';
import { commerceEscrowBalance } from '@aivilization/commerce';
import { OpenSocietyRuntime } from './runtime';
import { createOpenSocietyManifest, serializableWorldPolicy } from './manifest';
const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanup.reverse()) fn();
  cleanup.length = 0;
});
function setup(options: { legacy?: boolean; home?: boolean; goods?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'life-suite-'));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  let m = createOpenSocietyManifest({ count: 3, life: !options.legacy });
  if (options.home || options.goods) {
    const initialWorld = {
      ...m.initialWorld,
      agents: Object.fromEntries(
        Object.entries(m.initialWorld.agents).map(([id, a]) => [
          id,
          {
            ...a,
            ...(options.home ? { locationId: asLocationId('residential-block') } : {}),
            ...(options.goods
              ? { inventory: { [Object.values(m.initialWorld.marketPools)[0]!.commodity]: 2 } }
              : {}),
          },
        ]),
      ),
    };
    m = { ...m, initialWorld, worldPolicies: serializableWorldPolicy(m.seed, initialWorld) };
  }
  const runtime = new OpenSocietyRuntime(root, m);
  cleanup.push(() => runtime.close());
  let n = 0;
  const [a, b, c] = m.residents.map((r) => r.id) as [string, string, string];
  const call = (
    actorId: string,
    name: string,
    args: Record<string, unknown>,
    key = `call-${++n}`,
  ) => {
    runtime.beginTurn(actorId);
    const r = runtime.invoke(actorId, { name, arguments: args, requestId: key });
    runtime.finishTurn(actorId, { summary: 'test' });
    return r;
  };
  const ok = (actor: string, name: string, args: Record<string, unknown>) => {
    const r = call(actor, name, args);
    expect(r.ok, `${name}: ${r.error}`).toBe(true);
    return r.data;
  };
  return { root, runtime, a, b, c, call, ok };
}
test('independent group consent, proposals, block enforcement, bounded perception and replay', () => {
  const f = setup(),
    { runtime: r, a, b, c, ok, call } = f;
  ok(a, 'groups.create', { id: 'g', title: '原文群' });
  const invite = ok(a, 'groups.invite', { groupId: 'g', residentId: b }) as { id: string };
  expect(call(a, 'groups.accept', { id: invite.id, expectedRevision: 1 }).ok).toBe(false);
  ok(b, 'groups.accept', { id: invite.id, expectedRevision: 1 });
  ok(b, 'groups.send', { groupId: 'g', content: '原始消息' });
  expect(call(c, 'groups.messages', { groupId: 'g' }).ok).toBe(false);
  ok(b, 'blocks.add', { targetId: a });
  expect(call(a, 'messages.send', { recipientId: b, content: 'blocked' })).toMatchObject({
    ok: false,
    error: 'communication-blocked',
  });
  ok(b, 'blocks.remove', { targetId: a });
  ok(a, 'proposals.create', {
    id: 'p',
    participants: [b, c],
    terms: '一起做事\n原文',
    expiresAt: 10000,
  });
  ok(b, 'proposals.respond', { id: 'p', expectedRevision: 1, accept: true });
  ok(c, 'proposals.respond', { id: 'p', expectedRevision: 2, accept: true });
  ok(b, 'commitments.declare', { id: 'p', kind: 'disputed', content: '我认为还未完成' });
  expect(call('resident-003', 'groups.members', { groupId: 'g' }).ok).toBe(false);
  expect(r.context(a).lifeInbox?.items.length).toBeLessThanOrEqual(6);
  const before = structuredClone(r.state);
  r.close();
  const replay = new OpenSocietyRuntime(f.root);
  cleanup.push(() => replay.close());
  expect(replay.state).toEqual(before);
});
test('real world accounts, escrow, inventory reservation and replay are atomic', () => {
  const { runtime: r, a, b, c, ok, call } = setup();
  const supply = r.state.world.moneySupply;
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
  const balanceA = r.state.world.agents[a]!.balance,
    balanceB = r.state.world.agents[b]!.balance;
  ok(b, 'orders.pay', { id: 'order', expectedRevision: 2 });
  expect(r.state.world.agents[b]!.balance).toBe(balanceB - 10);
  expect(commerceEscrowBalance(r.state.world.residentCommerce!)).toBe(10);
  expect(r.state.world.moneySupply).toBe(supply);
  expect(call(c, 'orders.read', { id: 'order' }).ok).toBe(false);
  const revision = r.state.world.residentCommerce?.orders.order?.revision;
  expect(call(a, 'orders.confirm', { id: 'order', expectedRevision: 3 }).ok).toBe(false);
  expect(r.state.world.residentCommerce?.orders.order?.revision).toBe(revision);
  ok(a, 'orders.deliver', {
    id: 'order',
    expectedRevision: 3,
    content: '已经提供记录服务（我的陈述）',
  });
  ok(b, 'orders.confirm', { id: 'order', expectedRevision: 4 });
  expect(r.state.world.agents[a]!.balance).toBe(balanceA + 10);
  expect(commerceEscrowBalance(r.state.world.residentCommerce!)).toBe(0);
  ok(a, 'payments.request', { id: 'split', payers: [b, c], amountEach: 2, description: '均摊' });
  ok(b, 'payments.pay', { id: 'split', expectedRevision: 1 });
  expect(r.state.world.residentCommerce?.requests.split?.paidBy).toEqual([b]);
  ok(b, 'deposits.lock', { id: 'deposit', beneficiaryId: a, amount: 3, purpose: '返还测试' });
  ok(a, 'deposits.release', { id: 'deposit', expectedRevision: 1 });
  expect(r.state.world.moneySupply).toBe(supply);
});
test('goods reservation is authoritative across orders and cancellation restores stock and cash', () => {
  const { runtime: r, a, b, c, ok, call } = setup({ goods: true });
  const commodity = Object.values(r.state.world.marketPools)[0]!.commodity;
  const before = Object.fromEntries(
    [a, b, c].map((id) => [
      id,
      {
        balance: r.state.world.agents[id]!.balance,
        stock: r.state.world.agents[id]!.inventory[commodity],
      },
    ]),
  );
  ok(a, 'offers.publish', {
    id: 'goods',
    kind: 'goods',
    commodity,
    description: '真实商品',
    unitPrice: 3,
    maxQuantity: 2,
  });
  ok(b, 'orders.create', { id: 'one', offerId: 'goods', offerRevision: 1, quantity: 2 });
  ok(a, 'orders.accept', { id: 'one', expectedRevision: 1 });
  expect(r.state.world.agents[a]!.inventory[commodity] ?? 0).toBe(0);
  ok(c, 'orders.create', { id: 'two', offerId: 'goods', offerRevision: 1, quantity: 1 });
  expect(call(a, 'orders.accept', { id: 'two', expectedRevision: 1 })).toMatchObject({
    ok: false,
    error: 'insufficient-stock',
  });
  ok(b, 'orders.pay', { id: 'one', expectedRevision: 2 });
  const paidBalance = r.state.world.agents[b]!.balance;
  expect(call(b, 'orders.pay', { id: 'one', expectedRevision: 2 }).ok).toBe(false);
  expect(r.state.world.agents[b]!.balance).toBe(paidBalance);
  ok(b, 'orders.cancel', { id: 'one', expectedRevision: 3 });
  expect(r.state.world.agents[b]!.balance).toBe(before[b]!.balance);
  expect(r.state.world.agents[a]!.inventory[commodity]).toBe(before[a]!.stock);
  expect(commerceEscrowBalance(r.state.world.residentCommerce!)).toBe(0);
});
