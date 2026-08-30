export type WorldDecisionContextTrace = {
  readonly agentId: string;
  readonly contextViewVersion?: string;
  readonly contextViewStage?: string;
  readonly visibleContextSections?: readonly string[];
  readonly salienceCount?: number;
  readonly salienceKinds?: readonly string[];
  readonly matterCount?: number;
  readonly obligationMatterCount?: number;
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
  readonly hasEducationOpportunityCost?: boolean;
  readonly educationInvestmentDirectlyAffordable?: boolean;
  readonly educationInvestmentPreservesMinimumBalanceReserve?: boolean;
};

export function cloneWorldDecisionContextTrace(
  trace: WorldDecisionContextTrace,
): WorldDecisionContextTrace {
  return {
    ...trace,
    ...(trace.visibleContextSections === undefined
      ? {}
      : { visibleContextSections: [...trace.visibleContextSections] }),
    ...(trace.salienceKinds === undefined ? {} : { salienceKinds: [...trace.salienceKinds] }),
  };
}
