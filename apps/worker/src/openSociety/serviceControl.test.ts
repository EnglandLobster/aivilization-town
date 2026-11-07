import { expect, test } from 'vitest';
import { programResourceFixture as fixture } from './testFixtures/programResourceExchange';
import { createOpenSocietyManifest } from './manifest';
import { initialOpenSocietyState } from './state';

test('paid service handover preserves actual providers and bookings while new administration uses current authority', () => {
  const f = fixture('service', true),
    t = f.t,
    at = f.state.world.clock.now;
  t.ok(t.b, 'services.schedule', {
    id: 'slot',
    serviceId: 'asset',
    start: at,
    end: at + 60000,
    capacity: 2,
  });
  t.ok(t.b, 'services.start', { id: 'slot', expectedRevision: 1, until: at + 60000 });
  t.ok(t.d, 'bookings.request', { id: 'existing', slotId: 'slot', units: 1 });
  t.ok(t.b, 'bookings.accept', { id: 'existing', expectedRevision: 1 });
  t.ok(t.d, 'bookings.check-in', { id: 'existing', expectedRevision: 2, until: at + 50000 });
  const before = f.state,
    slot = before.services!.slots.slot;
  t.ok(t.a, 'programs.run', { id: 'exchange', expectedRevision: 1 });
  expect(f.state.services!.slots.slot).toEqual(slot);
  expect(f.state.services!.bookings).toEqual(before.services!.bookings);
  expect(f.state.world.activityTimeByAgent).toEqual(before.world.activityTimeByAgent);
  expect(t.call(t.c, 'services.stop', { id: 'slot', expectedRevision: 2 }).error).toBe(
    'own-active-provider-shift-required',
  );
  t.ok(t.c, 'services.schedule', {
    id: 'future',
    serviceId: 'asset',
    start: at + 70000,
    end: at + 80000,
    capacity: 1,
  });
  t.ok(t.a, 'bookings.request', { id: 'new', slotId: 'future', units: 1 });
  expect(t.r.context(t.b).lifeInbox?.items.some((i) => i.id === 'new')).toBe(false);
  expect(t.r.context(t.c).lifeInbox?.items.some((i) => i.id === 'new')).toBe(true);
  expect(t.r.context(t.a).lifeInbox?.items.some((i) => i.id === 'new')).toBe(true);
  expect(t.r.context(t.d).lifeInbox?.items.some((i) => i.id === 'new')).toBe(false);
  expect(t.call(t.b, 'bookings.read', { id: 'new' }).error).toBe('booking-not-found');
  expect(t.call(t.b, 'bookings.accept', { id: 'new', expectedRevision: 1 }).ok).toBe(false);
  t.ok(t.c, 'bookings.accept', { id: 'new', expectedRevision: 1 });
  t.ok(t.c, 'resources.read', { kind: 'service', id: 'asset' });
  expect(t.call(t.b, 'resources.read', { kind: 'service', id: 'asset' }).ok).toBe(false);
  t.time(1000);
  t.ok(t.b, 'bookings.read', { id: 'existing' }); // Actual personal provider overlap survives management handover.
  t.ok(t.b, 'services.stop', { id: 'slot', expectedRevision: 2 });
  expect(f.state.services!.bookings.existing).toMatchObject({
    status: 'ended',
    attendedMs: 1000,
    providerOverlapMs: 1000,
  });
  expect(f.state.world.activityTimeByAgent[t.d]!.availableAt).toBeLessThanOrEqual(
    f.state.world.clock.now,
  );
  const oldManagerExperiences = f.state.experiences[t.b]?.length ?? 0;
  t.time(79000);
  expect(
    f.state.experiences[t.b]?.slice(oldManagerExperiences).some((e) => e.sourceIds.includes('new')),
  ).toBe(false);
  t.replay();
});
test('service control activation is explicit, idempotent and requires recorded-provider semantics', () => {
  const old = createOpenSocietyManifest({ count: 3, continuity: true });
  expect(initialOpenSocietyState(old).services!.controlPolicy).toBeUndefined();
  expect(() => createOpenSocietyManifest({ count: 3, serviceControl: true })).toThrow(
    'service-control-requires-recorded-providers-and-resource-control',
  );
  const fresh = createOpenSocietyManifest({ count: 3, continuity: true, serviceControl: true });
  expect(initialOpenSocietyState(fresh).services!.controlPolicy?.version).toBe(
    'resident-service-control-v1',
  );
  expect(fresh.provenance.serviceControl).toBe('resident-service-control-v1');
  const f = fixture('service', true),
    result = f.t.r.enableServiceControl();
  expect(f.t.r.enableServiceControl()).toEqual(result);
  expect(f.t.replay().enableServiceControl()).toEqual(result);
});
