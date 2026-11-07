/** Shared physical effort math for real manufacturing and construction; no identity, storage or orchestration. */
export const materialEffortCost = (totalMs: number, unitMs: number, unitCost: number) => {
  if (
    !Number.isSafeInteger(totalMs) ||
    totalMs < 0 ||
    !Number.isSafeInteger(unitMs) ||
    unitMs <= 0 ||
    !Number.isFinite(unitCost) ||
    unitCost < 0
  )
    throw new Error('invalid-physical-effort');
  const result = Math.round((totalMs / unitMs) * unitCost * 1e10) / 1e10;
  if (!Number.isFinite(result)) throw new Error('physical-effort-overflow');
  return result;
};
export function affordableWorkMs(input: {
  progressMs: number;
  remainingMs: number;
  elapsedMs: number;
  unitMs: number;
  energyCost: number;
  satietyCost: number;
  availableEnergy: number;
  availableSatiety: number;
}): number {
  if (
    ![input.progressMs, input.remainingMs, input.elapsedMs].every(
      (n) => Number.isSafeInteger(n) && n >= 0,
    ) ||
    ![input.availableEnergy, input.availableSatiety].every((n) => Number.isFinite(n) && n >= 0)
  )
    throw new Error('invalid-physical-work-budget');
  let low = 0,
    high = Math.min(input.elapsedMs, input.remainingMs);
  while (low < high) {
    const mid = Math.ceil((low + high) / 2),
      energy =
        materialEffortCost(input.progressMs + mid, input.unitMs, input.energyCost) -
        materialEffortCost(input.progressMs, input.unitMs, input.energyCost),
      satiety =
        materialEffortCost(input.progressMs + mid, input.unitMs, input.satietyCost) -
        materialEffortCost(input.progressMs, input.unitMs, input.satietyCost);
    if (energy <= input.availableEnergy && satiety <= input.availableSatiety) low = mid;
    else high = mid - 1;
  }
  return low;
}
