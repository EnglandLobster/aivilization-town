import { expect, test } from 'vitest';
import { decideServices, advanceServices } from './aggregate';
import {
  applyServicesEvent,
  emptyServicesState,
  STAFFED_SERVICES_POLICY,
  CONTINUOUS_SERVICES_POLICY,
  type ServicesCommand,
  type ServicesEvent,
  type ServicesPolicy,
} from './model';
import { serviceSupply, personalProviderOverlap } from './supply';

function fixture(policy: ServicesPolicy = STAFFED_SERVICES_POLICY) {
  let state = emptyServicesState(policy);
  const events: ServicesEvent[] = [];
  const employees = new Set(['staff', 'second']);
  const ports = {
    exists: () => true,
    locationCapacity: () => 4,
    presentAndIdle: () => true,
    controlsEnterprise: (a: string, id: string) => a === 'host' && id === 'firm',
    employedBy: (a: string, id: string) => id === 'firm' && employees.has(a),
  };
  const call = (a: string, at: number, c: ServicesCommand) => {
    const d = decideServices(state, a, at, c, ports);
    if (d.accepted) {
      events.push(...d.events);
      state = d.events.reduce(applyServicesEvent, state);
    }
    return d;
  };
  const ok = (a: string, at: number, c: ServicesCommand) => {
    const d = call(a, at, c);
    expect(d.accepted, JSON.stringify(d)).toBe(true);
    return d;
  };
  const prepare = () => {
    ok('host', 0, {
      type: 'publish',
      id: 'svc',
      kind: 'course',
      locationId: 'room',
      title: '共同授课',
      description: '自主参加',
      capacity: 4,
      ...(policy.version === 'resident-services-v3' ? { enterpriseId: 'firm' } : {}),
    });
    ok('host', 0, {
      type: 'schedule',
      id: 'slot',
      serviceId: 'svc',
      start: 1,
      end: 100,
      capacity: 4,
    });
  };
  const book = (id: string, units = 1) => {
    ok(id, 0, { type: 'request', id, slotId: 'slot', units });
    ok('host', 0, { type: 'accept', id, expectedRevision: 1 });
  };
  return {
    get s() {
      return state;
    },
    ports,
    employees,
    events,
    call,
    ok,
    prepare,
    book,
  };
}

test('v3 validates declared staffing, enterprise authority and actual independent participation; v2 keeps old semantics', () => {
  const f = fixture();
  for (const unitsPerProvider of [0, -1, 1.5, Infinity, 101])
    expect(
      f.call('host', 0, {
        type: 'publish',
        id: 'bad',
        kind: 'appointment',
        locationId: 'room',
        title: 'x',
        description: 'x',
        capacity: 4,
        unitsPerProvider,
      }).accepted,
    ).toBe(false);
  expect(
    f.call('other', 0, {
      type: 'publish',
      id: 'bad',
      kind: 'appointment',
      locationId: 'room',
      title: 'x',
      description: 'x',
      capacity: 4,
      enterpriseId: 'firm',
    }),
  ).toMatchObject({ accepted: false, reason: 'enterprise-owner-required' });
  f.prepare();
  f.book('guest');
  expect(
    f.call('other', 1, { type: 'start-session', id: 'slot', expectedRevision: 1 }),
  ).toMatchObject({ accepted: false, reason: 'service-provider-required' });
  expect(f.call('guest', 1, { type: 'check-in', id: 'guest', expectedRevision: 2 }).accepted).toBe(
    false,
  );
  f.employees.delete('staff');
  expect(
    f.call('staff', 1, { type: 'start-session', id: 'slot', expectedRevision: 1 }).accepted,
  ).toBe(false);
  f.employees.add('staff');
  f.ok('staff', 1, { type: 'start-session', id: 'slot', expectedRevision: 1 });
  expect(serviceSupply(f.s, f.s.slots.slot!, 1, f.ports)).toMatchObject({
    capacity: 1,
    nominalCapacity: 4,
  });
  expect(
    f.call('host', 2, { type: 'stop-session', id: 'slot', expectedRevision: 2 }),
  ).toMatchObject({ accepted: false, reason: 'own-active-provider-shift-required' });
  const legacy = fixture(CONTINUOUS_SERVICES_POLICY);
  legacy.prepare();
  legacy.book('guest', 4);
  legacy.ok('host', 1, { type: 'start-session', id: 'slot', expectedRevision: 1 });
  legacy.ok('guest', 1, { type: 'check-in', id: 'guest', expectedRevision: 2 });
  expect(
    legacy.call('host', 2, { type: 'stop-session', id: 'slot', expectedRevision: 2 }).accepted,
  ).toBe(false);
});

test('staffing covers the whole requested interval; early departure releases interrupted attendees and can restart', () => {
  const f = fixture();
  f.prepare();
  f.book('guest', 2);
  f.book('other');
  f.ok('host', 1, { type: 'start-session', id: 'slot', expectedRevision: 1, until: 50 });
  f.ok('staff', 1, { type: 'start-session', id: 'slot', expectedRevision: 2, until: 100 });
  expect(
    f.call('guest', 10, { type: 'check-in', id: 'guest', expectedRevision: 2, until: 100 }),
  ).toMatchObject({ accepted: false, reason: 'insufficient-provider-capacity' });
  f.ok('guest', 10, { type: 'check-in', id: 'guest', expectedRevision: 2, until: 50 });
  expect(
    f.call('other', 10, { type: 'check-in', id: 'other', expectedRevision: 2, until: 50 }).accepted,
  ).toBe(false);
  const stopped = f.ok('host', 20, { type: 'stop-session', id: 'slot', expectedRevision: 3 });
  expect(stopped).toMatchObject({
    releases: [
      { residentId: 'host', startedAt: 1, expectedUntil: 50 },
      { residentId: 'guest', startedAt: 10, expectedUntil: 50 },
    ],
  });
  expect(f.s.bookings.guest).toMatchObject({
    status: 'ended',
    endReason: 'staffing-interrupted',
    attendedMs: 10,
    providerOverlapMs: 10,
  });
  f.ok('host', 30, { type: 'start-session', id: 'slot', expectedRevision: 4 });
  f.ok('other', 30, { type: 'check-in', id: 'other', expectedRevision: 2 });
  expect(personalProviderOverlap(f.s.slots.slot!, 'host', 1, 100)).toBe(89);
  const full = advanceServices(f.s, 100).reduce(applyServicesEvent, f.s);
  const intermediate = advanceServices(f.s, 50).reduce(applyServicesEvent, f.s);
  expect(advanceServices(intermediate, 100).reduce(applyServicesEvent, intermediate)).toEqual(full);
  expect(full.bookings.other).toMatchObject({ providerOverlapMs: 70, attendedMs: 70 });
  expect(f.events.reduce(applyServicesEvent, emptyServicesState(STAFFED_SERVICES_POLICY))).toEqual(
    f.s,
  );
});

test('departure checks future shortages and keeps attendees when remaining coverage is sufficient', () => {
  for (const otherEnd of [80, 100]) {
    const f = fixture();
    f.prepare();
    f.book('guest');
    f.ok('host', 1, { type: 'start-session', id: 'slot', expectedRevision: 1, until: otherEnd });
    f.ok('staff', 1, { type: 'start-session', id: 'slot', expectedRevision: 2 });
    f.ok('guest', 2, { type: 'check-in', id: 'guest', expectedRevision: 2, until: 100 });
    f.ok('staff', 10, { type: 'stop-session', id: 'slot', expectedRevision: 3 });
    expect(f.s.bookings.guest!.status).toBe(otherEnd === 80 ? 'ended' : 'checked-in');
  }
});
