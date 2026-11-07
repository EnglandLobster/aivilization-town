import { advanceElapsedLaborPhysiology } from './residentLabor';
import { advanceElapsedPhysiology, type ElapsedPhysiologyInput } from './elapsedPhysiology';

export const PRODUCTIVE_PHYSIOLOGY_VERSION = 'resident-productive-physiology-v1';
// Physical axes are IEEE doubles. Permit only relative representation error when comparing
// an integer millisecond boundary, never an absolute resource allowance (zero stays zero).
export const PRODUCTIVE_PHYSIOLOGY_RELATIVE_PRECISION = 8 * Number.EPSILON;
const withinBudget = (cost: number, available: number) =>
  cost <= available ||
  cost - available <=
    Math.max(Math.abs(cost), Math.abs(available)) * PRODUCTIVE_PHYSIOLOGY_RELATIVE_PRECISION;
/** One actual productive interval; passive decay continues after physical work becomes impossible. */
export function advanceProductivePhysiology(
  input: Omit<ElapsedPhysiologyInput, 'sleep'> & {
    readonly workLimitMs: number;
    readonly effort: { readonly energyCostPerHour: number; readonly satietyCostPerHour: number };
  },
) {
  if (
    !Number.isSafeInteger(input.elapsedMs) ||
    input.elapsedMs < 0 ||
    !Number.isSafeInteger(input.workLimitMs) ||
    input.workLimitMs < 0 ||
    input.workLimitMs > input.elapsedMs ||
    Object.values(input.effort).some((v) => !Number.isFinite(v) || v < 0)
  )
    throw Error('invalid-productive-physiology-input');
  // Validate all ordinary physiology inputs even when no work can take place.
  advanceElapsedPhysiology({ ...input, elapsedMs: 0 });
  const active = (elapsedMs: number) =>
    advanceElapsedLaborPhysiology({
      ...input,
      elapsedMs,
      labor: input.effort,
    });
  const affordable = (ms: number) => {
    const hours = ms / 3600000;
    return (
      withinBudget(
        (input.decay.energyPerHour + input.effort.energyCostPerHour) * hours,
        input.previous.energy,
      ) &&
      withinBudget(
        (input.decay.satietyPerHour + input.effort.satietyCostPerHour) * hours,
        input.previous.satiety,
      ) &&
      active(ms).next.health > 0
    );
  };
  let low = 0,
    high = input.previous.health > 0 ? input.workLimitMs : 0;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (affordable(mid)) low = mid;
    else high = mid - 1;
  }
  const workedMs = low,
    work = active(workedMs);
  const remainder = advanceElapsedPhysiology({
    previous: work.next,
    elapsedMs: input.elapsedMs - workedMs,
    decay: input.decay,
    ...(input.deprivation ? { deprivation: input.deprivation } : {}),
  });
  return { workedMs, next: remainder.next, lowEnergyMs: work.lowEnergyMs + remainder.lowEnergyMs };
}
