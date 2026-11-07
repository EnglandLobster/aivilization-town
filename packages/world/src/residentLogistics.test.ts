import { expect, test } from 'vitest';
import { LOGISTICS_POLICY } from '@aivilization/logistics';
import { applyWorldEvent } from './projection';
import { enableResidentLogisticsEvent } from './residentLogistics';
import { freightWorldFixture as fixture } from './testFixtures/residentFreight';

test('hand freight follows actual travel and reaches destination inventory atomically with its fee; false arrival and replay tampering fail', () => {
  const t = fixture();
  t.ready();
  t.ok(t.freight('carrier', 'load'));
  expect(t.w.agents.carrier!.inventory).toEqual({ Wood: 1 });
  expect(t.w.materials!.custodies!.records.parcel!.held).toEqual({ Wood: 4 });
  expect(t.freight('carrier', 'deliver')).toMatchObject({
    accepted: false,
    reason: 'freight-carrier-not-present-and-idle',
  });
  t.commit(t.move('carrier'));
  expect(t.w.transitByAgent?.carrier).toBeDefined();
  expect(t.freight('carrier', 'deliver').accepted).toBe(false);
  t.arrive();
  const before = t.w,
    d = t.freight('carrier', 'deliver');
  const es = t.ok(d);
  expect(t.w.materials!.stocks['recipient-stock']!.inventory).toEqual({ Wood: 4 });
  expect(t.w.agents.carrier!.balance).toBe(108);
  expect(t.w.agents.payer!.balance).toBe(92);
  const event = es[0]!;
  if (event.type !== 'ResidentLogisticsCommitted') throw Error('wrong event');
  expect(() =>
    applyWorldEvent(before, { ...event, payload: { ...event.payload, transactions: [] } }),
  ).toThrow('freight-accounting-facts-mismatch');
  expect(() =>
    applyWorldEvent(before, { ...event, payload: { ...event.payload, materialProofs: [] } }),
  ).toThrow('freight-material-facts-mismatch');
  t.replay();
});
test('loaded cancellation preserves in-transit custody and fee until real return, with independent source stock closure guard', () => {
  const t = fixture();
  t.ready();
  t.ok(t.freight('carrier', 'load'));
  t.commit(t.move('carrier'));
  t.ok(t.freight('source', 'cancel'));
  expect(t.w.logistics!.freight.parcel).toMatchObject({ status: 'return-required', escrow: 8 });
  expect(t.w.materials!.custodies!.records.parcel!.held).toEqual({ Wood: 4 });
  expect(
    t.material('recipient', {
      type: 'close-stock',
      id: 'recipient-stock',
      expectedRevision: t.w.materials!.stocks['recipient-stock']!.revision,
    }),
  ).toMatchObject({ accepted: false, reason: 'material-stock-unsettled' });
  t.arrive();
  expect(t.freight('carrier', 'return').accepted).toBe(false);
  t.commit(t.move('carrier', 'west'));
  t.arrive();
  t.ok(t.freight('carrier', 'return'));
  expect(t.w.materials!.stocks['source-stock']!.inventory).toEqual({ Wood: 8 });
  expect(t.w.agents.carrier!.balance).toBe(103);
  expect(t.w.agents.payer!.balance).toBe(97);
  t.replay();
});
test('vehicle freight stays with the real vehicle when courier walks away; solo driving carries it without a fictional passenger', () => {
  const t = fixture({ vehicle: true });
  t.ready();
  t.ok(t.freight('carrier', 'load'));
  expect(
    t.mobility('friend', {
      type: 'vehicles.drive',
      id: 'car',
      destinationId: 'east',
      expectedRevision: 1,
    }),
  ).toMatchObject({ accepted: false, reason: 'vehicle-freight-custodian-required' });
  t.commit(t.move('carrier'));
  t.arrive();
  expect(t.freight('carrier', 'deliver')).toMatchObject({
    accepted: false,
    reason: 'freight-vehicle-not-present-and-authorized',
  });
  expect(t.w.residentMobility.vehicles.car!.locationId).toBe('west');
  t.commit(t.move('carrier', 'west'));
  t.arrive();
  t.ok(
    t.mobility('carrier', {
      type: 'vehicles.drive',
      id: 'car',
      destinationId: 'east',
      expectedRevision: 1,
    }),
  );
  expect(t.w.residentMobility.vehicles.car!.journey!.people).toEqual(['carrier']);
  t.arrive();
  t.ok(t.freight('carrier', 'deliver'));
  expect(t.w.residentMobility.vehicles.car!.locationId).toBe('east');
  t.replay();
});
test('normal bags count toward walking and vehicle loads; loading freight cannot bypass either limit', () => {
  const t = fixture({ carrierBag: 18 });
  t.ready();
  expect(t.freight('carrier', 'load')).toMatchObject({
    accepted: false,
    reason: 'freight-load-capacity',
  });
  const over = fixture({ carrierBag: 21 });
  expect(
    over
      .move('carrier')
      .some(
        (e) =>
          e.type === 'ActionRejected' && e.payload.reason === 'personal-load-capacity-exceeded',
      ),
  ).toBe(true);
  const vehicle = fixture({ vehicle: true, carrierBag: 5, capacity: 8 });
  vehicle.ready();
  expect(vehicle.freight('carrier', 'load')).toMatchObject({
    accepted: false,
    reason: 'freight-load-capacity',
  });
  const drive = fixture({ carrierBag: 9, capacity: 8 });
  expect(
    drive.mobility('carrier', {
      type: 'vehicles.drive',
      id: 'car',
      destinationId: 'east',
      expectedRevision: 1,
    }),
  ).toMatchObject({ accepted: false, reason: 'vehicle-load-capacity-exceeded' });
});
test('deadline settlement releases preloaded commitments but never erases loaded obligations or invents a refund', () => {
  const t = fixture();
  t.ready();
  t.time(3600000);
  expect(t.w.logistics!.freight.parcel).toMatchObject({
    status: 'cancelled',
    refunded: 8,
    paid: 0,
  });
  expect(t.w.materials!.stocks['source-stock']!.inventory.Wood).toBe(8);
  const loaded = fixture();
  loaded.ready();
  loaded.ok(loaded.freight('carrier', 'load'));
  loaded.time(3600000);
  expect(loaded.w.logistics!.freight.parcel).toMatchObject({
    status: 'return-required',
    escrow: 8,
  });
  expect(loaded.w.materials!.custodies!.records.parcel!.held.Wood).toBe(4);
  loaded.ok(loaded.freight('carrier', 'return'));
  loaded.replay();
  t.replay();
});
test('old snapshots keep travel semantics; explicit enable refuses unfinished movement and preserves all possessions', () => {
  const t = fixture({ enabled: false, carrierBag: 21 });
  expect(t.w.logistics).toBeUndefined();
  expect(t.w.materials!.custodies).toBeUndefined();
  t.commit(t.move('carrier'));
  expect(t.w.transitByAgent?.carrier).toBeDefined();
  expect(enableResidentLogisticsEvent({ ...t.context(), policy: LOGISTICS_POLICY })).toMatchObject({
    accepted: false,
    reason: 'logistics-upgrade-await-existing-travel',
  });
  t.arrive();
  t.ok(enableResidentLogisticsEvent({ ...t.context(), policy: LOGISTICS_POLICY }));
  expect(t.w.agents.carrier!.inventory.Wood).toBe(21);
  expect(t.move('carrier', 'west').some((e) => e.type === 'ActionRejected')).toBe(true);
  t.replay();
});
