import type { CommandEnvelope } from './command';

export type CommandStreamName = string;

export type CommandStreamReadOptions = {
  readonly afterSequence?: number;
  readonly limit?: number;
};

export type CommandRecord<TCommand extends CommandEnvelope = CommandEnvelope> = {
  readonly sequence: number;
  readonly command: TCommand;
};

export type AppendToCommandStreamRequest<TCommand extends CommandEnvelope = CommandEnvelope> = {
  readonly streamName: CommandStreamName;
  readonly expectedVersion?: number;
  readonly idempotencyKey?: string;
  readonly commands: readonly TCommand[];
};

export type AppendToCommandStreamResult<TCommand extends CommandEnvelope = CommandEnvelope> = {
  readonly appendedCommands: readonly CommandRecord<TCommand>[];
  readonly streamVersion: number;
  readonly idempotentReplay: boolean;
};

export interface CommandStore<TCommand extends CommandEnvelope = CommandEnvelope> {
  appendToStream(
    request: AppendToCommandStreamRequest<TCommand>,
  ): AppendToCommandStreamResult<TCommand>;
  readStream(
    streamName: CommandStreamName,
    options?: CommandStreamReadOptions,
  ): readonly CommandRecord<TCommand>[];
  getStreamVersion(streamName: CommandStreamName): number;
}

type StoredCommandIdempotencyRecord<TCommand extends CommandEnvelope> = {
  readonly streamName: CommandStreamName;
  readonly expectedVersion?: number;
  readonly commandFingerprint: string;
  readonly appendedCommands: readonly CommandRecord<TCommand>[];
  readonly streamVersion: number;
};

export class InMemoryCommandStore<
  TCommand extends CommandEnvelope = CommandEnvelope,
> implements CommandStore<TCommand> {
  private readonly streams = new Map<CommandStreamName, readonly CommandRecord<TCommand>[]>();
  private readonly idempotencyRecords = new Map<string, StoredCommandIdempotencyRecord<TCommand>>();

  appendToStream(
    request: AppendToCommandStreamRequest<TCommand>,
  ): AppendToCommandStreamResult<TCommand> {
    assertNonEmpty(request.streamName, 'streamName');
    assertNonEmptyBatch(request.commands);

    const idempotentReplay = this.replayIdempotentAppendIfPresent(request);
    if (idempotentReplay !== undefined) {
      return idempotentReplay;
    }

    const currentStream = this.streams.get(request.streamName) ?? [];
    const currentVersion = currentStream.length;
    if (request.expectedVersion !== undefined && request.expectedVersion !== currentVersion) {
      throw new Error(
        `expected command stream version ${request.expectedVersion} but current version is ${currentVersion}`,
      );
    }

    const appendedCommands = assignCommandSequences(request.commands, currentVersion);
    const nextStream = [...currentStream, ...appendedCommands];
    this.streams.set(request.streamName, nextStream);
    const result = {
      appendedCommands,
      streamVersion: nextStream.length,
      idempotentReplay: false,
    };

    if (request.idempotencyKey !== undefined) {
      this.idempotencyRecords.set(request.idempotencyKey, {
        streamName: request.streamName,
        ...(request.expectedVersion === undefined
          ? {}
          : { expectedVersion: request.expectedVersion }),
        commandFingerprint: fingerprintCommands(request.commands),
        appendedCommands,
        streamVersion: nextStream.length,
      });
    }

    return result;
  }

  readStream(
    streamName: CommandStreamName,
    options: CommandStreamReadOptions = {},
  ): readonly CommandRecord<TCommand>[] {
    assertNonEmpty(streamName, 'streamName');
    validateReadOptions(options);

    const stream = this.streams.get(streamName) ?? [];
    const afterSequence = options.afterSequence ?? 0;
    const windowed = stream.filter((record) => record.sequence > afterSequence);
    return options.limit === undefined ? windowed : windowed.slice(0, options.limit);
  }

  getStreamVersion(streamName: CommandStreamName): number {
    assertNonEmpty(streamName, 'streamName');
    return this.streams.get(streamName)?.length ?? 0;
  }

  private replayIdempotentAppendIfPresent(
    request: AppendToCommandStreamRequest<TCommand>,
  ): AppendToCommandStreamResult<TCommand> | undefined {
    if (request.idempotencyKey === undefined) {
      return undefined;
    }

    const existing = this.idempotencyRecords.get(request.idempotencyKey);
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
}

export function assignCommandSequences<TCommand extends CommandEnvelope>(
  commands: readonly TCommand[],
  currentVersion: number,
): readonly CommandRecord<TCommand>[] {
  return commands.map((command, index) => ({
    sequence: currentVersion + index + 1,
    command,
  }));
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
