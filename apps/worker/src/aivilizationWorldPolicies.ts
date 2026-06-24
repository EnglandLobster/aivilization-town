import {
  aivilizationHealthcarePolicyDefaults,
  aivilizationProductionPolicyDefaults,
  aivilizationResidentialPhysiologyCaps,
  aivilizationScenarioDefaults,
  aivilizationSurvivalTimePolicyDefaults,
  commodities,
  jobTiers,
  occupations,
} from '@aivilization/content';
import type { WorldCommandPolicies } from '@aivilization/world';
import type { WorldCommandPolicyResolver } from './worldCommandPolicySource';

export function createAivilizationWorldCommandPolicies(): WorldCommandPolicyResolver {
  return (projection) =>
    createAivilizationWorldCommandPoliciesSnapshot(
      Object.values(projection.agents).map((agent) => agent.educationScore),
    );
}

export function createAivilizationWorldCommandPoliciesSnapshot(
  populationEducationScores: readonly number[],
): WorldCommandPolicies {
  return {
    satietyRecoveryByCommodity: createSatietyRecoveryByCommodity(),
    maxSatiety: aivilizationScenarioDefaults.maxPhysiology.satiety,
    wageCalculator: calculateOccupationWage,
    laborCost: {
      energyCostPerHour: 10,
      satietyCostPerHour: 10,
    },
    criticalThresholds: {
      energy: 1,
      health: 1,
    },
    residentialPhysiologyCaps: {
      caps: aivilizationResidentialPhysiologyCaps.map((cap) => ({
        residentialTier: cap.residentialTier,
        maxEnergy: cap.maxEnergy,
        maxSatiety: cap.maxSatiety,
        maxHealth: cap.maxHealth,
      })),
    },
    sleep: {
      energyRecoveryPerSecond: 1,
      maxEnergy: aivilizationScenarioDefaults.maxPhysiology.energy,
    },
    seeDoctor: {
      healthRecoveryPerSecond: 1,
      maxHealth: aivilizationScenarioDefaults.maxPhysiology.health,
      treatmentCost: {
        currencyCostPerSecond:
          aivilizationHealthcarePolicyDefaults.seeDoctorTreatmentCost.currencyCostPerSecond,
      },
    },
    production: {
      efficiency: {
        minEfficiency: aivilizationProductionPolicyDefaults.educationEfficiency.minEfficiency,
        educationScoreForMaxEfficiency:
          aivilizationProductionPolicyDefaults.educationEfficiency.educationScoreForMaxEfficiency,
      },
    },
    jobApplication: {
      populationEducationScores,
      quotaByResidentialTier: [1000, 1000, 1000, 1000, 1000, 1000],
    },
    residentialTierUpgrade: {
      maxResidentialTier: 6,
      costs: jobTiers
        .filter((tier) => tier.tier > 1)
        .map((tier) => ({
          targetResidentialTier: tier.tier,
          currencyCost: tier.tier * 100,
          minEducationScore: tier.minEducationScore,
          ...(tier.prerequisiteCommodity === null
            ? {}
            : { inventoryCosts: { [tier.prerequisiteCommodity]: 1 } }),
        })),
    },
    sleepDeprivation: {
      energyThreshold: aivilizationSurvivalTimePolicyDefaults.sleepDeprivation.energyThreshold,
      healthDecayPerSecond:
        aivilizationSurvivalTimePolicyDefaults.sleepDeprivation.healthDecayPerSecond,
      minHealth: aivilizationSurvivalTimePolicyDefaults.sleepDeprivation.minHealth,
    },
    stochasticIllness: {
      illnessProbabilityPercentPerHour:
        aivilizationSurvivalTimePolicyDefaults.stochasticIllness.illnessProbabilityPercentPerHour,
      healthDamage: aivilizationSurvivalTimePolicyDefaults.stochasticIllness.healthDamage,
      minHealth: aivilizationSurvivalTimePolicyDefaults.stochasticIllness.minHealth,
    },
    residentialUpkeep: {
      costs: aivilizationSurvivalTimePolicyDefaults.residentialUpkeep.costs.map((cost) => ({
        residentialTier: cost.residentialTier,
        currencyCostPerHour: cost.currencyCostPerHour,
      })),
    },
    safetyNetSubsidy: {
      minimumBalance: aivilizationSurvivalTimePolicyDefaults.safetyNetSubsidy.minimumBalance,
      maxSubsidy: aivilizationSurvivalTimePolicyDefaults.safetyNetSubsidy.maxSubsidy,
    },
  };
}

function createSatietyRecoveryByCommodity(): Record<string, number> {
  const recoveries: Record<string, number> = {};
  for (const commodity of commodities) {
    if (commodity.tier === 'Primary' && commodity.role.toLowerCase().includes('food')) {
      recoveries[commodity.name] = 25;
    }
    if (commodity.tier === 'SecondaryProcessedFood') {
      recoveries[commodity.name] = 50;
    }
  }
  return recoveries;
}

function calculateOccupationWage(occupationName: string): number {
  const occupation = occupations.find((candidate) => candidate.name === occupationName);
  if (occupation === undefined) {
    throw new Error(`unknown occupation: ${occupationName}`);
  }
  return occupation.baseWage;
}
