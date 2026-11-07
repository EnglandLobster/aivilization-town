import type { PremisesState } from './model';

/** Physical/author/control source for an application-owned sale; this module knows no prices or commerce. */
export function premisesTransferFacts(state: PremisesState, id: string) {
  const building = state.buildings[id],
    control = building?.control;
  if (
    !state.resourcePrincipals ||
    !building ||
    !control ||
    control.policyVersion !== 'resource-principals-v2' ||
    !control.offer
  )
    return undefined;
  return {
    kind: 'premises' as const,
    id: building.id,
    revision: building.revision,
    controlVersion: control.version,
    seller: structuredClone(control.controller),
    offer: structuredClone(control.offer),
    authorId: building.ownerId,
    locationId: building.locationId,
    blueprint: structuredClone(building.blueprint),
    condition: building.condition,
    buildingStatus: building.status,
    openProjects: Object.values(state.projects)
      .filter((p) => p.buildingId === id && p.status === 'open')
      .map((p) => ({ id: p.id, revision: p.revision }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
}
