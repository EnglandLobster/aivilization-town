import type {
  ReactiveActionSimulator,
  ReactiveLocalizedPlanner,
  ReactiveRepairPolicy,
  StrategicPlanCompiler,
  StrategicPlanCompilationTrace,
} from '@aivilization/agent-runtime';
import type { SteeringStrategicPlanTrace, SteeringTrace } from '@aivilization/observability';
import type { CommandConsumerId } from '@aivilization/sim-core';
import type { WorkerSteeringCommand } from './steering';
import type { WorldProjection } from '@aivilization/world';
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
      });

      if (steering.commandDrafts.length === 0) {
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
      await recordSteeringTrace({
        storage: input.storage,
        sequence: record.sequence,
        command,
        steering,
        recordedAt: input.checkpointUpdatedAt,
      });
      return { steering, dispatch };
    },
  }).then((result) => ({
    ...result,
    projection,
    worldDispatchResults,
  }));
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
