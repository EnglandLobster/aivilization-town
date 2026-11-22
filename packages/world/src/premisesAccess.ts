import {
  mayEnterPremises,
  mayOperatePremises,
  mayResideInPremises,
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
/** Receiving new cargo requires control of, or an operation grant in, the actual building. */
export function premisesStorageControllerAllowed(
  w: WorldProjection,
  controller: Controller,
  locationId: string,
) {
  const b = premisesAtLocation(w, locationId);
  if (!b) return true;
  if (b.status !== 'operational' || b.condition <= 0) return false;
  return (
    sameController(effectiveController(b), controller) ||
    (controller.kind === 'resident' && mayOperatePremises(b, controller.id))
  );
}
export function mayEnterWorldPremises(w: WorldProjection, actorId: string, locationId: string) {
  const b = premisesAtLocation(w, locationId);
  if (!b) return true;
  if (b.status !== 'operational' || b.condition <= 0) return false;
  return (
    mayEnterPremises(b, actorId) ||
    mayRetrieveWorldStock(w, actorId, locationId) ||
    w.agents[actorId]?.residenceLocationId === locationId
  );
}
export function mayResideWorldPremises(w: WorldProjection, actorId: string, locationId: string) {
  const b = premisesAtLocation(w, locationId);
  if (!b) return true;
  return (
    b.status === 'operational' &&
    b.condition > 0 &&
    b.blueprint.primaryUse === 'residence' &&
    (mayResideInPremises(b, actorId) || w.agents[actorId]?.residenceLocationId === locationId)
  );
}
export function mayOperateWorldPremises(w: WorldProjection, actorId: string, locationId: string) {
  const b = premisesAtLocation(w, locationId);
  return !b || (b.status === 'operational' && b.condition > 0 && mayOperatePremises(b, actorId));
}
export function mayStoreWorldPremises(w: WorldProjection, actorId: string, locationId: string) {
  return mayOperateWorldPremises(w, actorId, locationId);
}
/** Retrieval grants entry only; stock ownership/collective authorization is still required to withdraw. */
export function mayRetrieveWorldStock(w: WorldProjection, actorId: string, locationId: string) {
  return (
    !!premisesAtLocation(w, locationId) &&
    Object.values(w.materials?.stocks ?? {}).some(
      (stock) =>
        stock.locationId === locationId &&
        stock.status !== 'closed' &&
        personallyControls(stock, actorId),
    )
  );
}
/** Until when the actor may keep using the building for this scope, given current grants. */
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
  const allowed =
    scope === 'entry'
      ? mayEnterPremises(b, actorId)
      : scope === 'reside'
        ? mayResideInPremises(b, actorId)
        : mayOperatePremises(b, actorId);
  return allowed ? Number.MAX_SAFE_INTEGER : at;
}
