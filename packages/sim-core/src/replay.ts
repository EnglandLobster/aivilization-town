import type { EventEnvelope } from './event';

export function replayEvents<TProjection, TEvent extends EventEnvelope>(
  initialProjection: TProjection,
  events: readonly TEvent[],
  apply: (projection: TProjection, event: TEvent) => TProjection,
): TProjection {
  const ordered = [...events].sort((left, right) => left.sequence - right.sequence);
  return ordered.reduce<TProjection>(
    (projection, event) => apply(projection, event),
    initialProjection,
  );
}
