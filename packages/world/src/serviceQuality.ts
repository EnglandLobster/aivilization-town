import type { TownPublicService } from '@aivilization/society';
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
