import { expect, test } from 'vitest';
import {
  emptyMobilityState,
  decideMobility,
  applyMobilityEvent,
  advanceMobility,
  nextMobilityBoundary,
  interruptVehicleJourney,
  type MobilityPorts,
} from './index';
const ports: MobilityPorts = {
  exists: () => true,
  location: () => 'a',
  idle: () => true,
  destinationExists: () => true,
  arrivalAt: () => 100,
};
function fixture() {
  const seed = emptyMobilityState([
    { id: 'car', ownerId: 'driver', authorized: [], seats: 2, locationId: 'a', revision: 1 },
  ]);
  const d = decideMobility(
    seed,
    'driver',
    0,
    { type: 'vehicles.drive', id: 'car', destinationId: 'b', expectedRevision: 1 },
    ports,
  );
  if (!d.accepted) throw Error(d.reason);
  return d.events.reduce(applyMobilityEvent, seed);
}
const source = (stoppedAt: number) => ({
  executor: 'system' as const,
  participantId: 'driver',
  populationEventId: 'death-driver',
  populationPolicyVersion: 'starvation-v1',
  populationType: 'AgentDied' as const,
  stoppedAt,
});
for (const at of [0, 50, 99])
  test(`interruption preserves route and stops automatic arrival at ${at}`, () => {
    const s = fixture(),
      before = structuredClone(s);
    const d = interruptVehicleJourney({
      state: s,
      vehicleId: 'car',
      expectedRevision: 2,
      source: source(at),
    });
    if (!d.accepted) throw Error(d.reason);
    const after = applyMobilityEvent(s, d.event);
    expect(after.vehicles.car).toEqual({
      ...s.vehicles.car,
      revision: 3,
      journey: {
        ...s.vehicles.car!.journey,
        interruption: { ...source(at), version: 'vehicle-journey-interruption-v1', elapsedMs: at },
      },
    });
    expect(after.rides).toEqual(s.rides);
    expect(after.drivers).toEqual(s.drivers);
    expect(after.quotes).toEqual(s.quotes);
    expect(advanceMobility(after, 200, { ...ports, location: () => 'b' })).toEqual({
      accepted: true,
      events: [],
      fares: [],
    });
    expect(nextMobilityBoundary(after, at)).toBeUndefined();
    expect(applyMobilityEvent(structuredClone(s), structuredClone(d.event))).toEqual(after);
    expect(() => applyMobilityEvent(after, d.event)).toThrow(
      'invalid-vehicle-journey-interruption',
    );
    expect(() =>
      applyMobilityEvent(s, {
        ...d.event,
        value: {
          ...d.event.value,
          interruption: { ...d.event.value.interruption, elapsedMs: at + 1 },
        },
      }),
    ).toThrow();
    expect(() =>
      applyMobilityEvent(s, { type: 'VehicleChanged', value: after.vehicles.car! }),
    ).toThrow('interrupted-vehicle-requires-resumption-protocol');
    expect(() =>
      applyMobilityEvent(after, {
        type: 'VehicleChanged',
        value: { ...s.vehicles.car!, revision: 4 },
      }),
    ).toThrow('interrupted-vehicle-requires-resumption-protocol');
    expect(
      interruptVehicleJourney({
        state: after,
        vehicleId: 'car',
        expectedRevision: 3,
        source: source(at),
      }).accepted,
    ).toBe(false);
    expect(s).toEqual(before);
  });
test('invalid subject, stale revision and outside active interval cannot interrupt; migration has explicit provenance', () => {
  const s = fixture();
  for (const at of [-1, 100, 101, NaN, 0.5])
    expect(
      interruptVehicleJourney({
        state: s,
        vehicleId: 'car',
        expectedRevision: 2,
        source: source(at),
      }).accepted,
    ).toBe(false);
  for (const change of [
    { participantId: 'other' },
    { populationEventId: '' },
    { populationPolicyVersion: '' },
  ])
    expect(
      interruptVehicleJourney({
        state: s,
        vehicleId: 'car',
        expectedRevision: 2,
        source: { ...source(50), ...change },
      }).accepted,
    ).toBe(false);
  expect(
    interruptVehicleJourney({ state: s, vehicleId: 'car', expectedRevision: 1, source: source(50) })
      .accepted,
  ).toBe(false);
  const d = interruptVehicleJourney({
    state: s,
    vehicleId: 'car',
    expectedRevision: 2,
    source: {
      ...source(50),
      populationType: 'AgentEmigrated',
      populationEventId: 'migration-driver',
    },
  });
  expect(d.accepted).toBe(true);
});

test('interrupted pickup retains the ride and escrow responsibility instead of expiring or refunding it', () => {
  let s = emptyMobilityState([
    { id: 'car', ownerId: 'driver', authorized: [], seats: 2, locationId: 'a', revision: 1 },
  ]);
  const p: MobilityPorts = { ...ports, location: (id) => (id === 'rider' ? 'b' : 'a') };
  const run = (actor: string, command: Parameters<typeof decideMobility>[3]) => {
    const d = decideMobility(s, actor, 0, command, p);
    if (!d.accepted) throw Error(d.reason);
    s = d.events.reduce(applyMobilityEvent, s);
  };
  run('driver', { type: 'drivers.register', vehicleId: 'car' });
  run('driver', { type: 'drivers.online' });
  run('rider', { type: 'rides.request', id: 'ride', destinationId: 'c', expiresAt: 1000 });
  run('driver', { type: 'rides.quote', id: 'quote', rideId: 'ride', fare: 10, expiresAt: 800 });
  run('rider', { type: 'rides.book', id: 'ride', quoteId: 'quote', expectedRevision: 1 });
  run('driver', { type: 'rides.pickup', id: 'ride', expectedRevision: 2 });
  const d = interruptVehicleJourney({
    state: s,
    vehicleId: 'car',
    expectedRevision: 2,
    source: source(50),
  });
  if (!d.accepted) throw Error(d.reason);
  const after = applyMobilityEvent(s, d.event);
  expect(after.rides.ride).toEqual(s.rides.ride);
  expect(after.rides.ride).toMatchObject({ status: 'pickup', fare: 10 });
  expect(advanceMobility(after, 2000, { ...p, location: () => 'b' })).toEqual({
    accepted: true,
    events: [],
    fares: [],
  });
  expect(nextMobilityBoundary(after, 50)).toBeUndefined();
});
