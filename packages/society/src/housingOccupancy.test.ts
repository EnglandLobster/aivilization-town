import { expect, test } from 'vitest';
import {
  HOUSING_OCCUPANCY_POLICY,
  decideHousingDeparture,
  applyHousingDeparture,
  recordHousingOccupancyChange,
  type HousingOccupancyState,
} from './housingOccupancy';
test('personal departure records one exact residence version, and returning to the same address cannot revive old consent', () => {
  const state: HousingOccupancyState = { policy: HOUSING_OCCUPANCY_POLICY, revisions: {} };
  const command = {
    state,
    actorId: 'a',
    at: 0,
    currentResidenceId: 'home',
    expectedResidenceId: 'home',
    expectedRevision: 1,
  };
  const d = decideHousingDeparture(command);
  if (!d.accepted) throw Error(d.reason);
  const next = applyHousingDeparture(state, 'home', d.event);
  expect(next.revisions.a).toBe(2);
  expect(state.revisions).toEqual({});
  expect(() => applyHousingDeparture(next, 'home', d.event)).toThrow(
    'housing-departure-source-mismatch',
  );
  expect(() => applyHousingDeparture(state, 'other', d.event)).toThrow(
    'housing-departure-source-mismatch',
  );
  const returned = recordHousingOccupancyChange(next, 'a');
  expect(decideHousingDeparture({ ...command, state: returned })).toMatchObject({
    accepted: false,
    reason: 'housing-occupancy-revision-conflict',
  });
  expect(decideHousingDeparture({ ...command, currentResidenceId: null })).toMatchObject({
    accepted: false,
    reason: 'housing-residence-not-registered',
  });
  expect(decideHousingDeparture({ ...command, expectedResidenceId: 'other' }).accepted).toBe(false);
  for (const at of [-1, NaN, Infinity])
    expect(decideHousingDeparture({ ...command, at }).accepted).toBe(false);
  expect(decideHousingDeparture({ ...command, actorId: '__proto__' }).accepted).toBe(false);
  expect(() =>
    recordHousingOccupancyChange(
      { policy: HOUSING_OCCUPANCY_POLICY, revisions: { a: Number.MAX_SAFE_INTEGER } },
      'a',
    ),
  ).toThrow('housing-occupancy-revision-limit');
});
