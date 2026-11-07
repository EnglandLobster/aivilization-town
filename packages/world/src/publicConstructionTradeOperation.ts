import { publicEqual, type PublicProposal } from '@aivilization/governance';
import { residentConstructionTradeRequestOperation } from './residentConstructionTrade';
import type { WorldProjection } from './projection';
import type { PrincipalCollectivePort } from './principalCollectivePort';
export function publicConstructionTradeOperation(input: {
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
  if (p.action.kind !== 'manage-resource') return no('public-construction-trade-action-required');
  const d = residentConstructionTradeRequestOperation({
    ...input,
    request: p.action.request,
    publicPrincipalExecution: { proposalId: p.id, proposalRevision: p.revision },
  });
  if (!d.accepted) return d;
  const e = d.events[0],
    v = e?.type === 'ResidentConstructionTradeCommitted' ? e.payload.events[0] : undefined;
  if (
    d.events.length !== 1 ||
    e?.type !== 'ResidentConstructionTradeCommitted' ||
    e.payload.events.length !== 1 ||
    v?.type !== 'ConstructionTradeCommitted' ||
    v.authorization?.source.kind !== 'public' ||
    v.authorization.source.proposalId !== p.id ||
    !publicEqual(v.authorization.request, p.action.request)
  )
    return no('public-construction-trade-single-exact-commit-required');
  return { accepted: true as const, commit: e.payload };
}
