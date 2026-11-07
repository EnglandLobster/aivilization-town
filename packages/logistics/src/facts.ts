import { validController, validControllerId } from '@aivilization/authority';
import { validInventory } from '@aivilization/materials';
import type { FreightTerms } from './model';
import { LOGISTICS_POLICY } from './model';
export function freightFactsEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b))
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((v, i) => freightFactsEqual(v, b[i]))
    );
  const x = a as Readonly<Record<string, unknown>>,
    y = b as Readonly<Record<string, unknown>>;
  return (
    Object.keys(x).length === Object.keys(y).length &&
    Object.keys(x).every((k) => Object.hasOwn(y, k) && freightFactsEqual(x[k], y[k]))
  );
}
export function freightMoneyMicros(n: number): number {
  const q = Math.round(n * 1e6);
  if (!Number.isFinite(n) || n < 0 || !Number.isSafeInteger(q) || Math.abs(q / 1e6 - n) > 1e-10)
    throw Error('invalid-freight-money');
  return q;
}
export const freightMoneyDifference = (a: number, b: number) =>
  (freightMoneyMicros(a) - freightMoneyMicros(b)) / 1e6;
export function validFreightTerms(f: FreightTerms, at: number): boolean {
  if (
    !validControllerId(f.id) ||
    f.id.length > 60 ||
    !validController(f.controller) ||
    !validController(f.recipient) ||
    ![f.sourceStockId, f.destinationStockId, f.materialRef.id, f.carrierId, f.payer.id].every(
      validControllerId,
    ) ||
    (f.vehicleId !== undefined && !validControllerId(f.vehicleId)) ||
    !['agent', 'collective'].includes(f.payer.sector) ||
    f.sourceStockId === f.destinationStockId ||
    !f.sourceLocationId ||
    !f.destinationLocationId ||
    f.sourceLocationId === f.destinationLocationId ||
    !Number.isSafeInteger(f.materialRef.revision) ||
    f.materialRef.revision < 1 ||
    !validInventory(f.items, 100, 1e9) ||
    !f.title.trim() ||
    f.title.length > 120 ||
    !f.terms.trim() ||
    f.terms.length > LOGISTICS_POLICY.maxTermsChars ||
    !Number.isSafeInteger(f.deadline) ||
    f.deadline <= at ||
    f.deadline > at + LOGISTICS_POLICY.maxWindowMs ||
    [f.deliveryFee, f.returnFee].some(
      (n) => !Number.isFinite(n) || n < 0 || n > LOGISTICS_POLICY.maxFee,
    )
  )
    return false;
  try {
    freightMoneyMicros(f.deliveryFee);
    freightMoneyMicros(f.returnFee);
    return true;
  } catch {
    return false;
  }
}
/** Quantity units, not kilograms; this explicit model also covers ordinary personal inventory. */
export function physicalLoadUnits(items: Readonly<Record<string, number>>) {
  let total = 0;
  for (const amount of Object.values(items)) {
    if (!Number.isFinite(amount) || amount < 0) throw Error('invalid-physical-load');
    total += amount;
  }
  if (!Number.isFinite(total)) throw Error('physical-load-overflow');
  return total;
}
