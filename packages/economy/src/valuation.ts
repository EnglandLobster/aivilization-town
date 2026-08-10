import { getSpotPrice, type AmmPool } from './amm';
import { getInventoryQuantity, type Inventory } from './inventory';

export function valueInventory(input: {
  readonly inventory: Inventory;
  readonly pools: readonly AmmPool[];
}): number {
  return input.pools.reduce((totalValue, pool) => {
    return totalValue + getInventoryQuantity(input.inventory, pool.commodity) * getSpotPrice(pool);
  }, 0);
}

export function calculateNetWorth(input: {
  readonly currencyBalance: number;
  readonly inventory: Inventory;
  readonly pools: readonly AmmPool[];
}): number {
  return input.currencyBalance + valueInventory({ inventory: input.inventory, pools: input.pools });
}
