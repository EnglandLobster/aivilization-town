import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  FileCommandConsumerCheckpointStore,
  InMemoryCommandConsumerCheckpointStore,
  createCommandConsumerCheckpoint,
  createSimulationPartition,
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
  const root = mkdtempSync(join(tmpdir(), 'aivilization-command-consumer-checkpoints-'));
  tmpRoots.push(root);
  return root;
}

describe('command consumer checkpoint creation', () => {
  test('validates checkpoint identity and consumed sequence', () => {
    expect(
      createCommandConsumerCheckpoint({
        consumerId: 'worker-main',
        streamName: partition.commandStreamName,
        lastConsumedSequence: 12,
        updatedAt: 1000,
      }),
    ).toEqual({
      consumerId: 'worker-main',
      streamName: partition.commandStreamName,
      lastConsumedSequence: 12,
      updatedAt: 1000,
    });
    expect(() =>
      createCommandConsumerCheckpoint({
        consumerId: '',
        streamName: partition.commandStreamName,
        lastConsumedSequence: 12,
        updatedAt: 1000,
      }),
    ).toThrow('consumerId must not be empty');
    expect(() =>
      createCommandConsumerCheckpoint({
        consumerId: 'worker-main',
        streamName: '',
        lastConsumedSequence: 12,
        updatedAt: 1000,
      }),
    ).toThrow('streamName must not be empty');
    expect(() =>
      createCommandConsumerCheckpoint({
        consumerId: 'worker-main',
        streamName: partition.commandStreamName,
        lastConsumedSequence: -1,
        updatedAt: 1000,
      }),
    ).toThrow('lastConsumedSequence must be a non-negative integer');
    expect(() =>
      createCommandConsumerCheckpoint({
        consumerId: 'worker-main',
        streamName: partition.commandStreamName,
        lastConsumedSequence: 12,
        updatedAt: Number.NaN,
      }),
    ).toThrow('updatedAt must be finite');
  });
});

describe('command consumer checkpoint stores', () => {
  test('stores and returns the latest in-memory checkpoint per consumer and command stream', () => {
    const store = new InMemoryCommandConsumerCheckpointStore();
    const first = createCommandConsumerCheckpoint({
      consumerId: 'worker-main',
      streamName: partition.commandStreamName,
      lastConsumedSequence: 5,
      updatedAt: 500,
    });
    const second = createCommandConsumerCheckpoint({
      consumerId: 'worker-main',
      streamName: partition.commandStreamName,
      lastConsumedSequence: 10,
      updatedAt: 1000,
    });
    const otherStream = createCommandConsumerCheckpoint({
      consumerId: 'worker-main',
      streamName: otherPartition.commandStreamName,
      lastConsumedSequence: 3,
      updatedAt: 300,
    });
    const otherConsumer = createCommandConsumerCheckpoint({
      consumerId: 'worker-replay',
      streamName: partition.commandStreamName,
      lastConsumedSequence: 2,
      updatedAt: 200,
    });

    store.saveCheckpoint(first);
    store.saveCheckpoint(otherStream);
    store.saveCheckpoint(otherConsumer);
    store.saveCheckpoint(second);

    expect(
      store.getLatestCheckpoint({
        consumerId: 'worker-main',
        streamName: partition.commandStreamName,
      }),
    ).toEqual(second);
    expect(
      store.getLatestCheckpoint({
        consumerId: 'worker-main',
        streamName: otherPartition.commandStreamName,
      }),
    ).toEqual(otherStream);
    expect(
      store.getLatestCheckpoint({
        consumerId: 'worker-replay',
        streamName: partition.commandStreamName,
      }),
    ).toEqual(otherConsumer);
  });

  test('rejects stale checkpoint saves for the same consumer and command stream', () => {
    const store = new InMemoryCommandConsumerCheckpointStore();
    store.saveCheckpoint(
      createCommandConsumerCheckpoint({
        consumerId: 'worker-main',
        streamName: partition.commandStreamName,
        lastConsumedSequence: 10,
        updatedAt: 1000,
      }),
    );

    expect(() =>
      store.saveCheckpoint(
        createCommandConsumerCheckpoint({
          consumerId: 'worker-main',
          streamName: partition.commandStreamName,
          lastConsumedSequence: 9,
          updatedAt: 1100,
        }),
      ),
    ).toThrow('command consumer checkpoint sequence 9 is older than current sequence 10');
  });

  test('persists latest checkpoint metadata across file store instances', () => {
    const rootDir = createRootDir();
    const firstStore = new FileCommandConsumerCheckpointStore({ rootDir });
    const checkpoint = createCommandConsumerCheckpoint({
      consumerId: 'worker-main',
      streamName: partition.commandStreamName,
      lastConsumedSequence: 12,
      updatedAt: 1200,
    });

    firstStore.saveCheckpoint(checkpoint);
    const restartedStore = new FileCommandConsumerCheckpointStore({ rootDir });

    expect(
      restartedStore.getLatestCheckpoint({
        consumerId: 'worker-main',
        streamName: partition.commandStreamName,
      }),
    ).toEqual(checkpoint);
  });
});
