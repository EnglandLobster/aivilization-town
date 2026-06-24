import {
  calculateDynamicWage,
  calculateStaticWage,
  resolveOccupation,
  type KnowledgePremiumFunction,
} from '@aivilization/society';
import type {
  WorldCommandPolicies,
  WorldMarketPriceIndexState,
  WorldProjection,
} from '@aivilization/world';

export type ProjectionBackedWagePolicyInput = {
  readonly projection: WorldProjection;
  readonly knowledgePremium: KnowledgePremiumFunction;
  readonly shortTermAdjustment?: number;
  readonly maxShortTermAdjustment?: number;
};

export type ProjectionBackedWorldCommandPoliciesInput = ProjectionBackedWagePolicyInput & {
  readonly basePolicies: WorldCommandPolicies;
};

export function createProjectionBackedWageCalculator(
  input: ProjectionBackedWagePolicyInput,
): (occupationName: string) => number {
  const latestPriceIndex = resolveLatestMarketPriceIndex(input.projection);
  const populationEducationScores = Object.values(input.projection.agents).map(
    (agent) => agent.educationScore,
  );
  if (populationEducationScores.length === 0) {
    throw new Error('projection-backed wage policy requires at least one agent education score');
  }

  const shortTermAdjustment = input.shortTermAdjustment ?? 0;
  const maxShortTermAdjustment = input.maxShortTermAdjustment ?? Math.abs(shortTermAdjustment);

  return (occupationName) => {
    const occupation = resolveOccupation({ occupationName });
    if (occupation.jobTier <= 3) {
      return calculateStaticWage({
        occupationName,
        overallPriceChangeRatio: latestPriceIndex.overall,
      });
    }

    return calculateDynamicWage({
      occupationName,
      populationEducationScores,
      overallPriceChangeRatio: latestPriceIndex.overall,
      shortTermAdjustment,
      maxShortTermAdjustment,
      knowledgePremium: input.knowledgePremium,
    });
  };
}

export function createProjectionBackedWorldCommandPolicies(
  input: ProjectionBackedWorldCommandPoliciesInput,
): WorldCommandPolicies {
  return {
    ...input.basePolicies,
    wageCalculator: createProjectionBackedWageCalculator({
      projection: input.projection,
      knowledgePremium: input.knowledgePremium,
      ...(input.shortTermAdjustment === undefined
        ? {}
        : { shortTermAdjustment: input.shortTermAdjustment }),
      ...(input.maxShortTermAdjustment === undefined
        ? {}
        : { maxShortTermAdjustment: input.maxShortTermAdjustment }),
    }),
  };
}

function resolveLatestMarketPriceIndex(
  projection: WorldProjection,
): WorldMarketPriceIndexState {
  const firstIndex = projection.marketPriceIndices[0];
  if (firstIndex === undefined) {
    throw new Error('projection-backed wage policy requires at least one market price index');
  }

  const latestIndex = projection.marketPriceIndices.reduce((latest, candidate) =>
    candidate.recordedAt > latest.recordedAt ? candidate : latest,
  );
  if (!Number.isFinite(latestIndex.overall) || latestIndex.overall <= 0) {
    throw new Error('latest market price index overall must be positive');
  }

  return latestIndex;
}
