import { publicEqual, type PublicProposal } from '@aivilization/governance';
import { residentPeriodicOperation } from './periodicObligations';
import type { WorldProjection } from './projection';
import type { PrincipalCollectivePort } from './principalCollectivePort';
export function publicPeriodicOperation(input: {
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
  if (
    p.action.kind !== 'manage-resource' ||
    p.action.request.resourceKind !== 'periodic-obligation'
  )
    return no('public-periodic-action-required');
  const d = residentPeriodicOperation({
    ...input,
    request: p.action.request,
    publicPrincipalExecution: { proposalId: p.id, proposalRevision: p.revision },
  });
  if (!d.accepted) return d;
  const e = d.events[0],
    event = e?.type === 'ResidentPeriodicObligationsCommitted' ? e.payload.event : undefined,
    proof =
      event?.type === 'PeriodicObligationOffered'
        ? event.obligation.offeredAuthorization
        : event?.type === 'PeriodicObligationChanged'
          ? event.authorization
          : undefined;
  if (
    d.events.length !== 1 ||
    e?.type !== 'ResidentPeriodicObligationsCommitted' ||
    proof?.source.kind !== 'public' ||
    proof.source.proposalId !== p.id ||
    !publicEqual(proof.request, p.action.request)
  )
    return no('public-periodic-single-exact-commit-required');
  return { accepted: true as const, commit: e.payload };
}
