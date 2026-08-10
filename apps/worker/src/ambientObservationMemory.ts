import { createShortTermMemoryRecord, type ShortTermMemoryRecord } from '@aivilization/memory';
import {
  createSeededRandom,
  type AgentId,
  type CommandId,
  type EventId,
  type LocationId,
} from '@aivilization/sim-core';
import type { WorldEvent, WorldProjection } from '@aivilization/world';

export const CANONICAL_AMBIENT_OBSERVATION_MEMORY_POLICY_VERSION =
  'paper-local-ambient-observation-v1';
export const CANONICAL_AMBIENT_OBSERVATION_MAX_OBSERVERS_PER_EVENT = 4;
export const CANONICAL_AMBIENT_OBSERVATION_VISIBLE_EVENT_TYPES = [
  'ConversationRecorded',
  'SocialInteractionCompleted',
  'CommodityProduced',
  'WagePaid',
  'EducationChanged',
  'AgentLocationChanged',
] as const satisfies readonly WorldEvent['type'][];

export function createCanonicalAmbientObservationMemoryPolicyManifest() {
  return {
    policyVersion: CANONICAL_AMBIENT_OBSERVATION_MEMORY_POLICY_VERSION,
    enabled: true as const,
    visibleEventTypes: [...CANONICAL_AMBIENT_OBSERVATION_VISIBLE_EVENT_TYPES],
    maxObserversPerEvent: CANONICAL_AMBIENT_OBSERVATION_MAX_OBSERVERS_PER_EVENT,
    observerSelectionRule: 'event-seeded-stable-ranking-among-co-located-non-actor-agents' as const,
    marketContextRule:
      'current-amm-state-from-world-projection-and-authoritative-trades-from-market-observation-ledger' as const,
    marketTradeBystanderMemory: 'disabled-no-global-public-tape-fanout' as const,
    paperBoundary:
      'paper-stm-records-agent-execution-outcomes-and-significant-social-experience;-bystander-cap-is-repository-design' as const,
  };
}

export function createCanonicalAmbientObservationMemoryRuntimeInput() {
  const policy = createCanonicalAmbientObservationMemoryPolicyManifest();
  return {
    enabled: policy.enabled,
    visibleEventTypes: [...policy.visibleEventTypes],
    maxObserversPerEvent: policy.maxObserversPerEvent,
  };
}

export type WorkerAmbientObservationMemoryResult = {
  readonly observedEventCount: number;
  readonly recordCount: number;
  readonly records: readonly ShortTermMemoryRecord[];
};

type VisibleWorldEvent = {
  readonly eventId: EventId;
  readonly commandId?: CommandId;
  readonly type: WorldEvent['type'];
  readonly locationId: LocationId;
  readonly actorAgentIds: readonly AgentId[];
  readonly summary: string;
  readonly tags: readonly string[];
};

export function createAmbientObservationMemoryRecords(input: {
  readonly tickId: string;
  readonly events: readonly WorldEvent[];
  readonly projection: WorldProjection;
  readonly occurredAt: number;
  readonly importanceScore?: number;
  readonly maxObserversPerEvent?: number;
  readonly visibleEventTypes?: readonly WorldEvent['type'][];
}): WorkerAmbientObservationMemoryResult {
  assertNonEmpty(input.tickId, 'tickId');
  assertFinite(input.occurredAt, 'occurredAt');
  if (input.importanceScore !== undefined) {
    assertImportance(input.importanceScore);
  }
  if (
    input.maxObserversPerEvent !== undefined &&
    (!Number.isInteger(input.maxObserversPerEvent) || input.maxObserversPerEvent < 0)
  ) {
    throw new Error('maxObserversPerEvent must be a non-negative integer');
  }

  const visibleEvents = input.events
    .map((event) => toVisibleWorldEvent(event, input.projection))
    .filter((event): event is VisibleWorldEvent => event !== undefined)
    .filter(
      (event) =>
        input.visibleEventTypes === undefined || input.visibleEventTypes.includes(event.type),
    );
  const records = visibleEvents.flatMap((event) =>
    createObserverRecords({
      tickId: input.tickId,
      event,
      projection: input.projection,
      occurredAt: input.occurredAt,
      importanceScore: input.importanceScore ?? 0.55,
      ...(input.maxObserversPerEvent === undefined
        ? {}
        : { maxObserversPerEvent: input.maxObserversPerEvent }),
    }),
  );

  return {
    observedEventCount: visibleEvents.length,
    recordCount: records.length,
    records,
  };
}

