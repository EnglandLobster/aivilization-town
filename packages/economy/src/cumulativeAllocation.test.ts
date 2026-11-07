import { expect, test } from 'vitest';
import { cumulativeUnitAllocation as share } from './cumulativeAllocation';
test('cumulative allocations conserve the exact budget over arbitrary partitions without floating multiplication overflow', () => {
  const total = Number.MAX_SAFE_INTEGER,
    duration = 86400000;
  const points = [0, 1, 3599999, 3600000, 80000001, duration];
  const settled = points
    .slice(1)
    .reduce(
      (sum, at, i) => sum + (share(total, at, duration) - share(total, points[i]!, duration)),
      0,
    );
  expect(settled).toBe(total);
  expect(share(total, 1, duration)).toBe(Number(BigInt(total) / BigInt(duration)));
  expect(share(0, duration, duration)).toBe(0);
  expect(share(11, 2, 3)).toBe(7);
});
test.each([
  [1, 0, 0],
  [1, -1, 2],
  [1, 3, 2],
  [NaN, 0, 1],
  [1.1, 0, 1],
  [1, 0, Infinity],
])('rejects invalid integer allocation %j', (total, elapsed, duration) => {
  expect(() => share(total, elapsed, duration)).toThrow('invalid-cumulative-unit-allocation');
});
