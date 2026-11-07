import { expect, test } from 'vitest';
import { removeInventory } from './inventory';
import { resolveInventoryRequest } from './inventoryRequest';

test('intent resolution uses only existing stock and leaves old event arithmetic unchanged', () => {
  const stock = removeInventory(removeInventory({ Pie: 1 }, 'Pie', 0.4), 'Pie', 0.4);
  const r = resolveInventoryRequest(stock.Pie!, 0.2)!;
  expect(r.quantity).toBe(stock.Pie);
  expect(r.quantityResolution).toEqual({
    policyVersion: 'inventory-request-precision-v1',
    requested: 0.2,
    available: stock.Pie,
    settled: stock.Pie,
  });
  expect(removeInventory(stock, 'Pie', r.quantity)).toEqual({});
  expect(() => removeInventory(stock, 'Pie', 0.2)).toThrow('insufficient');
  expect(resolveInventoryRequest(1, 0.2)).toEqual({ quantity: 0.2 });
});
test('genuine shortages and invalid or missing quantities cannot be forgiven', () => {
  for (const [stock, requested] of [
    [0, 1e-30],
    [1e-30, 1e-20],
    [0.19, 0.2],
    [1e12, 1e12 + 0.0001],
    [Infinity, 1],
    [1, NaN],
    [-1, 1],
    [1, 0],
  ])
    expect(resolveInventoryRequest(stock!, requested!)).toBeUndefined();
  for (const scale of [1e-20, 1e-10, 1, 1e5]) {
    const stock = scale * (1 - 0.4 - 0.4),
      request = scale * 0.2;
    const r = resolveInventoryRequest(stock, request)!;
    expect(r.quantity).toBeLessThanOrEqual(stock);
    expect(r.quantity).toBeGreaterThan(0);
  }
});
