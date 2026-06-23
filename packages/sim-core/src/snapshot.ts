import { asSimulationId, type SimulationId } from './ids';
import type { PartitionKey } from './partition';
import type { SimulationTimestamp } from './time';

export type SnapshotReference = {
  readonly simulationId: SimulationId;
  readonly partitionKey: PartitionKey;
  readonly sequence: number;
  readonly uri: string;
  readonly createdAt: SimulationTimestamp;
};

export type ProjectionCheckpoint = {
  readonly simulationId: SimulationId;
  readonly partitionKey: PartitionKey;
  readonly lastAppliedSequence: number;
  readonly snapshot?: SnapshotReference;
};

export function createSnapshotReference(input: {
  readonly simulationId: string;
  readonly partitionKey: PartitionKey;
  readonly sequence: number;
  readonly uri: string;
  readonly createdAt: SimulationTimestamp;
}): SnapshotReference {
  if (!Number.isInteger(input.sequence) || input.sequence < 0) {
    throw new Error(`snapshot sequence must be a non-negative integer, received ${input.sequence}`);
  }
  if (input.uri.length === 0) {
    throw new Error('snapshot uri must not be empty');
  }

  return {
    simulationId: asSimulationId(input.simulationId),
    partitionKey: input.partitionKey,
    sequence: input.sequence,
    uri: input.uri,
    createdAt: input.createdAt,
  };
}
