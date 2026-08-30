import {
  WORLD_DECISION_CONTEXT_VIEW_VERSION,
  type WorldDecisionContext,
} from '@aivilization/agent-runtime';
import type { MemorySynthesisWorldDecisionContext } from '@aivilization/memory';

/**
 * Runtime projection for reflection/social-model synthesis. The memory package
 * intentionally owns its compact input contract; worker is the adapter that
 * converts the complete authoritative read model into that contract.
 */
export function createMemorySynthesisContextView(
  context: WorldDecisionContext,
): MemorySynthesisWorldDecisionContext {
  return {
    contextViewVersion: WORLD_DECISION_CONTEXT_VIEW_VERSION,
    contextViewStage: 'memory-synthesis',
    agent: {
      agentId: context.agent.agentId,
      locationId: context.agent.locationId,
      physiology: { ...context.agent.physiology },
      educationScore: context.agent.educationScore,
      balance: context.agent.balance,
      residentialTier: context.agent.residentialTier,
      job: context.agent.job,
      inventory: { ...context.agent.inventory },
    },
    market: {
      spotPrices: context.market.spotPrices.map((price) => ({ ...price })),
      ...(context.market.latestPriceIndex === undefined
        ? {}
        : {
            latestPriceIndex: {
              ...context.market.latestPriceIndex,
              ratios: { ...context.market.latestPriceIndex.ratios },
            },
          }),
    },
    ...(context.rules === undefined
      ? {}
      : {
          rules: {
            ...(context.rules.criticalThresholds === undefined
              ? {}
              : { criticalThresholds: { ...context.rules.criticalThresholds } }),
            occupations: context.rules.occupations.map((occupation) => ({
              occupationName: occupation.occupationName,
              jobTier: occupation.jobTier,
              baseWage: occupation.baseWage,
              ...(occupation.currentWage === undefined
                ? {}
                : { currentWage: occupation.currentWage }),
              effectiveEducationThreshold: occupation.effectiveEducationThreshold,
              requiredResidentialTier: occupation.requiredResidentialTier,
              prerequisiteCommodity: occupation.prerequisiteCommodity,
              eligible: occupation.eligible,
              rejectionReasons: [...occupation.rejectionReasons],
              ...(occupation.applicationQuota === undefined
                ? {}
                : { applicationQuota: { ...occupation.applicationQuota } }),
            })),
            production: context.rules.production.map((production) => ({
              commodity: production.commodity,
              minResidentialTier: production.minResidentialTier,
              inputs: { ...production.inputs },
              energyCost: production.energyCost,
              satietyCost: production.satietyCost,
              timeCostSeconds: production.timeCostSeconds,
              ...(production.outputSpotPrice === undefined
                ? {}
                : { outputSpotPrice: production.outputSpotPrice }),
              ...(production.inputSpotCost === undefined
                ? {}
                : { inputSpotCost: production.inputSpotCost }),
              ...(production.grossMargin === undefined
                ? {}
                : { grossMargin: production.grossMargin }),
              ...(production.grossMarginPerSecond === undefined
                ? {}
                : { grossMarginPerSecond: production.grossMarginPerSecond }),
              producible: production.producible,
              rejectionReasons: [...production.rejectionReasons],
            })),
            ...(context.rules.residentialUpgrade === undefined
              ? {}
              : {
                  residentialUpgrade: {
                    ...context.rules.residentialUpgrade,
                    inventoryCosts: { ...context.rules.residentialUpgrade.inventoryCosts },
                    missingInventory: { ...context.rules.residentialUpgrade.missingInventory },
                    rejectionReasons: [...context.rules.residentialUpgrade.rejectionReasons],
                  },
                }),
          },
        }),
  };
}
