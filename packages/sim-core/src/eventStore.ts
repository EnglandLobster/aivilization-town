import type { EventEnvelope } from './event';

export type EventStreamName = string;

export type EventStreamReadOptions = {
  readonly afterSequence?: number;
  readonly limit?: number;
};

export type AppendToEventStreamRequest<TEvent extends EventEnvelope = EventEnvelope> = {
  readonly streamName: EventStreamName;
  readonly expectedVersion?: number;
  readonly idempotencyKey?: string;
  readonly events: readonly TEvent[];
};

export type AppendToEventStreamResult<TEvent extends EventEnvelope = EventEnvelope> = {
  readonly appendedEvents: readonly TEvent[];
  readonly streamVersion: number;
  readonly idempotentReplay: boolean;
};

export type IdempotentEventStreamAppend<TEvent extends EventEnvelope = EventEnvelope> = {
  readonly idempotencyKey: string;
  readonly streamName: EventStreamName;
  readonly expectedVersion?: number;
  readonly appendedEvents: readonly TEvent[];
  readonly streamVersion: number;
};

export interface EventStore<TEvent extends EventEnvelope = EventEnvelope> {
  appendToStream(request: AppendToEventStreamRequest<TEvent>): AppendToEventStreamResult<TEvent>;
  readStream(streamName: EventStreamName, options?: EventStreamReadOptions): readonly TEvent[];
  getStreamVersion(streamName: EventStreamName): number;
  getIdempotentAppend(idempotencyKey: string): IdempotentEventStreamAppend<TEvent> | undefined;
}

type StoredIdempotencyRecord<TEvent extends EventEnvelope> = {
  readonly streamName: EventStreamName;
  readonly expectedVersion?: number;
  readonly eventFingerprint: string;
  readonly appendedEvents: readonly TEvent[];
  readonly streamVersion: number;
};

export class InMemoryEventStore<
  TEvent extends EventEnvelope = EventEnvelope,
> implements EventStore<TEvent> {
  private readonly streams = new Map<EventStreamName, readonly TEvent[]>();
  private readonly idempotencyRecords = new Map<string, StoredIdempotencyRecord<TEvent>>();

  appendToStream(request: AppendToEventStreamRequest<TEvent>): AppendToEventStreamResult<TEvent> {
    assertNonEmpty(request.streamName, 'streamName');
    assertNonEmptyBatch(request.events);

    const idempotentReplay = this.replayIdempotentAppendIfPresent(request);
    if (idempotentReplay !== undefined) {
      return idempotentReplay;
    }

    const currentStream = this.streams.get(request.streamName) ?? [];
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

    const nextStream = [...currentStream, ...request.events];
    this.streams.set(request.streamName, nextStream);
    const result = {
      appendedEvents: request.events,
      streamVersion: nextStream.length,
      idempotentReplay: false,
    };

    if (request.idempotencyKey !== undefined) {
      this.idempotencyRecords.set(request.idempotencyKey, {
        streamName: request.streamName,
        ...(request.expectedVersion === undefined
          ? {}
          : { expectedVersion: request.expectedVersion }),
        eventFingerprint: fingerprintEvents(request.events),
        appendedEvents: request.events,
        streamVersion: nextStream.length,
      });
    }

    return result;
  }

  readStream(streamName: EventStreamName, options: EventStreamReadOptions = {}): readonly TEvent[] {
    assertNonEmpty(streamName, 'streamName');
    validateReadOptions(options);

    const stream = this.streams.get(streamName) ?? [];
    const afterSequence = options.afterSequence ?? 0;
    const windowed = stream.filter((event) => event.sequence > afterSequence);
    return options.limit === undefined ? windowed : windowed.slice(0, options.limit);
  }

  getStreamVersion(streamName: EventStreamName): number {
    assertNonEmpty(streamName, 'streamName');
    return this.streams.get(streamName)?.length ?? 0;
  }

  getIdempotentAppend(
    idempotencyKey: string,
  ): IdempotentEventStreamAppend<TEvent> | undefined {
    assertNonEmpty(idempotencyKey, 'idempotencyKey');
    const record = this.idempotencyRecords.get(idempotencyKey);
    if (record === undefined) return undefined;
    return {
      idempotencyKey,
      streamName: record.streamName,
      ...(record.expectedVersion === undefined
        ? {}
        : { expectedVersion: record.expectedVersion }),
      appendedEvents: record.appendedEvents,
      streamVersion: record.streamVersion,
    };
  }

  private replayIdempotentAppendIfPresent(
    request: AppendToEventStreamRequest<TEvent>,
  ): AppendToEventStreamResult<TEvent> | undefined {
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
