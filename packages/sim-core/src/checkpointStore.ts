import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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

  constructor(input: { readonly rootDir: string }) {
    assertNonEmpty(input.rootDir, 'rootDir');
    this.rootDir = input.rootDir;
    this.checkpointsPath = join(input.rootDir, 'projection-checkpoints.jsonl');
    this.ensureStorage();
  }

  saveCheckpoint(checkpoint: ProjectionCheckpoint): ProjectionCheckpoint {
    const current = this.getLatestCheckpoint(checkpoint);
    assertCheckpointIsNotStale(current, checkpoint);
    appendJsonLine(this.checkpointsPath, checkpoint);
    return checkpoint;
  }

  getLatestCheckpoint(input: ProjectionCheckpointLookup): ProjectionCheckpoint | undefined {
    const key = createCheckpointKey(input);
    return readJsonLines<ProjectionCheckpoint>(this.checkpointsPath)
      .filter((checkpoint) => createCheckpointKey(checkpoint) === key)
      .reduce<ProjectionCheckpoint | undefined>(
        (latest, checkpoint) =>
          latest === undefined || checkpoint.lastAppliedSequence >= latest.lastAppliedSequence
            ? checkpoint
            : latest,
        undefined,
      );
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

function appendJsonLine(path: string, value: unknown): void {
  appendFileSync(path, `${JSON.stringify(value)}\n`);
}

function readJsonLines<TValue>(path: string): readonly TValue[] {
  if (!existsSync(path)) {
    return [];
  }
  const content = readFileSync(path, 'utf8').trim();
  if (content.length === 0) {
    return [];
  }
  return content.split('\n').map((line) => JSON.parse(line) as TValue);
}

function assertNonEmpty(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${name} must not be empty`);
  }
}
