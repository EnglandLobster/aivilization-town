import { publicEqual, type PublicProposal } from '@aivilization/governance';
import { residentResourceSaleOperation } from './resourceSales';
import type { WorldProjection } from './projection';
import type { PrincipalCollectivePort } from './principalCollectivePort';
export function publicResourceSaleOperation(input: {
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
  if (p.action.kind !== 'manage-resource' || p.action.request.resourceKind !== 'resource-sale')
    return no('public-resource-sale-action-required');
  const d = residentResourceSaleOperation({
    ...input,
    request: p.action.request,
    publicPrincipalExecution: { proposalId: p.id, proposalRevision: p.revision },
  });
  if (!d.accepted) return d;
  const e = d.events[0],
    v = e?.type === 'ResidentResourceSalesCommitted' ? e.payload.event : undefined;
  if (
    d.events.length !== 1 ||
    e?.type !== 'ResidentResourceSalesCommitted' ||
    v?.type !== 'ResourceSaleCommitted' ||
    v.authorization?.source.kind !== 'public' ||
    v.authorization.source.proposalId !== p.id ||
    !publicEqual(v.authorization.request, p.action.request)
  )
    return no('public-resource-sale-single-exact-commit-required');
  return { accepted: true as const, commit: e.payload };
}
