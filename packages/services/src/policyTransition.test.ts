import { expect, test } from 'vitest';
import {
  emptyServicesState,
  applyServicesEvent,
  SERVICES_POLICY,
  CONTINUOUS_SERVICES_POLICY,
  type ServicesCommand,
} from './model';
import { decideServices, advanceServices } from './aggregate';
import { decideServicePolicyUpgrade } from './policyTransition';
const ports = { exists: () => true, locationCapacity: () => 5, presentAndIdle: () => true };
test.each([SERVICES_POLICY, CONTINUOUS_SERVICES_POLICY])(
  'upgrade drains old $version, keeps old attendance facts, and requires new offers',
  (policy) => {
    let s = emptyServicesState(policy);
    const call = (actor: string, at: number, c: ServicesCommand) => {
      const d = decideServices(s, actor, at, c, ports);
      expect(d.accepted).toBe(true);
      if (d.accepted) s = d.events.reduce(applyServicesEvent, s);
    };
    call('host', 0, {
      type: 'publish',
      id: 'old',
      kind: 'event',
      locationId: 'room',
      title: 'old',
      description: 'terms',
      capacity: 2,
    });
    expect(decideServicePolicyUpgrade(s, 0)).toMatchObject({
      accepted: false,
      reason: 'active-services-require-close',
    });
    call('host', 0, {
      type: 'schedule',
      id: 'slot',
      serviceId: 'old',
      start: 0,
      end: 10,
      capacity: 2,
    });
    call('guest', 0, { type: 'request', id: 'booking', slotId: 'slot', units: 1 });
    call('host', 0, { type: 'accept', id: 'booking', expectedRevision: 1 });
    call('guest', 0, { type: 'check-in', id: 'booking', expectedRevision: 2 });
    expect(
      decideServicePolicyUpgrade(
        { ...s, services: { old: { ...s.services.old!, active: false } } },
        1,
      ),
    ).toMatchObject({ accepted: false, reason: 'outstanding-service-bookings' });
    s = advanceServices(s, 10).reduce(applyServicesEvent, s);
    call('host', 10, { type: 'close', id: 'old', expectedRevision: 1 });
    expect(s.bookings.booking?.status).toBe(
      policy.version === 'resident-services-v1' ? 'completed' : 'ended',
    );
    const before = structuredClone(s);
    const d = decideServicePolicyUpgrade(s, 10);
    expect(d.accepted).toBe(true);
    if (!d.accepted) throw Error(d.reason);
    s = d.events.reduce(applyServicesEvent, s);
    expect(s.policy.version).toBe('resident-services-v3');
    expect(s.bookings).toEqual(before.bookings);
    expect(s.services).toEqual(before.services);
    expect(s.slots).toEqual(before.slots);
    expect(d.events.reduce(applyServicesEvent, before)).toEqual(s);
    expect(decideServicePolicyUpgrade(s, 10)).toEqual({ accepted: true, events: [] });
    expect(() =>
      applyServicesEvent(s, {
        type: 'ServiceChanged',
        service: { ...s.services.old!, active: true, revision: 3 },
      }),
    ).toThrow('legacy-service-republication-required');
    call('host', 10, {
      type: 'publish',
      id: 'new',
      kind: 'course',
      locationId: 'room',
      title: 'new',
      description: 'actual teacher',
      capacity: 2,
    });
    expect(s.services.new?.participationMode).toBe('hosted');
    expect(s.services.new?.unitsPerProvider).toBe(1);
    call('host', 10, {
      type: 'schedule',
      id: 'new-slot',
      serviceId: 'new',
      start: 10,
      end: 20,
      capacity: 2,
    });
    call('guest', 10, { type: 'request', id: 'new-booking', slotId: 'new-slot', units: 1 });
    call('host', 10, { type: 'accept', id: 'new-booking', expectedRevision: 1 });
    expect(
      decideServices(
        s,
        'guest',
        10,
        { type: 'check-in', id: 'new-booking', expectedRevision: 2 },
        ports,
      ),
    ).toMatchObject({ accepted: false, reason: 'teacher-session-not-started' });
  },
);
test('upgrade refuses invalid time, waiting queues and actual unfinished provider time', () => {
  const s = emptyServicesState();
  expect(decideServicePolicyUpgrade(s, -1)).toMatchObject({
    accepted: false,
    reason: 'invalid-service-policy-time',
  });
  expect(
    decideServicePolicyUpgrade(
      {
        ...s,
        queues: {
          q: {
            id: 'q',
            serviceId: 'old',
            residentId: 'guest',
            sequence: 1,
            status: 'waiting',
            at: 0,
          },
        },
      },
      10,
    ),
  ).toMatchObject({ accepted: false, reason: 'outstanding-service-queue' });
  const busy = {
    ...s,
    slots: {
      slot: {
        id: 'slot',
        serviceId: 'old',
        start: 0,
        end: 10,
        capacity: 1,
        revision: 1,
        active: true,
        startedAt: 0,
      },
    },
  };
  expect(decideServicePolicyUpgrade(busy, 9)).toMatchObject({
    accepted: false,
    reason: 'outstanding-service-provider-time',
  });
  expect(decideServicePolicyUpgrade(busy, 10).accepted).toBe(true);
});
