import { describe, expect, it } from 'vitest';
import {
  emptyMobilityState,
  decideMobility,
  applyMobilityEvent,
  advanceMobility,
  nextMobilityBoundary,
  type MobilityCommand,
  type MobilityPorts,
  type MobilityEvent,
} from './index';
function fixture() {
  const seed = emptyMobilityState([
    { id: 'car', ownerId: 'd', authorized: [], seats: 2, locationId: 'a', revision: 1 },
  ]);
  let s = seed;
  let now = 0;
  const locations: Record<string, string> = { d: 'a', r: 'a', x: 'a' };
  const p: MobilityPorts = {
    exists: (id) => id in locations,
    location: (id) => locations[id] ?? null,
    idle: () => true,
    destinationExists: (id) => ['a', 'b', 'c'].includes(id),
    arrivalAt: () => now + 100,
  };
  const events: MobilityEvent[] = [];
  const call = (actor: string, c: MobilityCommand) => {
    const d = decideMobility(s, actor, now, c, p);
    if (d.accepted) {
      s = d.events.reduce(applyMobilityEvent, s);
      events.push(...d.events);
    }
    return d;
  };
  const setup = () => {
    call('d', { type: 'drivers.register', vehicleId: 'car' });
    call('d', { type: 'drivers.online' });
    call('r', { type: 'rides.request', id: 'ride', destinationId: 'b', expiresAt: 1000 });
    call('d', { type: 'rides.quote', id: 'quote', rideId: 'ride', fare: 10, expiresAt: 800 });
  };
  return {
    seed,
    call,
    setup,
    events,
    p,
    locations,
    get state() {
      return s;
    },
    set now(n: number) {
      now = n;
    },
  };
}
describe('mobility commitments', () => {
  it('requires real authorization, validates fare/deadlines and rejects stale revisions', () => {
    const f = fixture();
    expect(f.call('x', { type: 'drivers.register', vehicleId: 'car' })).toMatchObject({
      accepted: false,
    });
    f.setup();
    for (const fare of [0, -1, NaN, Infinity, 10001, 1.5])
      expect(
        f.call('d', { type: 'rides.quote', id: 'bad', rideId: 'ride', fare, expiresAt: 500 }),
      ).toMatchObject({ accepted: false, reason: 'invalid-quote' });
    expect(
      f.call('r', { type: 'rides.book', id: 'ride', quoteId: 'quote', expectedRevision: 2 }),
    ).toMatchObject({ accepted: false, reason: 'revision-conflict' });
    f.now = 800;
    expect(
      f.call('r', { type: 'rides.book', id: 'ride', quoteId: 'quote', expectedRevision: 1 }),
    ).toMatchObject({ accepted: false, reason: 'quote-not-available' });
  });
  it('reserves once, moves actual parties, completes only after arrival and replays exactly', () => {
    const f = fixture();
    f.setup();
    expect(
      f.call('r', { type: 'rides.book', id: 'ride', quoteId: 'quote', expectedRevision: 1 }),
    ).toMatchObject({ accepted: true, fares: [{ kind: 'fund' }] });
    expect(
      f.call('d', { type: 'vehicles.authorize', id: 'car', residentId: 'x', expectedRevision: 1 }),
    ).toMatchObject({ accepted: false, reason: 'vehicle-busy' });
    expect(f.call('x', { type: 'rides.board', id: 'ride', expectedRevision: 2 })).toMatchObject({
      accepted: false,
    });
    f.call('d', { type: 'rides.pickup', id: 'ride', expectedRevision: 2 });
    f.call('r', { type: 'rides.board', id: 'ride', expectedRevision: 3 });
    expect(f.state.vehicles.car?.journey).toEqual({
      from: 'a',
      to: 'b',
      people: ['d', 'r'],
      departedAt: 0,
      arrivesAt: 100,
    });
    expect(nextMobilityBoundary(f.state, 0)).toBe(100);
    expect(f.call('r', { type: 'rides.cancel', id: 'ride', expectedRevision: 4 })).toMatchObject({
      accepted: false,
    });
    expect(advanceMobility(f.state, 100, f.p)).toMatchObject({ events: [], fares: [] });
    f.locations.d = 'b';
    f.locations.r = 'b';
    const done = advanceMobility(f.state, 100, f.p);
    expect(done).toMatchObject({ accepted: true, fares: [{ kind: 'pay' }] });
    if (!done.accepted) throw Error('unexpected');
    const state = done.events.reduce(applyMobilityEvent, f.state);
    expect(state.rides.ride?.status).toBe('completed');
    expect(state.vehicles.car?.locationId).toBe('b');
    expect(advanceMobility(state, 200, f.p)).toMatchObject({ events: [], fares: [] });
    expect([...f.events, ...done.events].reduce(applyMobilityEvent, f.seed)).toEqual(state);
  });
  it('cancellation refunds while pickup vehicle continues until arrival', () => {
    const f = fixture();
    f.locations.r = 'c';
    f.setup();
    f.call('r', { type: 'rides.book', id: 'ride', quoteId: 'quote', expectedRevision: 1 });
    f.call('d', { type: 'rides.pickup', id: 'ride', expectedRevision: 2 });
    expect(f.call('r', { type: 'rides.cancel', id: 'ride', expectedRevision: 3 })).toMatchObject({
      accepted: true,
      fares: [{ kind: 'refund' }],
    });
    expect(f.state.vehicles.car?.journey?.to).toBe('c');
    expect(f.call('d', { type: 'drivers.register', vehicleId: 'car' })).toMatchObject({
      accepted: false,
    });
    f.locations.d = 'c';
    const result = advanceMobility(f.state, 100, f.p);
    expect(result).toMatchObject({ accepted: true, fares: [] });
    if (result.accepted)
      expect(result.events.reduce(applyMobilityEvent, f.state).vehicles.car).toMatchObject({
        locationId: 'c',
      });
  });
  it('expires unboarded orders, validates seeds and does not auto-register', () => {
    expect(() =>
      emptyMobilityState([
        { id: 'v', ownerId: 'd', authorized: [], seats: 1, revision: 1, locationId: 'a' },
      ]),
    ).toThrow('invalid-vehicle-seed');
    const f = fixture();
    expect(f.state.drivers).toEqual({});
    f.setup();
    f.call('r', { type: 'rides.book', id: 'ride', quoteId: 'quote', expectedRevision: 1 });
    expect(advanceMobility(f.state, 1000, f.p)).toMatchObject({
      accepted: true,
      fares: [{ kind: 'refund' }],
      events: [{ type: 'RideChanged', value: { status: 'cancelled', at: 1000 } }],
    });
  });
});
