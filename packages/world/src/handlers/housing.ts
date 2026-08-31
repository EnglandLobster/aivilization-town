import {
  evaluateHousingConstruction,
  evaluateResidenceChange,
  type HousingConstructionPolicy,
  type ResidentialAssignmentPolicy,
} from '@aivilization/society';
import type { CommandEnvelope } from '@aivilization/sim-core';
import { assertAgentBuildHousingPayload, assertAgentChooseResidencePayload } from '../commands';
import type { WorldEvent } from '../events';
import {
  resolveAgentResidenceLocationId,
  resolveResidentialOccupancy,
  type WorldProjection,
} from '../projection';
import {
  makeEvent,
  makeMemoryEvent,
  parsePayload,
  rejectCommand,
  resolveCommandAgent,
} from './shared';

export function handleAgentChooseResidenceCommand(input: {
  readonly command: CommandEnvelope<'AgentChooseResidence', unknown>;
  readonly projection: WorldProjection;
  readonly policy: ResidentialAssignmentPolicy;
  readonly nextSequence: number;
}): WorldEvent[] {
  const agent = resolveCommandAgent(input.projection, input.command);
  const payloadResult = parsePayload(() =>
    assertAgentChooseResidencePayload(input.command.payload),
  );
  if (payloadResult.status === 'invalid') {
    return rejectCommand(input, 'AgentChooseResidence', payloadResult.reason);
  }
  const residence = input.projection.locations[payloadResult.payload.locationId];
  if (residence === undefined || residence.kind !== 'residence') {
    return rejectCommand(
      input,
      'AgentChooseResidence',
      `location ${payloadResult.payload.locationId} is not residential`,
    );
  }
  if (agent.locationId !== residence.locationId) {
    return rejectCommand(
      input,
      'AgentChooseResidence',
      `agent must be at residential location ${residence.locationId}`,
    );
  }
  const decision = evaluateResidenceChange({
    previousResidenceLocationId: resolveAgentResidenceLocationId(input.projection, agent),
    target: {
      locationId: residence.locationId,
      capacity: residence.capacity,
      occupied: resolveResidentialOccupancy(input.projection, residence.locationId),
    },
    policy: input.policy,
  });
  if (decision.status === 'rejected') {
    return rejectCommand(input, 'AgentChooseResidence', `${decision.reason}: ${decision.detail}`);
  }
  return [
    makeEvent(input, 0, 'AgentResidenceChanged', {
      agentId: agent.agentId,
      previousResidenceLocationId: decision.previousResidenceLocationId,
      nextResidenceLocationId: decision.nextResidenceLocationId,
      capacityAtDecision: decision.capacity,
      occupancyBefore: decision.occupancyBefore,
      occupancyAfter: decision.occupancyAfter,
      reason: 'agent-choice',
      policyVersion: decision.policyVersion,
    }),
    makeMemoryEvent(input, 1, {
      summary: `Chose ${residence.name} as home.`,
      status: 'succeeded',
      tags: ['residence', residence.locationId],
    }),
  ];
}

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
