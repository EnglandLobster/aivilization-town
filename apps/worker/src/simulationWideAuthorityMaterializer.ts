import {
  createProjectionCheckpoint,
  type AgentId,
  type PartitionKey,
} from '@aivilization/sim-core';
import type { ShortTermMemoryRecord } from '@aivilization/memory';
import type { WorldEvent, WorldProjection } from '@aivilization/world';
import { applyWorldEvent } from '@aivilization/world';
import type { LocalWorldRuntimeStorage } from './localRuntimeStorage';
import { hydrateAgentCognitiveSnapshot } from './agentCognitiveSnapshot';
import { hydrateWorldProjectionFromEventStream } from './projectionHydration';
import type {
  SimulationWideAuthorityInboxCursor,
  SimulationWideAuthorityService,
} from './simulationWideAuthority';
import { createAivilizationTownBulletinPolicy } from './aivilizationWorldPolicies';
import {
  createBulletinObservationRecords,
  createBulletinScheduledIntentions,
} from './bulletinBoard';

/**
 * Consumes a partition's slice of the simulation-wide authority inbox into the
 * partition event stream, that owner's short-term memory, and a fresh projection
 * checkpoint. It is the local half of the unified-town wiring: the authority
 * settles canonical world commands against one global ledger, and each
 * partition materializer applies only the deliveries addressed to it.
 *
 * Every delivery is applied idempotently. The event-store append uses a stable
 * idempotency key derived from the operation, fencing token, and partition, so
 * a replayed recovery re-applies already-materialized deliveries as no-ops. The
 * durable cursor is only advanced (`acknowledgeInbox`) after the local
 * projection and checkpoint have been written, matching the authority's
 * contiguous-acknowledgement rule.
 */
export type SimulationWideAuthorityMaterializer = {
  readonly partitionKey: PartitionKey;
  readonly materializeInbox: (input: {
    readonly lease: SimulationWideAuthorityMaterializerLease;
    readonly limit?: number;
  }) => Promise<SimulationWideAuthorityMaterializerResult>;
  readonly recover: (
    lease: SimulationWideAuthorityMaterializerLease,
  ) => Promise<SimulationWideAuthorityMaterializerResult>;
};

export type SimulationWideAuthorityMaterializerLease = {
  readonly workerId: string;
  readonly observedAt: number;
  readonly durationMs: number;
};

export type SimulationWideAuthorityMaterializerResult = {
  readonly partitionKey: PartitionKey;
  readonly materializedOperationIds: readonly string[];
  readonly throughFencingToken: number | undefined;
  readonly cursor: SimulationWideAuthorityInboxCursor | undefined;
  readonly projection: WorldProjection;
  readonly streamVersion: number;
  readonly idempotent: boolean;
};

export const SHORT_TERM_MEMORY_MATERIALIZATION_DEDUP_LIMIT = 4_096;

