import { expect, test } from 'vitest';
import { personalControlAuthorization, type ControlCommand } from '@aivilization/authority';
import {
  emptyServicesState,
  applyServicesEvent,
  STAFFED_SERVICES_POLICY,
  SERVICES_POLICY,
  CONTINUOUS_SERVICES_POLICY,
  type ServicesCommand,
  type ServicesEvent,
} from './model';
import { decideServices } from './aggregate';
import { decideServiceControl } from './serviceControl';
import { SERVICE_CONTROL_POLICY } from './serviceControlModel';
import { serviceSupply, providerOverlap } from './supply';

function fixture(enterprise = false) {
  const initial = emptyServicesState(STAFFED_SERVICES_POLICY);
  let state = applyServicesEvent(initial, {
      type: 'ServiceControlEnabled',
      policy: SERVICE_CONTROL_POLICY,
    }),
    at = 100;
  const events: ServicesEvent[] = [
    { type: 'ServiceControlEnabled', policy: SERVICE_CONTROL_POLICY },
  ];
  const ports = {
    exists: (id: string) => ['a', 'b', 'c', 'd'].includes(id),
    locationCapacity: () => 5,
    presentAndIdle: () => true,
    controlsEnterprise: () => true,
    employedBy: () => false,
  };
  const call = (actorId: string, command: ServicesCommand) => {
    const d = decideServices(state, actorId, at, command, ports);
    if (d.accepted) {
      state = d.events.reduce(applyServicesEvent, state);
      events.push(...d.events);
    }
    return d;
  };
  call('a', {
    type: 'publish',
    id: 'service',
    kind: 'course',
    locationId: 'square',
    title: '原始标题',
    description: '由居民选择用途',
    capacity: 2,
    ...(enterprise ? { enterpriseId: 'firm' } : {}),
  });
  call('a', {
    type: 'schedule',
    id: 'slot',
    serviceId: 'service',
    start: 100,
    end: 1000,
    capacity: 2,
  });
  const control = (
    actorId: string,
    command: ControlCommand,
    expectedRevision = state.services.service!.revision,
  ) => {
    const d = decideServiceControl({
      state,
      serviceId: 'service',
      actorId,
      at,
      command,
      expectedRevision,
      authorize: personalControlAuthorization(actorId),
      available: (c) => c.kind === 'resident' && ports.exists(c.id),
    });
    if (d.accepted) {
      state = d.events.reduce(applyServicesEvent, state);
      events.push(...d.events);
    }
    return d;
  };
  const offer = () =>
    control('a', {
      type: 'offer',
      expectedVersion: 1,
      target: { kind: 'resident', id: 'b' },
      expiresAt: 800,
      terms: '只交接管理权',
    });
  const accept = () => control('b', { type: 'accept', expectedVersion: 2 });
  return {
    initial,
    ports,
    call,
    control,
    offer,
    accept,
    events,
    get state() {
      return state;
    },
    time: (v: number) => {
      at = v;
    },
  };
}

