import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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

  constructor(input: { readonly rootDir: string }) {
    assertNonEmpty(input.rootDir, 'rootDir');
    this.rootDir = input.rootDir;
    this.checkpointsPath = join(input.rootDir, 'command-consumer-checkpoints.jsonl');
    this.ensureStorage();
  }

  saveCheckpoint(checkpoint: CommandConsumerCheckpoint): CommandConsumerCheckpoint {
    const current = this.getLatestCheckpoint(checkpoint);
    assertCheckpointIsNotStale(current, checkpoint);
    appendJsonLine(this.checkpointsPath, checkpoint);
    return checkpoint;
  }

  getLatestCheckpoint(
    input: CommandConsumerCheckpointLookup,
  ): CommandConsumerCheckpoint | undefined {
    const key = createCheckpointKey(input);
    return readJsonLines<CommandConsumerCheckpoint>(this.checkpointsPath)
      .filter((checkpoint) => createCheckpointKey(checkpoint) === key)
      .reduce<CommandConsumerCheckpoint | undefined>(
        (latest, checkpoint) =>
          latest === undefined ||
          checkpoint.lastConsumedSequence >= latest.lastConsumedSequence
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
