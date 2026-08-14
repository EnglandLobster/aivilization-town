import type { ScenarioMarketPoolSeed, ScenarioPreset } from '@aivilization/content';
import type { SimulationClock } from '@aivilization/sim-core';
import { createBankState, createWorldProjection, type WorldProjection } from '@aivilization/world';

export type ScenarioProjectionInput = {
  readonly preset: ScenarioPreset;
  readonly marketPools?: readonly ScenarioMarketPoolSeed[];
  readonly clock?: SimulationClock;
  readonly moneySupply?: number;
  /**
   * Optional initial public treasury. When present the fiscal feature is on
   * from bootstrap: public wages and safety nets draw from the treasury, and
   * taxes accumulate into it. Omitted keeps the legacy mint-funded world.
   */
  readonly treasury?: number;
  /**
   * Optional initial town-bank cash reserves. When present the bank slice
   * exists from bootstrap so loans can be issued against reserves. The caller
   * must include the reserves in the money supply seed, mirroring the
   * treasury convention (the bank cash account circulates).
   */
  readonly bankReserves?: number;
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
      ...(location.regionId === undefined ? {} : { regionId: location.regionId }),
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
      ...(pool.regionId === undefined ? {} : { regionId: pool.regionId }),
    })),
    moneySupply: input.moneySupply ?? calculateCirculatingMoneySupply(input.preset),
    ...(input.treasury === undefined ? {} : { treasury: input.treasury }),
    ...(input.bankReserves === undefined
      ? {}
      : { bank: createBankState({ reserves: input.bankReserves }) }),
  });
}

function calculateCirculatingMoneySupply(preset: ScenarioPreset): number {
  return preset.agentSeeds.reduce((total, agent) => total + agent.balance, 0);
}
