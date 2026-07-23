import {
  calculateDynamicWage,
  calculateStaticWage,
  resolveOccupation,
  type KnowledgePremiumFunction,
} from '@aivilization/society';
import type { WorldCommandPolicies, WorldProjection } from '@aivilization/world';
import type { WorldCommandPolicyResolver } from './worldCommandPolicySource';

export type ProjectionBackedWagePolicyInput = {
  readonly projection: WorldProjection;
  readonly knowledgePremium: KnowledgePremiumFunction;
  readonly shortTermAdjustment?: number;
  readonly maxShortTermAdjustment?: number;
  readonly missingMarketPriceIndexStrategy?: 'error' | 'neutral';
};

export type ProjectionBackedWorldCommandPoliciesInput = ProjectionBackedWagePolicyInput & {
  readonly basePolicies: WorldCommandPolicies;
};

export type ProjectionBackedWorldCommandPolicySourceInput = Omit<
  ProjectionBackedWorldCommandPoliciesInput,
  'projection'
>;

export function createProjectionBackedWageCalculator(
  input: ProjectionBackedWagePolicyInput,
): (occupationName: string) => number {
  const overallPriceChangeRatio = resolveLatestOverallPriceChangeRatio(
    input.projection,
    input.missingMarketPriceIndexStrategy ?? 'error',
  );
  const populationEducationScores = extractPopulationEducationScores(input.projection);

  const shortTermAdjustment = input.shortTermAdjustment ?? 0;
  const maxShortTermAdjustment = input.maxShortTermAdjustment ?? Math.abs(shortTermAdjustment);

  return (occupationName) => {
    const occupation = resolveOccupation({ occupationName });
    if (occupation.jobTier <= 3) {
      return calculateStaticWage({
        occupationName,
        overallPriceChangeRatio,
      });
    }

    return calculateDynamicWage({
      occupationName,
      populationEducationScores,
      overallPriceChangeRatio,
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
      ...(input.missingMarketPriceIndexStrategy === undefined
        ? {}
        : { missingMarketPriceIndexStrategy: input.missingMarketPriceIndexStrategy }),
    }),
    ...(input.basePolicies.jobApplication === undefined
      ? {}
      : {
          jobApplication: {
            ...input.basePolicies.jobApplication,
            populationEducationScores: extractPopulationEducationScores(input.projection),
          },
        }),
  };
}

export function createProjectionBackedWorldCommandPolicySource(
  input: ProjectionBackedWorldCommandPolicySourceInput,
): WorldCommandPolicyResolver {
  return (projection) =>
    createProjectionBackedWorldCommandPolicies({
      basePolicies: input.basePolicies,
      projection,
      knowledgePremium: input.knowledgePremium,
      ...(input.shortTermAdjustment === undefined
        ? {}
        : { shortTermAdjustment: input.shortTermAdjustment }),
      ...(input.maxShortTermAdjustment === undefined
        ? {}
        : { maxShortTermAdjustment: input.maxShortTermAdjustment }),
      ...(input.missingMarketPriceIndexStrategy === undefined
        ? {}
        : { missingMarketPriceIndexStrategy: input.missingMarketPriceIndexStrategy }),
    });
}

function extractPopulationEducationScores(projection: WorldProjection): readonly number[] {
  const scores = Object.values(projection.agents).map((agent) => agent.educationScore);
  if (scores.length === 0) {
    throw new Error('projection-backed wage policy requires at least one agent education score');
  }

  return scores;
}

function resolveLatestOverallPriceChangeRatio(
  projection: WorldProjection,
  missingMarketPriceIndexStrategy: 'error' | 'neutral',
): number {
  const firstIndex = projection.marketPriceIndices[0];
  if (firstIndex === undefined) {
    if (missingMarketPriceIndexStrategy === 'neutral') {
      return 1;
    }
    throw new Error('projection-backed wage policy requires at least one market price index');
  }

  const latestIndex = projection.marketPriceIndices.reduce((latest, candidate) =>
    candidate.recordedAt > latest.recordedAt ? candidate : latest,
  );
  if (!Number.isFinite(latestIndex.overall) || latestIndex.overall <= 0) {
    throw new Error('latest market price index overall must be positive');
  }

  return latestIndex.overall;
}
