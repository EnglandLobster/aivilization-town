import type { AgentId } from '@aivilization/sim-core';

export type WorldDecisionAgentContext = {
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

export type WorldDecisionMarketSpotPrice = {
  readonly commodity: string;
  readonly spotPrice: number;
};

export type WorldDecisionMarketPriceIndex = {
  readonly baselineAt: number;
  readonly recordedAt: number;
  readonly overall: number;
  readonly ratios: Readonly<Record<string, number>>;
};

export type WorldDecisionMarketContext = {
  readonly spotPrices: readonly WorldDecisionMarketSpotPrice[];
  readonly latestPriceIndex?: WorldDecisionMarketPriceIndex;
};

export type WorldDecisionOccupationApplicationQuota = {
  readonly residentialTier: number;
  readonly limit: number;
  readonly currentApplications: number;
  readonly remaining: number;
};

export type WorldDecisionOccupationRule = {
  readonly occupationName: string;
  readonly jobTier: number;
  readonly baseWage: number;
  readonly effectiveEducationThreshold: number;
  readonly requiredResidentialTier: number;
  readonly prerequisiteCommodity: string | null;
  readonly eligible: boolean;
  readonly rejectionReasons: readonly string[];
  readonly applicationQuota?: WorldDecisionOccupationApplicationQuota;
};

export type WorldDecisionProductionRule = {
  readonly commodity: string;
  readonly minResidentialTier: number | null;
  readonly inputs: Readonly<Record<string, number>>;
  readonly energyCost: number;
  readonly satietyCost: number;
  readonly timeCostSeconds: number;
  readonly producible: boolean;
  readonly rejectionReasons: readonly string[];
};

export type WorldDecisionRulesContext = {
  readonly criticalThresholds?: {
    readonly energy: number;
    readonly health: number;
  };
  readonly occupations: readonly WorldDecisionOccupationRule[];
  readonly production: readonly WorldDecisionProductionRule[];
};

export type WorldDecisionContext = {
  readonly agent: WorldDecisionAgentContext;
  readonly market: WorldDecisionMarketContext;
  readonly rules?: WorldDecisionRulesContext;
};

export type WorldDecisionContextTrace = {
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
  readonly occupationRuleCount: number;
  readonly eligibleOccupationRuleCount: number;
  readonly productionRuleCount: number;
  readonly producibleCommodityRuleCount: number;
};

export function createWorldDecisionContextTrace(
  context: WorldDecisionContext,
): WorldDecisionContextTrace {
  return {
    agentId: context.agent.agentId,
    hasLocationId: context.agent.locationId !== undefined,
    hasPhysiology:
      Number.isFinite(context.agent.physiology.energy) &&
      Number.isFinite(context.agent.physiology.satiety) &&
      Number.isFinite(context.agent.physiology.health),
    hasJob: context.agent.job !== undefined,
    hasBalance: Number.isFinite(context.agent.balance),
    hasEducationScore: Number.isFinite(context.agent.educationScore),
    hasResidentialTier: Number.isFinite(context.agent.residentialTier),
    hasInventory: context.agent.inventory !== undefined,
    inventoryItemCount: Object.keys(context.agent.inventory).length,
    marketSpotPriceCount: context.market.spotPrices.length,
    hasLatestPriceIndex: context.market.latestPriceIndex !== undefined,
    occupationRuleCount: context.rules?.occupations.length ?? 0,
    eligibleOccupationRuleCount:
      context.rules?.occupations.filter((occupation) => occupation.eligible).length ?? 0,
    productionRuleCount: context.rules?.production.length ?? 0,
    producibleCommodityRuleCount:
      context.rules?.production.filter((production) => production.producible).length ?? 0,
  };
}
