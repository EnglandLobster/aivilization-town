import type { ScenarioMarketPoolSeed, ScenarioPreset } from '@aivilization/content';
import type { SimulationClock } from '@aivilization/sim-core';
import { createWorldProjection, type WorldProjection } from '@aivilization/world';

export type ScenarioProjectionInput = {
  readonly preset: ScenarioPreset;
  readonly marketPools?: readonly ScenarioMarketPoolSeed[];
  readonly clock?: SimulationClock;
  readonly moneySupply?: number;
};

export function createWorldProjectionFromScenario(input: ScenarioProjectionInput): WorldProjection {
  return createWorldProjection({
    clock: input.clock ?? input.preset.clock,
    locations: input.preset.locations.map((location) => ({
      locationId: location.locationId,
      name: location.name,
      kind: location.kind,
      activityAffinities: location.activityAffinities,
      capacity: location.capacity,
      source: location.source,
      ...(location.mapPosition === undefined ? {} : { mapPosition: location.mapPosition }),
      ...(location.connections === undefined ? {} : { connections: location.connections }),
    })),
    agents: input.preset.agentSeeds.map((agent) => ({
      agentId: agent.agentId,
      locationId: agent.locationId,
      physiology: agent.physiology,
      educationScore: agent.educationScore,
      balance: agent.balance,
      residentialTier: agent.residentialTier,
      job: agent.job,
      inventory: agent.inventory,
    })),
    marketPools: (input.marketPools ?? []).map((pool) => ({
      commodity: pool.commodity,
      commodityReserve: pool.commodityReserve,
      currencyReserve: pool.currencyReserve,
    })),
    moneySupply: input.moneySupply ?? calculateCirculatingMoneySupply(input.preset),
  });
}

function calculateCirculatingMoneySupply(preset: ScenarioPreset): number {
  return preset.agentSeeds.reduce((total, agent) => total + agent.balance, 0);
}
