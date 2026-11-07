import { applyVehiclePrincipalEvent } from '@aivilization/mobility';
import { applyPremisesCommit } from '@aivilization/premises';
import { applyMaterialCommit } from '@aivilization/materials';
import type { PrincipalControlChanged } from '@aivilization/authority';
import type { WorldProjection } from './projection';
import type { PrincipalCollectivePort } from './principalCollectivePort';
import { worldPrincipalAvailable } from './resourcePrincipalAuthority';
/** Owning effects only. Every caller must independently validate its exact authority and transaction source first. Not exported by the package. */
export function applyPrincipalResourceControlEffects(
  w: WorldProjection,
  change: PrincipalControlChanged,
  collective?: PrincipalCollectivePort,
): WorldProjection {
  if (change.control.at !== w.clock.now) throw Error('principal-control-actual-time-required');
  if (change.request.resourceKind === 'vehicle') {
    if (!w.residentMobility?.principalPolicy) throw Error('vehicle-principals-not-enabled');
    const command = change.request.command,
      vehicle = w.residentMobility.vehicles[change.request.resourceId];
    const target =
      command.type === 'offer'
        ? command.target
        : command.type === 'accept'
          ? vehicle?.control?.offer?.target
          : undefined;
    if (target && !worldPrincipalAvailable(w, target, collective))
      throw Error('vehicle-principal-target-unavailable');
    return {
      ...w,
      residentMobility: applyVehiclePrincipalEvent(w.residentMobility, {
        type: 'VehiclePrincipalControlChanged',
        id: change.request.resourceId,
        previousRevision: change.request.resourceRevision,
        change,
      }),
    };
  }
  if (change.request.resourceKind === 'premises') {
    if (!w.premises?.resourcePrincipals) throw Error('premises-principals-not-enabled');
    return {
      ...w,
      premises: applyPremisesCommit(w.premises, [
        { type: 'PremisesPrincipalControlChanged', change },
      ]).state,
    };
  }
  if (change.request.resourceKind !== 'stock' || !w.materials?.resourcePrincipals)
    throw Error('material-principals-not-enabled');
  return {
    ...w,
    materials: applyMaterialCommit(w.materials, [
      { type: 'MaterialPrincipalControlChanged', change },
    ]).state,
  };
}
