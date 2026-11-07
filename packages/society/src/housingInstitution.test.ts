import { test, expect } from 'vitest';
import {
  initialPublicHousing,
  inheritedPublicHousingTerms,
  enactPublicHousing,
  applyPublicHousingEvent,
  publicHousingAt,
  publicHousingPolicies,
  assertPublicHousingTerms,
} from './housingInstitution';
const source = {
  kind: 'public-decision' as const,
  proposalId: 'change-price',
  actorId: 'resident-1',
  procedureRevision: 1,
};
function fixture() {
  const terms = inheritedPublicHousingTerms(
    {
      policyVersion: 'legacy-price',
      costs: [
        { residentialTier: 1, currencyCostPerHour: 3 },
        { residentialTier: 2, currencyCostPerHour: 10 },
      ],
      landValueCoefficientPerHour: 0.2,
      arrearsDowngradeThresholdHours: 72,
    },
    {
      maxResidentialTier: 2,
      costs: [
        {
          targetResidentialTier: 2,
          currencyCost: 200,
          inventoryCosts: { Beef: 1 },
          minEducationScore: 100,
        },
      ],
    },
    [1, 2],
  );
  const state = initialPublicHousing({
    at: 100,
    terms,
    sourceVersion: 'legacy-price',
    legacyArrearsDowngradeThresholdHours: 72,
  });
  return { terms, state };
}
test('inheritance records original fees and enforcement separately; public price changes have exact time and immutable old versions', () => {
  const { terms, state } = fixture();
  expect(state.legacyArrearsDowngradeThresholdHours).toBe(72);
  expect(terms.standards[1]!.upgrade).toEqual({
    currencyCost: 200,
    inventoryCosts: { Beef: 1 },
    minEducationScore: 100,
  });
  const changed = {
    ...terms,
    standards: terms.standards.map((s) => ({
      ...s,
      upkeepPerHour: 0,
      upgrade: s.upgrade ? { ...s.upgrade, minEducationScore: 0 } : null,
    })),
  };
  const event = enactPublicHousing({ state, at: 200, expectedRevision: 1, terms: changed, source });
  const next = applyPublicHousingEvent(state, event);
  expect(publicHousingAt(next, 99)).toBeUndefined();
  expect(publicHousingAt(next, 199)).toEqual(state.revisions[0]);
  expect(publicHousingAt(next, 200)).toEqual(event.policy);
  expect(state.revisions[0]!.terms).toEqual(terms);
  expect(next.legacyArrearsDowngradeThresholdHours).toBe(72);
  const policy = publicHousingPolicies(event.policy);
  expect(policy.upkeep.costs).toEqual([
    { residentialTier: 1, currencyCostPerHour: 0 },
    { residentialTier: 2, currencyCostPerHour: 0 },
  ]);
  expect(policy.upkeep).not.toHaveProperty('arrearsDowngradeThresholdHours');
  expect(policy.upgrade.costs[0]).toMatchObject({
    currencyCost: 200,
    minEducationScore: 0,
    inventoryCosts: { Beef: 1 },
  });
  expect(() => applyPublicHousingEvent(next, event)).toThrow(
    'public-housing-event-source-mismatch',
  );
  expect(() =>
    enactPublicHousing({ state: next, at: 201, expectedRevision: 1, terms, source }),
  ).toThrow('public-housing-revision-conflict');
});
test('a price grant cannot create new physical standards, body effects, currency, arbitrary items or retroactive enactment', () => {
  const { terms, state } = fixture();
  for (const value of [-1, NaN, Infinity, 1e12])
    expect(() =>
      assertPublicHousingTerms({ ...terms, landValueCoefficientPerHour: value }),
    ).toThrow();
  expect(() =>
    assertPublicHousingTerms({ ...terms, standards: [terms.standards[0]!, terms.standards[0]!] }),
  ).toThrow();
  const injected = { ...terms, physiologyMaximum: 999 };
  expect(() => assertPublicHousingTerms(injected)).toThrow('invalid-public-housing-terms');
  const newTier = {
    ...terms,
    standards: [...terms.standards, { tier: 3, upkeepPerHour: 0, upgrade: null }],
  };
  expect(() =>
    enactPublicHousing({ state, at: 200, expectedRevision: 1, terms: newTier, source }),
  ).toThrow('invalid-public-housing-revision');
  expect(() => enactPublicHousing({ state, at: 99, expectedRevision: 1, terms, source })).toThrow(
    'invalid-public-housing-revision',
  );
  expect(() =>
    assertPublicHousingTerms({
      ...terms,
      standards: [
        terms.standards[0]!,
        {
          ...terms.standards[1]!,
          upgrade: { currencyCost: 0, minEducationScore: 0, inventoryCosts: { ImaginaryHouse: 1 } },
        },
      ],
    }),
  ).toThrow('invalid-public-housing-upgrade');
  const e = enactPublicHousing({ state, at: 100, expectedRevision: 1, terms, source });
  expect(applyPublicHousingEvent(state, e).revisions).toHaveLength(2);
});
