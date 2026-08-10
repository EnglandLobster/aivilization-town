import {
  AppendOnlyJsonLinesFile,
  createCommandEnvelope,
  createProjectionCheckpoint,
  type AgentId,
  type PartitionKey,
} from '@aivilization/sim-core';
import {
  dispatchWorldCommand,
  type AgentStartConversationTurnPayload,
  type WorldEvent,
  type WorldProjection,
} from '@aivilization/world';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LocalSimulationRuntimeHostPartition } from './localSimulationRuntimeHost';
import type { LocalSimulationSocietyDirectoryService } from './localSimulationSocietyDirectory';
import { hydrateWorldProjectionFromEventStream } from './projectionHydration';
import {
  resolveWorldCommandPolicies,
  type WorldCommandPolicySource,
} from './worldCommandPolicySource';

export const LOCAL_SIMULATION_SOCIAL_INTERACTION_SCHEMA_VERSION =
  'local-simulation-social-interaction-v1';

export type LocalSimulationCrossPartitionConversationRequest = {
  readonly operationId: string;
  readonly simulationId: string;
  readonly initiatorAgentId: string;
  readonly targetAgentId: string;
  readonly topic: string;
  readonly turns: readonly AgentStartConversationTurnPayload[];
  readonly issuedAt: number;
};

export type LocalSimulationCrossPartitionConversationResult = {
  readonly schemaVersion: typeof LOCAL_SIMULATION_SOCIAL_INTERACTION_SCHEMA_VERSION;
  readonly operationId: string;
  readonly conversationId: string;
  readonly sourcePartitionKey: PartitionKey;
  readonly targetPartitionKey: PartitionKey;
  readonly partitionStreamVersions: Readonly<Record<string, number>>;
  readonly idempotentReplay: boolean;
};

export type LocalSimulationSocialInteractionService = {
  readonly executeConversation: (
    request: LocalSimulationCrossPartitionConversationRequest,
  ) => Promise<LocalSimulationCrossPartitionConversationResult>;
  readonly recoverPending: () => Promise<
    readonly LocalSimulationCrossPartitionConversationResult[]
  >;
};

type SocialInteractionIntent = {
  readonly schemaVersion: typeof LOCAL_SIMULATION_SOCIAL_INTERACTION_SCHEMA_VERSION;
  readonly recordType: 'intent';
  readonly operationId: string;
  readonly requestFingerprint: string;
  readonly request: LocalSimulationCrossPartitionConversationRequest;
  readonly sourcePartitionKey: PartitionKey;
  readonly targetPartitionKey: PartitionKey;
  readonly eventsByPartition: Readonly<Record<string, readonly WorldEvent[]>>;
  readonly expectedVersionByPartition: Readonly<Record<string, number>>;
  readonly conversationId: string;
};

type SocialInteractionPartitionApplied = {
  readonly schemaVersion: typeof LOCAL_SIMULATION_SOCIAL_INTERACTION_SCHEMA_VERSION;
  readonly recordType: 'partition-applied';
  readonly operationId: string;
  readonly partitionKey: PartitionKey;
  readonly streamVersion: number;
  readonly appliedAt: number;
};

type SocialInteractionCompleted = {
  readonly schemaVersion: typeof LOCAL_SIMULATION_SOCIAL_INTERACTION_SCHEMA_VERSION;
  readonly recordType: 'completed';
  readonly operationId: string;
  readonly completedAt: number;
};

type SocialInteractionJournalRecord =
  | SocialInteractionIntent
  | SocialInteractionPartitionApplied
  | SocialInteractionCompleted;

type OperationState = {
  readonly intent: SocialInteractionIntent;
  readonly appliedPartitions: ReadonlyMap<PartitionKey, number>;
  readonly completed: boolean;
};

