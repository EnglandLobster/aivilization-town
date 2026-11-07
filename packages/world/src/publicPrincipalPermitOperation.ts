import { publicEqual, type PublicProposal } from '@aivilization/governance';
import { residentPrincipalPermitOperation } from './principalPremisesRights';
import type { WorldProjection } from './projection';
import type { PrincipalCollectivePort } from './principalCollectivePort';
export function publicPrincipalPermitOperation(input: {
  projection: WorldProjection;
  actorId: string;
  proposal: PublicProposal;
  requestId: string;
  simulationId: string;
  nextSequence: number;
  collective?: PrincipalCollectivePort;
}) {
  const p = input.proposal,
    no = (reason: string) => ({ accepted: false as const, reason });
  if (p.action.kind !== 'manage-resource') return no('public-permit-action-required');
  const d = residentPrincipalPermitOperation({
    ...input,
    request: p.action.request,
    publicPrincipalExecution: { proposalId: p.id, proposalRevision: p.revision },
  });
  if (!d.accepted) return d;
  const e = d.events[0];
  if (d.events.length !== 1 || e?.type !== 'ResidentPrincipalPremisesRightsCommitted')
    return no('public-permits-single-atomic-commit-required');
  const first = e.payload.events[0];
  if (
    e.payload.events.length !== 1 ||
    !first ||
    first.type === 'PrincipalPremisesRightsEnabled' ||
    first.authorization.source.kind !== 'public' ||
    first.authorization.source.proposalId !== p.id ||
    !publicEqual(first.authorization.request, p.action.request)
  )
    return no('public-permits-source-required');
  return { accepted: true as const, commit: e.payload };
}
