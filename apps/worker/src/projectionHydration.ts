import {
  replayEvents,
  type EventStore,
  type EventStreamName,
} from '@aivilization/sim-core';
import { applyWorldEvent, type WorldEvent, type WorldProjection } from '@aivilization/world';

export type WorldProjectionHydrationInput = {
  readonly initialProjection: WorldProjection;
  readonly eventStore: EventStore<WorldEvent>;
  readonly streamName: EventStreamName;
  readonly fromSequence?: number;
  readonly toSequence?: number;
};

export type WorldProjectionHydrationResult = {
  readonly projection: WorldProjection;
  readonly events: readonly WorldEvent[];
  readonly lastAppliedSequence: number;
  readonly streamVersion: number;
};

export function hydrateWorldProjectionFromEventStream(
  input: WorldProjectionHydrationInput,
): WorldProjectionHydrationResult {
  const fromSequence = input.fromSequence ?? 0;
  assertNonNegativeInteger(fromSequence, 'fromSequence');

  const streamVersion = input.eventStore.getStreamVersion(input.streamName);
  const toSequence = input.toSequence ?? streamVersion;
  assertNonNegativeInteger(toSequence, 'toSequence');
  if (toSequence < fromSequence) {
    throw new Error('toSequence must be greater than or equal to fromSequence');
  }
  if (toSequence > streamVersion) {
    throw new Error(`toSequence ${toSequence} must not exceed stream version ${streamVersion}`);
  }

  const events = input.eventStore
    .readStream(input.streamName, { afterSequence: fromSequence })
    .filter((event) => event.sequence <= toSequence);
  const projection = replayEvents(input.initialProjection, events, applyWorldEvent);

  return {
    projection,
    events,
    lastAppliedSequence: toSequence,
    streamVersion,
  };
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}
