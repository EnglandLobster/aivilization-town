export type WorldDecisionContextTrace = {
  readonly agentId: string;
  readonly hasPhysiology: boolean;
  readonly hasBalance: boolean;
  readonly hasEducationScore: boolean;
  readonly hasResidentialTier: boolean;
  readonly inventoryItemCount: number;
  readonly marketSpotPriceCount: number;
  readonly hasLatestPriceIndex: boolean;
};

export function cloneWorldDecisionContextTrace(
  trace: WorldDecisionContextTrace,
): WorldDecisionContextTrace {
  return { ...trace };
}
