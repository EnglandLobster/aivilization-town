import { publicEqual, type PublicProposal } from '@aivilization/governance';
import type { ServicesState } from '@aivilization/services';
import { residentServicePrincipalOperation } from './servicePrincipals';
import type { WorldProjection } from './projection';
import type { PrincipalCollectivePort } from './principalCollectivePort';
export function publicServicePrincipalOperation(input: {
  readonly projection: WorldProjection;
  readonly directory?: ServicesState;
  readonly actorId: string;
  readonly proposal: PublicProposal;
  readonly requestId: string;
  readonly simulationId: string;
  readonly nextSequence: number;
  readonly collective?: PrincipalCollectivePort;
}) {
  const p = input.proposal,
    no = (reason: string) => ({ accepted: false as const, reason });
  if (
    (p.action.kind !== 'manage-resource' && p.action.kind !== 'control-resource') ||
    p.action.request.resourceKind !== 'service'
  )
    return no('public-service-principal-action-required');
  if (!input.directory) return no('service-principal-directory-port-required');
  const d = residentServicePrincipalOperation({
    ...input,
    directory: input.directory,
    request: p.action.request,
    publicExecution: { proposalId: p.id, proposalRevision: p.revision },
  });
  if (!d.accepted) return d;
  const e = d.events[0],
    v = e?.type === 'ResidentServicePrincipalsCommitted' ? e.payload.events[0] : undefined;
  const proof =
    v?.type === 'ServicePrincipalControlChanged'
      ? v.change.control.authorization
      : v?.type === 'ServicePrincipalOperationCommitted'
        ? v.authorization
        : undefined;
  if (
    d.events.length !== 1 ||
    e?.type !== 'ResidentServicePrincipalsCommitted' ||
    e.payload.events.length !== 1 ||
    !proof ||
    proof.source.kind !== 'public' ||
    proof.source.proposalId !== p.id ||
    !publicEqual(proof.request, p.action.request)
  )
    return no('public-service-principal-single-exact-commit-required');
  return { accepted: true as const, commit: e.payload };
}
