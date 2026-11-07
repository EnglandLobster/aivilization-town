import { expect, test } from 'vitest';
import {
  emptyResidentLaborState,
  startResidentLabor,
  progressResidentLabor,
  stopResidentLabor,
  applyResidentLaborEvent,
  advanceElapsedLaborPhysiology,
  type ResidentLaborEvent,
} from './residentLabor';

function fixture() {
  const initial = emptyResidentLaborState();
  let state = initial;
  const events: ResidentLaborEvent[] = [];
  const apply = (d: ReturnType<typeof startResidentLabor>) => {
    expect(d.accepted).toBe(true);
    if (!d.accepted) throw Error(d.reason);
    for (const e of d.events) {
      state = applyResidentLaborEvent(state, e);
      events.push(e);
    }
  };
  const start = () =>
    startResidentLabor({
      state,
      actorId: 'a',
      id: 'labor',
      enterpriseId: 'firm',
      locationId: 'workshop',
      occupation: 'Maker',
      at: 123,
      durationMs: 125000,
      energyCostPerHour: 12,
      satietyCostPerHour: 5,
    });
  apply(start());
  return {
    initial,
    events,
    apply,
    start,
    get state() {
      return state;
    },
    get s() {
      return state.sessions.labor!;
    },
  };
}
test('only elapsed personal labor is recorded; partial stop retains immutable employer and effort terms', () => {
  const t = fixture();
  expect(t.s.elapsedMs).toBe(0);
  expect(t.start()).toMatchObject({ accepted: false });
  t.apply(progressResidentLabor(t.state, 'labor', 20123));
  expect(t.s.elapsedMs).toBe(20000);
  const common = { state: t.state, id: 'labor', at: 20123, expectedRevision: t.s.revision };
  expect(stopResidentLabor({ ...common, actorId: 'owner' })).toMatchObject({ accepted: false });
  expect(stopResidentLabor({ ...common, actorId: 'a', expectedRevision: 1 })).toMatchObject({
    accepted: false,
  });
  t.apply(stopResidentLabor({ ...common, actorId: 'a' }));
  expect(t.s).toMatchObject({
    status: 'interrupted',
    endReason: 'participant-left',
    elapsedMs: 20000,
  });
  expect(t.state.activeByActor).toEqual({});
  expect(progressResidentLabor(t.state, 'labor', 125123)).toMatchObject({ accepted: false });
  expect(t.events.reduce(applyResidentLaborEvent, t.initial)).toEqual(t.state);
});
test('completion, system stop authority, body uniqueness and forged historical changes are checked', () => {
  const t = fixture();
  expect(
    stopResidentLabor({
      state: t.state,
      actorId: 'a',
      id: 'labor',
      at: 123,
      expectedRevision: 1,
      reason: 'employment-ended',
    }),
  ).toMatchObject({ accepted: false });
  t.apply(
    stopResidentLabor({
      state: t.state,
      actorId: 'system',
      id: 'labor',
      at: 123,
      expectedRevision: 1,
      reason: 'employment-ended',
    }),
  );
  const a = fixture();
  a.apply(progressResidentLabor(a.state, 'labor', 500000));
  expect(a.s).toMatchObject({ status: 'completed', settledAt: 125123, elapsedMs: 125000 });
  const first = a.events[0]!;
  expect(() =>
    applyResidentLaborEvent(a.initial, { ...first, session: { ...first.session, elapsedMs: 1 } }),
  ).toThrow();
  const started = applyResidentLaborEvent(a.initial, first);
  const last = a.events[1]!;
  expect(() =>
    applyResidentLaborEvent(started, {
      ...last,
      session: { ...last.session, enterpriseId: 'other' },
    }),
  ).toThrow('invalid-labor-transition');
  expect(() => applyResidentLaborEvent(started, first)).toThrow();
});
test('work and passive physiology integrate together with exact caps and partition-independent threshold damage', () => {
  const input = {
    previous: { energy: 30, satiety: 40, health: 80 },
    elapsedMs: 3600000,
    decay: { energyPerHour: 2, satietyPerHour: 3 },
    labor: { energyCostPerHour: 12, satietyCostPerHour: 5 },
    deprivation: { energyThreshold: 25, healthDecayPerSecond: 0.001, minHealth: 0 },
  };
  const all = advanceElapsedLaborPhysiology(input);
  expect(all.next.energy).toBe(16);
  expect(all.next.satiety).toBe(32);
  expect(all.next.health).toBeCloseTo(80 - (3600 - (5 * 3600) / 14) * 0.001, 10);
  let body = input.previous,
    low = 0;
  for (const elapsedMs of [12345, 999001, 100003, 2488651]) {
    const part = advanceElapsedLaborPhysiology({ ...input, previous: body, elapsedMs });
    body = part.next;
    low += part.lowEnergyMs;
  }
  expect(body.energy).toBeCloseTo(all.next.energy, 10);
  expect(body.satiety).toBeCloseTo(all.next.satiety, 10);
  expect(body.health).toBeCloseTo(all.next.health, 10);
  expect(low).toBeCloseTo(all.lowEnergyMs, 7);
  expect(() =>
    advanceElapsedLaborPhysiology({
      ...input,
      labor: { energyCostPerHour: -1, satietyCostPerHour: 0 },
    }),
  ).toThrow();
});
