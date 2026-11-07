import type { PublicProposal } from '@aivilization/governance';
import { publicEqual } from '@aivilization/governance';
import { residentPrincipalPremisesOperation } from './premisesPrincipals';
import type { WorldProjection } from './projection';
import type { PrincipalCollectivePort } from './principalCollectivePort';
import type { PremisesAuthorization } from './residentPremises';
export function publicPremisesOperation(input: {
  projection: WorldProjection;
  actorId: string;
  proposal: PublicProposal;
  requestId: string;
  simulationId: string;
  nextSequence: number;
  collective?: PrincipalCollectivePort;
  premisesAuthorization?: PremisesAuthorization;
}) {
  const p = input.proposal,
    no = (reason: string) => ({ accepted: false as const, reason });
  if (p.action.kind !== 'manage-resource') return no('public-premises-action-required');
  const w = input.projection;
  const d = residentPrincipalPremisesOperation({
    ...input,
    request: p.action.request,
    publicPrincipalExecution: { proposalId: p.id, proposalRevision: p.revision },
    authorization: input.premisesAuthorization ?? {
      authorize: () => undefined,
      controlAvailable: (c) => c.kind === 'resident' && !!w.agents[c.id],
      additionalObligations: () => false,
    },
  });
  if (!d.accepted) return d;
  const e = d.events[0];
  if (d.events.length !== 1 || e?.type !== 'ResidentPremisesCommitted')
    return no('public-premises-effect-needs-single-atomic-commit');
  const receipts = e.payload.events.filter((e) => e.type === 'PremisesPrincipalOperationRecorded');
  const proof =
    receipts[0]?.type === 'PremisesPrincipalOperationRecorded'
      ? receipts[0].receipt.authorization
      : undefined;
  if (
    receipts.length !== 1 ||
    !proof ||
    proof.source.kind !== 'public' ||
    proof.source.proposalId !== p.id ||
    !publicEqual(proof.request, p.action.request)
  )
    return no('public-premises-source-required');
  return { accepted: true as const, commit: e.payload };
}
