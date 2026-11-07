import { publicEqual, type PublicProposal } from '@aivilization/governance';
import { residentVehiclePrincipalOperation } from './vehiclePrincipals';
import type { WorldProjection } from './projection';
import type { PrincipalCollectivePort } from './principalCollectivePort';
export function publicVehiclePrincipalOperation(input: {
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
  if (p.action.kind !== 'manage-resource') return no('public-vehicle-principal-action-required');
  const d = residentVehiclePrincipalOperation({
    ...input,
    request: p.action.request,
    publicExecution: { proposalId: p.id, proposalRevision: p.revision },
  });
  if (!d.accepted) return d;
  const e = d.events[0],
    v = e?.type === 'ResidentVehiclePrincipalsCommitted' ? e.payload.events[0] : undefined;
  if (
    d.events.length !== 1 ||
    e?.type !== 'ResidentVehiclePrincipalsCommitted' ||
    e.payload.events.length !== 1 ||
    v?.type !== 'VehiclePrincipalDriversChanged' ||
    v.authorization?.source.kind !== 'public' ||
    v.authorization.source.proposalId !== p.id ||
    !publicEqual(v.authorization.request, p.action.request)
  )
    return no('public-vehicle-principal-single-exact-commit-required');
  return { accepted: true as const, commit: e.payload };
}
