import {
  boundPrincipalControlEffect,
  samePrincipalRequest,
  type PrincipalControlChanged,
} from '@aivilization/authority';
import { resourceSaleControlEffect, type ResourceSaleEvent } from '@aivilization/commerce';
import { decidePremisesPrincipalControl, applyPremisesCommit } from '@aivilization/premises';
import { decideMaterialPrincipalControl, applyMaterialCommit } from '@aivilization/materials';
import { decideVehiclePrincipalControl, applyVehiclePrincipalEvent } from '@aivilization/mobility';
import type { WorldProjection } from './projection';
import type { PrincipalCollectivePort } from './principalCollectivePort';
import { worldPrincipalAvailable } from './resourcePrincipalAuthority';
/** Parent authority has already been verified. Only the declared child transition receives its scoped proof. */
export function prepareResourceSaleControl(
  w: WorldProjection,
  event: ResourceSaleEvent,
  collective?: PrincipalCollectivePort,
) {
  if (
    event.type !== 'ResourceSaleCommitted' ||
    !event.authorization ||
    event.operation === 'expire' ||
    event.operation === 'offer'
  )
    return undefined;
  const request = resourceSaleControlEffect(event.sale, event.command!, event.sourceRead);
  if (!request) return undefined;
  const authorization = boundPrincipalControlEffect(event.authorization, request);
  const ports = {
    actorId: event.actorId,
    at: w.clock.now,
    request,
    available: (p: Parameters<typeof worldPrincipalAvailable>[1]) =>
      worldPrincipalAvailable(w, p, collective),
    authorize: (p: typeof authorization.principal, r: typeof request) =>
      p.kind === authorization.principal.kind &&
      p.id === authorization.principal.id &&
      samePrincipalRequest(r, request)
        ? authorization
        : undefined,
  };
  if (request.resourceKind === 'premises' && w.premises) {
    const d = decidePremisesPrincipalControl({ ...ports, state: w.premises });
    if (!d.accepted) throw Error(d.reason);
    return d.event.change;
  }
  const d =
    request.resourceKind === 'stock' && w.materials
      ? decideMaterialPrincipalControl({ ...ports, state: w.materials })
      : request.resourceKind === 'vehicle' && w.residentMobility
        ? decideVehiclePrincipalControl(w.residentMobility, event.actorId, w.clock.now, request, {
            available: ports.available,
            authorizeControl: ports.authorize,
            // This scope cannot manage drivers; custody/driver permissions are left intact.
            authorizeOperation: () => undefined,
            driverReleaseBlocked: () => 'resource-sale-driver-management-not-authorized',
          })
        : { accepted: false as const, reason: 'resource-sale-owning-resource-required' };
  if (!d.accepted) throw Error(d.reason);
  const e = d.events[0];
  if (
    d.events.length !== 1 ||
    (e?.type !== 'MaterialPrincipalControlChanged' && e?.type !== 'VehiclePrincipalControlChanged')
  )
    throw Error('resource-sale-single-control-required');
  return e.change;
}
/** Apply recorded owning facts. No decision or financial formula is rerun in a reducer. */
export function applyResourceSaleControl(
  w: WorldProjection,
  change: PrincipalControlChanged,
): WorldProjection {
  const kind = change.request.resourceKind;
  if (kind === 'premises')
    return {
      ...w,
      premises: applyPremisesCommit(w.premises, [
        { type: 'PremisesPrincipalControlChanged', change },
      ]).state,
    };
  if (kind === 'stock')
    return {
      ...w,
      materials: applyMaterialCommit(w.materials, [
        { type: 'MaterialPrincipalControlChanged', change },
      ]).state,
    };
  if (kind === 'vehicle' && w.residentMobility)
    return {
      ...w,
      residentMobility: applyVehiclePrincipalEvent(w.residentMobility, {
        type: 'VehiclePrincipalControlChanged',
        id: change.request.resourceId,
        previousRevision: change.request.resourceRevision,
        change,
      }),
    };
  throw Error('resource-sale-owning-resource-required');
}
