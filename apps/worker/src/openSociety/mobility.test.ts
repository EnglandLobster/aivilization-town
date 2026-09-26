import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { commerceEscrowBalance } from '@aivilization/commerce';
import { residentMobilityCommand } from '@aivilization/world';
import { OpenSocietyRuntime } from './runtime';
import { createOpenSocietyManifest } from './manifest';
import { residentLifeInbox } from './lifeContext';
const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const f of cleanup.reverse()) f();
  cleanup.length = 0;
});
function setup(continuity = true) {
  const root = mkdtempSync(join(tmpdir(), 'mobility-'));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const r = new OpenSocietyRuntime(
    root,
    createOpenSocietyManifest({ count: 4, continuity, initialization: 'newcomers' }),
  );
  cleanup.push(() => r.close());
  const [a, b, c, d] = r.manifest.residents.map((x) => x.id) as [string, string, string, string];
  let n = 0;
  const call = (actor: string, name: string, args: Record<string, unknown> = {}) => {
    r.beginTurn(actor);
    const result = r.invoke(actor, { name, arguments: args, requestId: `call-${++n}` });
    r.finishTurn(actor, { summary: 'test' });
    return result;
  };
  const ok = (actor: string, name: string, args: Record<string, unknown> = {}) => {
    const result = call(actor, name, args);
    expect(result.ok, `${name}: ${result.error}`).toBe(true);
    return result.data;
  };
  const prepare = (id = 'ride', rider = b) => {
    ok(a, 'drivers.register', { vehicleId: 'seed-car-1' });
    ok(a, 'drivers.online');
    ok(rider, 'rides.request', {
      id,
      destinationId: 'school',
      expiresAt: r.state.world.clock.now + 600000,
    });
    ok(a, 'rides.quote', {
      id: `q-${id}`,
      rideId: id,
      fare: 10,
      expiresAt: r.state.world.clock.now + 500000,
    });
  };
  const replay = () => {
    const before = structuredClone(r.state),
      bytes = readFileSync(join(root, 'journal.jsonl'));
    r.close();
    const reopened = new OpenSocietyRuntime(root);
    cleanup.push(() => reopened.close());
    expect(reopened.state).toEqual(before);
    expect(readFileSync(join(root, 'journal.jsonl'))).toEqual(bytes);
  };
  return { r, a, b, c, d, call, ok, prepare, replay };
}
test('shared travel settles fixed escrow once, preserves supply, limits context and replays journal', () => {
  const { r, a, b, c, call, ok, prepare, replay } = setup();
  prepare();
  const before = {
    a: r.state.world.agents[a]!.balance,
    b: r.state.world.agents[b]!.balance,
    supply: r.state.world.moneySupply,
  };
  ok(b, 'rides.book', { id: 'ride', quoteId: 'q-ride', expectedRevision: 1 });
  expect(r.state.world.agents[b]!.balance).toBe(before.b - 10);
  expect(commerceEscrowBalance(r.state.world.residentCommerce!)).toBe(10);
  expect(
    call(b, 'deposits.settle', { id: 'ride-deposit-ride', expectedRevision: 1 }),
  ).toMatchObject({ ok: false, error: 'ride-deposit-controlled-by-mobility' });
  expect(call(a, 'deposits.release', { id: 'ride-deposit-ride', expectedRevision: 1 }).ok).toBe(
    false,
  );
  expect(call(c, 'rides.read', { id: 'ride' }).ok).toBe(false);
  expect(residentLifeInbox(r.state, b, 6).items.some((x) => x.id === 'ride')).toBe(true);
  expect(residentLifeInbox(r.state, c, 6).items.some((x) => x.id === 'ride')).toBe(false);
  ok(a, 'rides.pickup', { id: 'ride', expectedRevision: 2 });
  ok(b, 'rides.board', { id: 'ride', expectedRevision: 3 });
  const driver = r.state.world.transitByAgent![a]!,
    rider = r.state.world.transitByAgent![b]!;
  expect(driver.arrivesAt).toBe(rider.arrivesAt);
  expect(driver.routeLocationIds).toEqual(rider.routeLocationIds);
  expect(driver.departedAt).toBe(rider.departedAt);
  expect(call(b, 'world.move', { targetLocationId: 'town-square' }).ok).toBe(false);
  expect(call(a, 'rides.cancel', { id: 'ride', expectedRevision: 4 }).ok).toBe(false);
  expect(r.advanceTime(driver.arrivesAt - r.state.world.clock.now, 'arrive').ok).toBe(true);
  expect(r.state.world.agents[a]!.locationId).toBe('school');
  expect(r.state.world.agents[b]!.locationId).toBe('school');
  expect(r.state.world.residentMobility!.vehicles['seed-car-1']).toMatchObject({
    locationId: 'school',
  });
  expect(r.state.world.residentMobility!.vehicles['seed-car-1']!.journey).toBeUndefined();
  expect(r.state.world.residentMobility!.rides.ride!.status).toBe('completed');
  expect(r.state.world.agents[a]!.balance).toBe(before.a + 10);
  expect(r.state.world.agents[b]!.balance).toBe(before.b - 10);
  expect(commerceEscrowBalance(r.state.world.residentCommerce!)).toBe(0);
  expect(r.state.world.moneySupply).toBe(before.supply);
  const state = structuredClone(r.state);
  r.advanceTime(driver.arrivesAt, 'arrive');
  expect(r.state).toEqual(state);
  for (const id of [a, b])
    expect(
      r.state.experiences[id]!.some(
        (x) => x.summary.includes('ResidentMobilityCommitted') && x.summary.includes('completed'),
      ),
    ).toBe(true);
  expect(
    r.state.experiences[c]?.some((x) => x.summary.includes('ride-deposit-ride')) ?? false,
  ).toBe(false);
  replay();
});
test('insufficient funds, capacity and conflicting reservations have no partial world effects', () => {
  const { r, a, b, c, call, ok, prepare } = setup();
  prepare();
  const w = r.state.world;
  const poor = { ...w, agents: { ...w.agents, [b]: { ...w.agents[b]!, balance: 0 } } };
  const reject = residentMobilityCommand({
    projection: poor,
    actorId: b,
    command: { type: 'rides.book', id: 'ride', quoteId: 'q-ride', expectedRevision: 1 },
    simulationId: 'test',
    requestId: 'poor',
    nextSequence: 100,
  });
  expect(reject).toEqual({ accepted: false, reason: 'insufficient-balance' });
  expect(poor.residentMobility!.rides.ride!.status).toBe('requested');
  ok(b, 'rides.book', { id: 'ride', quoteId: 'q-ride', expectedRevision: 1 });
  ok(c, 'rides.request', { id: 'other', destinationId: 'school', expiresAt: 600000 });
  expect(
    call(a, 'rides.quote', { id: 'other-q', rideId: 'other', fare: 1, expiresAt: 500000 }),
  ).toMatchObject({ ok: false, error: 'driver-or-vehicle-busy' });
  ok(a, 'rides.pickup', { id: 'ride', expectedRevision: 2 });
  const full = {
    ...r.state.world,
    locations: {
      ...r.state.world.locations,
      school: { ...r.state.world.locations.school!, capacity: 1 },
    },
  };
  expect(
    residentMobilityCommand({
      projection: full,
      actorId: b,
      command: { type: 'rides.board', id: 'ride', expectedRevision: 3 },
      simulationId: 'test',
      requestId: 'full',
      nextSequence: 100,
    }),
  ).toEqual({ accepted: false, reason: 'destination-or-route-unavailable' });
  expect(r.state.world.residentMobility!.rides.ride!.status).toBe('ready');
  ok(a, 'rides.cancel', { id: 'ride', expectedRevision: 3 });
  expect(commerceEscrowBalance(r.state.world.residentCommerce!)).toBe(0);
});
test('cancelling during real pickup refunds without teleportation and releases vehicle only on arrival', () => {
  const { r, a, b, ok, call } = setup();
  ok(b, 'world.move', { targetLocationId: 'school' });
  let arrival = r.state.world.transitByAgent![b]!.arrivesAt;
  r.advanceTime(arrival, 'rider-move');
  ok(a, 'drivers.register', { vehicleId: 'seed-car-1' });
  ok(a, 'drivers.online');
  ok(b, 'rides.request', {
    id: 'ride',
    destinationId: 'town-square',
    expiresAt: r.state.world.clock.now + 3600000,
  });
  ok(a, 'rides.quote', {
    id: 'quote',
    rideId: 'ride',
    fare: 10,
    expiresAt: r.state.world.clock.now + 3500000,
  });
  ok(b, 'rides.book', { id: 'ride', quoteId: 'quote', expectedRevision: 1 });
  ok(a, 'rides.pickup', { id: 'ride', expectedRevision: 2 });
  arrival = r.state.world.transitByAgent![a]!.arrivesAt;
  ok(b, 'rides.cancel', { id: 'ride', expectedRevision: 3 });
  expect(r.state.world.agents[a]!.locationId).toBe('town-square');
  expect(r.state.world.residentMobility!.vehicles['seed-car-1']!.journey).toBeDefined();
  expect(commerceEscrowBalance(r.state.world.residentCommerce!)).toBe(0);
  expect(call(a, 'drivers.register', { vehicleId: 'seed-car-1' }).ok).toBe(false);
  r.advanceTime(arrival - r.state.world.clock.now, 'pickup-arrival');
  expect(r.state.world.residentMobility!.vehicles['seed-car-1']!.locationId).toBe('school');
  ok(a, 'drivers.register', { vehicleId: 'seed-car-1' });
});
test('deadline refunds are equivalent across time steps; old manifests remain disabled', () => {
  const x = setup(),
    y = setup();
  for (const f of [x, y]) {
    f.prepare();
    f.ok(f.b, 'rides.book', { id: 'ride', quoteId: 'q-ride', expectedRevision: 1 });
  }
  x.r.advanceTime(700000, 'large');
  y.r.advanceTime(600000, 'boundary');
  y.r.advanceTime(100000, 'tail');
  expect(x.r.state.world.residentMobility).toEqual(y.r.state.world.residentMobility);
  expect(x.r.state.world.residentCommerce).toEqual(y.r.state.world.residentCommerce);
  expect(commerceEscrowBalance(x.r.state.world.residentCommerce!)).toBe(0);
  x.replay();
  const old = setup(false);
  expect(old.r.state.world.residentMobility).toBeUndefined();
  expect(old.call(old.a, 'drivers.online')).toMatchObject({
    ok: false,
    error: 'mobility-not-enabled',
  });
  old.ok(old.b, 'deposits.lock', {
    id: 'ride-deposit-legacy',
    beneficiaryId: old.a,
    amount: 1,
    purpose: 'Legacy ordinary deposit',
  });
  old.ok(old.a, 'deposits.release', { id: 'ride-deposit-legacy', expectedRevision: 1 });
  old.replay();
});

