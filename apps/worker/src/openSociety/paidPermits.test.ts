import { expect, test } from 'vitest';
import { openPermitsFixture } from './testFixtures/openPermits';
import type { CollectiveResourceAction } from '@aivilization/collaboration';
function fixture(options: Parameters<typeof openPermitsFixture>[1] = {}) {
  const t = openPermitsFixture(true, options),
    now = t.r.state.world.clock.now;
  const offer = (extra: Record<string, unknown> = {}) =>
    t.ok(
      t.b,
      'permits.offer',
      t.offer('permit', { users: [t.c, t.d], endAt: now + 360000, ...extra }),
    );
  const price = (extra: Record<string, unknown> = {}) =>
    t.ok(t.b, 'trades.offer', {
      id: 'order',
      sourceKind: 'permit',
      sourceId: 'permit',
      sourceRevision: 1,
      payerSector: 'agent',
      payerId: t.c,
      revenueSector: 'agent',
      revenueId: t.b,
      amount: 30,
      acceptBy: now + 60000,
      title: '使用权定价',
      terms: '固定权限期间，满意另行决定',
      ...extra,
    });
  return { ...t, now, offer, price, order: () => t.r.state.world.residentTrade!.orders.order! };
}
test('authenticated paid permission commits once, notifies named users without revealing price, expires and settles in the same tick', () => {
  const t = fixture();
  t.offer();
  t.price();
  const payer = t.r.state.world.agents[t.c]!.balance,
    seller = t.r.state.world.agents[t.b]!.balance;
  expect(t.call(t.c, 'permits.accept', { id: 'permit', expectedRevision: 1 }).error).toBe(
    'permit-paid-acceptance-required',
  );
  expect(t.call(t.b, 'trades.accept', { id: 'order', expectedRevision: 1 }).ok).toBe(false);
  const args = { id: 'order', expectedRevision: 1 };
  t.ok(t.c, 'trades.accept', args, 'one-accept');
  t.ok(t.c, 'trades.accept', args, 'one-accept');
  expect(t.r.state.world.agents[t.c]!.balance).toBe(payer - 30);
  expect(t.r.state.world.premisesRights!.permits.permit!.status).toBe('accepted');
  expect(t.r.state.world.activityTimeByAgent[t.d]).toBeUndefined();
  expect(t.call(t.d, 'trades.read', { id: 'order' }).error).toBe('trade-order-not-found');
  const notices = t.r.state.experiences[t.d]!.filter((e) =>
    e.summary.startsWith('PremisesPermitAccepted:'),
  );
  expect(notices).toHaveLength(1);
  expect(notices[0]!.summary).not.toContain('order');
  expect(notices[0]!.summary).not.toContain('escrow');
  const outsider = t.r.state.experiences[t.a] ?? [];
  expect(outsider.some((e) => e.summary.startsWith('PremisesPermitAccepted:'))).toBe(false);
  t.time(360000);
  expect(t.order()).toMatchObject({
    earned: 30,
    refunded: 0,
    paid: 0,
    status: 'awaiting-confirmation',
  });
  expect(t.ok(t.d, 'permits.read', { id: 'permit' }).data).toMatchObject({
    status: 'expired',
    provision: { availableMs: 360000, unavailableMs: 0 },
  });
  expect(t.r.state.world.agents[t.b]!.balance).toBe(seller);
  t.ok(t.c, 'trades.confirm', { id: 'order', expectedRevision: t.order().revision });
  expect(t.r.state.world.agents[t.b]!.balance).toBe(seller + 30);
  t.replay();
});
test('actual building deterioration ends further availability without erasing the earlier provided interval', () => {
  const t = fixture({ wearIntervalMs: 120000, wearPerInterval: 1000 });
  t.offer();
  t.price();
  t.ok(t.c, 'trades.accept', { id: 'order', expectedRevision: 1 });
  t.time(180000);
  expect(t.building().condition).toBe(0);
  expect(t.r.state.world.premisesRights!.provisions!.permit).toMatchObject({
    availableMs: 120000,
    unavailableMs: 60000,
  });
  t.time(180000);
  expect(t.order()).toMatchObject({
    earned: 10,
    refunded: 20,
    escrow: 10,
    status: 'awaiting-confirmation',
  });
  t.replay();
});
test('explicit legacy upgrade preserves old free permits and rejects retroactive price binding', () => {
  const t = fixture({ paidPermits: false });
  t.offer();
  expect(t.r.state.world.residentTrade!.policy.version).toBe('resident-evidence-trade-v1');
  t.ok(t.c, 'permits.accept', { id: 'permit', expectedRevision: 1 });
  const before = structuredClone(t.r.state.world);
  expect(t.r.enablePaidPermits().ok).toBe(true);
  expect(t.r.enablePaidPermits().ok).toBe(true);
  expect(t.r.state.world.agents).toEqual(before.agents);
  expect(t.r.state.world.premisesRights).toEqual(before.premisesRights);
  expect(t.r.state.world.residentTrade!.policy.version).toBe('resident-evidence-trade-v2');
  expect(
    t.call(t.b, 'trades.offer', {
      id: 'retroactive',
      sourceKind: 'permit',
      sourceId: 'permit',
      sourceRevision: 2,
      payerSector: 'agent',
      payerId: t.c,
      revenueSector: 'agent',
      revenueId: t.b,
      amount: 30,
      acceptBy: t.now + 60000,
      title: '事后要钱',
      terms: '单方文字不能产生债务',
    }).ok,
  ).toBe(false);
  t.replay();
});
test('collective exact authority pays and accepts its permission together, without allowing an ordinary member to spend', () => {
  const t = fixture();
  t.ok(t.c, 'collectives.create', {
    id: 'club',
    configuration: {
      title: '共同使用',
      terms: '两人独立确认',
      members: [t.c, t.d],
      voters: [t.c, t.d],
      threshold: 2,
      quorum: 2,
      timing: 'early',
      revote: true,
    },
    expiresAt: t.now + 86400000,
  });
  t.ok(t.d, 'collectives.respond', { id: 'club', expectedRevision: 1, accept: true });
  const decide = (id: string, action: CollectiveResourceAction) => {
    t.ok(t.c, 'collectives.propose', {
      id,
      collectiveId: 'club',
      expectedVersion: t.r.state.collectives!.charters.club!.version,
      terms: '只执行此项',
      action,
      closesAt: t.now + 120000,
      executeBefore: t.now + 240000,
    });
    for (const actor of [t.c, t.d])
      t.ok(actor, 'collectives.vote', {
        id,
        expectedRevision: t.r.state.collectives!.decisions[id]!.revision,
        vote: 'yes',
      });
    t.ok(t.c, 'collectives.decide', {
      id,
      expectedRevision: t.r.state.collectives!.decisions[id]!.revision,
    });
    t.ok(t.c, 'collectives.execute', {
      id,
      expectedRevision: t.r.state.collectives!.decisions[id]!.revision,
    });
  };
  t.ok(t.c, 'funds.open', { id: 'pool', collectiveId: 'club', title: '共同款' });
  t.ok(t.c, 'funds.contribute', { id: 'pool', expectedRevision: 1, amount: 30, note: '共同用途' });
  t.offer({ granteeKind: 'collective', granteeId: 'club' });
  t.price({ payerSector: 'collective', payerId: 'pool' });
  expect(t.call(t.c, 'trades.accept', { id: 'order', expectedRevision: 1 }).ok).toBe(false);
  decide('accept', {
    kind: 'resource',
    capability: 'trades.accept',
    resourceId: 'order',
    arguments: { expectedRevision: 1 },
  });
  expect(t.r.state.world.commonAccounts!.accounts.pool!.balance).toBe(0);
  expect(t.r.state.world.premisesRights!.permits.permit!.accepted).toMatchObject({
    actorId: t.c,
    decisionId: 'accept',
  });
  t.time(60000);
  decide('release', {
    kind: 'resource',
    capability: 'permits.release',
    resourceId: 'permit',
    arguments: { expectedRevision: 2 },
  });
  expect(t.order()).toMatchObject({
    earned: 5,
    refunded: 25,
    escrow: 5,
    status: 'awaiting-confirmation',
  });
  expect(t.r.state.world.commonAccounts!.accounts.pool!.balance).toBe(25);
  t.replay();
});

