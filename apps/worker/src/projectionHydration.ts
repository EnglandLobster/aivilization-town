import {
  replayEvents,
  type EventStore,
  type EventStreamName,
  type ProjectionCheckpoint,
  type ProjectionCheckpointLookup,
  type ProjectionCheckpointStore,
  type ProjectionSnapshotStore,
  type SnapshotReference,
} from '@aivilization/sim-core';
import {
  applyWorldEvent,
  enforceWorldProjectionMemoryRetention,
  normalizeLegacyWorldProjectionSnapshot,
  type WorldEvent,
  type WorldProjection,
} from '@aivilization/world';

export type WorldProjectionCheckpointHydrationInput = {
  readonly checkpointStore: ProjectionCheckpointStore;
  readonly snapshotStore: ProjectionSnapshotStore<WorldProjection>;
  readonly lookup: ProjectionCheckpointLookup;
};

export type WorldProjectionHydrationInput = {
  readonly initialProjection: WorldProjection;
  readonly eventStore: EventStore<WorldEvent>;
  readonly streamName: EventStreamName;
  readonly fromSequence?: number;
  readonly toSequence?: number;
  readonly checkpoint?: WorldProjectionCheckpointHydrationInput;
};

export type WorldProjectionHydrationResult = {
  readonly projection: WorldProjection;
  readonly events: readonly WorldEvent[];
  readonly lastAppliedSequence: number;
  readonly streamVersion: number;
  readonly replayFromSequence: number;
  readonly checkpoint?: ProjectionCheckpoint;
  readonly snapshot?: SnapshotReference;
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

  const checkpointHydration = resolveCheckpointHydration({
    checkpoint: input.checkpoint,
    fromSequence,
    toSequence,
    streamVersion,
  });
  const replayFromSequence = checkpointHydration?.fromSequence ?? fromSequence;
  const initialProjection = enforceWorldProjectionMemoryRetention(
    normalizeLegacyWorldProjectionSnapshot(
      checkpointHydration?.projection ?? input.initialProjection,
    ),
  );
  const events = input.eventStore
    .readStream(input.streamName, { afterSequence: replayFromSequence })
    .filter((event) => event.sequence <= toSequence);
  let projection: WorldProjection;
  try {
    projection = replayEvents(initialProjection, events, applyWorldEvent);
  } catch (checkpointReplayError) {
    if (checkpointHydration === undefined) {
      throw checkpointReplayError;
    }
    // Snapshots are a disposable acceleration layer; the event stream remains
    // authoritative. Older runtimes could checkpoint an in-memory authority
    // fact before its inbox append reached the stream. Such a snapshot has a
    // valid sequence and checksum but replaying the later durable delivery on
    // top of it violates a domain invariant. Retry from the caller's trusted
    // base projection and only recover when the complete event prefix itself
    // is valid. A corrupt event stream therefore still fails closed.
    const fallbackEvents = input.eventStore
      .readStream(input.streamName, { afterSequence: fromSequence })
      .filter((event) => event.sequence <= toSequence);
    try {
      projection = replayEvents(
        enforceWorldProjectionMemoryRetention(
          normalizeLegacyWorldProjectionSnapshot(input.initialProjection),
        ),
        fallbackEvents,
        applyWorldEvent,
      );
    } catch (eventStreamReplayError) {
      throw new AggregateError(
        [checkpointReplayError, eventStreamReplayError],
        'checkpoint replay failed and the authoritative event stream could not rebuild the projection',
      );
    }
    return {
      projection,
      events: fallbackEvents,
      lastAppliedSequence: toSequence,
      streamVersion,
      replayFromSequence: fromSequence,
    };
  }

  return {
    projection,
    events,
    lastAppliedSequence: toSequence,
    streamVersion,
    replayFromSequence,
    ...(checkpointHydration === undefined ? {} : { checkpoint: checkpointHydration.checkpoint }),
    ...(checkpointHydration === undefined ? {} : { snapshot: checkpointHydration.snapshot }),
  };
}

type ResolvedCheckpointHydration = {
  readonly projection: WorldProjection;
  readonly fromSequence: number;
  readonly checkpoint: ProjectionCheckpoint;
  readonly snapshot: SnapshotReference;
};

function resolveCheckpointHydration(input: {
  readonly checkpoint: WorldProjectionCheckpointHydrationInput | undefined;
  readonly fromSequence: number;
  readonly toSequence: number;
  readonly streamVersion: number;
}): ResolvedCheckpointHydration | undefined {
  if (input.checkpoint === undefined) {
    return undefined;
  }

  const checkpoint = input.checkpoint.checkpointStore.getLatestCheckpoint(input.checkpoint.lookup);
  if (checkpoint?.snapshot === undefined) {
    return undefined;
  }

  const snapshot = checkpoint.snapshot;
  if (snapshot.sequence > input.streamVersion) {
    throw new Error(
      `checkpoint snapshot sequence ${snapshot.sequence} must not exceed stream version ${input.streamVersion}`,
    );
  }
  if (snapshot.sequence <= input.fromSequence || snapshot.sequence > input.toSequence) {
    return undefined;
  }

  const projection = input.checkpoint.snapshotStore.loadSnapshot(snapshot);
  if (projection === undefined) {
    throw new Error(`checkpoint snapshot is missing: ${snapshot.uri}`);
  }

  return {
    projection,
    fromSequence: snapshot.sequence,
    checkpoint,
    snapshot,
  };
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}
