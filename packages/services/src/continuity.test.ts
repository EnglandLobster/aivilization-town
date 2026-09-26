import { expect, test } from 'vitest';
import { decideServices, advanceServices } from './aggregate';
import {
  CONTINUOUS_SERVICES_POLICY,
  emptyServicesState,
  applyServicesEvent,
  type ServicesCommand,
  type ServicesEvent,
} from './model';

test('hosted attendance needs an actual provider; late/partial participation ends with measured facts and can leave', () => {
  let state = emptyServicesState(CONTINUOUS_SERVICES_POLICY);
  const events: ServicesEvent[] = [];
  const ports = { exists: () => true, locationCapacity: () => 5, presentAndIdle: () => true };
  const call = (a: string, at: number, c: ServicesCommand) => {
    const d = decideServices(state, a, at, c, ports);
    if (d.accepted) {
      events.push(...d.events);
      state = d.events.reduce(applyServicesEvent, state);
    }
    return d;
  };
  expect(
    call('host', 0, {
      type: 'publish',
      id: 's',
      kind: 'appointment',
      locationId: 'room',
      title: '交流',
      description: '自愿参加',
      capacity: 5,
    }).accepted,
  ).toBe(true);
  call('host', 0, {
    type: 'schedule',
    id: 'slot',
    serviceId: 's',
    start: 1000,
    end: 3601000,
    capacity: 5,
  });
  call('guest', 0, { type: 'request', id: 'b', slotId: 'slot', units: 1 });
  call('host', 0, { type: 'accept', id: 'b', expectedRevision: 1 });
  expect(call('guest', 1000, { type: 'check-in', id: 'b', expectedRevision: 2 })).toMatchObject({
    accepted: false,
    reason: 'provider-session-not-active',
  });
  expect(
    call('guest', 1000, { type: 'start-session', id: 'slot', expectedRevision: 1 }).accepted,
  ).toBe(false);
  expect(
    call('host', 1000, { type: 'start-session', id: 'slot', expectedRevision: 1 }),
  ).toMatchObject({ accepted: true, participation: { until: 3601000 } });
  expect(call('guest', 3600000, { type: 'check-in', id: 'b', expectedRevision: 2 })).toMatchObject({
    accepted: true,
  });
  const ended = advanceServices(state, 3601000).reduce(applyServicesEvent, state);
  expect(ended.bookings.b).toMatchObject({
    status: 'ended',
    attendedMs: 1000,
    providerOverlapMs: 1000,
  });
  expect(call('guest', 3600500, { type: 'leave', id: 'b', expectedRevision: 3 })).toMatchObject({
    accepted: true,
    release: { startedAt: 3600000, expectedUntil: 3601000 },
  });
  expect(state.bookings.b).toMatchObject({ status: 'ended', attendedMs: 500 });
  expect(advanceServices(state, 4000000)).toEqual([]);
  expect(events.reduce(applyServicesEvent, emptyServicesState(CONTINUOUS_SERVICES_POLICY))).toEqual(
    state,
  );
});

test('self-service facilities require no human host, preserve v1 meaning and reject invalid time commitments', () => {
  let s = emptyServicesState(CONTINUOUS_SERVICES_POLICY);
  const p = { exists: () => true, locationCapacity: () => 10, presentAndIdle: () => true };
  const step = (a: string, at: number, c: ServicesCommand) => {
    const d = decideServices(s, a, at, c, p);
    if (d.accepted) s = d.events.reduce(applyServicesEvent, s);
    return d;
  };
  step('host', 0, {
    type: 'publish',
    id: 's',
    kind: 'event',
    locationId: 'square',
    title: '散步集合',
    description: '随时可离开',
    capacity: 10,
  });
  step('host', 0, { type: 'schedule', id: 't', serviceId: 's', start: 1, end: 100, capacity: 10 });
  step('guest', 0, { type: 'request', id: 'b', slotId: 't', units: 1 });
  step('host', 0, { type: 'accept', id: 'b', expectedRevision: 1 });
  expect(
    step('guest', 1, { type: 'check-in', id: 'b', expectedRevision: 2, until: 101 }).accepted,
  ).toBe(false);
  expect(
    step('guest', 1, { type: 'check-in', id: 'b', expectedRevision: 2, until: 50 }).accepted,
  ).toBe(true);
  const full = advanceServices(s, 100).reduce(applyServicesEvent, s);
  const half = advanceServices(s, 50).reduce(applyServicesEvent, s);
  expect(advanceServices(half, 100).reduce(applyServicesEvent, half)).toEqual(full);
  expect(full.bookings.b).toMatchObject({ status: 'ended', attendedMs: 49, providerOverlapMs: 0 });
  const legacy = {
    ...s,
    policy: { ...s.policy, version: 'resident-services-v1' as const },
    bookings: { b: { ...s.bookings.b!, attendingUntil: 100 } },
  };
  expect(advanceServices(legacy, 100)[0]).toMatchObject({ booking: { status: 'completed' } });
});
