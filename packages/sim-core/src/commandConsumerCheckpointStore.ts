import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppendOnlyJsonLinesFile } from './appendOnlyJsonLinesFile';
import type { CommandStreamName } from './commandStore';
import type { SimulationTimestamp } from './time';

export type CommandConsumerId = string;

export type CommandConsumerCheckpoint = {
  readonly consumerId: CommandConsumerId;
  readonly streamName: CommandStreamName;
  readonly lastConsumedSequence: number;
  readonly updatedAt: SimulationTimestamp;
};

export type CommandConsumerCheckpointLookup = {
  readonly consumerId: CommandConsumerId;
  readonly streamName: CommandStreamName;
};

export interface CommandConsumerCheckpointStore {
  saveCheckpoint(checkpoint: CommandConsumerCheckpoint): CommandConsumerCheckpoint;
  getLatestCheckpoint(
    input: CommandConsumerCheckpointLookup,
  ): CommandConsumerCheckpoint | undefined;
}

export function createCommandConsumerCheckpoint(input: {
  readonly consumerId: string;
  readonly streamName: CommandStreamName;
  readonly lastConsumedSequence: number;
  readonly updatedAt: SimulationTimestamp;
}): CommandConsumerCheckpoint {
  assertNonEmpty(input.consumerId, 'consumerId');
  assertNonEmpty(input.streamName, 'streamName');
  if (!Number.isInteger(input.lastConsumedSequence) || input.lastConsumedSequence < 0) {
    throw new Error('lastConsumedSequence must be a non-negative integer');
  }
  if (!Number.isFinite(input.updatedAt)) {
    throw new Error('updatedAt must be finite');
  }

  return {
    consumerId: input.consumerId,
    streamName: input.streamName,
    lastConsumedSequence: input.lastConsumedSequence,
    updatedAt: input.updatedAt,
  };
}

export class InMemoryCommandConsumerCheckpointStore implements CommandConsumerCheckpointStore {
  private readonly checkpointsByConsumerStream = new Map<string, CommandConsumerCheckpoint>();

  saveCheckpoint(checkpoint: CommandConsumerCheckpoint): CommandConsumerCheckpoint {
    const key = createCheckpointKey(checkpoint);
    const current = this.checkpointsByConsumerStream.get(key);
    assertCheckpointIsNotStale(current, checkpoint);
    this.checkpointsByConsumerStream.set(key, checkpoint);
    return checkpoint;
  }

  getLatestCheckpoint(
    input: CommandConsumerCheckpointLookup,
  ): CommandConsumerCheckpoint | undefined {
    return this.checkpointsByConsumerStream.get(createCheckpointKey(input));
  }
}

export class FileCommandConsumerCheckpointStore implements CommandConsumerCheckpointStore {
  private readonly rootDir: string;
  private readonly checkpointsPath: string;
  private readonly checkpointsFile: AppendOnlyJsonLinesFile<CommandConsumerCheckpoint>;
  private indexedCheckpoints: readonly CommandConsumerCheckpoint[] | undefined;
  private indexedCheckpointCount = 0;
  private readonly latestCheckpointByConsumerStream = new Map<string, CommandConsumerCheckpoint>();

  constructor(input: { readonly rootDir: string }) {
    assertNonEmpty(input.rootDir, 'rootDir');
    this.rootDir = input.rootDir;
    this.checkpointsPath = join(input.rootDir, 'command-consumer-checkpoints.jsonl');
    this.ensureStorage();
    this.checkpointsFile = new AppendOnlyJsonLinesFile(this.checkpointsPath);
  }

  saveCheckpoint(checkpoint: CommandConsumerCheckpoint): CommandConsumerCheckpoint {
    const current = this.getLatestCheckpoint(checkpoint);
    assertCheckpointIsNotStale(current, checkpoint);
    this.checkpointsFile.append([checkpoint]);
    return checkpoint;
  }

  getLatestCheckpoint(
    input: CommandConsumerCheckpointLookup,
  ): CommandConsumerCheckpoint | undefined {
    const key = createCheckpointKey(input);
    this.refreshLatestCheckpointIndex();
    return this.latestCheckpointByConsumerStream.get(key);
  }

  private refreshLatestCheckpointIndex(): void {
    const checkpoints = this.checkpointsFile.read();
    if (checkpoints !== this.indexedCheckpoints) {
      this.latestCheckpointByConsumerStream.clear();
      this.indexedCheckpointCount = 0;
      this.indexedCheckpoints = checkpoints;
    }
    for (let index = this.indexedCheckpointCount; index < checkpoints.length; index += 1) {
      const checkpoint = checkpoints[index];
      if (checkpoint === undefined) {
        continue;
      }
      const key = createCheckpointKey(checkpoint);
      const current = this.latestCheckpointByConsumerStream.get(key);
      if (
        current === undefined ||
        checkpoint.lastConsumedSequence >= current.lastConsumedSequence
      ) {
        this.latestCheckpointByConsumerStream.set(key, checkpoint);
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
  current: CommandConsumerCheckpoint | undefined,
  next: CommandConsumerCheckpoint,
): void {
  if (current !== undefined && next.lastConsumedSequence < current.lastConsumedSequence) {
    throw new Error(
      `command consumer checkpoint sequence ${next.lastConsumedSequence} is older than current sequence ${current.lastConsumedSequence}`,
    );
  }
}

function createCheckpointKey(input: CommandConsumerCheckpointLookup): string {
  return `${input.consumerId}:${input.streamName}`;
}

function assertNonEmpty(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${name} must not be empty`);
  }
}
