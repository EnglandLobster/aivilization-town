import { test, expect } from 'vitest';
import {
  HOUSING_CHOICE_POLICY,
  decideHousingStandardChoice,
  applyHousingStandardChoice,
  recordHousingStandardChange,
} from './housingChoice';
test('personal downward choice is versioned; replay rejects a stale tier, duplicate or fabricated benefit', () => {
  const state = { policy: HOUSING_CHOICE_POLICY, availableTiers: [1, 2, 3, 4], revisions: {} };
  const command = {
    state,
    actorId: 'resident-1',
    at: 100,
    currentTier: 4,
    targetTier: 2,
    expectedRevision: 1,
  };
  const d = decideHousingStandardChoice(command);
  expect(d.accepted).toBe(true);
  if (!d.accepted) throw Error(d.reason);
  const after = applyHousingStandardChoice(state, 4, d.event);
  expect(after).toEqual({
    state: {
      policy: HOUSING_CHOICE_POLICY,
      availableTiers: [1, 2, 3, 4],
      revisions: { 'resident-1': 2 },
    },
    tier: 2,
  });
  expect(() => applyHousingStandardChoice(after.state, 2, d.event)).toThrow(
    'housing-standard-choice-source-mismatch',
  );
  expect(() => applyHousingStandardChoice(state, 3, d.event)).toThrow(
    'housing-standard-choice-source-mismatch',
  );
  expect(() => applyHousingStandardChoice(state, 4, { ...d.event, nextTier: 5 })).toThrow();
  expect(
    decideHousingStandardChoice({
      ...command,
      state: recordHousingStandardChange(state, command.actorId),
    }),
  ).toMatchObject({ accepted: false, reason: 'housing-choice-revision-conflict' });
});
test('choice cannot manufacture an upgrade, use a nonfinite level, impersonate system or exhaust revision precision', () => {
  const state = { policy: HOUSING_CHOICE_POLICY, availableTiers: [1, 2, 3, 4], revisions: {} };
  const command = {
    state,
    actorId: 'resident-1',
    at: 0,
    currentTier: 2,
    targetTier: 1,
    expectedRevision: 1,
  };
  for (const targetTier of [0, -1, 1.5, NaN, Infinity, 2, 3, 33])
    expect(decideHousingStandardChoice({ ...command, targetTier }).accepted).toBe(false);
  expect(decideHousingStandardChoice({ ...command, actorId: 'system' }).accepted).toBe(false);
  expect(
    decideHousingStandardChoice({
      ...command,
      state: { ...state, revisions: { 'resident-1': Number.MAX_SAFE_INTEGER } },
      expectedRevision: Number.MAX_SAFE_INTEGER,
    }).accepted,
  ).toBe(false);
});
