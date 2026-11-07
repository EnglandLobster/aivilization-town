import { applyMaterialEvent } from './events';
import { fitsStock } from './inventoryFlow';
import { materialCustodyFlow } from './custodyFlow';
import { activeMaterialCustody, type MaterialCustodyProof } from './custodyModel';
import { no, type MaterialsState, type MaterialDecision } from './model';

/** Application-only port: logistics supplies consent, real custody/location and its exact transition proof. */
export function settleMaterialCustody(
  s: MaterialsState,
  actorId: string,
  at: number,
  receiptId: string,
  proof: MaterialCustodyProof,
  locationCapacity?: (locationId: string) => number | undefined,
): MaterialDecision {
  if (!s.custodies) return no('material-custody-not-enabled');
  if (
    proof.operation === 'reserve' &&
    (Object.keys(s.custodies.records).length >= s.custodies.policy.maxTotal ||
      [proof.sourceStockId, proof.destinationStockId].some(
        (id) =>
          Object.values(s.custodies!.records).filter(
            (v) =>
              activeMaterialCustody(v) && (v.sourceStockId === id || v.destinationStockId === id),
          ).length >= s.custodies!.policy.maxPerStock,
      ))
  )
    return no('material-custody-limit');
  const result = materialCustodyFlow(s, actorId, at, receiptId, proof);
  if (!result.accepted) return result;
  let next = s;
  for (const e of result.events) next = applyMaterialEvent(next, e);
  for (const id of [proof.sourceStockId, proof.destinationStockId]) {
    const stock = next.stocks[id]!;
    if (!fitsStock(next, id, stock.inventory, locationCapacity?.(stock.locationId)))
      return no('material-stock-capacity');
  }
  return result;
}
