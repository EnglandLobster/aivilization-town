import {
  assertPrincipalAuthorization,
  resourceAdministration,
  revisedResourceControl,
  type ControlAuthorization,
  type PrincipalAuthorization,
  type PrincipalOperationRequest,
} from '@aivilization/authority';
import type { PrincipalMaterialReservationCommand } from './reservationModel';
import type { MaterialCommand, MaterialPorts, MaterialStock } from './model';

export type MaterialAdministration = ControlAuthorization & {
  readonly principalAuthorization?: PrincipalAuthorization<PrincipalOperationRequest>;
};
/** Ownership version and resource revision are separate. The exact domain command includes all effects' inputs. */
export function materialOperationRequest(
  stock: MaterialStock,
  command: MaterialCommand | PrincipalMaterialReservationCommand,
): PrincipalOperationRequest {
  return {
    resourceKind: 'stock',
    resourceId: stock.id,
    resourceRevision: stock.revision,
    controlVersion: stock.control.version,
    operation: { capability: `materials.${command.type}`, arguments: structuredClone(command) },
  };
}
export function materialAdministration(
  stock: MaterialStock,
  actorId: string,
  command: MaterialCommand | PrincipalMaterialReservationCommand,
  ports: MaterialPorts,
): MaterialAdministration | undefined {
  if (stock.control.policyVersion !== 'resource-principals-v2')
    return resourceAdministration(stock, actorId, ports.authorize);
  // A pending transfer must explicitly resolve before a new discretionary administrative operation.
  if (stock.control.offer) return undefined;
  const request = materialOperationRequest(stock, command);
  const proof = ports.authorizePrincipal?.(stock.control.controller, request);
  if (!proof) return undefined;
  try {
    assertPrincipalAuthorization(proof, stock.control.controller, request, actorId);
  } catch {
    return undefined;
  }
  return {
    actorId,
    ...(proof.source.kind === 'collective' ? { decisionId: proof.source.decisionId } : {}),
    principalAuthorization: structuredClone(proof),
  };
}
/** v2 control records custody transitions; operating/configuring a stock advances its resource revision. */
export function revisedMaterialControl(
  stock: MaterialStock,
  grant: MaterialAdministration,
  at: number,
) {
  if (stock.control.policyVersion === 'resource-principals-v2') {
    if (!grant.principalAuthorization || stock.control.offer)
      throw Error('material-principal-proof-required');
    return stock.control;
  }
  return revisedResourceControl(stock, grant, at)!;
}
