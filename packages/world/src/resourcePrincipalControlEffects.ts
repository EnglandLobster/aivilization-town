import { applyPremisesCommit } from '@aivilization/premises';
import { applyMaterialCommit } from '@aivilization/materials';
import type { PrincipalControlChanged } from '@aivilization/authority';
import type { WorldProjection } from './projection';
/** Owning effects only. Every caller must independently validate its exact authority and transaction source first. Not exported by the package. */
export function applyPrincipalResourceControlEffects(
  w: WorldProjection,
  change: PrincipalControlChanged,
): WorldProjection {
  if (change.control.at !== w.clock.now) throw Error('principal-control-actual-time-required');
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
