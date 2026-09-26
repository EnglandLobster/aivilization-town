import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { OpenSocietyRuntime } from './runtime';
import { createOpenSocietyManifest } from './manifest';
import { executeServicesTool } from './servicesTools';

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const f of cleanup.reverse()) f();
  cleanup.length = 0;
});
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'service-supply-'));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const r = new OpenSocietyRuntime(
    root,
    createOpenSocietyManifest({ count: 4, continuity: true, initialization: 'newcomers' }),
  );
  cleanup.push(() => r.close());
  const [a, b, c, d] = r.manifest.residents.map((v) => v.id) as [string, string, string, string];
  let n = 0;
  const call = (actor: string, name: string, args: Record<string, unknown>) => {
    r.beginTurn(actor);
    const out = r.invoke(actor, { name, arguments: args, requestId: `req-${++n}` });
    r.finishTurn(actor, { summary: 'test' });
    return out;
  };
  const ok = (actor: string, name: string, args: Record<string, unknown>) => {
    const out = call(actor, name, args);
    expect(out.ok, `${name}: ${out.error}`).toBe(true);
    return out.data;
  };
  const prepare = () => {
    ok(a, 'world.found_enterprise', {
      enterpriseId: 'firm',
      name: '自主合作',
      occupationName: 'Cleaner',
      initialCapital: 100,
      maxEmployees: 3,
    });
    ok(a, 'world.post_job', { enterpriseId: 'firm', wageOffer: 100, openSlots: 3 });
    ok(b, 'world.join_enterprise', { enterpriseId: 'firm' });
    ok(a, 'services.publish', {
      id: 'svc',
      kind: 'course',
      locationId: 'town-square',
      title: '交流',
      description: '自主参加',
      capacity: 3,
      enterpriseId: 'firm',
    });
    ok(a, 'services.schedule', {
      id: 'slot',
      serviceId: 'svc',
      start: 1000,
      end: 10000,
      capacity: 3,
    });
    for (const [actor, id] of [
      [c, 'one'],
      [d, 'two'],
    ] as const) {
      ok(actor, 'bookings.request', { id, slotId: 'slot', units: 1 });
      ok(a, 'bookings.accept', { id, expectedRevision: 1 });
    }
    expect(r.advanceTime(1000, 'tick').ok).toBe(true);
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

test('real employees choose shifts; staffing and all interrupted reservations commit atomically with truthful personal experience', () => {
  const { r, a, b, c, d, call, ok, prepare, replay } = setup();
  prepare();
  const funds = Object.fromEntries(
    Object.entries(r.state.world.agents).map(([id, v]) => [id, v.balance]),
  );
  const inventories = Object.fromEntries(
    Object.entries(r.state.world.agents).map(([id, v]) => [id, v.inventory]),
  );
  const supply = r.state.world.moneySupply;
  expect(call(c, 'services.start', { id: 'slot', expectedRevision: 1 })).toMatchObject({
    ok: false,
    error: 'service-provider-required',
  });
  ok(b, 'services.start', { id: 'slot', expectedRevision: 1 });
  expect(r.state.world.activityTimeByAgent[b]).toMatchObject({
    commandType: 'ResidentParticipate',
    availableAt: 10000,
  });
  ok(c, 'bookings.check-in', { id: 'one', expectedRevision: 2 });
  expect(call(d, 'bookings.check-in', { id: 'two', expectedRevision: 2 })).toMatchObject({
    ok: false,
    error: 'insufficient-provider-capacity',
  });
  expect(call(b, 'world.move', { targetLocationId: 'school' }).ok).toBe(false);
  expect(r.advanceTime(1000, 'tick2').ok).toBe(true);
  expect(ok(b, 'bookings.read', { id: 'one' })).toMatchObject({ residentId: c });
  expect(ok(d, 'services.read', { id: 'svc' })).toMatchObject({
    slots: {
      items: [{ supply: { activeProviderCount: 1, capacity: 1, occupied: 1, available: 0 } }],
    },
  });
  const snapshot = structuredClone(r.state);
  const invalid = {
    ...snapshot,
    world: {
      ...snapshot.world,
      activityTimeByAgent: {
        ...snapshot.world.activityTimeByAgent,
        [c]: { ...snapshot.world.activityTimeByAgent[c]!, availableAt: 9000 },
      },
    },
  };
  const before = structuredClone(invalid);
  expect(() =>
    executeServicesTool(
      invalid,
      r.manifest,
      b,
      'services.stop',
      { id: 'slot', expectedRevision: 2 },
      'invalid',
    ),
  ).toThrow('participation-reservation-mismatch');
  expect(invalid).toEqual(before);
  expect(call(a, 'services.stop', { id: 'slot', expectedRevision: 2 })).toMatchObject({
    ok: false,
    error: 'own-active-provider-shift-required',
  });
  ok(b, 'services.stop', { id: 'slot', expectedRevision: 2 });
  const commit = r.journal.commits
    .filter((entry) => entry.capability === 'services.stop' && entry.result.ok)
    .at(-1)!;
  expect(commit.worldEvents?.map((e) => e.type)).toEqual([
    'ResidentParticipationEnded',
    'ResidentParticipationEnded',
  ]);
  expect(commit.servicesEvents?.map((e) => e.type)).toEqual([
    'ServiceSlotChanged',
    'BookingChanged',
  ]);
  expect(r.state.world.activityTimeByAgent[b]?.availableAt).toBe(2000);
  expect(r.state.world.activityTimeByAgent[c]?.availableAt).toBe(2000);
  expect(r.state.services!.bookings.one).toMatchObject({
    status: 'ended',
    endReason: 'staffing-interrupted',
    attendedMs: 1000,
  });
  expect(r.state.experiences[c]?.some((e) => e.summary.includes('staffing-interrupted'))).toBe(
    true,
  );
  expect(r.state.world.moneySupply).toBe(supply);
  expect(
    Object.fromEntries(Object.entries(r.state.world.agents).map(([id, v]) => [id, v.balance])),
  ).toEqual(funds);
  expect(
    Object.fromEntries(Object.entries(r.state.world.agents).map(([id, v]) => [id, v.inventory])),
  ).toEqual(inventories);
  expect(
    call(a, 'courses.assess', { id: 'false-teacher', bookingId: 'one', content: '我没有授课' }).ok,
  ).toBe(false);
  ok(b, 'courses.assess', {
    id: 'actual-teacher',
    bookingId: 'one',
    content: '短暂交流，提前结束',
  });
  replay();
});

test('current enterprise authorization, time/location and revision constraints cannot be bypassed', () => {
  const { r, a, b, c, call, ok, prepare, replay } = setup();
  prepare();
  expect(
    call(c, 'services.publish', {
      id: 'fake',
      kind: 'appointment',
      locationId: 'town-square',
      title: 'fake',
      description: 'fake',
      capacity: 2,
      enterpriseId: 'firm',
    }).ok,
  ).toBe(false);
  ok(b, 'world.leave_enterprise', { enterpriseId: 'firm' });
  expect(call(b, 'services.start', { id: 'slot', expectedRevision: 1 }).ok).toBe(false);
  ok(a, 'services.start', { id: 'slot', expectedRevision: 1, until: 5000 });
  expect(call(a, 'services.stop', { id: 'slot', expectedRevision: 1 })).toMatchObject({
    ok: false,
    error: 'revision-conflict',
  });
  ok(c, 'bookings.check-in', { id: 'one', expectedRevision: 2, until: 5000 });
  expect(r.advanceTime(4000, 'finish').ok).toBe(true);
  expect(r.state.services!.bookings.one).toMatchObject({
    status: 'ended',
    attendedMs: 4000,
    providerOverlapMs: 4000,
  });
  expect(call(a, 'services.stop', { id: 'slot', expectedRevision: 2 }).ok).toBe(false);
  replay();
});
