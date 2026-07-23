import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppendOnlyJsonLinesFile } from './appendOnlyJsonLinesFile';
import type { CommandEnvelope } from './command';
import {
  assignCommandSequences,
  type AppendToCommandStreamRequest,
  type AppendToCommandStreamResult,
  type CommandRecord,
  type CommandStore,
  type CommandStreamName,
  type CommandStreamReadOptions,
} from './commandStore';

type StoredCommandIdempotencyRecord<TCommand extends CommandEnvelope> = {
  readonly idempotencyKey: string;
  readonly streamName: CommandStreamName;
  readonly expectedVersion?: number;
  readonly commandFingerprint: string;
  readonly appendedCommands: readonly CommandRecord<TCommand>[];
  readonly streamVersion: number;
};

export class FileCommandStore<
  TCommand extends CommandEnvelope = CommandEnvelope,
> implements CommandStore<TCommand> {
  private readonly rootDir: string;
  private readonly streamsDir: string;
  private readonly idempotencyPath: string;
  private readonly idempotencyFile: AppendOnlyJsonLinesFile<
    StoredCommandIdempotencyRecord<TCommand>
  >;
  private readonly streamFiles = new Map<
    CommandStreamName,
    AppendOnlyJsonLinesFile<CommandRecord<TCommand>>
  >();
  private indexedIdempotencyRecords:
    | readonly StoredCommandIdempotencyRecord<TCommand>[]
    | undefined;
  private indexedIdempotencyRecordCount = 0;
  private readonly idempotencyRecordByKey = new Map<
    string,
    StoredCommandIdempotencyRecord<TCommand>
  >();

  constructor(input: { readonly rootDir: string }) {
    assertNonEmpty(input.rootDir, 'rootDir');
    this.rootDir = input.rootDir;
    this.streamsDir = join(input.rootDir, 'streams');
    this.idempotencyPath = join(input.rootDir, 'idempotency.jsonl');
    this.ensureStorage();
    this.idempotencyFile = new AppendOnlyJsonLinesFile(this.idempotencyPath);
  }

  appendToStream(
    request: AppendToCommandStreamRequest<TCommand>,
  ): AppendToCommandStreamResult<TCommand> {
    assertNonEmpty(request.streamName, 'streamName');
    assertNonEmptyBatch(request.commands);

    const idempotentReplay = this.replayIdempotentAppendIfPresent(request);
    if (idempotentReplay !== undefined) {
      return idempotentReplay;
    }

    const currentStream = this.readAllRecords(request.streamName);
    const currentVersion = currentStream.length;
    if (request.expectedVersion !== undefined && request.expectedVersion !== currentVersion) {
      throw new Error(
        `expected command stream version ${request.expectedVersion} but current version is ${currentVersion}`,
      );
    }

    const appendedCommands = assignCommandSequences(request.commands, currentVersion);
    this.streamFile(request.streamName).append(appendedCommands);
    const streamVersion = currentVersion + appendedCommands.length;
    const result = {
      appendedCommands,
      streamVersion,
      idempotentReplay: false,
    };

    if (request.idempotencyKey !== undefined) {
      this.idempotencyFile.append([
        {
          idempotencyKey: request.idempotencyKey,
          streamName: request.streamName,
          ...(request.expectedVersion === undefined
            ? {}
            : { expectedVersion: request.expectedVersion }),
          commandFingerprint: fingerprintCommands(request.commands),
          appendedCommands,
          streamVersion,
        },
      ] satisfies readonly StoredCommandIdempotencyRecord<TCommand>[]);
    }

    return result;
  }

  readStream(
    streamName: CommandStreamName,
    options: CommandStreamReadOptions = {},
  ): readonly CommandRecord<TCommand>[] {
    assertNonEmpty(streamName, 'streamName');
    validateReadOptions(options);

    const stream = this.readAllRecords(streamName);
    const afterSequence = options.afterSequence ?? 0;
    const windowed = stream.filter((record) => record.sequence > afterSequence);
    return options.limit === undefined ? windowed : windowed.slice(0, options.limit);
  }

  getStreamVersion(streamName: CommandStreamName): number {
    assertNonEmpty(streamName, 'streamName');
    return this.readAllRecords(streamName).length;
  }

  private replayIdempotentAppendIfPresent(
    request: AppendToCommandStreamRequest<TCommand>,
  ): AppendToCommandStreamResult<TCommand> | undefined {
    if (request.idempotencyKey === undefined) {
      return undefined;
    }

    const existing = this.getIdempotencyRecord(request.idempotencyKey);
    if (existing === undefined) {
      return undefined;
    }

    const isSameRequest =
      existing.streamName === request.streamName &&
      existing.expectedVersion === request.expectedVersion &&
      existing.commandFingerprint === fingerprintCommands(request.commands);

    if (!isSameRequest) {
      throw new Error(
        `idempotency key ${request.idempotencyKey} was already used for a different command append request`,
      );
    }

    return {
      appendedCommands: existing.appendedCommands,
      streamVersion: existing.streamVersion,
      idempotentReplay: true,
    };
  }

  private readAllRecords(streamName: CommandStreamName): readonly CommandRecord<TCommand>[] {
    return this.streamFile(streamName).read();
  }

  private getIdempotencyRecord(
    idempotencyKey: string,
  ): StoredCommandIdempotencyRecord<TCommand> | undefined {
    const records = this.idempotencyFile.read();
    if (records !== this.indexedIdempotencyRecords) {
      this.idempotencyRecordByKey.clear();
      this.indexedIdempotencyRecordCount = 0;
      this.indexedIdempotencyRecords = records;
    }
    for (let index = this.indexedIdempotencyRecordCount; index < records.length; index += 1) {
      const record = records[index];
      if (record !== undefined && !this.idempotencyRecordByKey.has(record.idempotencyKey)) {
        this.idempotencyRecordByKey.set(record.idempotencyKey, record);
      }
    }
    this.indexedIdempotencyRecordCount = records.length;
    return this.idempotencyRecordByKey.get(idempotencyKey);
  }

  private streamFile(
    streamName: CommandStreamName,
  ): AppendOnlyJsonLinesFile<CommandRecord<TCommand>> {
    const existing = this.streamFiles.get(streamName);
    if (existing !== undefined) {
      return existing;
    }
    const created = new AppendOnlyJsonLinesFile<CommandRecord<TCommand>>(
      this.streamPath(streamName),
    );
    this.streamFiles.set(streamName, created);
    return created;
  }

  private streamPath(streamName: CommandStreamName): string {
    return join(this.streamsDir, `${encodeURIComponent(streamName)}.jsonl`);
  }

  private ensureStorage(): void {
    mkdirSync(this.rootDir, { recursive: true });
    mkdirSync(this.streamsDir, { recursive: true });
    if (!existsSync(this.idempotencyPath)) {
      writeFileSync(this.idempotencyPath, '');
    }
  }
}

function assertNonEmpty(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${name} must not be empty`);
  }
}

function assertNonEmptyBatch(commands: readonly CommandEnvelope[]): void {
  if (commands.length === 0) {
    throw new Error('command batch must contain at least one command');
  }
}

function validateReadOptions(options: CommandStreamReadOptions): void {
  if (
    options.afterSequence !== undefined &&
    (!Number.isInteger(options.afterSequence) || options.afterSequence < 0)
  ) {
    throw new Error('afterSequence must be a non-negative integer');
  }

  if (options.limit !== undefined && (!Number.isInteger(options.limit) || options.limit < 1)) {
    throw new Error('limit must be a positive integer');
  }
}

function fingerprintCommands(commands: readonly CommandEnvelope[]): string {
  return JSON.stringify(commands);
}
