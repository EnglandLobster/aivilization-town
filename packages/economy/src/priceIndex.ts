import { commodities, type CommodityConfig } from '@aivilization/content';

export type CommodityPriceSnapshot = {
  readonly commodity: string;
  readonly baselinePrice: number;
  readonly currentPrice: number;
};

export type CommodityPriceCategory = 'food' | 'non-food';

export type PriceIndex = {
  readonly food: number;
  readonly nonFood: number;
  readonly overall: number;
  readonly foodCount: number;
  readonly nonFoodCount: number;
  readonly ratios: Readonly<Record<string, number>>;
};

export function calculatePriceChangeRatio(snapshot: CommodityPriceSnapshot): number {
  assertPositiveFinite(snapshot.baselinePrice, 'baselinePrice');
  assertPositiveFinite(snapshot.currentPrice, 'currentPrice');
  return snapshot.currentPrice / snapshot.baselinePrice;
}

export function calculatePriceIndices(
  snapshots: readonly CommodityPriceSnapshot[],
  commodityCatalog: readonly CommodityConfig[] = commodities,
): PriceIndex {
  const foodRatios: number[] = [];
  const nonFoodRatios: number[] = [];
  const ratios: Record<string, number> = {};

  for (const snapshot of snapshots) {
    const ratio = calculatePriceChangeRatio(snapshot);
    ratios[snapshot.commodity] = ratio;

    const commodity = commodityCatalog.find((candidate) => candidate.name === snapshot.commodity);
    const category = commodity === undefined ? 'non-food' : classifyCommodity(commodity);
    if (category === 'food') {
      foodRatios.push(ratio);
    } else {
      nonFoodRatios.push(ratio);
    }
  }

  const food = geometricMeanOrOne(foodRatios);
  const nonFood = geometricMeanOrOne(nonFoodRatios);
  const totalCount = foodRatios.length + nonFoodRatios.length;
  const overall =
    totalCount === 0
      ? 1
      : (foodRatios.length / totalCount) * food + (nonFoodRatios.length / totalCount) * nonFood;

  return {
    food,
    nonFood,
    overall,
    foodCount: foodRatios.length,
    nonFoodCount: nonFoodRatios.length,
    ratios,
  };
}

export function classifyCommodity(commodity: CommodityConfig): CommodityPriceCategory {
  if (commodity.tier === 'SecondaryProcessedFood') {
    return 'food';
  }
  return commodity.role.toLowerCase().includes('food') ? 'food' : 'non-food';
}

function geometricMeanOrOne(values: readonly number[]): number {
  if (values.length === 0) {
    return 1;
  }
  return values.reduce((product, value) => product * value, 1) ** (1 / values.length);
}

function assertPositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be positive`);
  }
}
