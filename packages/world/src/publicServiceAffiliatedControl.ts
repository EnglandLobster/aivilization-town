import { publicEqual, type PublicProposal } from '@aivilization/governance';
import type { ServicesState } from '@aivilization/services';
import { residentServiceAffiliationOperation } from './serviceAffiliation';
import type { ServicePrincipalWorldContext } from './servicePrincipals';
export function publicServiceAffiliatedControl(
  input: Omit<ServicePrincipalWorldContext, 'directory'> & {
    readonly directory?: ServicesState;
    readonly actorId: string;
    readonly proposal: PublicProposal;
  },
) {
  const p = input.proposal,
    no = (reason: string) => ({ accepted: false as const, reason });
  if (p.action.kind !== 'control-resource' || p.action.request.resourceKind !== 'service')
    return no('public-affiliated-service-control-required');
  if (!input.directory) return no('service-principal-directory-port-required');
  const d = residentServiceAffiliationOperation({
    ...input,
    directory: input.directory,
    request: p.action.request,
    publicExecution: { proposalId: p.id, proposalRevision: p.revision },
  });
  if (!d.accepted) return d;
  const e = d.events[0],
    v = e?.type === 'ResidentServiceAffiliationCommitted' ? e.payload.events[0] : undefined,
    proof =
      v?.type === 'ServiceAffiliatedPrincipalControlChanged'
        ? v.change.control.authorization
        : undefined;
  if (
    d.events.length !== 1 ||
    e?.type !== 'ResidentServiceAffiliationCommitted' ||
    e.payload.events.length !== 1 ||
    !proof ||
    proof.source.kind !== 'public' ||
    proof.source.proposalId !== p.id ||
    !publicEqual(proof.request, p.action.request)
  )
    return no('public-affiliated-service-single-exact-effect-required');
  return { accepted: true as const, commit: e.payload };
}
