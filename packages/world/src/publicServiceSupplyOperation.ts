import { publicEqual, type PublicProposal } from '@aivilization/governance';
import { residentServiceSupplyOperation } from './serviceSupply';
import type { ServicePrincipalWorldContext } from './servicePrincipals';
export function publicServiceSupplyOperation(
  input: Omit<ServicePrincipalWorldContext, 'directory'> & {
    directory?: ServicePrincipalWorldContext['directory'];
    actorId: string;
    proposal: PublicProposal;
  },
) {
  const p = input.proposal,
    no = (reason: string) => ({ accepted: false as const, reason });
  if (
    p.action.kind !== 'manage-resource' ||
    !['services.create', 'services.reopen'].includes(p.action.request.operation.capability)
  )
    return no('public-service-supply-action-required');
  if (!input.directory) return no('service-principal-directory-port-required');
  const d = residentServiceSupplyOperation({
    ...input,
    directory: input.directory,
    request: p.action.request,
    publicExecution: { proposalId: p.id, proposalRevision: p.revision },
  });
  if (!d.accepted) return d;
  const e = d.events[0],
    v = e?.type === 'ResidentServiceSupplyCommitted' ? e.payload.events[0] : undefined;
  const proof = v && v.type !== 'ServiceSupplyEnabled' ? v.authorization : undefined;
  if (
    d.events.length !== 1 ||
    e?.type !== 'ResidentServiceSupplyCommitted' ||
    e.payload.events.length !== 1 ||
    !proof ||
    proof.source.kind !== 'public' ||
    proof.source.proposalId !== p.id ||
    !publicEqual(proof.request, p.action.request)
  )
    return no('public-service-supply-single-exact-commit-required');
  return { accepted: true as const, commit: e.payload };
}