test('control transfers management while preserving original author, service facts and all appointments', () => {
  const f = fixture();
  f.call('c', { type: 'request', id: 'booking', slotId: 'slot', units: 1 });
  const before = f.state;
  expect(f.offer().accepted).toBe(true);
  expect(f.control('a', { type: 'accept', expectedVersion: 2 })).toMatchObject({
    accepted: false,
    reason: 'resource-controller-authority-required',
  });
  expect(f.accept().accepted).toBe(true);
  expect(f.state.services.service).toMatchObject({
    ...before.services.service,
    revision: 3,
    control: { controller: { kind: 'resident', id: 'b' } },
  });
  expect(f.state.slots).toEqual(before.slots);
  expect(f.state.bookings).toEqual(before.bookings);
  expect(f.call('a', { type: 'accept', id: 'booking', expectedRevision: 1 }).accepted).toBe(false);
  expect(f.call('b', { type: 'accept', id: 'booking', expectedRevision: 1 }).accepted).toBe(true);
  expect(
    f.call('a', {
      type: 'schedule',
      id: 'next',
      serviceId: 'service',
      start: 1100,
      end: 1200,
      capacity: 1,
    }).accepted,
  ).toBe(false);
  expect(
    f.call('b', {
      type: 'schedule',
      id: 'next',
      serviceId: 'service',
      start: 1100,
      end: 1200,
      capacity: 1,
    }).accepted,
  ).toBe(true);
  expect(f.call('b', { type: 'close', id: 'service', expectedRevision: 3 })).toMatchObject({
    accepted: false,
    reason: 'outstanding-bookings',
  });
  expect(f.events.reduce(applyServicesEvent, f.initial)).toEqual(f.state);
});
test('existing actual provider remains until personally leaving; administrator cannot replace or stop that body', () => {
  const f = fixture();
  f.call('a', { type: 'start-session', id: 'slot', expectedRevision: 1, until: 900 });
  f.call('c', { type: 'request', id: 'booking', slotId: 'slot', units: 1 });
  f.call('a', { type: 'accept', id: 'booking', expectedRevision: 1 });
  f.call('c', { type: 'check-in', id: 'booking', expectedRevision: 2, until: 700 });
  f.time(200);
  const before = f.state;
  f.offer();
  f.accept();
  expect(f.state.slots).toEqual(before.slots);
  expect(f.state.bookings).toEqual(before.bookings);
  expect(serviceSupply(f.state, f.state.slots.slot!, 200, f.ports).activeProviderCount).toBe(1);
  expect(f.call('b', { type: 'stop-session', id: 'slot', expectedRevision: 2 })).toMatchObject({
    accepted: false,
    reason: 'own-active-provider-shift-required',
  });
  expect(
    f.call('a', { type: 'start-session', id: 'slot', expectedRevision: 2, until: 900 }).accepted,
  ).toBe(false);
  f.time(300);
  const stop = f.call('a', { type: 'stop-session', id: 'slot', expectedRevision: 2 });
  expect(stop.accepted).toBe(true);
  expect(f.state.bookings.booking).toMatchObject({
    status: 'ended',
    attendedMs: 200,
    providerOverlapMs: 200,
  });
  expect(providerOverlap(f.state.slots.slot!, 100, 900)).toBe(200);
  expect(
    f.call('b', { type: 'start-session', id: 'slot', expectedRevision: 3, until: 800 }),
  ).toMatchObject({ accepted: true, participation: { residentId: 'b' } });
  expect(f.events.reduce(applyServicesEvent, f.initial)).toEqual(f.state);
});
test('version, expiry, cancellation and source authority all reject without changing service state', () => {
  const f = fixture();
  f.offer();
  const before = f.state;
  expect(f.control('b', { type: 'accept', expectedVersion: 1 }).accepted).toBe(false);
  expect(f.control('b', { type: 'accept', expectedVersion: 2 }, 1).accepted).toBe(false);
  expect(f.control('c', { type: 'cancel', expectedVersion: 2 }).accepted).toBe(false);
  f.time(800);
  expect(f.accept()).toMatchObject({ accepted: false, reason: 'control-offer-expired' });
  expect(f.state).toEqual(before);
  expect(f.control('a', { type: 'cancel', expectedVersion: 2 }).accepted).toBe(true);
  expect(f.control('b', { type: 'accept', expectedVersion: 3 }).accepted).toBe(false);
});
test('legacy implicit provider schemas and enterprise affiliation cannot be silently reinterpreted', () => {
  for (const policy of [SERVICES_POLICY, CONTINUOUS_SERVICES_POLICY])
    expect(() =>
      applyServicesEvent(emptyServicesState(policy), {
        type: 'ServiceControlEnabled',
        policy: SERVICE_CONTROL_POLICY,
      }),
    ).toThrow('service-control-requires-recorded-providers');
  const f = fixture(true);
  expect(f.offer()).toMatchObject({
    accepted: false,
    reason: 'enterprise-service-control-integration-required',
  });
  const legacy = emptyServicesState(STAFFED_SERVICES_POLICY);
  expect(
    decideServiceControl({
      state: legacy,
      actorId: 'a',
      serviceId: 'service',
      at: 100,
      expectedRevision: 1,
      command: { type: 'cancel', expectedVersion: 1 },
      authorize: personalControlAuthorization('a'),
      available: () => true,
    }),
  ).toMatchObject({ accepted: false, reason: 'service-control-not-enabled' });
});
test('recorded control facts reject forged identity, controller, timestamps and non-control event bypasses', () => {
  const f = fixture(),
    before = f.state;
  f.offer();
  const event = f.events.at(-1)!;
  if (event.type !== 'ServiceControlChanged') throw Error('fixture');
  for (const control of [
    { ...event.control, changedBy: 'c' },
    { ...event.control, version: 9 },
    { ...event.control, at: -1 },
    { ...event.control, controller: { kind: 'resident' as const, id: 'b' } },
    { ...event.control, offer: { ...event.control.offer!, offeredBy: 'c' } },
  ])
    expect(() => applyServicesEvent(before, { ...event, control })).toThrow();
  expect(() =>
    applyServicesEvent(before, {
      type: 'ServiceChanged',
      service: { ...before.services.service!, revision: 2, control: event.control },
    }),
  ).toThrow('service-control-event-required');
  expect(() =>
    applyServicesEvent(before, {
      type: 'ServiceChanged',
      service: { ...before.services.service!, revision: 2, ownerId: 'b' },
    }),
  ).toThrow('service-control-event-required');
});