export function createSimulationWideAuthorityMaterializer(input: {
  readonly authority: SimulationWideAuthorityService;
  readonly storage: LocalWorldRuntimeStorage;
  readonly partitionKey: PartitionKey;
  readonly consumerId: string;
  readonly initialProjection: WorldProjection;
}): SimulationWideAuthorityMaterializer {
  if (input.consumerId.trim().length === 0) {
    throw new Error('simulation-wide authority materializer consumerId must not be empty');
  }

  const applyInbox = async (
    lease: SimulationWideAuthorityMaterializerLease,
    limit?: number,
  ): Promise<SimulationWideAuthorityMaterializerResult> => {
    const read = input.authority.readInbox({
      partitionKey: input.partitionKey,
      consumerId: input.consumerId,
      ...(limit === undefined ? {} : { limit }),
    });
    const startingBoundary = hydratePartition();
    if (read.deliveries.length === 0) {
      return {
        partitionKey: input.partitionKey,
        materializedOperationIds: [],
        throughFencingToken: read.cursor?.throughFencingToken,
        cursor: read.cursor,
        projection: startingBoundary.projection,
        streamVersion: startingBoundary.streamVersion,
        idempotent: true,
      };
    }

    const materializedOperationIds: string[] = [];
    let streamVersion = startingBoundary.streamVersion;
    let projection = startingBoundary.projection;

    for (const delivery of read.deliveries) {
      if (delivery.events.length === 0) {
        materializedOperationIds.push(delivery.operationId);
        continue;
      }
      const idempotencyKey = createInboxAppendIdempotencyKey(
        delivery.operationId,
        delivery.fencingToken,
        input.partitionKey,
      );
      const durableAppend = input.storage.eventStore.getIdempotentAppend(idempotencyKey);
      const appendResult =
        durableAppend === undefined
          ? input.storage.eventStore.appendToStream({
              streamName: input.storage.partition.eventStreamName,
              expectedVersion: streamVersion,
              idempotencyKey,
              events: resequenceEvents(delivery.events, streamVersion, input.partitionKey),
            })
          : replayDurableInboxAppend({
              deliveryEvents: delivery.events,
              partitionKey: input.partitionKey,
              streamName: input.storage.partition.eventStreamName,
              currentStreamVersion: streamVersion,
              idempotencyKey,
              durableAppend,
            });
      if (!appendResult.idempotentReplay) {
        projection = appendResult.appendedEvents.reduce(applyWorldEvent, projection);
      }
      // These adapters can fail after the event append. Re-run them for a
      // durable idempotent append too; each repository operation validates or
      // suppresses duplicates, closing the event→memory crash window.
      await ensurePartitionMemoryMaterialized(appendResult.appendedEvents, projection);
      await ensureBulletinAwarenessMaterialized(
        appendResult.appendedEvents,
        projection,
        lease.observedAt,
      );
      // Cognitive hydration deliberately runs even when the event append is an
      // idempotent replay. A crash can occur after the arrival event commits
      // but before repositories are hydrated; the still-unacknowledged inbox
      // delivery is the recovery record for that exact window.
      if (delivery.cognitiveSnapshot !== undefined) {
        await hydrateAgentCognitiveSnapshot({
          storage: input.storage,
          snapshot: delivery.cognitiveSnapshot,
        });
      }
      streamVersion = Math.max(streamVersion, appendResult.streamVersion);
      materializedOperationIds.push(delivery.operationId);
    }

    savePartitionProjectionBoundary({
      storage: input.storage,
      partitionKey: input.partitionKey,
      streamVersion,
      createdAt: lease.observedAt,
      initialProjection: input.initialProjection,
    });

    const lastDelivery = read.deliveries[read.deliveries.length - 1];
    if (lastDelivery === undefined) {
      const hydrated = hydratePartition();
      return {
        partitionKey: input.partitionKey,
        materializedOperationIds,
        throughFencingToken: read.cursor?.throughFencingToken,
        cursor: read.cursor,
        projection: hydrated.projection,
        streamVersion: hydrated.streamVersion,
        idempotent: true,
      };
    }
    const acknowledge = input.authority.acknowledgeInbox({
      operationId: `inbox-materialize:${input.partitionKey}:${input.consumerId}:${lastDelivery.fencingToken}`,
      partitionKey: input.partitionKey,
      consumerId: input.consumerId,
      throughFencingToken: lastDelivery.fencingToken,
      workerId: lease.workerId,
      observedAt: lease.observedAt,
      durationMs: lease.durationMs,
    });

    return {
      partitionKey: input.partitionKey,
      materializedOperationIds,
      throughFencingToken: acknowledge.throughFencingToken,
      cursor: {
        partitionKey: input.partitionKey,
        consumerId: input.consumerId,
        throughFencingToken: acknowledge.throughFencingToken,
        materializedAt: lease.observedAt,
      },
      projection,
      streamVersion,
      idempotent: false,
    };
  };

  return {
    partitionKey: input.partitionKey,
    materializeInbox: ({ lease, limit }) => applyInbox(lease, limit),
    recover: (lease) => applyInbox(lease),
  };

  function hydratePartition() {
    return hydrateWorldProjectionFromEventStream({
      initialProjection: input.initialProjection,
      eventStore: input.storage.eventStore,
      streamName: input.storage.partition.eventStreamName,
      checkpoint: {
        checkpointStore: input.storage.checkpointStore,
        snapshotStore: input.storage.snapshotStore,
        lookup: {
          simulationId: input.storage.partition.simulationId,
          partitionKey: input.partitionKey,
        },
      },
    });
  }

  /**
   * Owner-scoped idempotent memory materialization. A global settlement (for
   * example a cross-owner conversation) emits memory records for every
   * participant, but each partition's durable memory belongs to the Agents it
   * owns: records are only written for Agents present in this partition's
   * projection AFTER applying the delivery, and duplicate record ids are
   * skipped rather than appended twice. Replayed recoveries therefore never
   * depend on "recover before tick" ordering to stay duplicate-free.
   * Mechanism-stage bound: deduplication scans the most recent
   * SHORT_TERM_MEMORY_MATERIALIZATION_DEDUP_LIMIT records per Agent.
   */
  async function ensurePartitionMemoryMaterialized(
    events: readonly WorldEvent[],
    projectionAfter: WorldProjection,
  ): Promise<void> {
    const records = events
      .flatMap((event) => (event.type === 'ShortTermMemoryRecorded' ? [event.payload.record] : []))
      .filter((record) => projectionAfter.agents[record.agentId] !== undefined);
    for (const record of records) {
      await appendShortTermMemoryRecordIfNew(record);
    }
  }

  /**
   * Town-bulletin awareness fanout. A BulletinPosted delivery turns into one
   * hearsay observation memory per resident this partition owns (idempotent by
   * deterministic record id); high-priority bulletins additionally upsert a
   * forced-attention ScheduledIntention so the next cycle preempts ordinary
   * work. Data-driven: without the town-bulletin switch no BulletinPosted
   * events exist and this is a no-op.
   */
  async function ensureBulletinAwarenessMaterialized(
    events: readonly WorldEvent[],
    projectionAfter: WorldProjection,
    observedAt: number,
  ): Promise<void> {
    if (!events.some((event) => event.type === 'BulletinPosted')) {
      return;
    }
    const records = createBulletinObservationRecords({ events, projection: projectionAfter });
    for (const record of records) {
      await appendShortTermMemoryRecordIfNew(record);
    }
    const intentions = createBulletinScheduledIntentions({
      records,
      policy: createAivilizationTownBulletinPolicy(),
      createdAt: observedAt,
    });
    const intentionsByAgentId = new Map<AgentId, typeof intentions>();
    for (const intention of intentions) {
      const existing = intentionsByAgentId.get(intention.agentId) ?? [];
      intentionsByAgentId.set(intention.agentId, [...existing, intention]);
    }
    for (const [agentId, scheduledIntentions] of intentionsByAgentId) {
      await input.storage.intentionRepository.upsertScheduledIntentions(
        agentId,
        scheduledIntentions,
      );
    }
  }

  async function appendShortTermMemoryRecordIfNew(record: ShortTermMemoryRecord): Promise<void> {
    const recent = await input.storage.shortTermMemoryRepository.retrieve({
      agentId: record.agentId,
      limit: SHORT_TERM_MEMORY_MATERIALIZATION_DEDUP_LIMIT,
    });
    const existing = recent.find((candidate) => candidate.id === record.id);
    if (existing !== undefined) {
      if (stableStringify(existing) !== stableStringify(record)) {
        throw new Error(`short-term memory id ${record.id} has conflicting content`);
      }
      return;
    }
    await input.storage.shortTermMemoryRepository.append(record);
  }
}

