import {
  summarizeRegionalServiceQuality,
  type RegionalServiceQualitySummary,
  type TownPublicService,
} from '@aivilization/society';
import type { WorldEvent } from './events';
import type {
  WorldAgentState,
  WorldProjection,
  WorldRegionalServiceQualityState,
} from './projection';
import { resolveAgentRegion } from './regionalMarkets';

/** Read the latest authority-settled quality fact visible to an agent. */
export function resolveAgentServiceQuality(input: {
  readonly projection: WorldProjection;
  readonly agent: WorldAgentState;
  readonly service: TownPublicService;
}): WorldRegionalServiceQualityState | undefined {
  const regionId = resolveAgentRegion({
    projection: input.projection,
    agentLocationId: input.agent.locationId,
  });
  return input.projection.regionalServiceQualities?.[regionId]?.[input.service];
}

/** Latest regional summary at a simulation instant, including this command's events. */
export function resolveRegionalServiceQualitySummary(input: {
  readonly projection: WorldProjection;
  readonly events?: readonly WorldEvent[];
  readonly regionId: string;
  readonly settledAt?: number;
}): RegionalServiceQualitySummary | undefined {
  const byService = new Map<TownPublicService, WorldRegionalServiceQualityState>();
  const projected = input.projection.regionalServiceQualities?.[input.regionId];
  for (const service of ['education', 'healthcare'] as const) {
    const state = projected?.[service];
    if (state !== undefined) byService.set(service, state);
  }
  for (const event of input.events ?? []) {
    if (
      event.type !== 'RegionalServiceQualityUpdated' ||
      event.payload.regionId !== input.regionId ||
      (input.settledAt !== undefined && event.payload.settledAt > input.settledAt)
    ) {
      continue;
    }
    byService.set(event.payload.service, event.payload);
  }
  return summarizeRegionalServiceQuality([...byService.values()]);
}