test('vehicle owner permissions can be revoked; driver walking does not transport a parked car', () => {
  const { r, a, b, c, ok, call } = setup();
  ok(a, 'vehicles.authorize', { id: 'seed-car-1', residentId: b, expectedRevision: 1 });
  ok(b, 'drivers.register', { vehicleId: 'seed-car-1' });
  ok(b, 'drivers.online');
  ok(c, 'rides.request', { id: 'trip', destinationId: 'school', expiresAt: 3600000 });
  ok(b, 'rides.quote', { id: 'quote', rideId: 'trip', fare: 1, expiresAt: 3500000 });
  ok(a, 'vehicles.revoke', { id: 'seed-car-1', residentId: b, expectedRevision: 2 });
  expect(
    call(c, 'rides.book', { id: 'trip', quoteId: 'quote', expectedRevision: 1 }),
  ).toMatchObject({ ok: false, error: 'driver-not-available' });
  ok(a, 'vehicles.authorize', { id: 'seed-car-1', residentId: b, expectedRevision: 3 });
  ok(b, 'world.move', { targetLocationId: 'school' });
  r.advanceTime(r.state.world.transitByAgent![b]!.arrivesAt, 'walk');
  expect(r.state.world.residentMobility!.vehicles['seed-car-1']!.locationId).toBe('town-square');
  ok(c, 'rides.book', { id: 'trip', quoteId: 'quote', expectedRevision: 1 });
  expect(call(b, 'rides.pickup', { id: 'trip', expectedRevision: 2 })).toMatchObject({
    ok: false,
    error: 'driver-must-be-at-idle-vehicle',
  });
  ok(c, 'rides.cancel', { id: 'trip', expectedRevision: 2 });
});

