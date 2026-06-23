import { occupations, type OccupationConfig } from '@aivilization/content';

export type OccupationAgentState = {
  readonly residentialTier: number;
  readonly educationScore: number;
};

export function calculateDynamicKnowledgeThreshold(input: {
  readonly educationScores: readonly number[];
  readonly eligibilityShare: number;
}): number {
  assertEligibilityShare(input.eligibilityShare);
  if (input.educationScores.length === 0) {
    throw new Error('educationScores must not be empty');
  }

  const sortedScores = [...input.educationScores].sort((left, right) => left - right);
  const quantileProbability = 1 - input.eligibilityShare;
  const index = Math.ceil(quantileProbability * sortedScores.length) - 1;
  return sortedScores[Math.max(0, Math.min(sortedScores.length - 1, index))] ?? 0;
}

export function calculateEffectiveKnowledgeThreshold(input: {
  readonly educationScores: readonly number[];
  readonly educationFloor: number;
  readonly eligibilityShare: number;
}): number {
  assertNonNegativeFinite(input.educationFloor, 'educationFloor');
  return Math.max(
    input.educationFloor,
    calculateDynamicKnowledgeThreshold({
      educationScores: input.educationScores,
      eligibilityShare: input.eligibilityShare,
    }),
  );
}

export function isEligibleForOccupation(input: {
  readonly occupationName: string;
  readonly agent: OccupationAgentState;
  readonly populationEducationScores: readonly number[];
  readonly occupationCatalog?: readonly OccupationConfig[];
}): boolean {
  const occupationCatalog = input.occupationCatalog ?? occupations;
  const occupation = occupationCatalog.find((candidate) => candidate.name === input.occupationName);
  if (occupation === undefined) {
    throw new Error(`unknown occupation ${input.occupationName}`);
  }

  const threshold = calculateEffectiveKnowledgeThreshold({
    educationScores: input.populationEducationScores,
    educationFloor: occupation.educationFloor,
    eligibilityShare: occupation.eligibilityShare,
  });

  return (
    input.agent.residentialTier >= occupation.minResidentialTier &&
    input.agent.educationScore >= threshold
  );
}

export function calculateApplicationQuota(input: {
  readonly residentialTier: number;
  readonly quotaByResidentialTier: readonly number[];
}): number {
  if (!Number.isInteger(input.residentialTier) || input.residentialTier < 1) {
    throw new Error('residentialTier must be a positive integer');
  }
  if (input.quotaByResidentialTier.length === 0) {
    throw new Error('quotaByResidentialTier must not be empty');
  }

  let previousQuota = 0;
  for (const quota of input.quotaByResidentialTier) {
    if (!Number.isInteger(quota) || quota < 0) {
      throw new Error('quotaByResidentialTier values must be non-negative integers');
    }
    if (quota < previousQuota) {
      throw new Error('quotaByResidentialTier must be non-decreasing');
    }
    previousQuota = quota;
  }

  const index = Math.min(input.residentialTier - 1, input.quotaByResidentialTier.length - 1);
  return input.quotaByResidentialTier[index] ?? 0;
}

function assertEligibilityShare(value: number): void {
  if (!Number.isFinite(value) || value <= 0 || value > 1) {
    throw new Error('eligibilityShare must be within (0, 1]');
  }
}

function assertNonNegativeFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be non-negative`);
  }
}
