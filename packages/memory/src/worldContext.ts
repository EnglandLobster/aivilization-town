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

export type MemorySynthesisWorldDecisionContext = {
  readonly agent: MemorySynthesisWorldDecisionAgentContext;
  readonly market: MemorySynthesisWorldDecisionMarketContext;
};

export type MemorySynthesisWorldDecisionContextTrace = {
  readonly agentId: AgentId;
  readonly hasPhysiology: boolean;
  readonly hasBalance: boolean;
  readonly hasEducationScore: boolean;
  readonly hasResidentialTier: boolean;
  readonly inventoryItemCount: number;
  readonly marketSpotPriceCount: number;
  readonly hasLatestPriceIndex: boolean;
};

export function createMemorySynthesisWorldDecisionContextTrace(
  context: MemorySynthesisWorldDecisionContext,
): MemorySynthesisWorldDecisionContextTrace {
  return {
    agentId: context.agent.agentId,
    hasPhysiology:
      Number.isFinite(context.agent.physiology.energy) &&
      Number.isFinite(context.agent.physiology.satiety) &&
      Number.isFinite(context.agent.physiology.health),
    hasBalance: Number.isFinite(context.agent.balance),
    hasEducationScore: Number.isFinite(context.agent.educationScore),
    hasResidentialTier: Number.isFinite(context.agent.residentialTier),
    inventoryItemCount: Object.keys(context.agent.inventory).length,
    marketSpotPriceCount: context.market.spotPrices.length,
    hasLatestPriceIndex: context.market.latestPriceIndex !== undefined,
  };
}
