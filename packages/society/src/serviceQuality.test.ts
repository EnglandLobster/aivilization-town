import { describe, expect, test } from 'vitest';
import {
  applyServiceQuality,
  assertValidServiceQualityPolicy,
  evaluateServiceQuality,
  TOWN_SERVICE_QUALITY_POLICY_VERSION,
  type ServiceQualityPolicy,
} from './serviceQuality';

const policy: ServiceQualityPolicy = {
  policyVersion: TOWN_SERVICE_QUALITY_POLICY_VERSION,
  cadenceMs: 3_600_000,
  services: {
    education: {
      requiredFundingPerCadence: 10,
      pressureStartsAtOccupancyRatio: 0.75,
      qualityAtFullOccupancy: 0.5,
    },
    healthcare: {
      requiredFundingPerCadence: 10,
      pressureStartsAtOccupancyRatio: 0.75,
      qualityAtFullOccupancy: 0.5,
    },
  },
  landValueWeight: 8,
  wellbeingPenaltyAtZeroQuality: 8,
};

describe('service quality', () => {
  test('keeps a fully funded service below the pressure threshold at full quality', () => {
    expect(
      evaluateServiceQuality({
        inputs: { service: 'education', fundedAmount: 10, occupancy: 30, capacity: 40 },
        policy,
      }),
    ).toEqual({
      service: 'education',
      fundedAmount: 10,
      occupancy: 30,
      capacity: 40,
      budgetEfficiency: 1,
      occupancyRatio: 0.75,
      capacityEfficiency: 1,
      quality: 1,
      landValueContribution: 8,
      wellbeingContribution: 0,
    });
  });

  test('combines partial funding and capacity pressure deterministically', () => {
    const evaluation = evaluateServiceQuality({
      inputs: { service: 'healthcare', fundedAmount: 5, occupancy: 20, capacity: 20 },
      policy,
    });
    expect(evaluation).toMatchObject({
      budgetEfficiency: 0.5,
      occupancyRatio: 1,
      capacityEfficiency: 0.5,
      quality: 0.25,
      landValueContribution: 2,
      wellbeingContribution: -6,
    });
    expect(applyServiceQuality(12, evaluation.quality)).toBe(3);
  });

  test('reports zero coverage when the region has no service capacity', () => {
    expect(
      evaluateServiceQuality({
        inputs: { service: 'education', fundedAmount: 10, occupancy: 0, capacity: 0 },
        policy,
      }),
    ).toMatchObject({
      budgetEfficiency: 1,
      occupancyRatio: 0,
      capacityEfficiency: 0,
      quality: 0,
      landValueContribution: 0,
      wellbeingContribution: -8,
    });
  });

  test('clamps excess occupancy and funding without producing quality above one', () => {
    expect(
      evaluateServiceQuality({
        inputs: { service: 'healthcare', fundedAmount: 100, occupancy: 40, capacity: 20 },
        policy,
      }).quality,
    ).toBe(0.5);
  });

  test('rejects malformed policies and inputs at their boundaries', () => {
    expect(() =>
      assertValidServiceQualityPolicy({
        ...policy,
        services: {
          ...policy.services,
          education: { ...policy.services.education, pressureStartsAtOccupancyRatio: 1 },
        },
      }),
    ).toThrow('pressureStartsAtOccupancyRatio must be less than 1');
    expect(() =>
      evaluateServiceQuality({
        inputs: { service: 'education', fundedAmount: Number.NaN, occupancy: 1, capacity: 1 },
        policy,
      }),
    ).toThrow('fundedAmount must be non-negative finite');
  });
});