test('real repair resumes availability prospectively and never charges the broken interval', () => {
  const t = fixture({ wearIntervalMs: 120000, wearPerInterval: 1000 });
  t.offer({ endAt: t.now + 600000 });
  t.price();
  t.ok(t.c, 'trades.accept', { id: 'order', expectedRevision: 1 });
  t.time(180000);
  expect(t.building().condition).toBe(0);
  const stock = () => t.r.state.world.materials!.stocks.s!;
  t.ok(t.a, 'stocks.deposit', {
    id: 's',
    expectedRevision: stock().revision,
    items: { Wood: 2.025, 'Iron Ingot': 0.25 },
  });
  t.ok(t.a, 'materials.reserve', {
    id: 'repair-input',
    stockId: 's',
    expectedStockRevision: stock().revision,
    beneficiaryKind: 'resident',
    beneficiaryId: t.b,
    consumerDomain: 'premises',
    consumerId: 'repair',
    items: { Wood: 2.025, 'Iron Ingot': 0.25 },
    terms: '修理这些设施',
    expiresAt: t.now + 600000,
  });
  t.ok(t.b, 'construction.create', {
    id: 'repair',
    kind: 'maintain',
    buildingId: 'home',
    siteId: t.site!.id,
    expectedSiteRevision: t.r.state.world.premises!.sites[t.site!.id]!.revision,
    expectedBuildingRevision: t.building().revision,
    controllerKind: 'resident',
    controllerId: t.b,
    title: '恢复设施',
    description: '实际投入维修',
    workers: [t.b],
    reservationRefs: ['repair-input@1'],
    ...t.blueprint,
  });
  const project = () => t.r.state.world.premises!.projects.repair!;
  const start = t.r.state.world.clock.now,
    duration = project().plan.workMs;
  t.ok(t.b, 'construction.start', {
    id: 'repair',
    expectedRevision: project().revision,
    until: start + duration,
  });
  t.time(duration);
  expect(project().status).toBe('completed');
  expect(t.building().condition).toBe(1000);
  expect(t.r.state.world.premisesRights!.provisions!.permit!.availableMs).toBe(120000);
  t.time(10000);
  t.ok(t.c, 'permits.release', { id: 'permit', expectedRevision: 2 });
  expect(t.r.state.world.premisesRights!.provisions!.permit).toMatchObject({
    availableMs: 130000,
    unavailableMs: 60000 + duration,
  });
  expect(t.order()).toMatchObject({
    earned: 6.5,
    refunded: 23.5,
    escrow: 6.5,
    status: 'awaiting-confirmation',
  });
  t.replay();
});
