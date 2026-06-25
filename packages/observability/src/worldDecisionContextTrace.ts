export type WorldDecisionContextTrace = {
  readonly agentId: string;
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
  readonly hasEconomicState?: boolean;
  readonly hasMarketPrices?: boolean;
  readonly completeEconomicContext?: boolean;
};

export function cloneWorldDecisionContextTrace(
  trace: WorldDecisionContextTrace,
): WorldDecisionContextTrace {
  return { ...trace };
}
