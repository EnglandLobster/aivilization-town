import type { JobTierConfig, OccupationConfig } from '@aivilization/content';
import { resolveJobTier, resolveOccupation } from './occupation-catalog';

export type OccupationAgentState = {
  readonly residentialTier: number;
  readonly educationScore: number;
};

export type OccupationApplicationAgentState = OccupationAgentState & {
  readonly inventory: Readonly<Record<string, number>>;
};

export type OccupationApplicationRejectionReason =
  | 'residential-tier-too-low'
  | 'education-too-low'
  | 'missing-prerequisite';

export type OccupationApplicationDecision =
  | {
      readonly status: 'accepted';
      readonly occupationName: string;
      readonly jobTier: number;
      readonly effectiveEducationThreshold: number;
      readonly consumedInventory: Readonly<Record<string, number>>;
    }
  | {
      readonly status: 'rejected';
      readonly reason: OccupationApplicationRejectionReason;
      readonly detail: string;
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
  const occupation = resolveOccupation(input);
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

export function evaluateOccupationApplication(input: {
  readonly occupationName: string;
  readonly agent: OccupationApplicationAgentState;
  readonly populationEducationScores: readonly number[];
  readonly occupationCatalog?: readonly OccupationConfig[];
  readonly jobTierCatalog?: readonly JobTierConfig[];
}): OccupationApplicationDecision {
  const occupation = resolveOccupation(input);
  const jobTier = resolveJobTier({
    jobTier: occupation.jobTier,
    ...(input.jobTierCatalog === undefined ? {} : { jobTierCatalog: input.jobTierCatalog }),
  });
  const occupationThreshold = calculateEffectiveKnowledgeThreshold({
    educationScores: input.populationEducationScores,
    educationFloor: occupation.educationFloor,
    eligibilityShare: occupation.eligibilityShare,
  });
  const effectiveEducationThreshold = Math.max(
    occupationThreshold,
    jobTier.minEducationScore,
  );
  const effectiveResidentialTier = Math.max(
    occupation.minResidentialTier,
    jobTier.minResidentialTier,
  );

  if (input.agent.residentialTier < effectiveResidentialTier) {
    return rejectOccupationApplication(
      'residential-tier-too-low',
      `residentialTier requires ${effectiveResidentialTier}, available ${input.agent.residentialTier}`,
    );
  }
  if (input.agent.educationScore < effectiveEducationThreshold) {
    return rejectOccupationApplication(
      'education-too-low',
      `educationScore requires ${effectiveEducationThreshold}, available ${input.agent.educationScore}`,
    );
  }

  const prerequisiteCommodity = jobTier.prerequisiteCommodity;
  const consumedInventory =
    prerequisiteCommodity === null ? {} : { [prerequisiteCommodity]: 1 };
  for (const [itemName, requiredQuantity] of Object.entries(consumedInventory)) {
    const availableQuantity = input.agent.inventory[itemName] ?? 0;
    if (availableQuantity < requiredQuantity) {
      return rejectOccupationApplication(
        'missing-prerequisite',
        `${itemName} requires ${requiredQuantity}, available ${availableQuantity}`,
      );
    }
  }

  return {
    status: 'accepted',
    occupationName: occupation.name,
    jobTier: occupation.jobTier,
    effectiveEducationThreshold,
    consumedInventory,
  };
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

function rejectOccupationApplication(
  reason: OccupationApplicationRejectionReason,
  detail: string,
): OccupationApplicationDecision {
  return { status: 'rejected', reason, detail };
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
