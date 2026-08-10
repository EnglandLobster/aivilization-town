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
  readonly currentWage?: number;
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
  readonly outputSpotPrice?: number;
  readonly inputSpotCost?: number;
  readonly grossMargin?: number;
  readonly grossMarginPerSecond?: number;
  readonly producible: boolean;
  readonly rejectionReasons: readonly string[];
};

export type WorldDecisionResidentialUpgradeRule = {
  readonly targetResidentialTier: number;
  readonly currencyCost: number;
  readonly minEducationScore: number;
  readonly inventoryCosts: Readonly<Record<string, number>>;
  readonly missingInventory: Readonly<Record<string, number>>;
  readonly eligible: boolean;
  readonly rejectionReasons: readonly string[];
};

export type WorldDecisionEducationOpportunityCostRule = {
  readonly policyVersion: string;
  readonly studyDurationSeconds: number;
  readonly educationRatePerSecond: number;
  readonly expectedEducationGain: number;
  readonly directCurrencyCost: number;
  readonly directInventoryCosts: Readonly<Record<string, number>>;
  readonly workLaborSeconds: number;
  readonly currentOccupationName: string | null;
  readonly foregoneLaborIncome: number;
  readonly totalCurrencyOpportunityCost: number;
  readonly minimumBalanceReserve: number;
  readonly balanceAfterDirectCost: number;
  readonly directlyAffordable: boolean;
  readonly preservesMinimumBalanceReserve: boolean;
};

export type WorldDecisionRulesContext = {
  readonly criticalThresholds?: {
    readonly energy: number;
    readonly health: number;
  };
  readonly occupations: readonly WorldDecisionOccupationRule[];
  readonly production: readonly WorldDecisionProductionRule[];
  readonly residentialUpgrade?: WorldDecisionResidentialUpgradeRule;
  readonly educationOpportunityCost?: WorldDecisionEducationOpportunityCostRule;
};

export type WorldDecisionSocietyAgentContext = {
  readonly agentId: AgentId;
  readonly ownerPartitionKey: string;
  readonly ownerLastAppliedSequence: number;
  readonly locationId: string | null;
  readonly job: string | null;
  readonly residentialTier: number;
  readonly educationScore: number;
  readonly displayName?: string;
  readonly activityAvailableAt?: number;
  readonly transit?: {
    readonly fromLocationId: string;
    readonly toLocationId: string;
    readonly departedAt: number;
    readonly arrivesAt: number;
  };
};

export type WorldDecisionSocietyContext = {
  readonly directoryId: string;
  readonly simulationId: string;
  readonly partitionBoundaries: readonly {
    readonly partitionKey: string;
    readonly lastAppliedSequence: number;
    readonly snapshotSequence: number;
    readonly simulationTime: number;
  }[];
  readonly agents: readonly WorldDecisionSocietyAgentContext[];
};

export type WorldDecisionContext = {
  readonly agent: WorldDecisionAgentContext;
  readonly market: WorldDecisionMarketContext;
  readonly society?: WorldDecisionSocietyContext;
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
  readonly hasEconomicState: boolean;
  readonly hasMarketPrices: boolean;
  readonly completeEconomicContext: boolean;
  readonly hasSocietyDirectory?: boolean;
  readonly societyPartitionCount?: number;
  readonly societyAgentCount?: number;
  readonly remoteSocietyAgentCount?: number;
  readonly occupationRuleCount: number;
  readonly eligibleOccupationRuleCount: number;
  readonly productionRuleCount: number;
  readonly producibleCommodityRuleCount: number;
  readonly hasResidentialUpgradeRule?: boolean;
  readonly residentialUpgradeEligible?: boolean;
  readonly hasEducationOpportunityCost?: boolean;
  readonly educationInvestmentDirectlyAffordable?: boolean;
  readonly educationInvestmentPreservesMinimumBalanceReserve?: boolean;
};

export function createWorldDecisionContextTrace(
  context: WorldDecisionContext,
): WorldDecisionContextTrace {
  const hasBalance = Number.isFinite(context.agent.balance);
  const hasInventory = context.agent.inventory !== undefined;
  const hasLatestPriceIndex = context.market.latestPriceIndex !== undefined;
  const hasEconomicState = hasBalance && hasInventory;
  const hasMarketPrices =
    context.market.spotPrices.length > 0 &&
    context.market.spotPrices.every(
      (price) => price.commodity.trim().length > 0 && Number.isFinite(price.spotPrice),
    );
  const localOwnerPartitionKey = context.society?.agents.find(
    (agent) => agent.agentId === context.agent.agentId,
  )?.ownerPartitionKey;

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
    ...(context.society === undefined
      ? {}
      : {
          hasSocietyDirectory: true,
          societyPartitionCount: context.society.partitionBoundaries.length,
          societyAgentCount: context.society.agents.length,
          remoteSocietyAgentCount: context.society.agents.filter(
            (agent) => agent.ownerPartitionKey !== localOwnerPartitionKey,
          ).length,
        }),
    occupationRuleCount: context.rules?.occupations.length ?? 0,
    eligibleOccupationRuleCount:
      context.rules?.occupations.filter((occupation) => occupation.eligible).length ?? 0,
    productionRuleCount: context.rules?.production.length ?? 0,
    producibleCommodityRuleCount:
      context.rules?.production.filter((production) => production.producible).length ?? 0,
    hasResidentialUpgradeRule: context.rules?.residentialUpgrade !== undefined,
    residentialUpgradeEligible: context.rules?.residentialUpgrade?.eligible ?? false,
    hasEducationOpportunityCost: context.rules?.educationOpportunityCost !== undefined,
    educationInvestmentDirectlyAffordable:
      context.rules?.educationOpportunityCost?.directlyAffordable ?? false,
    educationInvestmentPreservesMinimumBalanceReserve:
      context.rules?.educationOpportunityCost?.preservesMinimumBalanceReserve ?? false,
  };
}
