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
