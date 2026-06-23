import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, test } from 'vitest';
import {
  FileProjectionSnapshotStore,
  createSimulationPartition,
  createSnapshotReference,
} from './index';

type WorldProjection = {
  readonly clock: {
    readonly now: number;
  };
  readonly agentsById: Record<
    string,
    {
      readonly energy: number;
      readonly educationScore: number;
    }
  >;
};

const partition = createSimulationPartition({
  simulationId: 'sim-1',
  partitionKey: 'world-main',
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
  const root = mkdtempSync(join(tmpdir(), 'aivilization-projection-snapshot-store-'));
  tmpRoots.push(root);
  return root;
}

function createProjection(): WorldProjection {
  return {
    clock: { now: 1200 },
    agentsById: {
      alice: { energy: 82, educationScore: 0.74 },
      bob: { energy: 41, educationScore: 0.21 },
    },
  };
}

describe('file projection snapshot store', () => {
  test('persists projection snapshots across file store instances', () => {
    const rootDir = createRootDir();
    const firstStore = new FileProjectionSnapshotStore<WorldProjection>({ rootDir });
    const projection = createProjection();

    const reference = firstStore.saveSnapshot({
      simulationId: partition.simulationId,
      partitionKey: partition.partitionKey,
      sequence: 12,
      createdAt: 1200,
      projection,
    });
    const restartedStore = new FileProjectionSnapshotStore<WorldProjection>({ rootDir });

    expect(reference).toMatchObject({
      simulationId: 'sim-1',
      partitionKey: 'world-main',
      sequence: 12,
      createdAt: 1200,
    });
    expect(reference.uri.startsWith('file://')).toBe(true);
    expect(restartedStore.loadSnapshot(reference)).toEqual(projection);
  });

  test('returns undefined when the snapshot file is missing', () => {
    const rootDir = createRootDir();
    const store = new FileProjectionSnapshotStore<WorldProjection>({ rootDir });
    const reference = createSnapshotReference({
      simulationId: partition.simulationId,
      partitionKey: partition.partitionKey,
      sequence: 12,
      uri: pathToFileURL(join(rootDir, 'projection-snapshots', 'sim-1', 'world-main', '12.json'))
        .href,
      createdAt: 1200,
    });

    expect(store.loadSnapshot(reference)).toBeUndefined();
  });

  test('rejects snapshot references that are not file URIs', () => {
    const store = new FileProjectionSnapshotStore<WorldProjection>({ rootDir: createRootDir() });
    const reference = createSnapshotReference({
      simulationId: partition.simulationId,
      partitionKey: partition.partitionKey,
      sequence: 12,
      uri: 's3://snapshots/sim-1/world-main/12.json',
      createdAt: 1200,
    });

    expect(() => store.loadSnapshot(reference)).toThrow('snapshot uri must be a file URI');
  });

  test('rejects file URIs outside the snapshot root', () => {
    const store = new FileProjectionSnapshotStore<WorldProjection>({ rootDir: createRootDir() });
    const outsideRoot = createRootDir();
    const reference = createSnapshotReference({
      simulationId: partition.simulationId,
      partitionKey: partition.partitionKey,
      sequence: 12,
      uri: pathToFileURL(join(outsideRoot, 'projection-snapshots', 'sim-1.json')).href,
      createdAt: 1200,
    });

    expect(() => store.loadSnapshot(reference)).toThrow(
      'snapshot file must be under the snapshot root',
    );
  });

  test('rejects corrupt snapshot files with mismatched embedded references', () => {
    const store = new FileProjectionSnapshotStore<WorldProjection>({ rootDir: createRootDir() });
    const projection = createProjection();
    const reference = store.saveSnapshot({
      simulationId: partition.simulationId,
      partitionKey: partition.partitionKey,
      sequence: 12,
      createdAt: 1200,
      projection,
    });
    writeFileSync(
      fileURLToPath(reference.uri),
      JSON.stringify({
        reference: { ...reference, sequence: 11 },
        projection,
      }),
    );

    expect(() => store.loadSnapshot(reference)).toThrow(
      'snapshot file reference does not match requested reference',
    );
  });
});
