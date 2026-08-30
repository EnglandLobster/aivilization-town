import type { WorldEvent } from '../events';
import type { WorldProjection } from '../projection';

export function applyRegionalServiceQualityProjectionEvent(
  projection: WorldProjection,
  event: WorldEvent,
): WorldProjection | undefined {
  if (event.type !== 'RegionalServiceQualityUpdated') return undefined;
  const previousRegion = projection.regionalServiceQualities?.[event.payload.regionId];
  return {
    ...projection,
    regionalServiceQualities: {
      ...projection.regionalServiceQualities,
      [event.payload.regionId]: {
        ...previousRegion,
        [event.payload.service]: {
          service: event.payload.service,
          quality: event.payload.quality,
          fundedAmount: event.payload.fundedAmount,
          occupancy: event.payload.occupancy,
          capacity: event.payload.capacity,
          budgetEfficiency: event.payload.budgetEfficiency,
          occupancyRatio: event.payload.occupancyRatio,
          capacityEfficiency: event.payload.capacityEfficiency,
          landValueContribution: event.payload.landValueContribution,
          wellbeingContribution: event.payload.wellbeingContribution,
          policyVersion: event.payload.policyVersion,
          settledAt: event.payload.settledAt,
        },
      },
    },
  };
}
