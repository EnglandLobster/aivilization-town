import { expect, test } from 'vitest';
import { occupations, commodities } from '@aivilization/content';
import { evaluateOccupationApplication } from './occupation';
import {
  initialPublicEmployment,
  inheritedPublicEmploymentTerms,
  publicEmploymentAtCycle,
  schedulePublicEmployment,
  applyPublicEmploymentEvent,
  evaluatePublicOccupation,
  publicEmploymentQuota,
  assertPublicEmploymentTerms,
} from './publicEmployment';
const cycle = {
  policyVersion: 'original-cycle',
  cycleDurationMs: 60000,
  defaultOccupationCapacity: 1,
  occupationCapacityOverrides: { Chef: 2 },
};
const terms = () => inheritedPublicEmploymentTerms([1, 1, 2, 3, 4, 5], cycle);
const source = {
  kind: 'public-decision' as const,
  proposalId: 'proposal',
  actorId: 'resident',
  procedureRevision: 1,
};
test('inherited public rules preserve every named legacy occupation admission without silently reforming wealth, knowledge or materials', () => {
  const t = terms(),
    inventory = Object.fromEntries(commodities.map((c) => [c.name, 2])),
    populationEducationScores = [0, 100, 180, 330];
  for (const occupation of occupations)
    for (const residentialTier of [1, 3, 6])
      for (const educationScore of [0, 100, 330, 1000])
        for (const inventory of [{}, Object.fromEntries(commodities.map((c) => [c.name, 2]))]) {
          const input = {
            occupationName: occupation.name,
            agent: { residentialTier, educationScore, inventory },
            populationEducationScores,
          };
          expect(evaluatePublicOccupation({ terms: t, ...input })).toEqual(
            evaluateOccupationApplication(input),
          );
        }
  expect(
    evaluatePublicOccupation({
      terms: t,
      occupationName: 'Chef',
      agent: { residentialTier: 1, educationScore: 330, inventory },
      populationEducationScores,
    }),
  ).toMatchObject({ status: 'rejected', reason: 'residential-tier-too-low' });
});
test('a legitimate changed rule takes effect only in the next cycle and never changes old source, earlier applications or exact initial terms', () => {
  const initial = initialPublicEmployment({
    at: 90000,
    cycleDurationMs: 60000,
    terms: terms(),
    sourceVersion: 'inherited-scenario',
  });
  const changed = {
    ...terms(),
    quotaByResidentialTier: [3, 2, 1],
    occupations: terms().occupations.map((o) =>
      o.occupationName === 'Chef'
        ? { ...o, minimumResidentialTier: 1, prerequisiteCommodity: null }
        : o,
    ),
  };
  const event = schedulePublicEmployment({
    state: initial,
    at: 100000,
    expectedRevision: 1,
    terms: changed,
    source,
  });
  const state = applyPublicEmploymentEvent(initial, event);
  expect(publicEmploymentAtCycle(state, 0)).toBeUndefined();
  expect(publicEmploymentAtCycle(state, 1)).toEqual(initial.revisions[0]);
  expect(publicEmploymentAtCycle(state, 2)?.terms).toEqual(changed);
  expect(state.revisions[0]).toEqual(initial.revisions[0]);
  expect(publicEmploymentQuota(changed, 1)).toBe(3);
  expect(publicEmploymentQuota(changed, 10)).toBe(1);
  expect(
    evaluatePublicOccupation({
      terms: changed,
      occupationName: 'Chef',
      agent: { residentialTier: 1, educationScore: 330, inventory: {} },
      populationEducationScores: [180, 330],
    }).status,
  ).toBe('accepted');
  expect(() =>
    schedulePublicEmployment({ state, at: 110000, expectedRevision: 1, terms: changed, source }),
  ).toThrow('public-employment-revision-conflict');
  const second = schedulePublicEmployment({
      state,
      at: 110000,
      expectedRevision: 2,
      terms: terms(),
      source: { ...source, proposalId: 'later' },
    }),
    next = applyPublicEmploymentEvent(state, second);
  expect(publicEmploymentAtCycle(next, 2)?.revision).toBe(3);
  expect(next.revisions[1]).toEqual(event.policy);
  expect([event, second].reduce(applyPublicEmploymentEvent, initial)).toEqual(next);
});
test('closed actual catalogs, finite quotas and future-cycle sources reject malformed or retrospective policy', () => {
  const t = terms(),
    state = initialPublicEmployment({
      at: 0,
      cycleDurationMs: 60000,
      terms: t,
      sourceVersion: 'scenario',
    });
  for (const invalid of [
    { ...t, quotaByResidentialTier: [Infinity] },
    { ...t, ranking: ['housing', 'housing'] as const },
    { ...t, occupationCapacityOverrides: { Invented: 1 } },
    { ...t, occupations: t.occupations.slice(1) },
    {
      ...t,
      occupations: t.occupations.map((o) => ({ ...o, prerequisiteCommodity: 'Invented resource' })),
    },
  ])
    expect(() => assertPublicEmploymentTerms(invalid)).toThrow();
  const event = schedulePublicEmployment({
    state,
    at: 1000,
    expectedRevision: 1,
    terms: t,
    source,
  });
  expect(() =>
    applyPublicEmploymentEvent(state, { ...event, policy: { ...event.policy, effectiveCycle: 0 } }),
  ).toThrow('invalid-public-employment-revision');
  expect(() => applyPublicEmploymentEvent(state, { ...event, previousRevision: 7 })).toThrow(
    'public-employment-event-source-mismatch',
  );
});
