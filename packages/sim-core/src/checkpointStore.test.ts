import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  FileProjectionCheckpointStore,
  InMemoryProjectionCheckpointStore,
  createProjectionCheckpoint,
  createSimulationPartition,
  createSnapshotReference,
} from './index';

const partition = createSimulationPartition({
  simulationId: 'sim-1',
  partitionKey: 'world-main',
});

const otherPartition = createSimulationPartition({
  simulationId: 'sim-1',
  partitionKey: 'market-main',
});

const tmpRoots: string[] = [];

afterEach(() => {
  while (tmpRoots.length > 0) {
    const root = tmpRoots.pop();
    if (root !== undefined) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

function createRootDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'aivilization-checkpoint-store-'));
  tmpRoots.push(root);
  return root;
}

describe('projection checkpoint creation', () => {
  test('validates checkpoint sequence and snapshot partition ownership', () => {
    const snapshot = createSnapshotReference({
      simulationId: partition.simulationId,
      partitionKey: partition.partitionKey,
      sequence: 10,
      uri: 'file://snapshots/sim-1/world-main/10.json',
      createdAt: 1000,
    });

    const checkpoint = createProjectionCheckpoint({
      simulationId: partition.simulationId,
      partitionKey: partition.partitionKey,
      lastAppliedSequence: 10,
      snapshot,
    });

    expect(checkpoint).toEqual({
      simulationId: 'sim-1',
      partitionKey: 'world-main',
      lastAppliedSequence: 10,
      snapshot,
    });
    expect(() =>
      createProjectionCheckpoint({
        simulationId: partition.simulationId,
        partitionKey: partition.partitionKey,
        lastAppliedSequence: -1,
      }),
    ).toThrow('checkpoint lastAppliedSequence must be a non-negative integer');
    expect(() =>
      createProjectionCheckpoint({
        simulationId: partition.simulationId,
        partitionKey: otherPartition.partitionKey,
        lastAppliedSequence: 10,
        snapshot,
      }),
    ).toThrow('checkpoint snapshot must belong to the same simulation partition');
    expect(() =>
      createProjectionCheckpoint({
        simulationId: partition.simulationId,
        partitionKey: partition.partitionKey,
        lastAppliedSequence: 9,
        snapshot,
      }),
    ).toThrow('checkpoint snapshot sequence must not exceed lastAppliedSequence');
  });
});

describe('projection checkpoint stores', () => {
  test('stores and returns the latest in-memory checkpoint per simulation partition', () => {
    const store = new InMemoryProjectionCheckpointStore();
    const first = createProjectionCheckpoint({
      simulationId: partition.simulationId,
      partitionKey: partition.partitionKey,
      lastAppliedSequence: 5,
    });
    const second = createProjectionCheckpoint({
      simulationId: partition.simulationId,
      partitionKey: partition.partitionKey,
      lastAppliedSequence: 10,
    });
    const other = createProjectionCheckpoint({
      simulationId: otherPartition.simulationId,
      partitionKey: otherPartition.partitionKey,
      lastAppliedSequence: 3,
    });

    store.saveCheckpoint(first);
    store.saveCheckpoint(other);
    store.saveCheckpoint(second);

    expect(
      store.getLatestCheckpoint({
        simulationId: partition.simulationId,
        partitionKey: partition.partitionKey,
      }),
    ).toEqual(second);
    expect(
      store.getLatestCheckpoint({
        simulationId: otherPartition.simulationId,
        partitionKey: otherPartition.partitionKey,
      }),
    ).toEqual(other);
  });

  test('rejects stale checkpoint saves for the same simulation partition', () => {
    const store = new InMemoryProjectionCheckpointStore();
    store.saveCheckpoint(
      createProjectionCheckpoint({
        simulationId: partition.simulationId,
        partitionKey: partition.partitionKey,
        lastAppliedSequence: 10,
      }),
    );

    expect(() =>
      store.saveCheckpoint(
        createProjectionCheckpoint({
          simulationId: partition.simulationId,
          partitionKey: partition.partitionKey,
          lastAppliedSequence: 9,
        }),
      ),
    ).toThrow('checkpoint sequence 9 is older than current sequence 10');
  });

  test('persists latest checkpoint metadata across file store instances', () => {
    const rootDir = createRootDir();
    const firstStore = new FileProjectionCheckpointStore({ rootDir });
    const checkpoint = createProjectionCheckpoint({
      simulationId: partition.simulationId,
      partitionKey: partition.partitionKey,
      lastAppliedSequence: 12,
      snapshot: createSnapshotReference({
        simulationId: partition.simulationId,
        partitionKey: partition.partitionKey,
        sequence: 12,
        uri: 'file://snapshots/sim-1/world-main/12.json',
        createdAt: 1200,
      }),
    });

    firstStore.saveCheckpoint(checkpoint);
    const restartedStore = new FileProjectionCheckpointStore({ rootDir });

    expect(
      restartedStore.getLatestCheckpoint({
        simulationId: partition.simulationId,
        partitionKey: partition.partitionKey,
      }),
    ).toEqual(checkpoint);
  });
});
