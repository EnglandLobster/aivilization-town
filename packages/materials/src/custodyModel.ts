import type { Inventory } from '@aivilization/economy';
import type { Controller } from '@aivilization/authority';
/** Explicit opt-in. A custody record is one physical consignment, not another copy of its source reservation. */
export const MATERIAL_CUSTODY_POLICY = {
  version: 'material-freight-custody-v1',
  maxTotal: 10000,
  maxPerStock: 100,
} as const;
export type MaterialCustodyPolicy = typeof MATERIAL_CUSTODY_POLICY;
export type MaterialCustody = {
  readonly id: string;
  readonly consumerId: string;
  readonly sourceReservationId: string;
  readonly sourceStockId: string;
  readonly destinationStockId: string;
  readonly original: Inventory;
  readonly held: Inventory;
  readonly status: 'reserved' | 'loaded' | 'delivered' | 'returned' | 'cancelled';
  readonly revision: number;
  readonly at: number;
};
export type MaterialCustodiesState = {
  readonly policy: MaterialCustodyPolicy;
  readonly records: Readonly<Record<string, MaterialCustody>>;
};
export type MaterialCustodyEvent =
  | { readonly type: 'MaterialCustodyEnabled'; readonly policy: MaterialCustodyPolicy }
  | { readonly type: 'MaterialCustodyChanged'; readonly custody: MaterialCustody };
/** The logistics aggregate's exact transition is the authority; this is never accepted as a resident argument. */
export type MaterialCustodyProof = {
  readonly id: string;
  readonly consumerId: string;
  readonly sourceReservationId: string;
  readonly sourceStockId: string;
  readonly destinationStockId: string;
  readonly items: Inventory;
  readonly beneficiary: Controller;
  readonly operation: 'reserve' | 'load' | 'deliver' | 'return' | 'cancel' | 'release';
  readonly evidenceId: string;
};
export const activeMaterialCustody = (c: MaterialCustody) =>
  c.status === 'reserved' || c.status === 'loaded';
export function assertMaterialCustodyPolicy(p: MaterialCustodyPolicy) {
  if (
    p.version !== MATERIAL_CUSTODY_POLICY.version ||
    p.maxTotal !== MATERIAL_CUSTODY_POLICY.maxTotal ||
    p.maxPerStock !== MATERIAL_CUSTODY_POLICY.maxPerStock
  )
    throw Error('unsupported-material-custody-policy');
}
