import type {
  ReactiveActionSimulator,
  ReactiveLocalizedPlanner,
  ReactiveRepairPolicy,
  StrategicPlanCompiler,
  StrategicPlanCompilationTrace,
} from '@aivilization/agent-runtime';
import type { SteeringStrategicPlanTrace, SteeringTrace } from '@aivilization/observability';
import type { CommandConsumerId, EventId } from '@aivilization/sim-core';
import type { WorkerSteeringCommand } from './steering';
import type { WorldProjection } from '@aivilization/world';
import type { ShortTermMemoryRecord } from '@aivilization/memory';
import {
  dispatchCommandDraftsToWorldEventStream,
  type DispatchCommandDraftsToEventStreamResult,
} from './commandDispatch';
import {
  consumeWorkerCommandStreamWithCheckpoint,
  type CheckpointedWorkerCommandStreamConsumptionResult,
} from './commandStreamConsumer';
import type { LocalWorldRuntimeStorage } from './localRuntimeStorage';
import { handleWorkerSteeringCommand, type WorkerSteeringResult } from './steering';
import type { WorldCommandPolicySource } from './worldCommandPolicySource';

export type LocalRuntimeSteeringCommandDrainInput = {
  readonly storage: LocalWorldRuntimeStorage;
  readonly consumerId: CommandConsumerId;
  readonly checkpointUpdatedAt: number;
  readonly localizedPlanners: readonly ReactiveLocalizedPlanner[];
  readonly simulate: ReactiveActionSimulator;
  readonly repair?: ReactiveRepairPolicy;
  readonly strategicPlanCompiler?: StrategicPlanCompiler;
  readonly limit?: number;
};

export function drainLocalRuntimeSteeringCommands(
  input: LocalRuntimeSteeringCommandDrainInput,
): Promise<CheckpointedWorkerCommandStreamConsumptionResult<WorkerSteeringResult>> {
  return consumeWorkerCommandStreamWithCheckpoint({
    commandStore: input.storage.commandStore,
    checkpointStore: input.storage.commandConsumerCheckpointStore,
    consumerId: input.consumerId,
    streamName: input.storage.partition.commandStreamName,
    checkpointUpdatedAt: input.checkpointUpdatedAt,
    ...(input.limit === undefined ? {} : { limit: input.limit }),
    handle: async ({ record, command }) => {
      const steering = await handleWorkerSteeringCommand({
        command,
        ...input.storage.repositories,
        localizedPlanners: input.localizedPlanners,
        simulate: input.simulate,
        ...(input.repair === undefined ? {} : { repair: input.repair }),
        ...(input.strategicPlanCompiler === undefined
          ? {}
          : { strategicPlanCompiler: input.strategicPlanCompiler }),
      });
      await recordSteeringTrace({
        storage: input.storage,
        sequence: record.sequence,
        command,
        steering,
        recordedAt: input.checkpointUpdatedAt,
      });
      return steering;
    },
  });
}

export type LocalRuntimeSteeringCommandWorldDrainRecordResult = {
  readonly steering: WorkerSteeringResult;
  readonly dispatch?: DispatchCommandDraftsToEventStreamResult;
};

export type LocalRuntimeSteeringCommandWorldDrainResult =
  CheckpointedWorkerCommandStreamConsumptionResult<LocalRuntimeSteeringCommandWorldDrainRecordResult> & {
    readonly projection: WorldProjection;
    readonly worldDispatchResults: readonly DispatchCommandDraftsToEventStreamResult[];
  };

