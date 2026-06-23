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

export function createProjectionCheckpoint(input: {
  readonly simulationId: string;
  readonly partitionKey: PartitionKey;
  readonly lastAppliedSequence: number;
  readonly snapshot?: SnapshotReference;
}): ProjectionCheckpoint {
  if (!Number.isInteger(input.lastAppliedSequence) || input.lastAppliedSequence < 0) {
    throw new Error('checkpoint lastAppliedSequence must be a non-negative integer');
  }
  const simulationId = asSimulationId(input.simulationId);
  if (
    input.snapshot !== undefined &&
    (input.snapshot.simulationId !== simulationId || input.snapshot.partitionKey !== input.partitionKey)
  ) {
    throw new Error('checkpoint snapshot must belong to the same simulation partition');
  }
  if (input.snapshot !== undefined && input.snapshot.sequence > input.lastAppliedSequence) {
    throw new Error('checkpoint snapshot sequence must not exceed lastAppliedSequence');
  }

  return {
    simulationId,
    partitionKey: input.partitionKey,
    lastAppliedSequence: input.lastAppliedSequence,
    ...(input.snapshot === undefined ? {} : { snapshot: input.snapshot }),
  };
}

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
