import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { openFreightFixture } from './testFixtures/openFreight';
import { createOpenSocietyManifest } from './manifest';

test('explicit goods grant upgrades once without rewriting old manifest; seeds require preceding public scope', () => {
  const h = openFreightFixture();
  const bytes = readFileSync(join(h.root, 'manifest.json'));
  expect(h.r.enablePublicGoodsProcurement().ok).toBe(false);
  expect(h.r.enablePublicGovernance().ok).toBe(true);
  expect(h.r.enablePublicProcurement().ok).toBe(true);
  const source = h.r.state.world.publicGovernance!.authority.grant.source;
  expect(h.r.enablePublicGoodsProcurement().ok).toBe(true);
  const count = h.r.journal.commits.length;
  expect(h.r.enablePublicGoodsProcurement().ok).toBe(true);
  expect(h.r.journal.commits).toHaveLength(count);
  expect(h.r.state.world.publicGovernance!.authority.grant.source).toEqual(source);
  expect(readFileSync(join(h.root, 'manifest.json'))).toEqual(bytes);
  h.replay();
  expect(() =>
    createOpenSocietyManifest({
      count: 4,
      continuity: true,
      publicGovernance: true,
      publicGoodsProcurement: true,
    }),
  ).toThrow();
});

test('public freight contracts expose their own provenance and delivery ledger while private freight stays private', () => {
  const h = openFreightFixture(true, true, 1000000000, true);
  expect(h.r.manifest.provenance.publicGoodsProcurement).toBe(
    'resident-public-goods-procurement-v1',
  );
  h.prepare();
  expect(h.call(h.outsider, 'freight.read', { id: 'parcel' }).ok).toBe(false);
  h.ok(h.a, 'trades.offer', {
    id: 'order',
    sourceKind: 'freight',
    sourceId: 'parcel',
    sourceRevision: h.freight().revision,
    payerSector: 'treasury',
    payerId: 'public-treasury',
    revenueSector: 'agent',
    revenueId: h.a,
    amount: 30,
    acceptBy: 600000,
    title: 'Public purchase',
    terms: 'Recipient owns real delivered goods',
  });
  expect(h.ok(h.outsider, 'trades.read', { id: 'order' }).data).toMatchObject({
    payer: { sector: 'treasury' },
    source: { buyer: { kind: 'resident', id: h.c } },
  });
  h.ok(h.outsider, 'freight.read', { id: 'parcel' });
  const treasury = h.r.state.world.treasury;
  h.ok(h.c, 'trades.accept', { id: 'order', expectedRevision: 1 });
  expect(h.r.state.world.treasury).toBe(treasury);
  const proposal = () => h.r.state.world.publicGovernance!.authority.proposals.buy!;
  h.ok(h.outsider, 'governance.propose', {
    id: 'buy',
    text: 'Resident decision',
    action: { kind: 'fund-goods', orderId: 'order', expectedRevision: 2, amount: 30 },
    expectedProcedureRevision: 1,
    closesAt: 60000,
  });
  for (const actor of [h.a, h.c, h.outsider])
    h.ok(actor, 'governance.vote', {
      id: 'buy',
      expectedRevision: proposal().revision,
      choice: 'yes',
    });
  h.time(60000);
  h.ok(h.b, 'governance.close', { id: 'buy', expectedRevision: proposal().revision });
  h.ok(h.outsider, 'governance.execute', { id: 'buy', expectedRevision: proposal().revision });
  const order = () => h.r.state.world.residentTrade!.orders.order!;
  expect(order()).toMatchObject({ status: 'funded', escrow: 30, fundingDecisionId: 'buy' });
  h.op(h.b, 'load');
  h.ok(h.b, 'world.move', { targetLocationId: h.east });
  h.arrive();
  h.op(h.b, 'deliver');
  expect(
    h.call(h.outsider, 'trades.confirm', { id: 'order', expectedRevision: order().revision }).ok,
  ).toBe(false);
  h.ok(h.c, 'trades.confirm', { id: 'order', expectedRevision: order().revision });
  expect(order()).toMatchObject({ status: 'completed', paid: 30 });
  expect(h.ok(h.outsider, 'governance.status').data).toMatchObject({
    goodsProcurement: { policy: { ownership: 'named-recipient-not-implicit-public-property' } },
  });
  expect(JSON.stringify(h.ok(h.outsider, 'trades.ledger', { id: 'order' }).data)).toContain(
    'public-funder',
  );
  h.replay();
});
