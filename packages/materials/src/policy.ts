import { RESOURCE_CONTROL_POLICY } from '@aivilization/authority';
import { assertMaterialsPolicy, type MaterialRecipe, type MaterialsPolicy } from './model';
/** Limits bound work and retained active resources; they confer no physical capacity or property rights. */
export function createMaterialsPolicy(recipes: readonly MaterialRecipe[]): MaterialsPolicy {
  const p: MaterialsPolicy = {
    version: 'resident-materials-v1',
    control: RESOURCE_CONTROL_POLICY,
    maxStocksPerController: 20,
    maxStocks: 2000,
    maxJobsPerStock: 100,
    maxJobs: 5000,
    maxKinds: 64,
    maxQuantity: 1_000_000,
    maxBatch: 100,
    maxWorkers: 30,
    maxShiftMs: 8 * 3600000,
    settlementIntervalMs: 60000,
    recipes: structuredClone(recipes),
  };
  assertMaterialsPolicy(p);
  return p;
}
