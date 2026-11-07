import {
  assertPrincipalAuthorization,
  principalOperationKey,
  validResourcePrincipal,
  type PrincipalAuthorization,
  type PrincipalOperationRequest,
  type ResourcePrincipal,
} from '@aivilization/authority';
import type { PremisesState, PremisesPorts, PremisesEvent } from './model';
import type { CreateConstruction } from './projects';
import type { PremisesCommand } from './management';

export const PREMISES_PRINCIPALS_POLICY = { version: 'premises-resource-principals-v2' } as const;
export type PrincipalCreateConstruction = Omit<CreateConstruction, 'controller'> & {
  readonly controller: ResourcePrincipal;
};
export type PrincipalPremisesCommand =
  | { readonly type: 'create-construction'; readonly construction: PrincipalCreateConstruction }
  | { readonly type: 'cancel-construction'; readonly id: string; readonly expectedRevision: number }
  | {
      readonly type: 'manage-premises';
      readonly id: string;
      readonly expectedRevision: number;
      readonly command: Exclude<PremisesCommand, { type: 'control' }>;
    };

/** Creation binds a site/land-use version; later operations bind the actual project or building version. */
export function premisesPrincipalRequest(
  s: PremisesState,
  c: PrincipalPremisesCommand,
): PrincipalOperationRequest {
  if (c.type === 'create-construction' && c.construction.kind === 'build') {
    const site = s.sites[c.construction.siteId];
    if (!site) throw Error('construction-site-not-found');
    return {
      resourceKind: 'construction-site',
      resourceId: site.id,
      resourceRevision: site.revision,
      controlVersion: s.landUsePolicy.revision,
      operation: { capability: `premises.${c.type}`, arguments: structuredClone(c) },
    };
  }
  if (c.type === 'cancel-construction') {
    const p = s.projects[c.id];
    if (!p?.principalAuthorization) throw Error('principal-project-not-transitioned');
    return {
      resourceKind: 'construction-project',
      resourceId: p.id,
      resourceRevision: p.revision,
      controlVersion: 1,
      operation: { capability: `premises.${c.type}`, arguments: structuredClone(c) },
    };
  }
  const id = c.type === 'create-construction' ? c.construction.buildingId : c.id,
    b = s.buildings[id];
  if (!b || b.control.policyVersion !== 'resource-principals-v2')
    throw Error('principal-premises-not-transitioned');
  return {
    resourceKind: 'premises',
    resourceId: b.id,
    resourceRevision: b.revision,
    controlVersion: b.control.version,
    operation: { capability: `premises.${c.type}`, arguments: structuredClone(c) },
  };
}
export function premisesOperationPrincipal(
  s: PremisesState,
  c: PrincipalPremisesCommand,
): ResourcePrincipal {
  if (c.type === 'create-construction') return c.construction.controller;
  const p =
    c.type === 'cancel-construction'
      ? s.projects[c.id]?.controller
      : s.buildings[c.id]?.control.controller;
  if (!p) throw Error('principal-premises-resource-not-found');
  return p;
}
export function authorizePremisesPrincipal(
  s: PremisesState,
  actorId: string,
  c: PrincipalPremisesCommand,
  ports: PremisesPorts,
) {
  if (!s.resourcePrincipals) return undefined;
  try {
    const request = premisesPrincipalRequest(s, c),
      principal = premisesOperationPrincipal(s, c);
    if (!validResourcePrincipal(principal) || !ports.principalAvailable?.(principal))
      return undefined;
    const b = request.resourceKind === 'premises' && s.buildings[request.resourceId];
    if (b && b.control.offer) return undefined;
    const proof = ports.authorizePrincipal?.(principal, request);
    if (!proof) return undefined;
    assertPrincipalAuthorization(proof, principal, request, actorId);
    return proof;
  } catch {
    return undefined;
  }
}
export function principalPremisesReceipt(
  id: string,
  at: number,
  authorization: PrincipalAuthorization<PrincipalOperationRequest>,
): PremisesEvent {
  return {
    type: 'PremisesPrincipalOperationRecorded',
    receipt: { id, at, authorization: structuredClone(authorization) },
  };
}
/** This is the source of a newly constructed asset, never a fabricated bilateral transfer. */
export function constructedPrincipalControl(
  p: PrincipalAuthorization<PrincipalOperationRequest>,
  at: number,
) {
  assertPrincipalAuthorization(p, p.principal, p.request, p.actorId);
  if (
    p.request.operation.capability !== 'premises.create-construction' ||
    p.request.operation.arguments.type !== 'create-construction'
  )
    throw Error('principal-construction-source-required');
  return {
    policyVersion: 'resource-principals-v2' as const,
    controller: structuredClone(p.principal),
    version: 1,
    at,
    authorization: structuredClone(p),
  };
}
export function samePremisesProof(
  a: PrincipalAuthorization<PrincipalOperationRequest> | undefined,
  b: PrincipalAuthorization<PrincipalOperationRequest> | undefined,
) {
  return !!a && !!b && principalOperationKey(a) === principalOperationKey(b);
}
