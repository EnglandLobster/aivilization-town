import {
  createSimulationPartition,
  type CommandEnvelope,
  type CommandStore,
} from '@aivilization/sim-core';
import type {
  SteeringCommandSubmissionContext,
  SteeringCommandSubmissionPort,
} from './simulationApi';

export type CommandStoreSteeringSubmissionResult = {
  readonly accepted: true;
  readonly streamName: string;
  readonly sequence: number;
  readonly streamVersion: number;
  readonly idempotentReplay: boolean;
};

export function createCommandStoreSteeringSubmissionPort(input: {
  readonly commandStore: CommandStore;
}): SteeringCommandSubmissionPort<CommandStoreSteeringSubmissionResult> {
  return {
    submit: (command, context) => {
      assertCommandMatchesContext(command, context);

      const partition = createSimulationPartition({
        simulationId: context.simulationId,
        partitionKey: context.partitionKey,
      });
      const append = input.commandStore.appendToStream({
        streamName: partition.commandStreamName,
        ...(command.expectedVersion === undefined
          ? {}
          : { expectedVersion: command.expectedVersion }),
        idempotencyKey: command.idempotencyKey,
        commands: [command],
      });
      const record = append.appendedCommands[0];
      if (record === undefined) {
        throw new Error('command store append returned no command record');
      }

      return Promise.resolve({
        accepted: true,
        streamName: partition.commandStreamName,
        sequence: record.sequence,
        streamVersion: append.streamVersion,
        idempotentReplay: append.idempotentReplay,
      });
    },
  };
}

function assertCommandMatchesContext(
  command: CommandEnvelope,
  context: SteeringCommandSubmissionContext,
): void {
  if (command.simulationId !== context.simulationId) {
    throw new Error(
      `command simulationId ${command.simulationId} does not match submission context ${context.simulationId}`,
    );
  }
}
