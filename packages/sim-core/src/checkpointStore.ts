import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppendOnlyJsonLinesFile } from './appendOnlyJsonLinesFile';
import type { SimulationId } from './ids';
import type { PartitionKey } from './partition';
import type { ProjectionCheckpoint } from './snapshot';

export type ProjectionCheckpointLookup = {
  readonly simulationId: SimulationId;
  readonly partitionKey: PartitionKey;
};

export interface ProjectionCheckpointStore {
  saveCheckpoint(checkpoint: ProjectionCheckpoint): ProjectionCheckpoint;
  getLatestCheckpoint(input: ProjectionCheckpointLookup): ProjectionCheckpoint | undefined;
}

export class InMemoryProjectionCheckpointStore implements ProjectionCheckpointStore {
  private readonly checkpointsByPartition = new Map<string, ProjectionCheckpoint>();

  saveCheckpoint(checkpoint: ProjectionCheckpoint): ProjectionCheckpoint {
    const key = createCheckpointKey(checkpoint);
    const current = this.checkpointsByPartition.get(key);
    assertCheckpointIsNotStale(current, checkpoint);
    this.checkpointsByPartition.set(key, checkpoint);
    return checkpoint;
  }

  getLatestCheckpoint(input: ProjectionCheckpointLookup): ProjectionCheckpoint | undefined {
    return this.checkpointsByPartition.get(createCheckpointKey(input));
  }
}

export class FileProjectionCheckpointStore implements ProjectionCheckpointStore {
  private readonly rootDir: string;
  private readonly checkpointsPath: string;
  private readonly checkpointsFile: AppendOnlyJsonLinesFile<ProjectionCheckpoint>;
  private indexedCheckpoints: readonly ProjectionCheckpoint[] | undefined;
  private indexedCheckpointCount = 0;
  private readonly latestCheckpointByPartition = new Map<string, ProjectionCheckpoint>();

  constructor(input: { readonly rootDir: string }) {
    assertNonEmpty(input.rootDir, 'rootDir');
    this.rootDir = input.rootDir;
    this.checkpointsPath = join(input.rootDir, 'projection-checkpoints.jsonl');
    this.ensureStorage();
    this.checkpointsFile = new AppendOnlyJsonLinesFile(this.checkpointsPath);
  }

  saveCheckpoint(checkpoint: ProjectionCheckpoint): ProjectionCheckpoint {
    const current = this.getLatestCheckpoint(checkpoint);
    assertCheckpointIsNotStale(current, checkpoint);
    this.checkpointsFile.append([checkpoint]);
    return checkpoint;
  }

  getLatestCheckpoint(input: ProjectionCheckpointLookup): ProjectionCheckpoint | undefined {
    const key = createCheckpointKey(input);
    this.refreshLatestCheckpointIndex();
    return this.latestCheckpointByPartition.get(key);
  }

  private refreshLatestCheckpointIndex(): void {
    const checkpoints = this.checkpointsFile.read();
    if (checkpoints !== this.indexedCheckpoints) {
      this.latestCheckpointByPartition.clear();
      this.indexedCheckpointCount = 0;
      this.indexedCheckpoints = checkpoints;
    }
    for (let index = this.indexedCheckpointCount; index < checkpoints.length; index += 1) {
      const checkpoint = checkpoints[index];
      if (checkpoint === undefined) {
        continue;
      }
      const key = createCheckpointKey(checkpoint);
      const current = this.latestCheckpointByPartition.get(key);
      if (current === undefined || checkpoint.lastAppliedSequence >= current.lastAppliedSequence) {
        this.latestCheckpointByPartition.set(key, checkpoint);
      }
    }
    this.indexedCheckpointCount = checkpoints.length;
  }

  private ensureStorage(): void {
    mkdirSync(this.rootDir, { recursive: true });
    if (!existsSync(this.checkpointsPath)) {
      writeFileSync(this.checkpointsPath, '');
    }
  }
}

function assertCheckpointIsNotStale(
  current: ProjectionCheckpoint | undefined,
  next: ProjectionCheckpoint,
): void {
  if (current !== undefined && next.lastAppliedSequence < current.lastAppliedSequence) {
    throw new Error(
      `checkpoint sequence ${next.lastAppliedSequence} is older than current sequence ${current.lastAppliedSequence}`,
    );
  }
}

function createCheckpointKey(input: ProjectionCheckpointLookup): string {
  return `${input.simulationId}:${input.partitionKey}`;
}

function assertNonEmpty(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${name} must not be empty`);
  }
}
