import { expect, test } from 'vitest';
import { asAgentId, asLocationId } from '@aivilization/sim-core';
import { freightCustodian, type FreightCustodyCommand } from '@aivilization/logistics';
import { freightWorldFixture } from './testFixtures/residentFreight';
import { applyWorldEvent, type WorldProjection } from './projection';
import { residentLogisticsEvent } from './residentLogistics';
import {
  capturedResidentDeparture,
  residentDeathFixture,
  residentExitFixture,
} from './testFixtures/residentExit';
import {
  enableResidentFreightCustodyEvent,
  residentFreightCustodyEvent,
  freightCustodyTakingFailure,
} from './residentFreightCustody';

function handoff(t: ReturnType<typeof freightWorldFixture>, vehicle: boolean) {
  t.commit([enableResidentFreightCustodyEvent(t.context('system'))]);
  const command = (actorId: string, command: FreightCustodyCommand) =>
    residentFreightCustodyEvent({
      ...t.context(actorId),
      freightId: 'parcel',
      command,
    });
  t.ok(
    command('carrier', {
      type: 'propose',
      id: 'handoff',
      nextCarrierId: 'friend',
      expiresAt: 1000000,
      ...(vehicle ? { vehicleId: 'car' } : {}),
    }),
  );
  for (const [i, role] of (['source', 'recipient', 'payer', 'previous-carrier'] as const).entries())
    t.ok(
      command(role === 'previous-carrier' ? 'carrier' : role, {
        type: 'consent',
        id: 'handoff',
        expectedRevision: i + 1,
        role,
      }),
    );
  return command;
}
for (const vehicle of [false, true])
  test(`actual handoff changes physical operator, preserves original contract payment and replays (vehicle ${vehicle})`, () => {
    const t = freightWorldFixture({ vehicle });
    t.ready();
    t.ok(t.freight('carrier', 'load'));
    const original = structuredClone(t.w.logistics!.freight.parcel);
    const command = handoff(t, vehicle),
      before = structuredClone(t.w);
    const d = command('friend', { type: 'accept', id: 'handoff', expectedRevision: 5 });
    if (!d.accepted) throw Error(d.reason);
    t.ok(d);
    expect(t.w.logistics!.freight.parcel).toEqual(original);
    expect(t.w.materials).toEqual(before.materials);
    expect(t.w.agents).toEqual(before.agents);
    expect(freightCustodian(t.w.logistics!.custody, original!)).toMatchObject({
      carrierId: 'friend',
    });
    expect(() => applyWorldEvent(t.w, d.events[0]!)).toThrow();
    expect(t.freight('carrier', 'return')).toMatchObject({
      accepted: false,
      reason: 'freight-personal-carrier-required',
    });
    if (vehicle) {
      expect(
        t.mobility('carrier', {
          type: 'vehicles.drive',
          id: 'car',
          destinationId: 'east',
          expectedRevision: 1,
        }).accepted,
      ).toBe(false);
      t.ok(
        t.mobility('friend', {
          type: 'vehicles.drive',
          id: 'car',
          destinationId: 'east',
          expectedRevision: 1,
        }),
      );
    } else t.commit(t.move('friend'));
    t.arrive('friend');
    t.ok(t.freight('friend', 'deliver'));
    expect(t.w.materials!.stocks['recipient-stock']!.inventory).toEqual({ Wood: 4 });
    expect(t.w.agents.friend!.balance).toBe(100);
    expect(t.w.agents.carrier!.balance).toBe(108);
    expect(t.w.logistics!.freight.parcel).toMatchObject({
      carrierId: 'carrier',
      escrow: 0,
      status: 'delivered',
    });
    t.replay();
  });