export function drainLocalRuntimeSteeringCommandsToWorld(
  input: LocalRuntimeSteeringCommandDrainInput & {
    readonly projection: WorldProjection;
    readonly policies: WorldCommandPolicySource;
  },
): Promise<LocalRuntimeSteeringCommandWorldDrainResult> {
  let projection = input.projection;
  const worldDispatchResults: DispatchCommandDraftsToEventStreamResult[] = [];

  return consumeWorkerCommandStreamWithCheckpoint({
    commandStore: input.storage.commandStore,
    checkpointStore: input.storage.commandConsumerCheckpointStore,
    consumerId: input.consumerId,
    streamName: input.storage.partition.commandStreamName,
    checkpointUpdatedAt: input.checkpointUpdatedAt,
    ...(input.limit === undefined ? {} : { limit: input.limit }),
    handle: async ({ record, command }) => {
      const steering = await handleWorkerSteeringCommand({
        command,
        ...input.storage.repositories,
        localizedPlanners: input.localizedPlanners,
        simulate: input.simulate,
        ...(input.repair === undefined ? {} : { repair: input.repair }),
        ...(input.strategicPlanCompiler === undefined
          ? {}
          : { strategicPlanCompiler: input.strategicPlanCompiler }),
        persistShortTermMemoryRecords: false,
      });

      if (steering.commandDrafts.length === 0) {
        await persistSteeringShortTermMemoryRecords({
          storage: input.storage,
          steering,
        });
        await recordSteeringTrace({
          storage: input.storage,
          sequence: record.sequence,
          command,
          steering,
          recordedAt: input.checkpointUpdatedAt,
        });
        return { steering };
      }

      const dispatch = dispatchCommandDraftsToWorldEventStream({
        commandDrafts: steering.commandDrafts,
        projection,
        policies: input.policies,
        eventStore: input.storage.eventStore,
        streamName: input.storage.partition.eventStreamName,
        appendIdempotencyKey: createSteeringWorldAppendIdempotencyKey({
          consumerId: input.consumerId,
          sequence: record.sequence,
          commandId: command.id,
        }),
        commandIdPrefix: createSteeringWorldCommandIdPrefix({
          sequence: record.sequence,
          commandId: command.id,
        }),
      });
      projection = dispatch.projection;
      worldDispatchResults.push(dispatch);
      const enrichedSteering = enrichSteeringResultWithDispatchEventIds({
        steering,
        eventIds: dispatch.events.map((event) => event.id),
      });
      await persistSteeringShortTermMemoryRecords({
        storage: input.storage,
        steering: enrichedSteering,
      });
      await recordSteeringTrace({
        storage: input.storage,
        sequence: record.sequence,
        command,
        steering: enrichedSteering,
        recordedAt: input.checkpointUpdatedAt,
      });
      return { steering: enrichedSteering, dispatch };
    },
  }).then((result) => ({
    ...result,
    projection,
    worldDispatchResults,
  }));
}

async function persistSteeringShortTermMemoryRecords(input: {
  readonly storage: LocalWorldRuntimeStorage;
  readonly steering: WorkerSteeringResult;
}): Promise<void> {
  if (input.steering.shortTermMemoryRecords.length === 0) {
    return;
  }
  await input.storage.shortTermMemoryRepository.appendMany(input.steering.shortTermMemoryRecords);
}

function enrichSteeringResultWithDispatchEventIds(input: {
  readonly steering: WorkerSteeringResult;
  readonly eventIds: readonly EventId[];
}): WorkerSteeringResult {
  if (input.steering.kind !== 'reactive-command-routed' || input.eventIds.length === 0) {
    return input.steering;
  }

  const shortTermMemoryRecords = input.steering.shortTermMemoryRecords.map((record) =>
    isReactiveOutcomeRecord(record)
      ? enrichMemoryRecordSourceEventIds({ record, eventIds: input.eventIds })
      : record,
  );

  return {
    ...input.steering,
    routeResult: {
      ...input.steering.routeResult,
      shortTermMemoryRecords,
    },
    shortTermMemoryRecords,
  };
}

function isReactiveOutcomeRecord(record: ShortTermMemoryRecord): boolean {
  return (
    record.kind === 'human-command' &&
    record.tags.includes('reactive') &&
    record.id.endsWith(':outcome')
  );
}

function enrichMemoryRecordSourceEventIds(input: {
  readonly record: ShortTermMemoryRecord;
  readonly eventIds: readonly EventId[];
}): ShortTermMemoryRecord {
  return {
    ...input.record,
    source: {
      ...input.record.source,
      eventIds: stableUnique([...input.record.source.eventIds, ...input.eventIds]),
    },
  };
}

function stableUnique<TValue>(values: readonly TValue[]): readonly TValue[] {
  return [...new Set(values)];
}

function createSteeringWorldAppendIdempotencyKey(input: {
  readonly consumerId: CommandConsumerId;
  readonly sequence: number;
  readonly commandId: string;
}): string {
  return `steering-world:${input.consumerId}:${input.sequence}:${input.commandId}`;
}

