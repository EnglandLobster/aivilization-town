import type { KnowledgePremiumFunction } from '@aivilization/society';
import type { SimulationTimestamp } from '@aivilization/sim-core';
import type { WorldCommandPolicies, WorldProjection } from '@aivilization/world';
import type { WorkerTickMarketMetricsInput } from './tickRunner';
import { createProjectionBackedWorldCommandPolicySource } from './wagePolicy';
import type { WorldCommandPolicyResolver } from './worldCommandPolicySource';

export type ProjectionBackedEconomicRuntimeConfigInput = {
  readonly basePolicies: WorldCommandPolicies;
  readonly baselineProjection: WorldProjection;
  readonly baselineAt: SimulationTimestamp;
  readonly knowledgePremium: KnowledgePremiumFunction;
  readonly shortTermAdjustment?: number;
  readonly maxShortTermAdjustment?: number;
  readonly marketMetricAppendIdempotencyKey?: string;
};

export type ProjectionBackedEconomicRuntimeConfig = {
  readonly policies: WorldCommandPolicyResolver;
  readonly marketMetrics: WorkerTickMarketMetricsInput;
};

export function createProjectionBackedEconomicRuntimeConfig(
  input: ProjectionBackedEconomicRuntimeConfigInput,
): ProjectionBackedEconomicRuntimeConfig {
  return {
    policies: createProjectionBackedWorldCommandPolicySource({
      basePolicies: input.basePolicies,
      knowledgePremium: input.knowledgePremium,
      ...(input.shortTermAdjustment === undefined
        ? {}
        : { shortTermAdjustment: input.shortTermAdjustment }),
      ...(input.maxShortTermAdjustment === undefined
        ? {}
        : { maxShortTermAdjustment: input.maxShortTermAdjustment }),
    }),
    marketMetrics: {
      baselineProjection: input.baselineProjection,
      baselineAt: input.baselineAt,
      ...(input.marketMetricAppendIdempotencyKey === undefined
        ? {}
        : { appendIdempotencyKey: input.marketMetricAppendIdempotencyKey }),
    },
  };
}
