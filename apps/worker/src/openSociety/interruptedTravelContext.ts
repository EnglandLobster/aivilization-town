import type { WorldProjection } from '@aivilization/world';
/** One own-state pointer at opportunity start; original route only on explicit action query. */
export function interruptedTravelContext(w: WorldProjection, actorId: string, detail = false) {
  const record = w.interruptedTravelByAgent?.[actorId];
  if (!record) return {};
  return {
    interruptedTravel: {
      status: 'interrupted' as const,
      vehicleId: record.vehicleId,
      stoppedAt: record.source.at,
      requires: 'authorized-travel-resumption',
      readWith: 'town city observe --view action',
      ...(detail
        ? {
            elapsedMs: record.source.at - record.transit.departedAt,
            originalTravel: structuredClone(record.transit),
            source: {
              version: record.source.version,
              populationEventId: record.source.populationEventId,
            },
          }
        : {}),
    },
  };
}
