import { addInventory, removeInventory, type Inventory } from '@aivilization/economy';
import { validInventory, type MaterialsState } from './model';
import { activeMaterialCustody } from './custodyModel';
export const scaleInventory = (v: Inventory, n: number): Inventory =>
  Object.fromEntries(
    Object.entries(v)
      .map(([k, q]) => [k, q * n] as const)
      .filter(([, q]) => q !== 0),
  );
export function moveInventory(
  v: Inventory,
  items: Inventory,
  direction: 'add' | 'remove',
): Inventory {
  let result = v;
  for (const [k, q] of Object.entries(items))
    result = direction === 'add' ? addInventory(result, k, q) : removeInventory(result, k, q);
  return result;
}
export const containsInventory = (v: Inventory, items: Inventory) =>
  Object.entries(items).every(([k, q]) => Number.isFinite(v[k] ?? 0) && (v[k] ?? 0) >= q);
/** Reserve headroom for both returned inputs and future outputs, so settlement cannot get trapped by later deposits. */
export function fitsStock(
  s: MaterialsState,
  stockId: string,
  inventory: Inventory,
  locationCapacity?: number,
): boolean {
  let reserved = inventory;
  for (const job of Object.values(s.productions))
    if (job.stockId === stockId && job.status === 'open') {
      if (!job.sourceId) reserved = moveInventory(reserved, job.held, 'add');
      reserved = moveInventory(
        reserved,
        scaleInventory(job.recipe.outputs, job.quantity - job.completed),
        'add',
      );
    }
  for (const r of Object.values(s.reservations?.records ?? {}))
    if (r.stockId === stockId && r.status !== 'settled')
      reserved = moveInventory(reserved, r.held, 'add');
  for (const c of Object.values(s.custodies?.records ?? {}))
    if (
      activeMaterialCustody(c) &&
      (c.destinationStockId === stockId || (c.status === 'loaded' && c.sourceStockId === stockId))
    )
      reserved = moveInventory(reserved, c.original, 'add');
  if (!validInventory(reserved, s.policy.maxKinds, s.policy.maxQuantity, true)) return false;
  if (locationCapacity === undefined) return true;
  if (!Number.isFinite(locationCapacity) || locationCapacity < 0) return false;
  const stock = s.stocks[stockId];
  if (!stock) return false;
  const prospective = { ...s, stocks: { ...s.stocks, [stockId]: { ...stock, inventory } } };
  return materialLocationStorageUsage(prospective, stock.locationId).total <= locationCapacity;
}
/** One registered quantity unit per storage unit under the explicit premises-facility-use-v1 model. */
export function materialLocationStorageUsage(s: MaterialsState, locationId: string) {
  const ids = new Set(
    Object.values(s.stocks)
      .filter((v) => v.locationId === locationId)
      .map((v) => v.id),
  );
  const quantity = (v: Inventory) => Object.values(v).reduce((a, b) => a + b, 0);
  let stored = Object.values(s.stocks)
      .filter((v) => ids.has(v.id))
      .reduce((n, v) => n + quantity(v.inventory), 0),
    futureOutputs = 0;
  for (const p of Object.values(s.productions))
    if (ids.has(p.stockId) && p.status === 'open') {
      if (!p.sourceId) stored += quantity(p.held);
      futureOutputs += quantity(p.recipe.outputs) * (p.quantity - p.completed);
    }
  for (const r of Object.values(s.reservations?.records ?? {}))
    if (ids.has(r.stockId) && r.status !== 'settled') stored += quantity(r.held);
  if (!s.custodies) return { stored, futureOutputs, total: stored + futureOutputs };
  let incoming = 0,
    returnHeadroom = 0;
  for (const c of Object.values(s.custodies.records))
    if (activeMaterialCustody(c)) {
      if (ids.has(c.destinationStockId)) incoming += quantity(c.original);
      if (c.status === 'loaded' && ids.has(c.sourceStockId)) returnHeadroom += quantity(c.original);
    }
  return {
    stored,
    futureOutputs,
    incoming,
    returnHeadroom,
    total: stored + futureOutputs + incoming + returnHeadroom,
  };
}
