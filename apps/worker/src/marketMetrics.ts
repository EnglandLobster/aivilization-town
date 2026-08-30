import {
  calculateGiniCoefficient,
  calculateNetWorth,
  calculatePriceIndices,
  getSpotPrice,
  type AmmPool,
  type CommodityPriceSnapshot,
} from '@aivilization/economy';
import {
  deriveEducationLevel,
  EDUCATION_SYSTEM_MAX_LEVEL,
  type EducationSystemPolicy,
} from '@aivilization/society';
import {
  applyWorldEvent,
  totalDeposits,
  type EconomicCompositionRecordedPayload,
  type WorldAgentState,
  type WorldEvent,
  type WorldProjection,
} from '@aivilization/world';
import {
  createEventEnvelope,
  type AppendToEventStreamResult,
  type EventStore,
  type EventStreamName,
  type SimulationId,
  type SimulationTimestamp,
} from '@aivilization/sim-core';

/**
 * A read-only pool override lets the metrics be derived from the unified
 * authority pools while the recorded events are still appended to and applied
 * against the partition stream. Without an override the metrics read the
 * projection's own pools, preserving legacy single-partition behavior.
 */
export type MarketMetricsPoolOverride = {
  readonly marketPools: Readonly<Record<string, AmmPool>>;
};

export type MarketMetricsSnapshotInput = {
  readonly baselineProjection: WorldProjection;
  readonly currentProjection: WorldProjection;
  readonly baselineMarketOverride?: MarketMetricsPoolOverride;
  readonly currentMarketOverride?: MarketMetricsPoolOverride;
};

export type RecordMarketMetricsInput = MarketMetricsSnapshotInput & {
  readonly simulationId: SimulationId;
  readonly baselineAt: SimulationTimestamp;
  readonly issuedAt: SimulationTimestamp;
  readonly eventStore: EventStore<WorldEvent>;
  readonly streamName: EventStreamName;
  readonly appendIdempotencyKey: string;
  readonly expectedVersion?: number;
  /**
   * Enabled education-system policy used to record the per-level agent
   * headcount on the composition event. Absent or disabled omits
   * `educationDistribution`, keeping legacy runs byte-for-byte compatible.
   */
  readonly educationSystemPolicy?: EducationSystemPolicy;
};

export type RecordMarketMetricsResult = {
  readonly events: readonly WorldEvent[];
  readonly projection: WorldProjection;
  readonly appendResult: AppendToEventStreamResult<WorldEvent>;
};

export function createMarketPriceSnapshotsFromProjections(
  input: MarketMetricsSnapshotInput,
): CommodityPriceSnapshot[] {
  const currentPools =
    input.currentMarketOverride?.marketPools ?? input.currentProjection.marketPools;
  const baselinePools =
    input.baselineMarketOverride?.marketPools ?? input.baselineProjection.marketPools;
  const currentByCommodity = groupPoolsByCommodity(Object.values(currentPools));
  const baselineByCommodity = groupPoolsByCommodity(Object.values(baselinePools));
  const snapshots = [...currentByCommodity.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([commodity, currentCommodityPools]) => {
      const baselineCommodityPools = baselineByCommodity.get(commodity);
      if (baselineCommodityPools === undefined) {
        throw new Error(`missing baseline AMM pool for ${commodity}`);
      }
      return {
        commodity,
        baselinePrice: calculateLiquidityWeightedSpotPrice(baselineCommodityPools),
        currentPrice: calculateLiquidityWeightedSpotPrice(currentCommodityPools),
      };
    });

  if (snapshots.length === 0) {
    throw new Error('market price index requires at least one comparable AMM pool');
  }

  return snapshots;
}

/**
 * Economic-composition observation derived from the current (post-settlement)
 * projection. Pool-side fields read the override pools when the unified
 * authority owns the market, for the same reason the price index does;
 * agent/enterprise/treasury/bank fields always read the partition projection,
 * which is their authoritative state. Agent net worth values inventory at one
 * town-wide spot price per commodity (regional reserves summed, matching the
 * price index's liquidity weighting).
 */