function replayDurableInboxAppend(input: {
  readonly deliveryEvents: readonly WorldEvent[];
  readonly partitionKey: PartitionKey;
  readonly streamName: string;
  readonly currentStreamVersion: number;
  readonly idempotencyKey: string;
  readonly durableAppend: {
    readonly streamName: string;
    readonly expectedVersion?: number;
    readonly appendedEvents: readonly WorldEvent[];
    readonly streamVersion: number;
  };
}): {
  readonly appendedEvents: readonly WorldEvent[];
  readonly streamVersion: number;
  readonly idempotentReplay: true;
} {
  const expectedVersion = input.durableAppend.expectedVersion;
  if (
    input.durableAppend.streamName !== input.streamName ||
    expectedVersion === undefined ||
    input.durableAppend.streamVersion > input.currentStreamVersion
  ) {
    throw new Error(`authority inbox durable append is inconsistent: ${input.idempotencyKey}`);
  }
  const expectedEvents = resequenceEvents(
    input.deliveryEvents,
    expectedVersion,
    input.partitionKey,
  );
  if (stableStringify(expectedEvents) !== stableStringify(input.durableAppend.appendedEvents)) {
    throw new Error(`authority inbox durable append content diverged: ${input.idempotencyKey}`);
  }
  return {
    appendedEvents: input.durableAppend.appendedEvents,
    streamVersion: input.durableAppend.streamVersion,
    idempotentReplay: true,
  };
}

function resequenceEvents(
  events: readonly WorldEvent[],
  currentVersion: number,
  partitionKey: PartitionKey,
): readonly WorldEvent[] {
  return events.map((event, index) => ({
    ...event,
    partitionKey,
    sequence: currentVersion + index + 1,
  }));
}

function savePartitionProjectionBoundary(input: {
  readonly storage: LocalWorldRuntimeStorage;
  readonly partitionKey: PartitionKey;
  readonly streamVersion: number;
  readonly createdAt: number;
  readonly initialProjection: WorldProjection;
}): void {
  const current = input.storage.checkpointStore.getLatestCheckpoint({
    simulationId: input.storage.partition.simulationId,
    partitionKey: input.partitionKey,
  });
  if (current?.lastAppliedSequence === input.streamVersion && current.snapshot !== undefined) {
    return;
  }
  const hydrated = hydrateWorldProjectionFromEventStream({
    initialProjection: input.initialProjection,
    eventStore: input.storage.eventStore,
    streamName: input.storage.partition.eventStreamName,
    checkpoint: {
      checkpointStore: input.storage.checkpointStore,
      snapshotStore: input.storage.snapshotStore,
      lookup: {
        simulationId: input.storage.partition.simulationId,
        partitionKey: input.partitionKey,
      },
    },
  });
  if (hydrated.streamVersion !== input.streamVersion) {
    throw new Error(
      `simulation-wide authority materializer stream advanced unexpectedly for ${input.partitionKey}`,
    );
  }
  const snapshot = input.storage.snapshotStore.saveSnapshot({
    simulationId: input.storage.partition.simulationId,
    partitionKey: input.partitionKey,
    sequence: input.streamVersion,
    createdAt: input.createdAt,
    projection: hydrated.projection,
  });
  input.storage.checkpointStore.saveCheckpoint(
    createProjectionCheckpoint({
      simulationId: input.storage.partition.simulationId,
      partitionKey: input.partitionKey,
      lastAppliedSequence: input.streamVersion,
      snapshot,
    }),
  );
}

function createInboxAppendIdempotencyKey(
  operationId: string,
  fencingToken: number,
  partitionKey: PartitionKey,
): string {
  return `authority-inbox:${operationId}:${fencingToken}:${partitionKey}`;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`)
    .join(',')}}`;
}
