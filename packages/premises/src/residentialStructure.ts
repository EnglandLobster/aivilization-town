import type { PremisesState } from './model';

/** Administrative closure and expired rights do not remove an existing physical structure. */
export function residentialStructureAt(s: PremisesState, locationId: string) {
  const b = Object.values(s.buildings).find((b) => b.locationId === locationId);
  if (!b || b.status === 'demolished' || b.condition <= 0 || b.blueprint.primaryUse !== 'residence')
    return undefined;
  return {
    locationId: b.locationId,
    buildingId: b.id,
    revision: b.revision,
    condition: b.condition,
  } as const;
}

/** Until is an exclusive interval boundary. Future wear belongs to the owning scheduler. */
export function assertResidentialStructureInterval(s: PremisesState, from: number, until: number) {
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(until) || from < 0 || until < from)
    throw Error('invalid-physical-housing-interval');
  for (const b of Object.values(s.buildings)) {
    if (b.status === 'demolished') continue;
    const next = b.wearSettledAt + s.policy.wearIntervalMs;
    if (b.wearSettledAt > from || next <= from || until > next)
      throw Error('physical-housing-requires-settled-premises-boundaries');
  }
}