test('parked departed carrier can be independently replaced; real return pays original estate without resurrecting a body', () => {
  const t = freightWorldFixture({ vehicle: true });
  t.ready();
  t.ok(t.freight('carrier', 'load'));
  const prepared = { ...t.w, residentExits: residentExitFixture().residentExits },
    death = residentDeathFixture();
  const start = applyWorldEvent(
    prepared,
    capturedResidentDeparture(prepared, {
      ...death,
      payload: { ...death.payload, agentId: asAgentId('carrier') },
    }),
  );
  let w: WorldProjection = start;
  const events: Parameters<typeof applyWorldEvent>[1][] = [];
  const commit = (es: typeof events) => {
    w = es.reduce(applyWorldEvent, w);
    events.push(...es);
  };
  commit([enableResidentFreightCustodyEvent({ ...t.context('system'), projection: w })]);
  const run = (actor: string, command: FreightCustodyCommand) => {
    const d = residentFreightCustodyEvent({
      ...t.context(actor),
      projection: w,
      freightId: 'parcel',
      command,
    });
    if (!d.accepted) throw Error(d.reason);
    commit([...d.events]);
  };
  run('source', {
    type: 'propose',
    id: 'recovery',
    nextCarrierId: 'friend',
    vehicleId: 'car',
    expiresAt: 10000,
  });
  for (const [i, role] of (['source', 'recipient', 'payer'] as const).entries())
    run(role, { type: 'consent', id: 'recovery', expectedRevision: i + 1, role });
  run('friend', { type: 'accept', id: 'recovery', expectedRevision: 4 });
  const returned = residentLogisticsEvent({
    ...t.context('friend'),
    projection: w,
    command: {
      type: 'return',
      id: 'parcel',
      expectedRevision: w.logistics!.freight.parcel!.revision,
    },
  });
  if (!returned.accepted) throw Error(returned.reason);
  commit([...returned.events]);
  expect(w.agents.carrier).toBeUndefined();
  expect(w.agents.friend!.balance).toBe(100);
  expect(w.agents.payer!.balance).toBe(97);
  expect(Object.values(w.residentExits!.cash.accounts)[0]!.balance).toBe(103);
  expect(w.materials!.stocks['source-stock']!.inventory).toEqual({ Wood: 8 });
  expect(events.reduce(applyWorldEvent, start)).toEqual(w);
  expect(w.moneySupply).toBe(500);
  expect(Object.values(w.agents).reduce((n, a) => n + a.balance, 103)).toBe(500);
});

test('handoff requires actual co-location, capacity and vehicle authorization; forged physical success is rejected atomically', () => {
  const t = freightWorldFixture({ vehicle: true });
  t.ready();
  t.ok(t.freight('carrier', 'load'));
  const command = handoff(t, true);
  t.commit(t.move('friend'));
  t.arrive('friend');
  const before = structuredClone(t.w);
  expect(command('friend', { type: 'accept', id: 'handoff', expectedRevision: 5 })).toMatchObject({
    accepted: false,
    reason: 'custody-participants-not-present-and-idle',
  });
  const old = t.w.logistics!.custody!.proposals.handoff!;
  const { custody, ...legacyLogistics } = t.w.logistics!;
  expect(custody).toBeDefined();
  const forged = enableResidentFreightCustodyEvent({
    ...t.context('system'),
    projection: { ...t.w, logistics: legacyLogistics },
  });
  if (forged.type !== 'ResidentLogisticsCommitted') throw Error('envelope');
  expect(() =>
    applyWorldEvent(t.w, {
      ...forged,
      payload: {
        ...forged.payload,
        actorId: 'friend',
        custody: {
          version: 'freight-custody-handoff-v1',
          type: 'handoff',
          event: {
            type: 'FreightCustodyHandoffChanged',
            value: {
              ...old,
              revision: 6,
              status: 'accepted',
              lastActorId: 'friend',
              at: t.w.clock.now,
            },
          },
        },
      },
    }),
  ).toThrow('custody-participants-not-present-and-idle');
  expect(t.w).toEqual(before);
  const f = t.w.logistics!.freight.parcel!;
  const atSource: WorldProjection = {
    ...t.w,
    agents: {
      ...t.w.agents,
      friend: {
        ...t.w.agents.friend!,
        locationId: asLocationId('west'),
        inventory: { Wood: 30 },
      },
    },
  };
  expect(freightCustodyTakingFailure(atSource, f, 'carrier', 'friend', undefined)).toBe(
    'custody-personal-load-capacity',
  );
  expect(freightCustodyTakingFailure(atSource, f, 'carrier', 'friend', 'car')).toBe(
    'custody-vehicle-load-capacity',
  );
  expect(freightCustodyTakingFailure(atSource, f, 'carrier', 'friend', 'missing')).toBe(
    'custody-vehicle-not-present-and-authorized',
  );
});

test('old logistics remains unchanged until explicit activation', () => {
  const t = freightWorldFixture();
  t.ready();
  t.ok(t.freight('carrier', 'load'));
  expect(t.w.logistics).not.toHaveProperty('custody');
  expect(
    residentFreightCustodyEvent({
      ...t.context('carrier'),
      freightId: 'parcel',
      command: { type: 'propose', id: 'x', nextCarrierId: 'friend', expiresAt: 1000 },
    }),
  ).toMatchObject({ accepted: false });
  t.ok(t.freight('carrier', 'return'));
  t.replay();
});
