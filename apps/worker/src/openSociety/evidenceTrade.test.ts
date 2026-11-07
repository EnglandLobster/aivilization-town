import { expect, test } from 'vitest';
import { openFreightFixture } from './testFixtures/openFreight';
import { validateEvidenceTradeResourceAction } from './evidenceTradeTools';
import type { CollectiveResourceAction } from '@aivilization/collaboration';
function fixture(enabled = true, commonMaxBalance = 1000000000) {
  const h = openFreightFixture(true, enabled, commonMaxBalance);
  const order = () => h.r.state.world.residentTrade!.orders.order!;
  const op = (
    actor: string,
    operation: string,
    args: Record<string, unknown> = {},
    requestId?: string,
  ) =>
    h.ok(
      actor,
      `trades.${operation}`,
      { id: 'order', expectedRevision: order().revision, ...args },
      requestId,
    );
  const offer = () => {
    h.prepare();
    h.ok(h.a, 'trades.offer', {
      id: 'order',
      sourceKind: 'freight',
      sourceId: 'parcel',
      sourceRevision: h.freight().revision,
      payerSector: 'agent',
      payerId: h.c,
      revenueSector: 'agent',
      revenueId: h.a,
      amount: 30,
      acceptBy: h.r.state.world.clock.now + 600000,
      title: '由居民约定的商品交易',
      terms: '真实木料，运输费用独立核对',
    });
  };
  return { h, order, op, offer };
}
test('authenticated trade tools settle actual freight once, reveal only party records and recover the same journal', () => {
  const { h, order, op, offer } = fixture();
  offer();
  expect(h.call(h.outsider, 'trades.read', { id: 'order' }).error).toBe('trade-order-not-found');
  expect(h.call(h.b, 'trades.ledger', { id: 'order' }).error).toBe('trade-order-not-found'); // carrier is not the goods buyer/seller
  expect(
    h.call(h.b, 'freight.load', { id: 'parcel', expectedRevision: h.freight().revision }).error,
  ).toBe('trade-payment-or-offer-release-required');
  const balanceA = h.r.state.world.agents[h.a]!.balance,
    balanceC = h.r.state.world.agents[h.c]!.balance;
  op(h.c, 'accept');
  h.op(h.b, 'load');
  h.ok(h.b, 'world.move', { targetLocationId: h.east });
  h.arrive();
  h.op(h.b, 'deliver');
  expect(order()).toMatchObject({ status: 'awaiting-confirmation', earned: 30, escrow: 30 });
  expect(
    h.r.state.experiences[h.c]?.some(
      (e) =>
        e.summary.includes('ResidentEvidenceTradeCommitted') &&
        e.summary.includes('awaiting-confirmation'),
    ),
  ).toBe(true);
  const outsider = JSON.stringify(h.r.state.experiences[h.outsider] ?? []);
  expect(outsider).not.toContain('town trades read --id order');
  const revision = order().revision;
  op(h.c, 'confirm', {}, 'one-confirmation');
  const retried = h.ok(
    h.c,
    'trades.confirm',
    { id: 'order', expectedRevision: revision },
    'one-confirmation',
  );
  expect(retried.ok).toBe(true);
  expect(h.r.state.world.agents[h.a]!.balance).toBeCloseTo(balanceA + 30, 8);
  expect(h.r.state.world.agents[h.c]!.balance).toBeCloseTo(balanceC - 30, 8);
  const ledger = h.ok(h.c, 'trades.ledger', { id: 'order', limit: 30 });
  expect(JSON.stringify(ledger.data)).toContain('"paid":30');
  expect(JSON.stringify(h.ok(h.c, 'trades.read', { id: 'order' }).data)).toContain(
    'resident-logistics-v1',
  );
  h.replay();
});
test('funded cancellation retains the order escrow in transit and refunds only on real return', () => {
  const { h, order, op, offer } = fixture();
  offer();
  op(h.c, 'accept');
  h.op(h.b, 'load');
  h.ok(h.b, 'world.move', { targetLocationId: h.east });
  h.op(h.a, 'cancel');
  expect(
    h.call(h.c, 'trades.withdraw', { id: 'order', expectedRevision: order().revision }).error,
  ).toBe('trade-unfunded-offer-required');
  expect(order().escrow).toBe(30);
  h.arrive();
  h.ok(h.b, 'world.move', { targetLocationId: h.west });
  h.arrive();
  h.op(h.b, 'return');
  expect(order()).toMatchObject({ status: 'refunded', refunded: 30, escrow: 0 });
  expect(h.r.state.world.materials!.stocks.src!.inventory.Wood).toBe(8);
  h.replay();
});
test('CLI parameters cannot submit identity or source evidence; legacy mode requires explicit opt-in', () => {
  const { h, offer } = fixture(false);
  expect(h.call(h.a, 'trades.rules').error).toBe('evidence-trade-not-enabled');
  const before = structuredClone(h.r.state.world);
  expect(h.r.enableEvidenceTrade().ok).toBe(true);
  expect(h.r.state.world.agents).toEqual(before.agents);
  expect(h.r.state.world.materials).toEqual(before.materials);
  offer();
  expect(
    h.call(h.c, 'trades.accept', { id: 'order', expectedRevision: 1, actorId: h.a }).error,
  ).toMatch(/unknown/);
  expect(
    h.call(h.c, 'trades.observe', {
      id: 'order',
      expectedRevision: 1,
      evidence: { status: 'delivered' },
    }).error,
  ).toMatch(/unknown/);
  expect(
    validateEvidenceTradeResourceAction(h.r.state, 'club', {
      kind: 'resource',
      capability: 'trades.confirm',
      resourceId: 'order',
      arguments: { expectedRevision: 1 },
    }),
  ).toBe('collective-trade-controller-mismatch');
  h.replay();
});
test('unaccepted order expiry is the same across small and large time advances, releases physical start and never pays', () => {
  for (const split of [false, true]) {
    const { h, order, offer } = fixture();
    offer();
    if (split) for (let i = 0; i < 6; i++) h.time(100000);
    else h.time(600000);
    expect(order()).toMatchObject({ status: 'expired', funded: 0, escrow: 0, paid: 0 });
    h.op(h.b, 'load');
    h.replay();
  }
});
function collective(h: ReturnType<typeof openFreightFixture>) {
  const now = h.r.state.world.clock.now;
  h.ok(h.a, 'collectives.create', {
    id: 'club',
    configuration: {
      title: '共同购买服务',
      terms: '两人独立确认',
      members: [h.a, h.d],
      voters: [h.a, h.d],
      threshold: 2,
      quorum: 2,
      timing: 'early',
      revote: true,
    },
    expiresAt: now + 86400000,
  });
  h.ok(h.d, 'collectives.respond', { id: 'club', expectedRevision: 1, accept: true });
  h.ok(h.a, 'funds.open', { id: 'pool', collectiveId: 'club', title: '共同费用' });
  h.ok(h.d, 'funds.contribute', { id: 'pool', expectedRevision: 1, amount: 30, note: '独立出资' });
  const decide = (id: string, action: CollectiveResourceAction, executor = h.d) => {
    h.ok(h.a, 'collectives.propose', {
      id,
      collectiveId: 'club',
      expectedVersion: h.r.state.collectives!.charters.club!.version,
      terms: '这一项精确操作',
      action,
      closesAt: now + 120000,
      executeBefore: now + 240000,
    });
    for (const actor of [h.a, h.d])
      h.ok(actor, 'collectives.vote', {
        id,
        expectedRevision: h.r.state.collectives!.decisions[id]!.revision,
        vote: 'yes',
      });
    h.ok(h.a, 'collectives.decide', {
      id,
      expectedRevision: h.r.state.collectives!.decisions[id]!.revision,
    });
    h.ok(executor, 'collectives.execute', {
      id,
      expectedRevision: h.r.state.collectives!.decisions[id]!.revision,
    });
  };
  return decide;
}
test('two independent collective votes authorize paid service and settlement; members cannot spend or acquire bodily authority', () => {
  const { h, order, op } = fixture(true, 30),
    decide = collective(h),
    now = h.r.state.world.clock.now;
  const service = () => h.r.state.world.serviceEngagements!.engagements.help!;
  h.ok(h.a, 'engagements.offer', {
    id: 'help',
    controllerKind: 'resident',
    controllerId: h.a,
    title: '居民帮忙',
    terms: '实际参与才能履行',
    locationId: h.west,
    providerId: h.b,
    recipientId: h.a,
    payerSector: 'collective',
    payerId: 'pool',
    revenueSector: 'agent',
    revenueId: h.a,
    providerShareBps: 0,
    pricePerHour: 0,
    modelId: 'personal-assistance-v1',
    maxDurationMs: 60000,
    startAt: now,
    endAt: now + 120000,
    reservationRefs: [],
  });
  h.ok(h.a, 'engagements.accept', { id: 'help', expectedRevision: service().revision });
  decide('service-fund', {
    kind: 'resource',
    capability: 'engagements.fund',
    resourceId: 'help',
    arguments: { expectedRevision: service().revision },
  });
  h.ok(h.a, 'trades.offer', {
    id: 'order',
    sourceKind: 'service',
    sourceId: 'help',
    sourceRevision: service().revision,
    payerSector: 'collective',
    payerId: 'pool',
    revenueSector: 'agent',
    revenueId: h.a,
    amount: 30,
    acceptBy: now + 30000,
    title: '共同赞助实际服务',
    terms: '实际时长，未履行部分退回',
  });
  expect(
    h.call(h.a, 'trades.accept', { id: 'order', expectedRevision: order().revision }).error,
  ).toBe('trade-party-authority-required');
  decide('buy', {
    kind: 'resource',
    capability: 'trades.accept',
    resourceId: 'order',
    arguments: { expectedRevision: order().revision },
  });
  expect(h.r.state.world.commonAccounts!.accounts.pool!.balance).toBe(0);
  expect(
    h.call(h.d, 'funds.contribute', {
      id: 'pool',
      expectedRevision: h.r.state.world.commonAccounts!.accounts.pool!.revision,
      amount: 1,
      note: '不能挤占退款空间',
    }).error,
  ).toBe('unrepresentable-common-account-transfer');
  expect(
    h.call(h.d, 'engagements.start', {
      id: 'help',
      expectedRevision: service().revision,
      until: now + 60000,
    }).ok,
  ).toBe(false);
  h.ok(h.b, 'engagements.start', {
    id: 'help',
    expectedRevision: service().revision,
    until: now + 60000,
  });
  h.ok(h.a, 'engagements.start', {
    id: 'help',
    expectedRevision: service().revision,
    until: now + 60000,
  });
  h.time(30000);
  h.ok(h.a, 'engagements.leave', { id: 'help', expectedRevision: service().revision });
  expect(order()).toMatchObject({
    earned: 15,
    refunded: 15,
    escrow: 15,
    status: 'awaiting-confirmation',
  });
  expect(h.r.state.world.commonAccounts!.accounts.pool!.balance).toBe(15);
  // Agree to a different final split after recording actual facts, with a fresh independent collective decision.
  op(h.a, 'propose-settlement', { content: '再退五单位', refund: 5 });
  decide(
    'settle',
    {
      kind: 'resource',
      capability: 'trades.respond-settlement',
      resourceId: 'order',
      arguments: { expectedRevision: order().revision, accept: true },
    },
    h.a,
  );
  expect(order()).toMatchObject({ status: 'settled', paid: 10, refunded: 20, escrow: 0 });
  expect(h.r.state.world.commonAccounts!.accounts.pool!.balance).toBe(20);
  expect(
    h.call(h.d, 'collectives.execute', {
      id: 'settle',
      expectedRevision: h.r.state.collectives!.decisions.settle!.revision,
    }).ok,
  ).toBe(false);
  h.replay();
});

test('ledger pages preserve numeric order revisions across same-tick statements and canonical journal key reordering', () => {
  const { h, op, offer } = fixture();
  offer();
  op(h.c, 'accept');
  for (let i = 0; i < 12; i++) op(h.c, 'dispute', { content: `Original statement ${i}` });
  const before = h.ok(h.c, 'trades.ledger', { id: 'order', offset: 8, limit: 6 });
  expect(before.data).toMatchObject({
    items: [
      { orderRevision: 9 },
      { orderRevision: 10 },
      { orderRevision: 11 },
      { orderRevision: 12 },
      { orderRevision: 13 },
      { orderRevision: 14 },
    ],
    nextOffset: null,
  });
  const reopened = h.replay();
  reopened.beginTurn(h.c);
  const after = reopened.invoke(h.c, {
    name: 'trades.ledger',
    arguments: { id: 'order', offset: 8, limit: 6 },
    requestId: 'read-after-restart',
  });
  expect(after.ok).toBe(true);
  expect(after.data).toEqual(before.data);
  reopened.finishTurn(h.c, { summary: 'Verified original ledger order after restart' });
});
