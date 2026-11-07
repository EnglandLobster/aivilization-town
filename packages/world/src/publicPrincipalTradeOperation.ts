import { publicEqual, type PublicProposal } from '@aivilization/governance';
import { residentPrincipalTradeOperation } from './principalEvidenceTrade';
import type { WorldProjection } from './projection';
import type { PrincipalCollectivePort } from './principalCollectivePort';
export function publicPrincipalTradeOperation(input: {
  readonly projection: WorldProjection;
  readonly actorId: string;
  readonly proposal: PublicProposal;
  readonly requestId: string;
  readonly simulationId: string;
  readonly nextSequence: number;
  readonly collective?: PrincipalCollectivePort;
}) {
  const p = input.proposal,
    no = (reason: string) => ({ accepted: false as const, reason });
  if (p.action.kind !== 'manage-resource') return no('public-principal-trade-action-required');
  const d = residentPrincipalTradeOperation({
    ...input,
    request: p.action.request,
    publicPrincipalExecution: { proposalId: p.id, proposalRevision: p.revision },
  });
  if (!d.accepted) return d;
  const e = d.events[0],
    v = e?.type === 'ResidentPrincipalEvidenceTradeCommitted' ? e.payload.events[0] : undefined;
  if (
    d.events.length !== 1 ||
    e?.type !== 'ResidentPrincipalEvidenceTradeCommitted' ||
    e.payload.events.length !== 1 ||
    v?.type !== 'PrincipalTradeCommitted' ||
    v.receipt.authorization?.source.kind !== 'public' ||
    v.receipt.authorization.source.proposalId !== p.id ||
    !publicEqual(v.receipt.authorization.request, p.action.request)
  )
    return no('public-principal-trade-single-exact-commit-required');
  return { accepted: true as const, commit: e.payload };
}
