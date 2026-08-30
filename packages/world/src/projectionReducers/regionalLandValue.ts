import type { WorldEvent } from '../events';
import type { WorldProjection } from '../projection';

/**
 * Projection reducer for the regional land value read-model slice. The index
 * is a pricing signal only: the reducer stores the authoritative value from
 * each RegionalLandValueUpdated event and never recomputes it (the decision
 * was already made by the world cadence handler and recorded in the event).
 */
export function applyRegionalLandValueProjectionEvent(
  projection: WorldProjection,
  event: WorldEvent,
): WorldProjection | undefined {
  switch (event.type) {
    case 'RegionalLandValueUpdated':
      return {
        ...projection,
        regionalLandValues: {
          ...projection.regionalLandValues,
          [event.payload.regionId]: event.payload.nextIndex,
        },
        ...(event.payload.settledAt <= projection.clock.now
          ? {}
          : {
              pendingRegionalLandValueUpdates: [
                ...(projection.pendingRegionalLandValueUpdates ?? []).filter(
                  (update) =>
                    update.settledAt !== event.payload.settledAt ||
                    update.regionId !== event.payload.regionId,
                ),
                { ...event.payload },
              ].sort(
                (left, right) =>
                  left.settledAt - right.settledAt || left.regionId.localeCompare(right.regionId),
              ),
            }),
      };
    default:
      return undefined;
  }
}
