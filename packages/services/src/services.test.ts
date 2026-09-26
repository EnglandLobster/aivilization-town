import { it, expect } from 'vitest';
import {
  emptyServicesState,
  applyServicesEvent,
  type ServicesCommand,
  type ServicesEvent,
} from './model';
import { decideServices, advanceServices } from './aggregate';
it('protects final capacity, queue order, real attendance and deterministic expiration', () => {
  let s = emptyServicesState(),
    at = 0,
    present = false;
  const events: ServicesEvent[] = [];
  const call = (actorId: string, c: ServicesCommand) => {
    const d = decideServices(s, actorId, at, c, {
      exists: () => true,
      locationCapacity: () => 1,
      presentAndIdle: () => present,
    });
    if (d.accepted) {
      s = d.events.reduce(applyServicesEvent, s);
      events.push(...d.events);
    }
    return d;
  };
  call('a', {
    type: 'publish',
    id: 's',
    kind: 'event',
    locationId: 'square',
    title: '活动',
    description: '原文',
    capacity: 1,
  });
  call('a', { type: 'schedule', id: 'slot', serviceId: 's', start: 10, end: 20, capacity: 1 });
  call('b', { type: 'request', id: 'b', slotId: 'slot', units: 1 });
  call('c', { type: 'request', id: 'c', slotId: 'slot', units: 1 });
  call('a', { type: 'accept', id: 'b', expectedRevision: 1 });
  expect(call('a', { type: 'accept', id: 'c', expectedRevision: 1 })).toMatchObject({
    accepted: false,
  });
  expect(call('b', { type: 'check-in', id: 'b', expectedRevision: 2 }).accepted).toBe(false);
  call('b', { type: 'cancel', id: 'b', expectedRevision: 2 });
  call('a', { type: 'accept', id: 'c', expectedRevision: 1 });
  at = 10;
  expect(call('c', { type: 'check-in', id: 'c', expectedRevision: 2 }).accepted).toBe(false);
  present = true;
  expect(call('c', { type: 'check-in', id: 'c', expectedRevision: 2 })).toMatchObject({
    accepted: true,
    participation: { until: 20 },
  });
  expect(call('a', { type: 'close', id: 's', expectedRevision: 1 }).accepted).toBe(false);
  expect(events.reduce(applyServicesEvent, emptyServicesState())).toEqual(s);
  const one = advanceServices(s, 30).reduce(applyServicesEvent, s),
    half = advanceServices(s, 20).reduce(applyServicesEvent, s);
  expect(advanceServices(half, 30).reduce(applyServicesEvent, half)).toEqual(one);
  expect(one.bookings.c?.status).toBe('completed');
});
