import { getSpotPrice } from '@aivilization/economy';
import type { WorldDecisionContext } from '@aivilization/agent-runtime';
import type { AgentId } from '@aivilization/sim-core';
import type { WorldMarketPriceIndexState, WorldProjection } from '@aivilization/world';

export function createWorldDecisionContextFromProjection(input: {
  readonly projection: WorldProjection;
  readonly agentId: AgentId;
}): WorldDecisionContext {
  const agent = input.projection.agents[input.agentId];
  if (agent === undefined) {
    throw new Error(`cannot create world decision context for unknown agent ${input.agentId}`);
  }

  const latestPriceIndex = resolveLatestPriceIndex(input.projection.marketPriceIndices);
  return {
    agent: {
      agentId: agent.agentId,
      locationId: agent.locationId,
      physiology: { ...agent.physiology },
      educationScore: agent.educationScore,
      balance: agent.balance,
      residentialTier: agent.residentialTier,
      job: agent.job,
      inventory: copyPositiveSortedRecord(agent.inventory),
    },
    market: {
      spotPrices: Object.values(input.projection.marketPools)
        .map((pool) => ({
          commodity: pool.commodity,
          spotPrice: getSpotPrice(pool),
        }))
        .sort((left, right) => left.commodity.localeCompare(right.commodity)),
      ...(latestPriceIndex === undefined
        ? {}
        : {
            latestPriceIndex: {
              baselineAt: latestPriceIndex.baselineAt,
              recordedAt: latestPriceIndex.recordedAt,
              overall: latestPriceIndex.overall,
              ratios: copyPositiveSortedRecord(latestPriceIndex.ratios),
            },
          }),
    },
  };
}

function resolveLatestPriceIndex(
  indices: readonly WorldMarketPriceIndexState[],
): WorldMarketPriceIndexState | undefined {
  return indices.reduce<WorldMarketPriceIndexState | undefined>(
    (latest, candidate) =>
      latest === undefined || candidate.recordedAt > latest.recordedAt ? candidate : latest,
    undefined,
  );
}

function copyPositiveSortedRecord(
  values: Readonly<Record<string, number>>,
): Readonly<Record<string, number>> {
  return Object.fromEntries(
    Object.entries(values)
      .filter(([, value]) => value > 0)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}
