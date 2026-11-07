import { freightCustodian } from '@aivilization/logistics';
import {
  mayEnterPremises,
  mayOperatePremises,
  mayResideInPremises,
  premisesPermitAllows,
  premisesPermitUseUntil,
  permitEffectiveAt,
  type PremisesUseScope,
} from '@aivilization/premises';
import {
  effectiveController,
  personallyControls,
  sameController,
  type Controller,
} from '@aivilization/authority';
import type { WorldProjection } from './projection';
export function premisesAtLocation(w: WorldProjection, locationId: string) {
  return Object.values(w.premises?.buildings ?? {}).find((b) => b.locationId === locationId);
}
/** Receiving new cargo requires an actual storage right, not only ownership of a stock record. */
export function premisesStorageControllerAllowed(
  w: WorldProjection,
  controller: Controller,
  locationId: string,
) {
  const b = premisesAtLocation(w, locationId);
  if (!b || !w.premisesRights) return true;
  if (b.status !== 'operational' || b.condition <= 0) return false;
  const permits = Object.values(w.premisesRights.permits).filter(
    (p) => p.buildingId === b.id && p.scopes.includes('store') && permitEffectiveAt(p, w.clock.now),
  );
  const entitled = (p: (typeof permits)[number]) =>
    sameController(p.grantee, controller) ||
    (controller.kind === 'resident' && p.users.includes(controller.id));
  if (permits.some((p) => p.mode === 'exclusive' && !entitled(p))) return false;
  return (
    permits.some(entitled) ||
    sameController(effectiveController(b), controller) ||
    (controller.kind === 'resident' && mayOperatePremises(b, controller.id))
  );
}
function activeLease(w: WorldProjection, actorId: string, locationId: string) {
  return Object.values(w.residentLeases?.leases ?? {}).some(
    (l) =>
      l.tenantId === actorId &&
      l.locationId === locationId &&
      l.status === 'active' &&
      l.expiresAt > w.clock.now,
  );
}
export function mayEnterWorldPremises(w: WorldProjection, actorId: string, locationId: string) {
  const b = premisesAtLocation(w, locationId);
  if (!b) return true;
  if (b.status !== 'operational' || b.condition <= 0) return false;
  const actualResident = w.agents[actorId]?.residenceLocationId === locationId;
  const invitation = Object.values(w.residentLeases?.leases ?? {}).some(
    (l) =>
      l.tenantId === actorId &&
      l.locationId === locationId &&
      l.status === 'offered' &&
      l.expiresAt > w.clock.now,
  );
  return (
    premisesPermitAllows(
      w.premisesRights,
      b.id,
      actorId,
      'entry',
      w.clock.now,
      mayEnterPremises(b, actorId),
    ) ||
    mayRetrieveWorldStock(w, actorId, locationId) ||
    (w.premisesRights !== undefined &&
      Object.values(w.logistics?.freight ?? {}).some(
        (f) =>
          freightCustodian(w.logistics?.custody, f).carrierId === actorId &&
          ((f.sourceLocationId === locationId &&
            ['funded', 'loaded', 'return-required'].includes(f.status)) ||
            (f.destinationLocationId === locationId &&
              f.status === 'loaded' &&
              premisesStorageControllerAllowed(w, f.recipient, locationId))),
      )) ||
    actualResident ||
    activeLease(w, actorId, locationId) ||
    invitation
  );
}
export function mayResideWorldPremises(w: WorldProjection, actorId: string, locationId: string) {
  const b = premisesAtLocation(w, locationId);
  if (!b) return true;
  return (
    b.status === 'operational' &&
    b.condition > 0 &&
    b.blueprint.primaryUse === 'residence' &&
    (premisesPermitAllows(
      w.premisesRights,
      b.id,
      actorId,
      'reside',
      w.clock.now,
      mayResideInPremises(b, actorId),
    ) ||
      activeLease(w, actorId, locationId) ||
      w.agents[actorId]?.residenceLocationId === locationId)
  );
}
export function mayOperateWorldPremises(w: WorldProjection, actorId: string, locationId: string) {
  const b = premisesAtLocation(w, locationId);
  return (
    !b ||
    (b.status === 'operational' &&
      b.condition > 0 &&
      premisesPermitAllows(
        w.premisesRights,
        b.id,
        actorId,
        'operate',
        w.clock.now,
        mayOperatePremises(b, actorId),
      ))
  );
}
export function mayStoreWorldPremises(w: WorldProjection, actorId: string, locationId: string) {
  const b = premisesAtLocation(w, locationId);
  return (
    !b ||
    (b.status === 'operational' &&
      b.condition > 0 &&
      premisesPermitAllows(
        w.premisesRights,
        b.id,
        actorId,
        'store',
        w.clock.now,
        mayOperatePremises(b, actorId),
      ))
  );
}
/** Retrieval grants entry only; stock ownership/collective authorization is still required to withdraw. */
export function mayRetrieveWorldStock(w: WorldProjection, actorId: string, locationId: string) {
  if (!w.premisesRights) return false;
  const b = premisesAtLocation(w, locationId);
  return (
    !!b &&
    Object.values(w.materials?.stocks ?? {}).some(
      (stock) =>
        stock.locationId === locationId &&
        stock.status !== 'closed' &&
        (personallyControls(stock, actorId) ||
          Object.values(w.premisesRights!.permits).some(
            (p) =>
              p.buildingId === b.id &&
              p.accepted &&
              p.scopes.includes('store') &&
              p.users.includes(actorId) &&
              sameController(p.grantee, effectiveController(stock)),
          )),
    )
  );
}
/** A historical interval is checked at its start and every future rights boundary. */
export function worldPremisesUseUntil(
  w: WorldProjection,
  actorId: string,
  locationId: string,
  scope: PremisesUseScope,
  at = w.clock.now,
) {
  const b = premisesAtLocation(w, locationId);
  if (!b) return Number.MAX_SAFE_INTEGER;
  if (b.status !== 'operational' || b.condition <= 0) return at;
  const baseline =
    scope === 'entry'
      ? mayEnterPremises(b, actorId)
      : scope === 'reside'
        ? mayResideInPremises(b, actorId)
        : mayOperatePremises(b, actorId);
  return premisesPermitUseUntil(w.premisesRights, b.id, actorId, scope, at, baseline);
}
/** A new lease cannot promise conflicting exclusive residence rights, including future windows. */
export function premisesLeaseRightAvailable(
  w: WorldProjection,
  tenantId: string,
  locationId: string,
  expiresAt: number,
) {
  const b = premisesAtLocation(w, locationId);
  return (
    !b ||
    !w.premisesRights ||
    premisesPermitUseUntil(w.premisesRights, b.id, tenantId, 'reside', w.clock.now, true) >=
      expiresAt
  );
}
