import { asSimulationId, type SimulationId } from './ids';

export type PartitionKey = string;

export type SimulationPartition = {
  readonly simulationId: SimulationId;
  readonly partitionKey: PartitionKey;
  readonly commandStreamName: string;
  readonly eventStreamName: string;
};

export type StreamPosition = {
  readonly simulationId: SimulationId;
  readonly partitionKey: PartitionKey;
  readonly sequence: number;
};

export function createSimulationPartition(input: {
  readonly simulationId: string;
  readonly partitionKey: PartitionKey;
}): SimulationPartition {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(input.partitionKey)) {
    throw new Error(`partitionKey must be lowercase kebab-case, received ${input.partitionKey}`);
  }

  return {
    simulationId: asSimulationId(input.simulationId),
    partitionKey: input.partitionKey,
    commandStreamName: `simulation/${input.simulationId}/partition/${input.partitionKey}/commands`,
    eventStreamName: `simulation/${input.simulationId}/partition/${input.partitionKey}/events`,
  };
}