function createSteeringWorldCommandIdPrefix(input: {
  readonly sequence: number;
  readonly commandId: string;
}): string {
  return `steering-world-${input.sequence}-${input.commandId}`;
}

async function recordSteeringTrace(input: {
  readonly storage: LocalWorldRuntimeStorage;
  readonly sequence: number;
  readonly command: WorkerSteeringCommand;
  readonly steering: WorkerSteeringResult;
  readonly recordedAt: number;
}): Promise<void> {
  await input.storage.steeringTraceRepository.record(createSteeringTrace(input));
}

function createSteeringTrace(input: {
  readonly storage: LocalWorldRuntimeStorage;
  readonly sequence: number;
  readonly command: WorkerSteeringCommand;
  readonly steering: WorkerSteeringResult;
  readonly recordedAt: number;
}): SteeringTrace {
  const base = {
    traceId: `${input.command.simulationId}:${input.storage.partition.partitionKey}:${input.sequence}:${input.command.id}`,
    simulationId: input.command.simulationId,
    partitionKey: input.storage.partition.partitionKey,
    commandId: input.command.id,
    commandType: input.command.type,
    source: input.command.source,
    agentId: requireActorId(input.command),
    resultKind: input.steering.kind,
    commandDraftCount: input.steering.commandDrafts.length,
    shortTermMemoryRecordIds: input.steering.shortTermMemoryRecords.map((record) => record.id),
    issuedAt: input.command.issuedAt,
    recordedAt: input.recordedAt,
  };

  if (input.steering.kind === 'long-horizon-objective-set') {
    const objectiveId = input.steering.intentionState.activeObjective?.id;
    return {
      ...base,
      ...(objectiveId === undefined ? {} : { objectiveId }),
      ...(input.steering.planRecord === undefined
        ? {}
        : {
            planId: input.steering.planRecord.planId,
            ...(input.steering.planRecord.planningTrace === undefined
              ? {}
              : {
                  strategicPlan: mapStrategicPlanTrace(input.steering.planRecord.planningTrace),
                }),
          }),
      candidateActionCount: 0,
    };
  }

  return {
    ...base,
    reactiveCommandId: readReactiveCommandId(input.command),
    ...(input.steering.routeResult.selectedPlannerDomain === undefined
      ? {}
      : { selectedPlannerDomain: input.steering.routeResult.selectedPlannerDomain }),
    candidateActionCount: input.steering.routeResult.candidateActions.length,
  };
}

function mapStrategicPlanTrace(trace: StrategicPlanCompilationTrace): SteeringStrategicPlanTrace {
  return {
    status: trace.status,
    source: trace.source,
    ...(trace.requestId === undefined ? {} : { requestId: trace.requestId }),
    ...(trace.providerId === undefined ? {} : { providerId: trace.providerId }),
    ...(trace.model === undefined ? {} : { model: trace.model }),
    ...(trace.failureReason === undefined ? {} : { failureReason: trace.failureReason }),
    ...(trace.message === undefined ? {} : { message: trace.message }),
    ...(trace.attempts === undefined
      ? {}
      : {
          attempts: trace.attempts.map((attempt) => ({ ...attempt, usage: { ...attempt.usage } })),
        }),
    ...(trace.usage === undefined ? {} : { usage: { ...trace.usage } }),
    ...(trace.observedStateSummary === undefined
      ? {}
      : { observedStateSummary: trace.observedStateSummary }),
    ...(trace.worldDecisionContext === undefined
      ? {}
      : { worldDecisionContext: { ...trace.worldDecisionContext } }),
  };
}

function readReactiveCommandId(command: WorkerSteeringCommand): string {
  const payload = command.payload;
  if (typeof payload === 'object' && payload !== null && !Array.isArray(payload)) {
    const reactiveCommandId = (payload as Readonly<Record<string, unknown>>).reactiveCommandId;
    if (typeof reactiveCommandId === 'string' && reactiveCommandId.trim().length > 0) {
      return reactiveCommandId;
    }
  }
  return command.id;
}

function requireActorId(command: WorkerSteeringCommand): string {
  if (command.actorId === undefined) {
    throw new Error(`${command.type} requires actorId`);
  }
  return command.actorId;
}
