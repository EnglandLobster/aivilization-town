import { describe, expect, test } from 'vitest';
import { activities, commodities, jobTiers, occupations, productionRecipes } from './index';

describe('AIvilization source content', () => {
  test('includes the full paper commodity and production catalog anchors', () => {
    expect(commodities).toHaveLength(25);
    expect(productionRecipes).toHaveLength(24);
    expect(commodities.map((commodity) => commodity.name)).toContain('Apple');
    expect(commodities.map((commodity) => commodity.name)).toContain('Gold Apple');
    expect(commodities.map((commodity) => commodity.name)).toContain('Chip');
    expect(productionRecipes.find((recipe) => recipe.output === 'Chip')).toMatchObject({
      output: 'Chip',
      inputs: { Transistor: 1, 'Circuit Board': 1 },
      energyCost: 100,
      satietyCost: 25,
      timeCostSeconds: 5,
      rewardProbabilityPercent: 5,
    });
  });

  test('includes the full paper activity, job tier, and occupation anchors', () => {
    expect(activities).toHaveLength(7);
    expect(jobTiers).toHaveLength(6);
    expect(occupations).toHaveLength(17);
    expect(activities.map((activity) => activity.type)).toContain('Trade');
    expect(jobTiers.find((tier) => tier.tier === 6)).toMatchObject({
      tierName: 'Leadership',
      minResidentialTier: 6,
      minEducationScore: 320,
      prerequisiteCommodity: 'Circuit Board',
      wageType: 'dynamic',
    });
    expect(occupations.find((occupation) => occupation.name === 'CEO')).toMatchObject({
      jobTier: 6,
      educationFloor: 604,
      eligibilityShare: 0.065,
      baseWage: 1411,
    });
  });
});
