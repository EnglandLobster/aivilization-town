import { publicEqual, type PublicProposal } from '@aivilization/governance';
import type { ServicesState } from '@aivilization/services';
import type { ServicePrincipalWorldContext } from './servicePrincipals';
import { residentServiceSupplyRelationOperation } from './serviceSupplyRelations';
export function publicServiceSupplyRelations(
  input: Omit<ServicePrincipalWorldContext, 'directory'> & {
    readonly directory?: ServicesState;
    readonly actorId: string;
    readonly proposal: PublicProposal;
  },
) {
  const p = input.proposal,
    no = (reason: string) => ({ accepted: false as const, reason });
  if (
    (p.action.kind !== 'manage-resource' && p.action.kind !== 'control-resource') ||
    p.action.request.resourceKind !== 'service'
  )
    return no('public-service-supply-relation-action-required');
  if (!input.directory) return no('service-principal-directory-port-required');
  const d = residentServiceSupplyRelationOperation({
    ...input,
    directory: input.directory,
    request: p.action.request,
    publicExecution: { proposalId: p.id, proposalRevision: p.revision },
  });
  if (!d.accepted) return d;
  const e = d.events[0],
    v = e?.type === 'ResidentServiceSupplyRelationsCommitted' ? e.payload.events[0] : undefined,
    proof =
      v?.type === 'ServiceSupplyPrincipalControlChanged'
        ? v.change.control.authorization
        : v?.type === 'ServiceSupplyRelationChanged'
          ? v.authorization
          : undefined;
  if (
    d.events.length !== 1 ||
    e?.type !== 'ResidentServiceSupplyRelationsCommitted' ||
    e.payload.events.length !== 1 ||
    !proof ||
    proof.source.kind !== 'public' ||
    proof.source.proposalId !== p.id ||
    !publicEqual(proof.request, p.action.request)
  )
    return no('public-service-supply-relations-single-exact-commit-required');
  return { accepted: true as const, commit: e.payload };
}
