import { createAmmPool, type AmmPool } from './amm';

export type ExternalMarketLiquidityPolicy = {
  readonly policyVersion: string;
  readonly cadenceMs: number;
  readonly commodityReserveFloor: number;
  readonly commodityReserveCeiling: number;
  readonly currencyReserveFloor: number;
  readonly currencyReserveCeiling: number;
  readonly maxAdjustmentRatioPerCadence: number;
};

export type ExternalMarketLiquidityDecision = {
  readonly poolAfter: AmmPool;
  readonly commodityReserveDelta: number;
  readonly currencyReserveDelta: number;
};

export function rebalanceMarketPoolLiquidity(input: {
  readonly pool: AmmPool;
  readonly policy: ExternalMarketLiquidityPolicy;
}): ExternalMarketLiquidityDecision {
  assertValidExternalMarketLiquidityPolicy(input.policy);
  const commodityReserveAfter = rebalanceReserve(
    input.pool.commodityReserve,
    input.policy.commodityReserveFloor,
    input.policy.commodityReserveCeiling,
    input.policy.maxAdjustmentRatioPerCadence,
  );
  const currencyReserveAfter = rebalanceReserve(
    input.pool.currencyReserve,
    input.policy.currencyReserveFloor,
    input.policy.currencyReserveCeiling,
    input.policy.maxAdjustmentRatioPerCadence,
  );
  return {
    poolAfter: createAmmPool({
      ...input.pool,
      commodityReserve: commodityReserveAfter,
      currencyReserve: currencyReserveAfter,
    }),
    commodityReserveDelta: commodityReserveAfter - input.pool.commodityReserve,
    currencyReserveDelta: currencyReserveAfter - input.pool.currencyReserve,
  };
}

export function assertValidExternalMarketLiquidityPolicy(
  policy: ExternalMarketLiquidityPolicy,
): void {
  if (policy.policyVersion.trim().length === 0) {
    throw new Error('external market policyVersion must not be empty');
  }
  if (!Number.isInteger(policy.cadenceMs) || policy.cadenceMs < 1) {
    throw new Error('external market cadenceMs must be a positive integer');
  }
  assertPositiveFinite(policy.commodityReserveFloor, 'commodityReserveFloor');
  assertPositiveFinite(policy.commodityReserveCeiling, 'commodityReserveCeiling');
  assertPositiveFinite(policy.currencyReserveFloor, 'currencyReserveFloor');
  assertPositiveFinite(policy.currencyReserveCeiling, 'currencyReserveCeiling');
  if (policy.commodityReserveCeiling < policy.commodityReserveFloor) {
    throw new Error('commodityReserveCeiling must be at least its floor');
  }
  if (policy.currencyReserveCeiling < policy.currencyReserveFloor) {
    throw new Error('currencyReserveCeiling must be at least its floor');
  }
  if (
    !Number.isFinite(policy.maxAdjustmentRatioPerCadence) ||
    policy.maxAdjustmentRatioPerCadence <= 0 ||
    policy.maxAdjustmentRatioPerCadence > 1
  ) {
    throw new Error('maxAdjustmentRatioPerCadence must be in (0, 1]');
  }
}

function rebalanceReserve(
  current: number,
  floor: number,
  ceiling: number,
  maxAdjustmentRatio: number,
): number {
  const target = current < floor ? floor : current > ceiling ? ceiling : current;
  const adjustment = target - current;
  const boundedAdjustment =
    Math.sign(adjustment) * Math.min(Math.abs(adjustment), current * maxAdjustmentRatio);
  return current + boundedAdjustment;
}

function assertPositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be positive finite`);
  }
}
