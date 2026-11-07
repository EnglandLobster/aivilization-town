import { expect, test } from 'vitest';
import {
  emptyResidentRestState,
  startResidentRest,
  progressResidentRest,
  interruptResidentRest,
  applyResidentRestEvent,
  type ResidentRestState,
  type ResidentRestEvent,
} from './residentRest';
const start = (state = emptyResidentRestState()) =>
  startResidentRest({
    state,
    actorId: 'a',
    id: 'sleep',
    locationId: 'home',
    at: 1000,
    durationMs: 10000,
    energyPerSecond: 0.01,
    maximum: 100,
  });
function accepted(state: ResidentRestState, result: ReturnType<typeof start>) {
  if (!result.accepted) throw Error(result.reason);
  return result.events.reduce(applyResidentRestEvent, state);
}
test('start reserves planned time but records zero elapsed duration; partial progress and completion replay exactly', () => {
  let state = emptyResidentRestState();
  const events: ResidentRestEvent[] = [];
  const starting = start(state);
  if (!starting.accepted) throw Error(starting.reason);
  events.push(...starting.events);
  state = accepted(state, starting);
  expect(state.sessions.sleep).toMatchObject({ elapsedMs: 0, status: 'active', settledAt: 1000 });
  expect(start(state)).toMatchObject({ accepted: false, reason: 'rest-id-exists' });
  expect(
    startResidentRest({
      state,
      actorId: 'a',
      id: 'second',
      locationId: 'home',
      at: 2000,
      durationMs: 1000,
      energyPerSecond: 1,
      maximum: 100,
    }),
  ).toMatchObject({ reason: 'rest-already-active' });
  for (const at of [4000, 20000]) {
    const result = progressResidentRest(state, 'sleep', at);
    if (!result.accepted) throw Error(result.reason);
    events.push(...result.events);
    state = accepted(state, result);
  }
  expect(state.sessions.sleep).toMatchObject({
    elapsedMs: 10000,
    settledAt: 11000,
    status: 'completed',
  });
  expect(state.activeByActor).toEqual({});
  expect(events.reduce(applyResidentRestEvent, emptyResidentRestState())).toEqual(state);
});
test('only the person can interrupt, after current progress is settled, without erasing the planned duration', () => {
  let state = accepted(emptyResidentRestState(), start());
  const stop = (actorId: string, at = 4000, expectedRevision = 1) =>
    interruptResidentRest({
      state,
      id: 'sleep',
      actorId,
      at,
      expectedRevision,
    });
  expect(stop('b')).toMatchObject({ reason: 'own-rest-required' });
  expect(stop('a')).toMatchObject({ reason: 'rest-progress-must-be-settled' });
  state = accepted(state, progressResidentRest(state, 'sleep', 4000));
  expect(stop('a')).toMatchObject({ reason: 'rest-revision-conflict' });
  state = accepted(state, stop('a', 4000, 2));
  expect(state.sessions.sleep).toMatchObject({
    until: 11000,
    elapsedMs: 3000,
    status: 'interrupted',
  });
  expect(state.activeByActor).toEqual({});
  expect(progressResidentRest(state, 'sleep', 5000)).toMatchObject({ reason: 'rest-not-active' });
});
test('progress cannot go backwards or duplicate time; replay refuses changed identity, rates and unjustified progress', () => {
  const state = accepted(emptyResidentRestState(), start());
  expect(progressResidentRest(state, 'sleep', 1000)).toEqual({ accepted: true, events: [] });
  expect(progressResidentRest(state, 'sleep', 999)).toMatchObject({
    reason: 'invalid-rest-progress-time',
  });
  const p = progressResidentRest(state, 'sleep', 4000);
  if (!p.accepted) throw Error(p.reason);
  const event = p.events[0]!;
  for (const patch of [
    { actorId: 'b' },
    { energyPerSecond: 100 },
    { elapsedMs: 9000 },
    { status: 'completed' as const },
  ])
    expect(() =>
      applyResidentRestEvent(state, { ...event, session: { ...event.session, ...patch } }),
    ).toThrow();
  expect(() => applyResidentRestEvent(state, { ...event, previousRevision: 0 })).toThrow();
});
test.each([0, -1, 0.5, Infinity, 86400001])(
  'invalid planned duration %s creates no rest session',
  (durationMs) => {
    expect(
      startResidentRest({
        state: emptyResidentRestState(),
        actorId: 'a',
        id: 's',
        locationId: 'h',
        at: 1000,
        durationMs,
        energyPerSecond: 0.01,
        maximum: 100,
      }),
    ).toMatchObject({
      accepted: false,
      reason: 'invalid-resident-rest',
    });
  },
);

test('population interruption is explicitly system-driven and keeps settled duration', () => {
  const state = accepted(emptyResidentRestState(), start());
  const request = {
    state,
    id: 'sleep',
    expectedRevision: 1,
    at: 1000,
    systemReason: 'population-departure' as const,
  };
  expect(interruptResidentRest({ ...request, actorId: 'a' })).toMatchObject({
    accepted: false,
    reason: 'own-rest-required',
  });
  const d = interruptResidentRest({ ...request, actorId: 'system' });
  const next = accepted(state, d);
  expect(next.sessions.sleep).toMatchObject({ elapsedMs: 0, status: 'interrupted', until: 11000 });
  expect(next.activeByActor).toEqual({});
  expect(interruptResidentRest({ ...request, actorId: 'system', at: 1001 })).toMatchObject({
    accepted: false,
    reason: 'rest-progress-must-be-settled',
  });
});