export function createEconomicCompositionPayload(input: {
  readonly projection: WorldProjection;
  readonly recordedAt: number;
  readonly marketOverride?: MarketMetricsPoolOverride;
  /**
   * Enabled education-system policy; when present the payload records the
   * per-level agent headcount (`educationDistribution`). Agents without a
   * durable `educationLevel` fall back to deriving the level from
   * `educationScore` via the policy thresholds (E1 fallback semantics).
   */
  readonly educationSystemPolicy?: EducationSystemPolicy;
}): EconomicCompositionRecordedPayload {
  const projection = input.projection;
  const pools = Object.values(input.marketOverride?.marketPools ?? projection.marketPools);
  const agents = Object.values(projection.agents);
  const enterprises = Object.values(projection.enterprises);
  const valuationPools = aggregatePoolsByCommodity(pools);
  const bank = projection.bank;
  const educationSystemPolicy = input.educationSystemPolicy;
  return {
    recordedAt: input.recordedAt,
    moneySupply: projection.moneySupply,
    composition: {
      agents: agents.reduce((total, agent) => total + agent.balance, 0),
      enterprises: enterprises.reduce((total, enterprise) => total + enterprise.balance, 0),
      treasury: projection.treasury ?? 0,
      bank: bank?.balance ?? 0,
      ammPoolCurrency: pools.reduce((total, pool) => total + pool.currencyReserve, 0),
      ammPoolCommodityValue: pools.reduce(
        (total, pool) => total + pool.commodityReserve * getSpotPrice(pool),
        0,
      ),
      externalNetInflow: projection.externalMarket?.currencyReserveNetImports ?? 0,
    },
    enterprises: {
      total: enterprises.length,
      active: enterprises.filter((enterprise) => enterprise.status === 'active').length,
      insolvent: enterprises.filter((enterprise) => enterprise.status === 'insolvent').length,
      bankruptTotal: projection.bankruptEnterpriseTotal ?? 0,
    },
    gini: calculateGiniCoefficient(
      agents.map((agent) =>
        calculateNetWorth({
          currencyBalance: agent.balance,
          inventory: agent.inventory,
          pools: valuationPools,
        }),
      ),
    ),
    deposits: bank === undefined ? 0 : totalDeposits(bank),
    loansOutstanding:
      bank === undefined
        ? 0
        : Object.values(bank.loans)
            .filter((loan) => loan.status === 'active')
            .reduce((total, loan) => total + loan.principal + loan.accruedInterest, 0),
    ...(educationSystemPolicy === undefined || !educationSystemPolicy.enabled
      ? {}
      : {
          educationDistribution: countAgentsByEducationLevel(agents, educationSystemPolicy),
        }),
    ...(projection.renewableResources === undefined && projection.survivalOutcomes === undefined
      ? {}
      : {
          survival: {
            livingAgents: agents.length,
            deathsByCause: { ...projection.survivalOutcomes?.deathsByCause },
            emigrated: projection.survivalOutcomes?.emigrated ?? 0,
            resources: Object.entries(projection.renewableResources ?? {})
              .flatMap(([regionId, resources]) =>
                Object.values(resources).map((resource) => ({
                  regionId,
                  commodityName: resource.commodityName,
                  stock: resource.stock,
                  carryingCapacity: resource.carryingCapacity,
                  stockRatio: resource.stock / resource.carryingCapacity,
                  cumulativeExtracted:
                    projection.resourceFlowMetrics?.cumulativeExtractedByCommodity[
                      resource.commodityName
                    ] ?? 0,
                  scarcityRejections:
                    projection.resourceFlowMetrics?.scarcityRejectionsByCommodity[
                      resource.commodityName
                    ] ?? 0,
                })),
              )
              .sort(
                (left, right) =>
                  left.regionId.localeCompare(right.regionId) ||
                  left.commodityName.localeCompare(right.commodityName),
              ),
          },
        }),
  };
}

/**
 * Agent headcount per discrete education level ('0'..'5'). Agents without a
 * durable `educationLevel` (legacy registrations) derive it from
 * `educationScore` via the policy thresholds, matching the fallback used by
 * the study/recruitment handlers and the decision context.
 */
