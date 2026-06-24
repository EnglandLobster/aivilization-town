import { describe, expect, test } from 'vitest';
import { buyFromPool, createAmmPool, getInvariant, getSpotPrice, sellToPool } from './index';

describe('constant product AMM', () => {
  test('quotes spot price as currency reserve divided by commodity reserve', () => {
    const pool = createAmmPool({
      commodity: 'Apple',
      commodityReserve: 100,
      currencyReserve: 1000,
    });

    expect(getSpotPrice(pool)).toBe(10);
    expect(getInvariant(pool)).toBe(100000);
  });

  test('buying from the pool preserves invariant, raises spot price, and removes currency supply', () => {
    const pool = createAmmPool({
      commodity: 'Apple',
      commodityReserve: 100,
      currencyReserve: 1000,
    });

    const trade = buyFromPool(pool, 10);

    expect(trade.poolAfter.commodityReserve).toBe(90);
    expect(getInvariant(trade.poolAfter)).toBeCloseTo(getInvariant(pool), 8);
    expect(trade.invariantBefore).toBeCloseTo(100000, 8);
    expect(trade.invariantAfter).toBeCloseTo(100000, 8);
    expect(trade.currencyDelta).toBeCloseTo(111.1111111111, 8);
    expect(trade.effectivePrice).toBeGreaterThan(trade.spotPriceBefore);
    expect(trade.spotPriceAfter).toBeGreaterThan(trade.spotPriceBefore);
    expect(trade.moneySupplyDelta).toBeCloseTo(-trade.currencyDelta, 8);
  });

  test('selling to the pool preserves invariant, lowers spot price, and mints currency supply', () => {
    const pool = createAmmPool({
      commodity: 'Apple',
      commodityReserve: 100,
      currencyReserve: 1000,
    });

    const trade = sellToPool(pool, 10);

    expect(trade.poolAfter.commodityReserve).toBe(110);
    expect(getInvariant(trade.poolAfter)).toBeCloseTo(getInvariant(pool), 8);
    expect(trade.invariantBefore).toBeCloseTo(100000, 8);
    expect(trade.invariantAfter).toBeCloseTo(100000, 8);
    expect(trade.currencyDelta).toBeCloseTo(-90.9090909091, 8);
    expect(trade.effectivePrice).toBeLessThan(trade.spotPriceBefore);
    expect(trade.spotPriceAfter).toBeLessThan(trade.spotPriceBefore);
    expect(trade.moneySupplyDelta).toBeCloseTo(-trade.currencyDelta, 8);
  });

  test('rejects invalid trades and exhausted reserves', () => {
    const pool = createAmmPool({
      commodity: 'Apple',
      commodityReserve: 100,
      currencyReserve: 1000,
    });

    expect(() => buyFromPool(pool, 0)).toThrow('commodityAmount must be positive');
    expect(() => sellToPool(pool, -1)).toThrow('commodityAmount must be positive');
    expect(() => buyFromPool(pool, 100)).toThrow('cannot buy entire pool reserve');
  });
});
