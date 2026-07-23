import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { PartitionKey } from './partition';
import { createSnapshotReference, type SnapshotReference } from './snapshot';
import type { SimulationTimestamp } from './time';

const SNAPSHOT_ROOT_DIR_NAME = 'projection-snapshots';

export type ProjectionSnapshotSaveInput<TProjection> = {
  readonly simulationId: string;
  readonly partitionKey: PartitionKey;
  readonly sequence: number;
  readonly createdAt: SimulationTimestamp;
  readonly projection: TProjection;
};

export interface ProjectionSnapshotStore<TProjection> {
  saveSnapshot(input: ProjectionSnapshotSaveInput<TProjection>): SnapshotReference;
  loadSnapshot(reference: SnapshotReference): TProjection | undefined;
}

export class FileProjectionSnapshotStore<
  TProjection,
> implements ProjectionSnapshotStore<TProjection> {
  private readonly rootDir: string;
  private readonly snapshotRootDir: string;
  private readonly maximumSnapshotsPerPartition: number | undefined;

  constructor(input: { readonly rootDir: string; readonly maximumSnapshotsPerPartition?: number }) {
    assertNonEmpty(input.rootDir, 'rootDir');
    if (input.maximumSnapshotsPerPartition !== undefined) {
      assertPositiveInteger(input.maximumSnapshotsPerPartition, 'maximumSnapshotsPerPartition');
    }
    this.rootDir = resolve(input.rootDir);
    this.snapshotRootDir = join(this.rootDir, SNAPSHOT_ROOT_DIR_NAME);
    this.maximumSnapshotsPerPartition = input.maximumSnapshotsPerPartition;
    mkdirSync(this.snapshotRootDir, { recursive: true });
  }

  saveSnapshot(input: ProjectionSnapshotSaveInput<TProjection>): SnapshotReference {
    const snapshotPath = this.getSnapshotPath(input);
    const reference = createSnapshotReference({
      simulationId: input.simulationId,
      partitionKey: input.partitionKey,
      sequence: input.sequence,
      uri: pathToFileURL(snapshotPath).href,
      createdAt: input.createdAt,
    });

    mkdirSync(dirname(snapshotPath), { recursive: true });
    writeFileSync(
      snapshotPath,
      `${JSON.stringify({ reference, projection: input.projection }, null, 2)}\n`,
    );
    this.pruneSupersededSnapshots(dirname(snapshotPath), input.sequence);

    return reference;
  }

  loadSnapshot(reference: SnapshotReference): TProjection | undefined {
    const snapshotPath = this.getPathFromReference(reference);
    if (!existsSync(snapshotPath)) {
      return undefined;
    }

    const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8')) as Partial<
      StoredProjectionSnapshot<TProjection>
    >;
    assertMatchingReference(snapshot.reference, reference);
    if (!('projection' in snapshot)) {
      throw new Error('snapshot file projection is missing');
    }

    return snapshot.projection;
  }

  private getSnapshotPath(
    input: Pick<
      ProjectionSnapshotSaveInput<TProjection>,
      'simulationId' | 'partitionKey' | 'sequence'
    >,
  ): string {
    return join(
      this.snapshotRootDir,
      encodePathSegment(input.simulationId),
      encodePathSegment(input.partitionKey),
      `${input.sequence}.json`,
    );
  }

  private getPathFromReference(reference: SnapshotReference): string {
    const snapshotPath = resolve(fileUriToPath(reference.uri));
    if (!snapshotPath.startsWith(`${this.snapshotRootDir}${sep}`)) {
      throw new Error('snapshot file must be under the snapshot root');
    }

    return snapshotPath;
  }

  private pruneSupersededSnapshots(partitionSnapshotDir: string, savedSequence: number): void {
    if (this.maximumSnapshotsPerPartition === undefined) {
      return;
    }

    const candidates = readdirSync(partitionSnapshotDir)
      .map((filename) => ({ filename, sequence: parseSnapshotSequence(filename) }))
      .filter(
        (candidate): candidate is { readonly filename: string; readonly sequence: number } =>
          candidate.sequence !== undefined,
      )
      .sort((left, right) => right.sequence - left.sequence);
    const savedFilename = `${savedSequence}.json`;
    const retained = new Set([
      savedFilename,
      ...candidates
        .filter((candidate) => candidate.filename !== savedFilename)
        .slice(0, this.maximumSnapshotsPerPartition - 1)
        .map((candidate) => candidate.filename),
    ]);

    for (const candidate of candidates) {
      if (!retained.has(candidate.filename)) {
        unlinkSync(join(partitionSnapshotDir, candidate.filename));
      }
    }
  }
}

type StoredProjectionSnapshot<TProjection> = {
  readonly reference: SnapshotReference;
  readonly projection: TProjection;
};

function fileUriToPath(uri: string): string {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    throw new Error('snapshot uri must be a file URI');
  }
  if (url.protocol !== 'file:') {
    throw new Error('snapshot uri must be a file URI');
  }

  return fileURLToPath(url);
}

function assertMatchingReference(
  actual: SnapshotReference | undefined,
  expected: SnapshotReference,
): void {
  if (
    actual?.simulationId !== expected.simulationId ||
    actual.partitionKey !== expected.partitionKey ||
    actual.sequence !== expected.sequence ||
    actual.uri !== expected.uri ||
    actual.createdAt !== expected.createdAt
  ) {
    throw new Error('snapshot file reference does not match requested reference');
  }
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

function parseSnapshotSequence(filename: string): number | undefined {
  if (!filename.endsWith('.json')) {
    return undefined;
  }
  const sequence = Number(filename.slice(0, -'.json'.length));
  return Number.isSafeInteger(sequence) && sequence >= 0 ? sequence : undefined;
}

function assertNonEmpty(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${name} must not be empty`);
  }
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive safe integer`);
  }
}
