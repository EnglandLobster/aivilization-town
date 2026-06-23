import { describe, expect, test } from 'vitest';
import {
  calculateNetWorth,
  calculatePriceChangeRatio,
  calculatePriceIndices,
  createAmmPool,
  valueInventory,
} from './index';

describe('price indices and valuation', () => {
  test('calculates commodity price change ratio as current price divided by baseline price', () => {
    expect(
      calculatePriceChangeRatio({ commodity: 'Apple', baselinePrice: 10, currentPrice: 25 }),
    ).toBe(2.5);
  });

  test('calculates food, non-food, and overall price indices from paper formulas', () => {
    const index = calculatePriceIndices([
      { commodity: 'Apple', baselinePrice: 10, currentPrice: 20 },
      { commodity: 'Bread', baselinePrice: 4, currentPrice: 32 },
      { commodity: 'Wood', baselinePrice: 5, currentPrice: 20 },
      { commodity: 'Book', baselinePrice: 8, currentPrice: 8 },
    ]);

    expect(index.food).toBeCloseTo(4, 8);
    expect(index.nonFood).toBeCloseTo(2, 8);
    expect(index.overall).toBeCloseTo(3, 8);
    expect(index.foodCount).toBe(2);
    expect(index.nonFoodCount).toBe(2);
  });

  test('values inventory at current AMM spot prices', () => {
    const pools = [
      createAmmPool({ commodity: 'Apple', commodityReserve: 100, currencyReserve: 1000 }),
      createAmmPool({ commodity: 'Wood', commodityReserve: 200, currencyReserve: 1000 }),
    ];

    expect(valueInventory({ inventory: { Apple: 2, Wood: 3 }, pools })).toBe(35);
    expect(
      calculateNetWorth({ currencyBalance: 100, inventory: { Apple: 2, Wood: 3 }, pools }),
    ).toBe(135);
  });
});
