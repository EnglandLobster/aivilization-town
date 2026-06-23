import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  AppendToEventStreamRequest,
  AppendToEventStreamResult,
  EventStore,
  EventStreamName,
  EventStreamReadOptions,
} from './eventStore';
import type { EventEnvelope } from './event';

type StoredIdempotencyRecord<TEvent extends EventEnvelope> = {
  readonly idempotencyKey: string;
  readonly streamName: EventStreamName;
  readonly expectedVersion?: number;
  readonly eventFingerprint: string;
  readonly appendedEvents: readonly TEvent[];
  readonly streamVersion: number;
};

export class FileEventStore<TEvent extends EventEnvelope = EventEnvelope>
  implements EventStore<TEvent>
{
  private readonly rootDir: string;
  private readonly streamsDir: string;
  private readonly idempotencyPath: string;

  constructor(input: { readonly rootDir: string }) {
    assertNonEmpty(input.rootDir, 'rootDir');
    this.rootDir = input.rootDir;
    this.streamsDir = join(input.rootDir, 'streams');
    this.idempotencyPath = join(input.rootDir, 'idempotency.jsonl');
    this.ensureStorage();
  }

  appendToStream(request: AppendToEventStreamRequest<TEvent>): AppendToEventStreamResult<TEvent> {
    assertNonEmpty(request.streamName, 'streamName');
    assertNonEmptyBatch(request.events);

    const idempotentReplay = this.replayIdempotentAppendIfPresent(request);
    if (idempotentReplay !== undefined) {
      return idempotentReplay;
    }

    const currentStream = this.readAllEvents(request.streamName);
    const currentVersion = currentStream.length;
    if (request.expectedVersion !== undefined && request.expectedVersion !== currentVersion) {
      throw new Error(
        `expected stream version ${request.expectedVersion} but current version is ${currentVersion}`,
      );
    }

    request.events.forEach((event, index) => {
      const expectedSequence = currentVersion + index + 1;
      if (event.sequence !== expectedSequence) {
        throw new Error(
          `event sequence ${event.sequence} must equal next stream sequence ${expectedSequence}`,
        );
      }
    });

    appendJsonLines(this.streamPath(request.streamName), request.events);
    const streamVersion = currentVersion + request.events.length;
    const result = {
      appendedEvents: request.events,
      streamVersion,
      idempotentReplay: false,
    };

    if (request.idempotencyKey !== undefined) {
      appendJsonLines(this.idempotencyPath, [
        {
          idempotencyKey: request.idempotencyKey,
          streamName: request.streamName,
          ...(request.expectedVersion === undefined
            ? {}
            : { expectedVersion: request.expectedVersion }),
          eventFingerprint: fingerprintEvents(request.events),
          appendedEvents: request.events,
          streamVersion,
        },
      ] satisfies readonly StoredIdempotencyRecord<TEvent>[]);
    }

    return result;
  }

  readStream(streamName: EventStreamName, options: EventStreamReadOptions = {}): readonly TEvent[] {
    assertNonEmpty(streamName, 'streamName');
    validateReadOptions(options);

    const stream = this.readAllEvents(streamName);
    const afterSequence = options.afterSequence ?? 0;
    const windowed = stream.filter((event) => event.sequence > afterSequence);
    return options.limit === undefined ? windowed : windowed.slice(0, options.limit);
  }

  getStreamVersion(streamName: EventStreamName): number {
    assertNonEmpty(streamName, 'streamName');
    return this.readAllEvents(streamName).length;
  }

  private replayIdempotentAppendIfPresent(
    request: AppendToEventStreamRequest<TEvent>,
  ): AppendToEventStreamResult<TEvent> | undefined {
    if (request.idempotencyKey === undefined) {
      return undefined;
    }

    const existing = this.readIdempotencyRecords().find(
      (record) => record.idempotencyKey === request.idempotencyKey,
    );
    if (existing === undefined) {
      return undefined;
    }

    const isSameRequest =
      existing.streamName === request.streamName &&
      existing.expectedVersion === request.expectedVersion &&
      existing.eventFingerprint === fingerprintEvents(request.events);

    if (!isSameRequest) {
      throw new Error(
        `idempotency key ${request.idempotencyKey} was already used for a different append request`,
      );
    }

    return {
      appendedEvents: existing.appendedEvents,
      streamVersion: existing.streamVersion,
      idempotentReplay: true,
    };
  }

  private readAllEvents(streamName: EventStreamName): readonly TEvent[] {
    return readJsonLines<TEvent>(this.streamPath(streamName));
  }

  private readIdempotencyRecords(): readonly StoredIdempotencyRecord<TEvent>[] {
    return readJsonLines<StoredIdempotencyRecord<TEvent>>(this.idempotencyPath);
  }

  private streamPath(streamName: EventStreamName): string {
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

function appendJsonLines(path: string, values: readonly unknown[]): void {
  const payload = values.map((value) => JSON.stringify(value)).join('\n');
  appendFileSync(path, `${payload}\n`);
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

function assertNonEmptyBatch(events: readonly EventEnvelope[]): void {
  if (events.length === 0) {
    throw new Error('event batch must contain at least one event');
  }
}

function validateReadOptions(options: EventStreamReadOptions): void {
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

function fingerprintEvents(events: readonly EventEnvelope[]): string {
  return JSON.stringify(events);
}
