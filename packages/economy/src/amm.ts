export type AmmPool = {
  readonly commodity: string;
  readonly commodityReserve: number;
  readonly currencyReserve: number;
  /**
   * Optional regional market this pool belongs to. When the regional-markets
   * switch is enabled, each region keeps an independent AMM pool per commodity
   * so prices can diverge across the town; when disabled (the default) this is
   * undefined and the pool is the single global market pool. The AMM math is
   * agnostic to this field — it is an addressing concern, not a pricing one.
   */
  readonly regionId?: string;
};

export type AmmTradeResult = {
  readonly poolBefore: AmmPool;
  readonly poolAfter: AmmPool;
  readonly commodityDelta: number;
  readonly currencyDelta: number;
  readonly effectivePrice: number;
  readonly spotPriceBefore: number;
  readonly spotPriceAfter: number;
  readonly slippageRatio: number;
  readonly invariantBefore: number;
  readonly invariantAfter: number;
  readonly moneySupplyDelta: number;
};

export function createAmmPool(input: AmmPool): AmmPool {
  if (input.commodity.length === 0) {
    throw new Error('commodity must not be empty');
  }
  assertPositiveFinite(input.commodityReserve, 'commodityReserve');
  assertPositiveFinite(input.currencyReserve, 'currencyReserve');
  return { ...input };
}

export function getSpotPrice(pool: AmmPool): number {
  return pool.currencyReserve / pool.commodityReserve;
}

export function getInvariant(pool: AmmPool): number {
  return pool.commodityReserve * pool.currencyReserve;
}

export function buyFromPool(pool: AmmPool, commodityAmount: number): AmmTradeResult {
  assertPositiveFinite(commodityAmount, 'commodityAmount');
  if (commodityAmount >= pool.commodityReserve) {
    throw new Error('cannot buy entire pool reserve');
  }

  const spotPriceBefore = getSpotPrice(pool);
  const invariantBefore = getInvariant(pool);
  const commodityReserveAfter = pool.commodityReserve - commodityAmount;
  const currencyReserveAfter = invariantBefore / commodityReserveAfter;
  const currencyPaid = currencyReserveAfter - pool.currencyReserve;
  const poolAfter = createAmmPool({
    commodity: pool.commodity,
    commodityReserve: commodityReserveAfter,
    currencyReserve: currencyReserveAfter,
    ...(pool.regionId === undefined ? {} : { regionId: pool.regionId }),
  });
  const effectivePrice = currencyPaid / commodityAmount;
  const spotPriceAfter = getSpotPrice(poolAfter);

  return {
    poolBefore: pool,
    poolAfter,
    commodityDelta: -commodityAmount,
    currencyDelta: currencyPaid,
    effectivePrice,
    spotPriceBefore,
    spotPriceAfter,
    slippageRatio: effectivePrice / spotPriceBefore - 1,
    invariantBefore,
    invariantAfter: getInvariant(poolAfter),
    moneySupplyDelta: -currencyPaid,
  };
}

export function sellToPool(pool: AmmPool, commodityAmount: number): AmmTradeResult {
  assertPositiveFinite(commodityAmount, 'commodityAmount');

  const spotPriceBefore = getSpotPrice(pool);
  const invariantBefore = getInvariant(pool);
  const commodityReserveAfter = pool.commodityReserve + commodityAmount;
  const currencyReserveAfter = invariantBefore / commodityReserveAfter;
  const currencyPaidOut = pool.currencyReserve - currencyReserveAfter;
  const poolAfter = createAmmPool({
    commodity: pool.commodity,
    commodityReserve: commodityReserveAfter,
    currencyReserve: currencyReserveAfter,
    ...(pool.regionId === undefined ? {} : { regionId: pool.regionId }),
  });
  const effectivePrice = currencyPaidOut / commodityAmount;
  const spotPriceAfter = getSpotPrice(poolAfter);

  return {
    poolBefore: pool,
    poolAfter,
    commodityDelta: commodityAmount,
    currencyDelta: -currencyPaidOut,
    effectivePrice,
    spotPriceBefore,
    spotPriceAfter,
    slippageRatio: effectivePrice / spotPriceBefore - 1,
    invariantBefore,
    invariantAfter: getInvariant(poolAfter),
    moneySupplyDelta: currencyPaidOut,
  };
}

function assertPositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be positive`);
  }
}
