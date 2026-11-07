import { emptyServiceEngagementsState } from '@aivilization/services';
import { applyPremisesEvent } from '@aivilization/premises';
import type { WorldProjection } from '@aivilization/world';
export const SERVICE_FACILITY_SEED_VERSION = 'explicit-service-facilities-v1';
/** New experiments declare finite pre-existing public assets. Older journals receive none implicitly. */
export function seedOpenServiceEngagements(w: WorldProjection) {
  if (!w.premises || !w.materials?.reservations) throw Error('service-physical-domains-required');
  let premises = w.premises;
  for (const l of Object.values(w.locations).sort((a, b) =>
    a.locationId.localeCompare(b.locationId),
  )) {
    if (!['education', 'healthcare'].includes(l.kind) || l.capacity === null || l.capacity < 2)
      continue;
    const count = Math.min(2, Math.floor(l.capacity / 2));
    premises = applyPremisesEvent(premises, {
      type: 'ServiceFacilityEndowed',
      endowment: {
        locationId: l.locationId,
        careStations: l.kind === 'healthcare' ? count : 0,
        teachingStations: l.kind === 'education' ? count : 0,
        source: 'scenario-seed',
        sourceId: SERVICE_FACILITY_SEED_VERSION,
      },
    });
  }
  return { premises, serviceEngagements: emptyServiceEngagementsState() };
}