test('physical pickup arrival makes ready, then both return along one real route', () => {
  const { r, a, b, ok } = setup();
  ok(b, 'world.move', { targetLocationId: 'school' });
  r.advanceTime(r.state.world.transitByAgent![b]!.arrivesAt, 'walk');
  ok(a, 'drivers.register', { vehicleId: 'seed-car-1' });
  ok(a, 'drivers.online');
  const deadline = r.state.world.clock.now + 3600000;
  ok(b, 'rides.request', { id: 'trip', destinationId: 'town-square', expiresAt: deadline });
  ok(a, 'rides.quote', { id: 'quote', rideId: 'trip', fare: 10, expiresAt: deadline });
  ok(b, 'rides.book', { id: 'trip', quoteId: 'quote', expectedRevision: 1 });
  ok(a, 'rides.pickup', { id: 'trip', expectedRevision: 2 });
  r.advanceTime(r.state.world.transitByAgent![a]!.arrivesAt - r.state.world.clock.now, 'pickup');
  expect(r.state.world.residentMobility!.rides.trip!.status).toBe('ready');
  expect(r.state.world.residentMobility!.vehicles['seed-car-1']!.locationId).toBe('school');
  ok(b, 'rides.board', { id: 'trip', expectedRevision: 4 });
  r.advanceTime(r.state.world.transitByAgent![a]!.arrivesAt - r.state.world.clock.now, 'return');
  expect(r.state.world.residentMobility!.rides.trip!.status).toBe('completed');
  expect(r.state.world.agents[b]!.locationId).toBe('town-square');
});
