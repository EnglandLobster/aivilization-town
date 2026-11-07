import { expect, test } from 'vitest';
import { validateLogisticsResourceAction } from './logisticsTools';
import { openFreightFixture as fixture } from './testFixtures/openFreight';

test('authenticated freight CLI actions settle real material and fees, redact outsiders and replay the exact journal', () => {
  const h = fixture();
  h.prepare();
  expect(h.call(h.outsider, 'freight.read', { id: 'parcel' }).error).toBe('freight-not-found');
  expect(
    h.call(h.a, 'freight.load', { id: 'parcel', expectedRevision: h.freight().revision }).error,
  ).toBe('freight-personal-carrier-required');
  h.op(h.b, 'load');
  h.ok(h.b, 'world.move', { targetLocationId: h.east });
  h.arrive();
  const revision = h.freight().revision,
    requestId = 'exact-delivery';
  h.ok(h.b, 'freight.deliver', { id: 'parcel', expectedRevision: revision }, requestId);
  const balance = h.r.state.world.agents[h.b]!.balance;
  h.ok(h.b, 'freight.deliver', { id: 'parcel', expectedRevision: revision }, requestId);
  expect(h.r.state.world.agents[h.b]!.balance).toBe(balance);
  expect(h.r.state.world.materials!.stocks.dst!.inventory).toEqual({ Wood: 4 });
  const ledger = h.ok(h.d, 'freight.ledger', { id: 'parcel' });
  expect(JSON.stringify(ledger.data)).toContain('escrowAfter');
  h.replay();
});
test('vehicle custody requires the actual authorized courier; revocation cannot strand entrusted cargo', () => {
  const h = fixture();
  h.prepare(true);
  h.op(h.b, 'load');
  expect(
    h.call(h.a, 'vehicles.revoke', { id: 'seed-car-1', residentId: h.b, expectedRevision: 2 })
      .error,
  ).toBe('vehicle-custody-obligation');
  h.ok(h.b, 'vehicles.drive', { id: 'seed-car-1', destinationId: h.east, expectedRevision: 2 });
  h.op(h.a, 'cancel');
  const receipt = h.ok(h.a, 'freight.read', { id: 'parcel' });
  expect(JSON.stringify(receipt.data)).not.toContain('"people"');
  expect(h.freight().status).toBe('return-required');
  h.arrive();
  h.ok(h.b, 'vehicles.drive', {
    id: 'seed-car-1',
    destinationId: h.west,
    expectedRevision: h.r.state.world.residentMobility!.vehicles['seed-car-1']!.revision,
  });
  h.arrive();
  h.op(h.b, 'return');
  expect(h.freight()).toMatchObject({ status: 'returned', paid: 3, refunded: 5, escrow: 0 });
  h.replay();
});
test('old manifests require explicit enable, which endows no cargo space or goods; queries disclose the active rule model', () => {
  const h = fixture(false);
  expect(h.call(h.a, 'freight.rules').error).toBe('logistics-not-enabled');
  const vehicles = structuredClone(h.r.state.world.residentMobility);
  expect(h.r.enableLogistics().ok).toBe(true);
  expect(h.r.state.world.residentMobility).toEqual(vehicles);
  expect(h.r.state.world.residentMobility!.vehicles['seed-car-1']!.cargoCapacity).toBeUndefined();
  expect(JSON.stringify(h.ok(h.a, 'freight.rules').data)).toContain('quantity-load-v1');
  h.ok(h.a, 'rules.read', { id: 'physical-freight' });
  h.replay();
});
test('unknown execution arguments and collective proxies for personal labor cannot enter the authoritative path', () => {
  const h = fixture();
  h.prepare();
  expect(
    h.call(h.b, 'freight.load', {
      id: 'parcel',
      expectedRevision: h.freight().revision,
      arrived: true,
    }).ok,
  ).toBe(false);
  for (const capability of ['freight.load', 'freight.deliver', 'freight.return'])
    expect(
      validateLogisticsResourceAction(h.r.state, 'club', {
        kind: 'resource',
        capability,
        resourceId: 'parcel',
        arguments: { expectedRevision: h.freight().revision },
      }),
    ).toBe('unsupported-collective-freight-action');
  expect(h.freight().status).toBe('funded');
  h.replay();
});
test('stock contribution permission reveals no freight contents or contract; authorized inventory readers see both capacity promises', () => {
  const h = fixture();
  h.prepare();
  h.op(h.b, 'load');
  h.ok(h.a, 'stocks.configure', {
    id: 'src',
    expectedRevision: h.r.state.world.materials!.stocks.src!.revision,
    contributors: [h.a, h.outsider],
    readers: [h.a],
  });
  expect(h.ok(h.outsider, 'stocks.read', { id: 'src' }).data).not.toHaveProperty(
    'freightReservations',
  );
  const source = h.ok(h.a, 'stocks.read', { id: 'src' });
  expect(JSON.stringify(source.data)).toContain('reservedReturnSpace');
  const destination = h.ok(h.c, 'stocks.read', { id: 'dst' });
  expect(JSON.stringify(destination.data)).toContain('reservedIncomingSpace');
  expect(h.call(h.outsider, 'freight.read', { id: 'parcel' }).error).toBe('freight-not-found');
  h.replay();
});
test('a finite collective vote funds a freight agreement exactly once; the private common ledger and real refund replay together', () => {
  const h = fixture();
  h.ok(h.a, 'collectives.create', {
    id: 'club',
    configuration: {
      title: '自定运输预算',
      terms: '两人确认一笔支出',
      members: [h.a, h.d],
      voters: [h.a, h.d],
      threshold: 2,
      quorum: 2,
      timing: 'early',
      revote: true,
    },
    expiresAt: h.r.state.world.clock.now + 100000,
  });
  h.ok(h.d, 'collectives.respond', { id: 'club', expectedRevision: 1, accept: true });
  h.ok(h.a, 'funds.open', { id: 'pool', collectiveId: 'club', title: '自己组织的费用' });
  h.ok(h.d, 'funds.contribute', { id: 'pool', expectedRevision: 1, amount: 8, note: '这一次运费' });
  h.prepare(false, true);
  expect(
    h.call(h.a, 'freight.fund', { id: 'parcel', expectedRevision: h.freight().revision }).error,
  ).toBe('freight-payer-authority-required');
  h.ok(h.a, 'collectives.propose', {
    id: 'pay',
    collectiveId: 'club',
    expectedVersion: h.r.state.collectives!.charters.club!.version,
    terms: '精确支付这个约定',
    action: {
      kind: 'resource',
      capability: 'freight.fund',
      resourceId: 'parcel',
      arguments: { expectedRevision: h.freight().revision },
    },
    closesAt: h.r.state.world.clock.now + 10000,
    executeBefore: h.r.state.world.clock.now + 20000,
  });
  for (const actor of [h.a, h.d])
    h.ok(actor, 'collectives.vote', {
      id: 'pay',
      expectedRevision: h.r.state.collectives!.decisions.pay!.revision,
      vote: 'yes',
    });
  h.ok(h.a, 'collectives.decide', {
    id: 'pay',
    expectedRevision: h.r.state.collectives!.decisions.pay!.revision,
  });
  h.ok(h.d, 'collectives.execute', {
    id: 'pay',
    expectedRevision: h.r.state.collectives!.decisions.pay!.revision,
  });
  expect(h.r.state.world.commonAccounts!.accounts.pool!.balance).toBe(0);
  expect(h.freight().escrow).toBe(8);
  expect(
    h.call(h.d, 'collectives.execute', {
      id: 'pay',
      expectedRevision: h.r.state.collectives!.decisions.pay!.revision,
    }).ok,
  ).toBe(false);
  h.op(h.b, 'load');
  h.op(h.a, 'cancel');
  h.op(h.b, 'return');
  expect(h.r.state.world.commonAccounts!.accounts.pool!.balance).toBe(5);
  expect(h.freight()).toMatchObject({ paid: 3, refunded: 5 });
  h.replay();
});
