/** Exact cumulative allocation of an immutable integer budget; differences settle each interval. */
export function cumulativeUnitAllocation(total: number, elapsed: number, duration: number): number {
  if (
    ![total, elapsed, duration].every((n) => Number.isSafeInteger(n) && n >= 0) ||
    duration === 0 ||
    elapsed > duration
  )
    throw Error('invalid-cumulative-unit-allocation');
  return Number((BigInt(total) * BigInt(elapsed)) / BigInt(duration));
}
