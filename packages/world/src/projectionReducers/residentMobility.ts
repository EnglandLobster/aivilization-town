import { applyResidentTransportInterruption } from '../residentTransportInterruption';
import { applyMobilityEvent } from '@aivilization/mobility';
import type { WorldProjection } from '../projection';
import type { WorldEvent } from '../events';
export function applyResidentMobilityProjection(
  projection: WorldProjection,
  event: WorldEvent,
): WorldProjection | undefined {
  if (event.type !== 'ResidentMobilityCommitted') return undefined;
  if (!projection.residentMobility || event.payload.policyVersion !== 'resident-mobility-v1')
    throw new Error('mobility-not-enabled-or-version-mismatch');
  if (event.payload.transportInterruption)
    return applyResidentTransportInterruption(projection, event);
  if (event.payload.events.some((e) => e.type === 'VehicleJourneyInterrupted'))
    throw Error('vehicle-interruption-requires-atomic-transport-adapter');
  return {
    ...projection,
    residentMobility: event.payload.events.reduce(applyMobilityEvent, projection.residentMobility),
  };
}
