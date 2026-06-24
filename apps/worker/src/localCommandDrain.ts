import type {
  ReactiveActionSimulator,
  ReactiveLocalizedPlanner,
  ReactiveRepairPolicy,
  StrategicPlanCompiler,
} from '@aivilization/agent-runtime';
import type { CommandConsumerId } from '@aivilization/sim-core';
import {
  consumeWorkerCommandStreamWithCheckpoint,
  type CheckpointedWorkerCommandStreamConsumptionResult,
} from './commandStreamConsumer';
import type { LocalWorldRuntimeStorage } from './localRuntimeStorage';
import { handleWorkerSteeringCommand, type WorkerSteeringResult } from './steering';

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
