/** Resolves a human/Agent quantity intent to existing physical stock. Historical reducers stay strict. */
export const INVENTORY_REQUEST_PRECISION = {
  version: 'inventory-request-precision-v1',
  relativeEpsilonMultiplier: 4,
  maximumAdjustment: 1e-9,
} as const;
export type InventoryQuantityResolution = {
  readonly policyVersion: typeof INVENTORY_REQUEST_PRECISION.version;
  readonly requested: number;
  readonly available: number;
  readonly settled: number;
};
export function resolveInventoryRequest(
  available: number,
  requested: number,
):
  | { readonly quantity: number; readonly quantityResolution?: InventoryQuantityResolution }
  | undefined {
  if (!Number.isFinite(available) || available < 0 || !Number.isFinite(requested) || requested <= 0)
    return undefined;
  if (requested <= available) return { quantity: requested };
  // No absolute epsilon floor: zero or tiny stock cannot satisfy an unrelated positive request.
  const tolerance = Math.min(
    INVENTORY_REQUEST_PRECISION.maximumAdjustment,
    Number.EPSILON *
      INVENTORY_REQUEST_PRECISION.relativeEpsilonMultiplier *
      Math.max(available, requested),
  );
  if (available <= 0 || requested - available > tolerance) return undefined;
  return {
    quantity: available,
    quantityResolution: {
      policyVersion: INVENTORY_REQUEST_PRECISION.version,
      requested,
      available,
      settled: available,
    },
  };
}
