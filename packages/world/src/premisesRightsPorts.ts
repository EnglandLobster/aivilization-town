import { effectiveController, sameController } from '@aivilization/authority';
import type {
  PremisesPermit,
  AnyPremisesPermitTerms,
  PremisesRightsPorts,
} from '@aivilization/premises';
import { resolveAgentResidenceLocationId, type WorldProjection } from './projection';
export type PremisesRightsAuthorization = Pick<
  PremisesRightsPorts,
  'authorize' | 'controllerAvailable' | 'actingFor'
>;

export function premisesHasActiveWork(
  w: WorldProjection,
  locationId: string,
  users?: readonly string[],
) {
  return (
    Object.values(w.materials?.productions ?? {}).some(
      (p) =>
        p.session &&
        p.session.until > w.clock.now &&
        w.materials?.stocks[p.stockId]?.locationId === locationId &&
        (!users || users.includes(p.session.actorId)),
    ) ||
    Object.values(w.serviceEngagements?.engagements ?? {}).some(
      (e) =>
        e.locationId === locationId &&
        [e.providerPresence, e.recipientPresence].some(
          (p) => p && p.until > w.clock.now && (!users || users.includes(p.actorId)),
        ),
    )
  );
}
export function premisesPermitConflict(
  w: WorldProjection,
  t: AnyPremisesPermitTerms,
  at: number,
): string | undefined {
  const b = w.premises?.buildings[t.buildingId];
  if (!b || b.status !== 'operational' || b.condition <= 0) return 'permit-building-unavailable';
  if (
    Object.values(w.premises?.projects ?? {}).some(
      (p) => p.buildingId === b.id && p.status === 'open',
    )
  )
    return 'permit-construction-in-progress';
  if (t.scopes.includes('reside') && b.blueprint.primaryUse !== 'residence')
    return 'permit-residential-building-required';
  if (t.mode !== 'exclusive') return undefined;
  const from = Math.max(at, t.startAt),
    location = b.locationId;
  if (
    t.scopes.includes('reside') &&
    (Object.values(w.agents).some(
      (a) => !t.users.includes(a.agentId) && resolveAgentResidenceLocationId(w, a) === location,
    ) ||
      Object.values(w.residentLeases?.leases ?? {}).some(
        (l) =>
          l.locationId === location &&
          l.status !== 'ended' &&
          l.expiresAt > from &&
          !t.users.includes(l.tenantId),
      ))
  )
    return 'permit-existing-residence-or-lease';
  if (
    t.scopes.includes('store') &&
    Object.values(w.materials?.stocks ?? {}).some(
      (s) =>
        s.locationId === location &&
        s.status !== 'closed' &&
        !sameController(effectiveController(s), t.grantee) &&
        !(
          effectiveController(s).kind === 'resident' && t.users.includes(effectiveController(s).id)
        ),
    )
  )
    return 'permit-existing-stock-obligation';
  if (
    t.scopes.includes('operate') &&
    (Object.values(w.materials?.productions ?? {}).some(
      (p) =>
        p.session &&
        p.session.until > from &&
        w.materials?.stocks[p.stockId]?.locationId === location &&
        !t.users.includes(p.session.actorId),
    ) ||
      Object.values(w.serviceEngagements?.engagements ?? {}).some(
        (e) =>
          e.locationId === location &&
          ['accepted', 'funded'].includes(e.status) &&
          e.endAt > from &&
          e.startAt < t.endAt &&
          !t.users.includes(e.providerId),
      ))
  )
    return 'permit-existing-work-obligation';
  return undefined;
}
export function premisesPermitReleaseBlocked(
  w: WorldProjection,
  p: PremisesPermit,
): string | undefined {
  const b = w.premises?.buildings[p.buildingId];
  return b && premisesHasActiveWork(w, b.locationId, p.users)
    ? 'permit-active-work-must-end-first'
    : undefined;
}
export function residentPremisesRightsPorts(
  w: WorldProjection,
  auth: PremisesRightsAuthorization,
): PremisesRightsPorts {
  return {
    ...auth,
    building: (id) => w.premises?.buildings[id],
    exists: (id) => !!w.agents[id],
    conflict: (t, at) => premisesPermitConflict(w, t, at),
    releaseBlocked: (p) => premisesPermitReleaseBlocked(w, p),
  };
}
