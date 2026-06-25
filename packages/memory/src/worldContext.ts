import type { AgentId } from '@aivilization/sim-core';

export type MemorySynthesisWorldDecisionAgentContext = {
  readonly agentId: AgentId;
  readonly locationId: string | null;
  readonly physiology: {
    readonly energy: number;
    readonly satiety: number;
    readonly health: number;
  };
  readonly educationScore: number;
  readonly balance: number;
  readonly residentialTier: number;
  readonly job: string | null;
  readonly inventory: Readonly<Record<string, number>>;
};

export type MemorySynthesisWorldDecisionMarketSpotPrice = {
  readonly commodity: string;
  readonly spotPrice: number;
};

export type MemorySynthesisWorldDecisionMarketPriceIndex = {
  readonly baselineAt: number;
  readonly recordedAt: number;
  readonly overall: number;
  readonly ratios: Readonly<Record<string, number>>;
};

export type MemorySynthesisWorldDecisionMarketContext = {
  readonly spotPrices: readonly MemorySynthesisWorldDecisionMarketSpotPrice[];
  readonly latestPriceIndex?: MemorySynthesisWorldDecisionMarketPriceIndex;
};

export type MemorySynthesisWorldDecisionOccupationApplicationQuota = {
  readonly residentialTier: number;
  readonly limit: number;
  readonly currentApplications: number;
  readonly remaining: number;
};

export type MemorySynthesisWorldDecisionOccupationRule = {
  readonly occupationName: string;
  readonly jobTier: number;
  readonly baseWage: number;
  readonly effectiveEducationThreshold: number;
  readonly requiredResidentialTier: number;
  readonly prerequisiteCommodity: string | null;
  readonly eligible: boolean;
  readonly rejectionReasons: readonly string[];
  readonly applicationQuota?: MemorySynthesisWorldDecisionOccupationApplicationQuota;
};

export type MemorySynthesisWorldDecisionProductionRule = {
  readonly commodity: string;
  readonly minResidentialTier: number | null;
  readonly inputs: Readonly<Record<string, number>>;
  readonly energyCost: number;
  readonly satietyCost: number;
  readonly timeCostSeconds: number;
  readonly producible: boolean;
  readonly rejectionReasons: readonly string[];
};

export type MemorySynthesisWorldDecisionRulesContext = {
  readonly criticalThresholds?: {
    readonly energy: number;
    readonly health: number;
  };
  readonly occupations: readonly MemorySynthesisWorldDecisionOccupationRule[];
  readonly production: readonly MemorySynthesisWorldDecisionProductionRule[];
};

export type MemorySynthesisWorldDecisionContext = {
  readonly agent: MemorySynthesisWorldDecisionAgentContext;
  readonly market: MemorySynthesisWorldDecisionMarketContext;
  readonly rules?: MemorySynthesisWorldDecisionRulesContext;
};

export type MemorySynthesisWorldDecisionContextTrace = {
  readonly agentId: AgentId;
  readonly hasLocationId: boolean;
  readonly hasPhysiology: boolean;
  readonly hasJob: boolean;
  readonly hasBalance: boolean;
  readonly hasEducationScore: boolean;
  readonly hasResidentialTier: boolean;
  readonly hasInventory: boolean;
  readonly inventoryItemCount: number;
  readonly marketSpotPriceCount: number;
  readonly hasLatestPriceIndex: boolean;
  readonly hasEconomicState: boolean;
  readonly hasMarketPrices: boolean;
  readonly completeEconomicContext: boolean;
  readonly occupationRuleCount: number;
  readonly eligibleOccupationRuleCount: number;
  readonly productionRuleCount: number;
  readonly producibleCommodityRuleCount: number;
};

export function createMemorySynthesisWorldDecisionContextTrace(
  context: MemorySynthesisWorldDecisionContext,
): MemorySynthesisWorldDecisionContextTrace {
  const hasBalance = Number.isFinite(context.agent.balance);
  const hasInventory = context.agent.inventory !== undefined;
  const hasLatestPriceIndex = context.market.latestPriceIndex !== undefined;
  const hasEconomicState = hasBalance && hasInventory;
  const hasMarketPrices =
    context.market.spotPrices.length > 0 &&
    context.market.spotPrices.every(
      (price) => price.commodity.trim().length > 0 && Number.isFinite(price.spotPrice),
    );

  return {
    agentId: context.agent.agentId,
    hasLocationId: context.agent.locationId !== undefined,
    hasPhysiology:
      Number.isFinite(context.agent.physiology.energy) &&
      Number.isFinite(context.agent.physiology.satiety) &&
      Number.isFinite(context.agent.physiology.health),
    hasJob: context.agent.job !== undefined,
    hasBalance,
    hasEducationScore: Number.isFinite(context.agent.educationScore),
    hasResidentialTier: Number.isFinite(context.agent.residentialTier),
    hasInventory,
    inventoryItemCount: Object.keys(context.agent.inventory).length,
    marketSpotPriceCount: context.market.spotPrices.length,
    hasLatestPriceIndex,
    hasEconomicState,
    hasMarketPrices,
    completeEconomicContext: hasEconomicState && hasMarketPrices && hasLatestPriceIndex,
    occupationRuleCount: context.rules?.occupations.length ?? 0,
    eligibleOccupationRuleCount:
      context.rules?.occupations.filter((occupation) => occupation.eligible).length ?? 0,
    productionRuleCount: context.rules?.production.length ?? 0,
    producibleCommodityRuleCount:
      context.rules?.production.filter((production) => production.producible).length ?? 0,
  };
}