function createObserverRecords(input: {
  readonly tickId: string;
  readonly event: VisibleWorldEvent;
  readonly projection: WorldProjection;
  readonly occurredAt: number;
  readonly importanceScore: number;
  readonly maxObserversPerEvent?: number;
}): readonly ShortTermMemoryRecord[] {
  const actorAgentIds = new Set(input.event.actorAgentIds);
  const candidates = Object.values(input.projection.agents)
    .filter((agent) => agent.locationId === input.event.locationId)
    .filter((agent) => !actorAgentIds.has(agent.agentId))
    .sort((left, right) => left.agentId.localeCompare(right.agentId));
  const observers =
    input.maxObserversPerEvent === undefined
      ? candidates
      : candidates
          .map((agent) => ({
            agent,
            rank: createSeededRandom(`${input.event.eventId}:${agent.agentId}`).nextFloat(),
          }))
          .sort(
            (left, right) =>
              left.rank - right.rank || left.agent.agentId.localeCompare(right.agent.agentId),
          )
          .slice(0, input.maxObserversPerEvent)
          .map((ranked) => ranked.agent);

  return observers.map((observer) =>
    createShortTermMemoryRecord({
      id: `${input.tickId}:ambient:${input.event.eventId}:${observer.agentId}`,
      agentId: observer.agentId,
      kind: 'observation',
      status: 'observed',
      summary: input.event.summary,
      occurredAt: input.occurredAt,
      importanceScore: input.importanceScore,
      source: {
        ...(input.event.commandId === undefined ? {} : { commandId: input.event.commandId }),
        eventIds: [input.event.eventId],
      },
      tags: input.event.tags,
    }),
  );
}