export function createLocalSimulationSocialInteractionService(input: {
  readonly rootDir: string;
  readonly partitions: readonly LocalSimulationRuntimeHostPartition[];
  readonly societyDirectory: LocalSimulationSocietyDirectoryService;
  readonly policies: WorldCommandPolicySource;
  /**
   * When true, the legacy cross-partition conversation transaction is
   * intentionally disabled because the simulation-wide authority has taken over
   * as the single settlement point for social interaction. This prevents the
   * two paths from concurrently owning the same interaction kind.
   * Pending operations are still recovered on demand.
   */
  readonly disabled?: boolean;
}): LocalSimulationSocialInteractionService {
  if (input.disabled === true) {
    return createDisabledSocialInteractionService();
  }
  const journalPath = createJournalPath(input.rootDir);
  const journal = new AppendOnlyJsonLinesFile<SocialInteractionJournalRecord>(journalPath);
  const partitionByKey = new Map(
    input.partitions.map((partition) => [
      createPartitionLookupKey(partition.simulationId, partition.partitionKey),
      partition,
    ]),
  );
  let operationTail: Promise<void> = Promise.resolve();

  const serialize = <TResult>(operation: () => Promise<TResult>): Promise<TResult> => {
    const result = operationTail.then(operation, operation);
    operationTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  const applyIntent = async (
    intent: SocialInteractionIntent,
    wasAlreadyKnown: boolean,
  ): Promise<LocalSimulationCrossPartitionConversationResult> => {
    const streamVersions: Record<string, number> = {};
    for (const partitionKey of [intent.sourcePartitionKey, intent.targetPartitionKey]) {
      const partition = requirePartition({
        partitionByKey,
        simulationId: intent.request.simulationId,
        partitionKey,
      });
      const events = intent.eventsByPartition[partitionKey];
      const expectedVersion = intent.expectedVersionByPartition[partitionKey];
      if (events === undefined || expectedVersion === undefined) {
        throw new Error(`social interaction ${intent.operationId} is missing ${partitionKey} plan`);
      }
      const appendResult = partition.bootstrap.storage.eventStore.appendToStream({
        streamName: partition.bootstrap.storage.partition.eventStreamName,
        expectedVersion,
        idempotencyKey: createPartitionAppendIdempotencyKey(intent.operationId, partitionKey),
        events,
      });
      await ensurePartitionMemoryMaterialized(partition, appendResult.appendedEvents);
      savePartitionProjectionBoundary({
        partition,
        streamVersion: appendResult.streamVersion,
        createdAt: intent.request.issuedAt,
      });
      streamVersions[partitionKey] = appendResult.streamVersion;
      const state = readOperationStates(journal).get(intent.operationId);
      if (!state?.appliedPartitions.has(partitionKey)) {
        journal.append([
          {
            schemaVersion: LOCAL_SIMULATION_SOCIAL_INTERACTION_SCHEMA_VERSION,
            recordType: 'partition-applied',
            operationId: intent.operationId,
            partitionKey,
            streamVersion: appendResult.streamVersion,
            appliedAt: intent.request.issuedAt,
          },
        ]);
      }
    }

    const state = readOperationStates(journal).get(intent.operationId);
    if (!state?.completed) {
      journal.append([
        {
          schemaVersion: LOCAL_SIMULATION_SOCIAL_INTERACTION_SCHEMA_VERSION,
          recordType: 'completed',
          operationId: intent.operationId,
          completedAt: intent.request.issuedAt,
        },
      ]);
    }
    return {
      schemaVersion: LOCAL_SIMULATION_SOCIAL_INTERACTION_SCHEMA_VERSION,
      operationId: intent.operationId,
      conversationId: intent.conversationId,
      sourcePartitionKey: intent.sourcePartitionKey,
      targetPartitionKey: intent.targetPartitionKey,
      partitionStreamVersions: streamVersions,
      idempotentReplay: wasAlreadyKnown,
    };
  };

  return {
    executeConversation: (request) =>
      serialize(async () => {
        validateConversationRequest(request);
        const states = readOperationStates(journal);
        const existing = states.get(request.operationId);
        const requestFingerprint = stableStringify(request);
        if (existing !== undefined) {
          if (existing.intent.requestFingerprint !== requestFingerprint) {
            throw new Error(
              `social interaction operation ${request.operationId} was reused with different input`,
            );
          }
          return applyIntent(existing.intent, true);
        }

        const intent = createInteractionIntent({
          request,
          requestFingerprint,
          partitions: input.partitions,
          societyDirectory: input.societyDirectory,
          policies: input.policies,
        });
        journal.append([intent]);
        return applyIntent(intent, false);
      }),
    recoverPending: () =>
      serialize(async () => {
        const recovered: LocalSimulationCrossPartitionConversationResult[] = [];
        for (const state of readOperationStates(journal).values()) {
          if (!state.completed) recovered.push(await applyIntent(state.intent, true));
        }
        return recovered;
      }),
  };
}

function createInteractionIntent(input: {
  readonly request: LocalSimulationCrossPartitionConversationRequest;
  readonly requestFingerprint: string;
  readonly partitions: readonly LocalSimulationRuntimeHostPartition[];
  readonly societyDirectory: LocalSimulationSocietyDirectoryService;
  readonly policies: WorldCommandPolicySource;
}): SocialInteractionIntent {
  const directory = input.societyDirectory.getDirectory({
    simulationId: input.request.simulationId,
  });
  const initiator = directory.agents.find(
    (agent) => agent.agentId === input.request.initiatorAgentId,
  );
  const target = directory.agents.find((agent) => agent.agentId === input.request.targetAgentId);
  if (initiator === undefined)
    throw new Error(`unknown society agent ${input.request.initiatorAgentId}`);
  if (target === undefined) throw new Error(`unknown society agent ${input.request.targetAgentId}`);
  if (initiator.ownerPartitionKey === target.ownerPartitionKey) {
    throw new Error('cross-partition conversation participants must have different owners');
  }

  const sourcePartition = requirePartition({
    partitionByKey: new Map(
      input.partitions.map((partition) => [
        createPartitionLookupKey(partition.simulationId, partition.partitionKey),
        partition,
      ]),
    ),
    simulationId: input.request.simulationId,
    partitionKey: initiator.ownerPartitionKey,
  });
  const targetPartition = requirePartition({
    partitionByKey: new Map(
      input.partitions.map((partition) => [
        createPartitionLookupKey(partition.simulationId, partition.partitionKey),
        partition,
      ]),
    ),
    simulationId: input.request.simulationId,
    partitionKey: target.ownerPartitionKey,
  });
  const sourceBoundary = hydratePartition(sourcePartition);
  const targetBoundary = hydratePartition(targetPartition);
  if (sourceBoundary.projection.clock.now !== targetBoundary.projection.clock.now) {
    throw new Error(
      `cross-partition conversation requires equal simulation time boundaries, received ${sourceBoundary.projection.clock.now} and ${targetBoundary.projection.clock.now}`,
    );
  }
  const mergedProjection = mergeConversationProjection({
    source: sourceBoundary.projection,
    target: targetBoundary.projection,
    initiatorAgentId: initiator.agentId,
    targetAgentId: target.agentId,
  });
  const command = createCommandEnvelope({
    id: `cross-partition-conversation-${input.request.operationId}`,
    simulationId: input.request.simulationId,
    actorId: input.request.initiatorAgentId,
    source: 'agent-runtime',
    type: 'AgentStartConversation',
    payload: {
      targetAgentId: input.request.targetAgentId,
      topic: input.request.topic,
      relationDelta: 0,
      attitudeDelta: 0,
      turns: input.request.turns,
    },
    issuedAt: input.request.issuedAt,
  });
  const plannedEvents = dispatchWorldCommand({
    command,
    projection: mergedProjection,
    policies: resolveWorldCommandPolicies({
      policies: input.policies,
      projection: mergedProjection,
    }),
    nextSequence: 1,
  });
  const rejection = plannedEvents.find((event) => event.type === 'ActionRejected');
  if (rejection?.type === 'ActionRejected') {
    throw new Error(`cross-partition conversation rejected: ${rejection.payload.reason}`);
  }
  const sharedEvents = plannedEvents.filter(
    (event) => event.type === 'ConversationRecorded' || event.type === 'SocialInteractionCompleted',
  );
  const sourceMemory = requireAgentMemory(plannedEvents, initiator.agentId);
  const targetMemory = requireAgentMemory(plannedEvents, target.agentId);
  const eventsByPartition = {
    [initiator.ownerPartitionKey]: resequenceEvents(
      [...sharedEvents, sourceMemory],
      sourceBoundary.streamVersion,
      initiator.ownerPartitionKey,
    ),
    [target.ownerPartitionKey]: resequenceEvents(
      [...sharedEvents, targetMemory],
      targetBoundary.streamVersion,
      target.ownerPartitionKey,
    ),
  };
  const conversation = plannedEvents.find((event) => event.type === 'ConversationRecorded');
  if (conversation?.type !== 'ConversationRecorded') {
    throw new Error('cross-partition conversation did not produce a conversation record');
  }
  return {
    schemaVersion: LOCAL_SIMULATION_SOCIAL_INTERACTION_SCHEMA_VERSION,
    recordType: 'intent',
    operationId: input.request.operationId,
    requestFingerprint: input.requestFingerprint,
    request: input.request,
    sourcePartitionKey: initiator.ownerPartitionKey,
    targetPartitionKey: target.ownerPartitionKey,
    eventsByPartition,
    expectedVersionByPartition: {
      [initiator.ownerPartitionKey]: sourceBoundary.streamVersion,
      [target.ownerPartitionKey]: targetBoundary.streamVersion,
    },
    conversationId: conversation.payload.conversationId,
  };
}

function mergeConversationProjection(input: {
  readonly source: WorldProjection;
  readonly target: WorldProjection;
  readonly initiatorAgentId: AgentId;
  readonly targetAgentId: AgentId;
}): WorldProjection {
  const sourceAgent = input.source.agents[input.initiatorAgentId];
  const targetAgent = input.target.agents[input.targetAgentId];
  if (sourceAgent === undefined || targetAgent === undefined) {
    throw new Error('cross-partition conversation owner projection is missing its Agent');
  }
  if (sourceAgent.locationId === null || targetAgent.locationId === null) {
    throw new Error('cross-partition conversation requires known participant locations');
  }
  if (sourceAgent.locationId !== targetAgent.locationId) {
    throw new Error(
      `cross-partition conversation requires co-location, received ${sourceAgent.locationId} and ${targetAgent.locationId}`,
    );
  }
  if (input.source.locations[sourceAgent.locationId] === undefined) {
    throw new Error(`source partition is missing shared location ${sourceAgent.locationId}`);
  }
  const socialRelations = { ...input.source.socialRelations };
  for (const [key, relation] of Object.entries(input.target.socialRelations)) {
    const current = socialRelations[key];
    if (current !== undefined && stableStringify(current) !== stableStringify(relation)) {
      throw new Error(`cross-partition social relation replica diverged for ${key}`);
    }
    socialRelations[key] = relation;
  }
  return {
    ...input.source,
    agents: { ...input.source.agents, [targetAgent.agentId]: targetAgent },
    socialRelations,
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

function requireAgentMemory(events: readonly WorldEvent[], agentId: AgentId): WorldEvent {
  const memory = events.find(
    (event) => event.type === 'ShortTermMemoryRecorded' && event.payload.record.agentId === agentId,
  );
  if (memory?.type !== 'ShortTermMemoryRecorded') {
    throw new Error(`cross-partition conversation did not produce memory for ${agentId}`);
  }
  return memory;
}

async function ensurePartitionMemoryMaterialized(
  partition: LocalSimulationRuntimeHostPartition,
  events: readonly WorldEvent[],
): Promise<void> {
  const records = events.flatMap((event) =>
    event.type === 'ShortTermMemoryRecorded' ? [event.payload.record] : [],
  );
  for (const record of records) {
    const recent = await partition.bootstrap.storage.shortTermMemoryRepository.retrieve({
      agentId: record.agentId,
      limit: 64,
    });
    const existing = recent.find((candidate) => candidate.id === record.id);
    if (existing !== undefined) {
      if (stableStringify(existing) !== stableStringify(record)) {
        throw new Error(`short-term memory id ${record.id} has conflicting content`);
      }
      continue;
    }
    await partition.bootstrap.storage.shortTermMemoryRepository.append(record);
  }
}

function savePartitionProjectionBoundary(input: {
  readonly partition: LocalSimulationRuntimeHostPartition;
  readonly streamVersion: number;
  readonly createdAt: number;
}): void {
  const storage = input.partition.bootstrap.storage;
  const current = storage.checkpointStore.getLatestCheckpoint({
    simulationId: storage.partition.simulationId,
    partitionKey: input.partition.partitionKey,
  });
  if (current?.lastAppliedSequence === input.streamVersion && current.snapshot !== undefined)
    return;
  const hydrated = hydratePartition(input.partition);
  if (hydrated.streamVersion !== input.streamVersion) {
    throw new Error('partition stream advanced while applying cross-partition conversation');
  }
  const snapshot = storage.snapshotStore.saveSnapshot({
    simulationId: input.partition.simulationId,
    partitionKey: input.partition.partitionKey,
    sequence: input.streamVersion,
    createdAt: input.createdAt,
    projection: hydrated.projection,
  });
  storage.checkpointStore.saveCheckpoint(
    createProjectionCheckpoint({
      simulationId: input.partition.simulationId,
      partitionKey: input.partition.partitionKey,
      lastAppliedSequence: input.streamVersion,
      snapshot,
    }),
  );
}

function hydratePartition(partition: LocalSimulationRuntimeHostPartition) {
  const storage = partition.bootstrap.storage;
  return hydrateWorldProjectionFromEventStream({
    initialProjection: partition.bootstrap.initialProjection,
    eventStore: storage.eventStore,
    streamName: storage.partition.eventStreamName,
    checkpoint: {
      checkpointStore: storage.checkpointStore,
      snapshotStore: storage.snapshotStore,
      lookup: {
        simulationId: storage.partition.simulationId,
        partitionKey: partition.partitionKey,
      },
    },
  });
}

function readOperationStates(
  journal: AppendOnlyJsonLinesFile<SocialInteractionJournalRecord>,
): ReadonlyMap<string, OperationState> {
  const states = new Map<string, OperationState>();
  for (const record of journal.read()) {
    if (record.schemaVersion !== LOCAL_SIMULATION_SOCIAL_INTERACTION_SCHEMA_VERSION) {
      throw new Error('unsupported social interaction journal schema');
    }
    if (record.recordType === 'intent') {
      if (states.has(record.operationId)) {
        throw new Error(`duplicate social interaction intent ${record.operationId}`);
      }
      states.set(record.operationId, {
        intent: record,
        appliedPartitions: new Map(),
        completed: false,
      });
      continue;
    }
    const state = states.get(record.operationId);
    if (state === undefined) {
      throw new Error(`social interaction journal record precedes intent ${record.operationId}`);
    }
    if (record.recordType === 'partition-applied') {
      (state.appliedPartitions as Map<PartitionKey, number>).set(
        record.partitionKey,
        record.streamVersion,
      );
    } else {
      states.set(record.operationId, { ...state, completed: true });
    }
  }
  return states;
}

function createJournalPath(rootDir: string): string {
  const directory = join(rootDir, 'society', 'social-interactions');
  const path = join(directory, 'operations.jsonl');
  mkdirSync(directory, { recursive: true });
  if (!existsSync(path)) writeFileSync(path, '');
  return path;
}

function requirePartition(input: {
  readonly partitionByKey: ReadonlyMap<string, LocalSimulationRuntimeHostPartition>;
  readonly simulationId: string;
  readonly partitionKey: PartitionKey;
}): LocalSimulationRuntimeHostPartition {
  const partition = input.partitionByKey.get(
    createPartitionLookupKey(input.simulationId, input.partitionKey),
  );
  if (partition === undefined) {
    throw new Error(`social interaction owner partition ${input.partitionKey} is not hosted`);
  }
  return partition;
}

function createPartitionLookupKey(simulationId: string, partitionKey: PartitionKey): string {
  return JSON.stringify([simulationId, partitionKey]);
}

function createPartitionAppendIdempotencyKey(operationId: string, partitionKey: PartitionKey) {
  return `cross-partition-social:${operationId}:${partitionKey}`;
}

function createDisabledSocialInteractionService(): LocalSimulationSocialInteractionService {
  const disabledError = (): Promise<never> =>
    Promise.reject(
      new Error(
        'social interactions are managed by the simulation-wide authority; use the canonical tick instead',
      ),
    );
  return {
    executeConversation: () => disabledError(),
    recoverPending: () => Promise.resolve([]),
  };
}

function validateConversationRequest(
  request: LocalSimulationCrossPartitionConversationRequest,
): void {
  for (const [name, value] of [
    ['operationId', request.operationId],
    ['simulationId', request.simulationId],
    ['initiatorAgentId', request.initiatorAgentId],
    ['targetAgentId', request.targetAgentId],
    ['topic', request.topic],
  ] as const) {
    if (value.trim().length === 0) throw new Error(`${name} must not be empty`);
  }
  if (request.initiatorAgentId === request.targetAgentId) {
    throw new Error('conversation target must differ');
  }
  if (!Number.isFinite(request.issuedAt)) throw new Error('issuedAt must be finite');
  if (request.turns.length === 0) throw new Error('conversation turns must not be empty');
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