function countAgentsByEducationLevel(
  agents: readonly WorldAgentState[],
  policy: EducationSystemPolicy,
): Record<string, number> {
  const distribution: Record<string, number> = {};
  for (let level = 0; level <= EDUCATION_SYSTEM_MAX_LEVEL; level += 1) {
    distribution[String(level)] = 0;
  }
  for (const agent of agents) {
    const level = agent.educationLevel ?? deriveEducationLevel(agent.educationScore, policy);
    distribution[String(level)] = (distribution[String(level)] ?? 0) + 1;
  }
  return distribution;
}

/**
 * Append the tick's market-metric observation events (price index plus
 * economic composition) as one atomic stream append, then apply them onto the
 * current projection so downstream reads and checkpoints see the new state.
 */
export function recordMarketMetricsToEventStream(
  input: RecordMarketMetricsInput,
): RecordMarketMetricsResult {
  const expectedVersion =
    input.expectedVersion ?? input.eventStore.getStreamVersion(input.streamName);
  const snapshots = createMarketPriceSnapshotsFromProjections(input);
  const priceIndex = calculatePriceIndices(snapshots);
  const priceIndexEvent = createEventEnvelope({
    id: `${input.appendIdempotencyKey}:event:market-price-index`,
    simulationId: input.simulationId,
    type: 'MarketPriceIndexRecorded',
    payload: {
      baselineAt: input.baselineAt,
      food: priceIndex.food,
      nonFood: priceIndex.nonFood,
      overall: priceIndex.overall,
      foodCount: priceIndex.foodCount,
      nonFoodCount: priceIndex.nonFoodCount,
      ratios: priceIndex.ratios,
    },
    occurredAt: input.issuedAt,
    sequence: expectedVersion + 1,
  });
  const compositionEvent = createEventEnvelope({
    id: `${input.appendIdempotencyKey}:event:economic-composition`,
    simulationId: input.simulationId,
    type: 'EconomicCompositionRecorded',
    payload: createEconomicCompositionPayload({
      projection: input.currentProjection,
      recordedAt: input.issuedAt,
      ...(input.currentMarketOverride === undefined
        ? {}
        : { marketOverride: input.currentMarketOverride }),
      ...(input.educationSystemPolicy === undefined
        ? {}
        : { educationSystemPolicy: input.educationSystemPolicy }),
    }),
    occurredAt: input.issuedAt,
    sequence: expectedVersion + 2,
  });
  const events: WorldEvent[] = [priceIndexEvent, compositionEvent];
  const appendResult = input.eventStore.appendToStream({
    streamName: input.streamName,
    expectedVersion,
    idempotencyKey: input.appendIdempotencyKey,
    events,
  });
  const projection = appendResult.appendedEvents.reduce(applyWorldEvent, input.currentProjection);

  return {
    events: appendResult.appendedEvents,
    projection,
    appendResult,
  };
}

function groupPoolsByCommodity(pools: readonly AmmPool[]): Map<string, AmmPool[]> {
  const grouped = new Map<string, AmmPool[]>();
  for (const pool of pools) {
    const commodityPools = grouped.get(pool.commodity) ?? [];
    commodityPools.push(pool);
    grouped.set(pool.commodity, commodityPools);
  }
  return grouped;
}

/**
 * Town-wide price for a regional commodity. Summing reserves is equivalent to
 * weighting each regional spot price by its commodity-side market depth, so a
 * tiny illiquid region cannot dominate the aggregate index.
 */
function calculateLiquidityWeightedSpotPrice(pools: readonly AmmPool[]): number {
  const commodityReserve = pools.reduce((total, pool) => total + pool.commodityReserve, 0);
  const currencyReserve = pools.reduce((total, pool) => total + pool.currencyReserve, 0);
  return currencyReserve / commodityReserve;
}

/**
 * One virtual town-wide pool per commodity (regional reserves summed) so
 * inventory valuation sees a single spot price per commodity instead of
 * double-counting regional pools.
 */
function aggregatePoolsByCommodity(pools: readonly AmmPool[]): AmmPool[] {
  return [...groupPoolsByCommodity(pools).entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([commodity, commodityPools]) => ({
      commodity,
      commodityReserve: commodityPools.reduce((total, pool) => total + pool.commodityReserve, 0),
      currencyReserve: commodityPools.reduce((total, pool) => total + pool.currencyReserve, 0),
    }));
}