function toVisibleWorldEvent(
  event: WorldEvent,
  projection: WorldProjection,
): VisibleWorldEvent | undefined {
  switch (event.type) {
    case 'ConversationRecorded': {
      const location = projection.locations[event.payload.locationId];
      if (location === undefined) {
        return undefined;
      }
      return {
        eventId: event.id,
        ...(event.commandId === undefined ? {} : { commandId: event.commandId }),
        type: event.type,
        locationId: event.payload.locationId,
        actorAgentIds: event.payload.participantAgentIds,
        summary: `Observed ${formatAgentList(event.payload.participantAgentIds)} discuss ${
          event.payload.topic
        } at ${location.name}.`,
        tags: stableUnique([
          'ambient-observation',
          event.type,
          event.payload.locationId,
          ...event.payload.participantAgentIds,
          event.payload.topic,
        ]),
      };
    }
    case 'SocialInteractionCompleted': {
      const visible = visibleEventAtAgentLocation({
        event,
        projection,
        agentIds: [event.payload.sourceAgentId, event.payload.targetAgentId],
      });
      if (visible === undefined) {
        return undefined;
      }
      return {
        ...visible,
        summary: `Observed ${event.payload.sourceAgentId} interact with ${event.payload.targetAgentId}: ${event.payload.summary}`,
        tags: stableUnique([
          'ambient-observation',
          event.type,
          visible.locationId,
          event.payload.sourceAgentId,
          event.payload.targetAgentId,
          'social',
        ]),
      };
    }
    case 'TradeExecuted': {
      const visible = visibleEventAtAgentLocation({
        event,
        projection,
        agentIds: [event.payload.agentId],
      });
      if (visible === undefined) {
        return undefined;
      }
      const location = projection.locations[visible.locationId];
      return {
        ...visible,
        summary: `Observed ${event.payload.agentId} ${event.payload.side} ${formatQuantity(
          event.payload.commodityQuantity,
        )} ${event.payload.commodityName} at ${location?.name ?? visible.locationId}.`,
        tags: stableUnique([
          'ambient-observation',
          event.type,
          visible.locationId,
          event.payload.agentId,
          event.payload.commodityName,
          event.payload.side,
        ]),
      };
    }
    case 'CommodityProduced': {
      const visible = visibleEventAtAgentLocation({
        event,
        projection,
        agentIds: [event.payload.agentId],
      });
      if (visible === undefined) {
        return undefined;
      }
      const location = projection.locations[visible.locationId];
      return {
        ...visible,
        summary: `Observed ${event.payload.agentId} produce ${formatInventory(
          event.payload.produced,
        )} at ${location?.name ?? visible.locationId}.`,
        tags: stableUnique([
          'ambient-observation',
          event.type,
          visible.locationId,
          event.payload.agentId,
          ...Object.keys(event.payload.produced),
        ]),
      };
    }
    case 'WagePaid': {
      const visible = visibleEventAtAgentLocation({
        event,
        projection,
        agentIds: [event.payload.agentId],
      });
      if (visible === undefined) {
        return undefined;
      }
      const location = projection.locations[visible.locationId];
      return {
        ...visible,
        summary: `Observed ${event.payload.agentId} receive ${event.payload.amount} for ${event.payload.occupationName} at ${location?.name ?? visible.locationId}.`,
        tags: stableUnique([
          'ambient-observation',
          event.type,
          visible.locationId,
          event.payload.agentId,
          event.payload.occupationName,
          'work',
        ]),
      };
    }
    case 'EducationChanged': {
      const visible = visibleEventAtAgentLocation({
        event,
        projection,
        agentIds: [event.payload.agentId],
      });
      if (visible === undefined) {
        return undefined;
      }
      const location = projection.locations[visible.locationId];
      return {
        ...visible,
        summary: `Observed ${event.payload.agentId} study at ${location?.name ?? visible.locationId}.`,
        tags: stableUnique([
          'ambient-observation',
          event.type,
          visible.locationId,
          event.payload.agentId,
          'study',
        ]),
      };
    }
    case 'AgentLocationChanged': {
      const location = projection.locations[event.payload.nextLocationId];
      if (location === undefined) {
        return undefined;
      }
      return {
        eventId: event.id,
        ...(event.commandId === undefined ? {} : { commandId: event.commandId }),
        type: event.type,
        locationId: event.payload.nextLocationId,
        actorAgentIds: [event.payload.agentId],
        summary: `Observed ${event.payload.agentId} arrive at ${location.name}.`,
        tags: stableUnique([
          'ambient-observation',
          event.type,
          event.payload.nextLocationId,
          event.payload.agentId,
          'move',
        ]),
      };
    }
    case 'ActionRejected':
    case 'InventoryChanged':
    case 'JobApplicationSubmitted':
    case 'JobAssigned':
    case 'LocationObserved':
    case 'MarketPriceIndexRecorded':
    case 'MedicalTreatmentCharged':
    case 'PhysiologyChanged':
    case 'ResidentialTierUpgraded':
    case 'ResidentialUpkeepCharged':
    case 'ShortTermMemoryRecorded':
    case 'SimulationTimeAdvanced':
    case 'SubsidyPaid':
      return undefined;
  }
}

function visibleEventAtAgentLocation(input: {
  readonly event: WorldEvent;
  readonly projection: WorldProjection;
  readonly agentIds: readonly AgentId[];
}): VisibleWorldEvent | undefined {
  const primaryAgent = input.projection.agents[input.agentIds[0] ?? ''];
  if (primaryAgent?.locationId === null || primaryAgent?.locationId === undefined) {
    return undefined;
  }
  return {
    eventId: input.event.id,
    ...(input.event.commandId === undefined ? {} : { commandId: input.event.commandId }),
    type: input.event.type,
    locationId: primaryAgent.locationId,
    actorAgentIds: input.agentIds,
    summary: '',
    tags: [],
  };
}

function formatAgentList(agentIds: readonly AgentId[]): string {
  if (agentIds.length <= 2) {
    return agentIds.join(' and ');
  }
  return `${agentIds.slice(0, -1).join(', ')}, and ${agentIds.at(-1)}`;
}

function formatQuantity(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function formatInventory(inventory: Readonly<Record<string, number>>): string {
  const entries = Object.entries(inventory).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) {
    return 'nothing';
  }
  return entries
    .map(([itemName, quantity]) => `${formatQuantity(quantity)} ${itemName}`)
    .join(', ');
}

function stableUnique(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

function assertNonEmpty(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${name} must not be empty`);
  }
}

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be finite`);
  }
}

function assertImportance(value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error('importanceScore must be within [0, 1]');
  }
}
