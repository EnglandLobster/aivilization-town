import type { ControlledResource } from './control';
import type { PrincipalControlSnapshot } from './principal';

/** Legacy offers must finish or be cancelled under their original consent protocol. */
export function resourcePrincipalSnapshot(resource: ControlledResource): PrincipalControlSnapshot {
  const control = resource.control;
  if (control?.policyVersion === 'resource-principals-v2') return control;
  if (control?.offer) throw Error('legacy-control-offer-unresolved');
  return {
    controller: control?.controller ?? { kind: 'resident', id: resource.ownerId },
    version: control?.version ?? 1,
    at: control?.at ?? 0,
  };
}
