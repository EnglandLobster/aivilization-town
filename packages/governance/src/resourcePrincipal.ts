import {
  assertPrincipalAuthorization,
  type PrincipalAuthorization,
  type PrincipalControlRequest,
  type PrincipalOperationRequest,
  type PrincipalRequest,
} from '@aivilization/authority';
import {
  PUBLIC_RESOURCE_CUSTODY_GRANT,
  PUBLIC_CONSTRUCTION_PRINCIPALS_GRANT,
  type PublicGovernanceState,
} from './model';
import { preparePublicExecution } from './decisions';
import { assertPublicGrant, publicEqual } from './validation';
/** Trusted scope extension only. It neither transfers an asset nor grants a resident an executor role. */
export function enablePublicResourceCustodyAuthority(
  s: PublicGovernanceState,
): PublicGovernanceState {
  if (s.grant.resourceCustody) throw Error('public-resource-custody-already-enabled');
  const grant = {
    ...s.grant,
    actions: [
      ...new Set([...s.grant.actions, 'control-resource' as const, 'manage-resource' as const]),
    ],
    resourceCustody: PUBLIC_RESOURCE_CUSTODY_GRANT,
  };
  assertPublicGrant(grant);
  return { ...s, grant };
}
type PublicResourceInput<R extends PrincipalRequest> = {
  state: PublicGovernanceState;
  actorId: string;
  at: number;
  proposalId: string;
  expectedProposalRevision: number;
  request: R;
};
function authorizePublicResource<R extends PrincipalRequest>(
  input: PublicResourceInput<R>,
):
  | { accepted: true; authorization: PrincipalAuthorization<R> }
  | { accepted: false; reason: string } {
  const s = input.state;
  if (!s.grant.resourceCustody)
    return { accepted: false, reason: 'public-resource-custody-not-enabled' };
  const ready = preparePublicExecution(
    s,
    input.actorId,
    input.at,
    input.proposalId,
    input.expectedProposalRevision,
  );
  if (!ready.accepted) return ready;
  if (
    !('request' in ready.action) ||
    ready.action.kind !== ('operation' in input.request ? 'manage-resource' : 'control-resource') ||
    ready.action.expectedRevision !== input.request.resourceRevision ||
    !publicEqual(ready.action.request, input.request)
  )
    return { accepted: false, reason: 'public-resource-operation-mismatch' };
  const authorization: PrincipalAuthorization<R> = {
    actorId: input.actorId,
    principal: { kind: 'public', id: s.grant.id },
    request: structuredClone(input.request),
    source: {
      kind: 'public',
      proposalId: ready.proposal.id,
      procedureRevision: ready.proposal.procedureRevision,
    },
  };
  assertPrincipalAuthorization(
    authorization,
    { kind: 'public', id: s.grant.id },
    input.request,
    input.actorId,
  );
  return { accepted: true, authorization };
}

export const authorizePublicResourceControl = (
  input: PublicResourceInput<PrincipalControlRequest>,
) => authorizePublicResource(input);
export const authorizePublicResourceOperation = (
  input: PublicResourceInput<PrincipalOperationRequest>,
) => authorizePublicResource(input);

export function enablePublicConstructionPrincipalsAuthority(
  s: PublicGovernanceState,
): PublicGovernanceState {
  if (!s.grant.resourceCustody || s.grant.construction)
    throw Error('invalid-public-construction-activation');
  const grant = { ...s.grant, construction: PUBLIC_CONSTRUCTION_PRINCIPALS_GRANT };
  assertPublicGrant(grant);
  return { ...s, grant };
}
