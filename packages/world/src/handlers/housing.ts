import { evaluateHousingConstruction, type HousingConstructionPolicy } from '@aivilization/society';
import type { CommandEnvelope } from '@aivilization/sim-core';
import { assertAgentBuildHousingPayload } from '../commands';
import type { WorldEvent } from '../events';
import type { WorldProjection } from '../projection';
import {
  makeEvent,
  makeMemoryEvent,
  parsePayload,
  rejectCommand,
  resolveCommandAgent,
} from './shared';

export function handleAgentBuildHousingCommand(input: {
  readonly command: CommandEnvelope<'AgentBuildHousing', unknown>;
  readonly projection: WorldProjection;
  readonly policy: HousingConstructionPolicy;
  /** Application-supplied simulation-wide population for read-only dry runs. */
  readonly housingPopulation?: number;
  readonly nextSequence: number;
}): WorldEvent[] {
  const builder = resolveCommandAgent(input.projection, input.command);
  const payloadResult = parsePayload(() => assertAgentBuildHousingPayload(input.command.payload));
  if (payloadResult.status === 'invalid') {
    return rejectCommand(input, 'AgentBuildHousing', payloadResult.reason);
  }
  const location = input.projection.locations[payloadResult.payload.locationId];
  if (location === undefined) {
    return rejectCommand(
      input,
      'AgentBuildHousing',
      `unknown housing location ${payloadResult.payload.locationId}`,
    );
  }
  if (location.kind !== 'residence') {
    return rejectCommand(
      input,
      'AgentBuildHousing',
      `location ${location.locationId} is not residential`,
    );
  }
  if (location.capacity === null) {
    return rejectCommand(
      input,
      'AgentBuildHousing',
      `location ${location.locationId} already has unlimited capacity`,
    );
  }
  if (builder.locationId !== location.locationId) {
    return rejectCommand(
      input,
      'AgentBuildHousing',
      `builder must be at housing location ${location.locationId}`,
    );
  }
  const residentialLocations = Object.values(input.projection.locations).filter(
    (candidate) => candidate.kind === 'residence',
  );
  if (residentialLocations.some((candidate) => candidate.capacity === null)) {
    return rejectCommand(
      input,
      'AgentBuildHousing',
      'town already has unlimited residential capacity',
    );
  }
  const totalResidentialCapacity = residentialLocations.reduce(
    (total, candidate) => total + (candidate.capacity ?? 0),
    0,
  );
  const population = input.housingPopulation ?? Object.keys(input.projection.agents).length;
  const decision = evaluateHousingConstruction({
    locationCapacity: location.capacity,
    totalResidentialCapacity,
    population,
    builderInventory: builder.inventory,
    policy: input.policy,
  });
  if (decision.status === 'rejected') {
    return rejectCommand(input, 'AgentBuildHousing', `${decision.reason}: ${decision.detail}`);
  }

  const inventoryEvents = Object.entries(decision.consumedInventory)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([itemName, quantity], index) =>
      makeEvent(input, index, 'InventoryChanged', {
        agentId: builder.agentId,
        itemName,
        delta: -quantity,
        reason: 'housing-construction-material',
      }),
    );
  const constructionOffset = inventoryEvents.length;
  return [
    ...inventoryEvents,
    makeEvent(input, constructionOffset, 'HousingCapacityExpanded', {
      builderAgentId: builder.agentId,
      locationId: location.locationId,
      previousCapacity: decision.previousCapacity,
      nextCapacity: decision.nextCapacity,
      addedCapacity: decision.addedCapacity,
      populationAtDecision: decision.population,
      townResidentialCapacityAtDecision: decision.totalResidentialCapacity,
      occupancyRatioAtDecision: decision.occupancyRatio,
      consumedInventory: decision.consumedInventory,
      policyVersion: decision.policyVersion,
    }),
    makeMemoryEvent(input, constructionOffset + 1, {
      summary: `Expanded ${location.name} by ${decision.addedCapacity} housing slots.`,
      status: 'succeeded',
      tags: ['housing-construction', location.locationId, String(decision.addedCapacity)],
    }),
  ];
}
