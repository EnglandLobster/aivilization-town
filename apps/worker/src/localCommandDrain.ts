import type {
  ReactiveActionSimulator,
  ReactiveLocalizedPlanner,
  ReactiveRepairPolicy,
  StrategicPlanCompiler,
} from '@aivilization/agent-runtime';
import type { CommandConsumerId } from '@aivilization/sim-core';
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
    handle: ({ command }) =>
      handleWorkerSteeringCommand({
        command,
        ...input.storage.repositories,
        localizedPlanners: input.localizedPlanners,
        simulate: input.simulate,
        ...(input.repair === undefined ? {} : { repair: input.repair }),
        ...(input.strategicPlanCompiler === undefined
          ? {}
          : { strategicPlanCompiler: input.strategicPlanCompiler }),
      }),
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
