/**
 * Gini coefficient of a wealth distribution: 0 for perfect equality, approaching
 * 1 as one holder concentrates everything. Values are expected to be
 * non-negative wealth magnitudes (currency balance plus valued inventory);
 * the caller owns that domain interpretation, this stays a pure statistic.
 *
 * Uses the sorted weighted-sum form: for x sorted ascending,
 * G = Σ (2i − n − 1)·xᵢ / (n · Σ x). An empty distribution or one whose total
 * is zero (nobody holds anything) is defined as 0 — there is no inequality to
 * measure.
 */
export function calculateGiniCoefficient(values: readonly number[]): number {
  for (const value of values) {
    if (!Number.isFinite(value)) {
      throw new Error('gini values must be finite');
    }
  }
  const sorted = [...values].sort((left, right) => left - right);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  if (total === 0) {
    return 0;
  }
  const weightedSum = sorted.reduce(
    (sum, value, index) => sum + (2 * (index + 1) - sorted.length - 1) * value,
    0,
  );
  return weightedSum / (sorted.length * total);
}
