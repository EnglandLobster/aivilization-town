import type { PrincipalCollectivePort } from './principalCollectivePort';
import type { PublicProposal } from '@aivilization/governance';
import { publicEqual } from '@aivilization/governance';
import { decodePrincipalMaterialOperation } from './materialCommandCodec';
import { residentMaterialEvent } from './residentMaterials';
import { mayStoreWorldPremises } from './premisesAccess';
import type { WorldProjection } from './projection';
import type { WorldCommandPolicies } from './agentActions';

export function publicMaterialOperation(input: {
  projection: WorldProjection;
  collective?: PrincipalCollectivePort;
  actorId: string;
  proposal: PublicProposal;
  requestId: string;
  simulationId: string;
  nextSequence: number;
  policies?: WorldCommandPolicies;
}) {
  const p = input.proposal,
    w = input.projection;
  const no = (reason: string) => ({ accepted: false as const, reason });
  if (p.action.kind !== 'manage-resource' || p.action.request.resourceKind !== 'stock')
    return no('public-resource-operation-not-connected');
  const r = p.action.request;
  try {
    const command = decodePrincipalMaterialOperation(r);
    const d = residentMaterialEvent({
      ...input,
      command,
      publicPrincipalExecution: { proposalId: p.id, proposalRevision: p.revision },
      authorization: {
        authorize: () => undefined,
        controlAvailable: (c) => c.kind === 'resident' && !!w.agents[c.id],
        mayStoreAt: (actor, location) => mayStoreWorldPremises(w, actor, location),
        hasExternalObligation: (id) =>
          Object.values(w.premises?.projects ?? {}).some(
            (p) => p.status === 'open' && p.reservations.some((r) => r.sourceStockId === id),
          ),
      },
    });
    if (!d.accepted) return d;
    const e = d.events[0];
    if (d.events.length !== 1 || e?.type !== 'ResidentMaterialsCommitted')
      return no('missing-public-material-effect');
    const receipts = e.payload.events.filter((e) => e.type === 'MaterialReceiptRecorded');
    if (receipts.length !== 1 || receipts[0]?.type !== 'MaterialReceiptRecorded')
      return no('invalid-public-material-receipt');
    const proof = receipts[0].receipt.principalAuthorization;
    if (
      !proof ||
      proof.source.kind !== 'public' ||
      proof.source.proposalId !== p.id ||
      !publicEqual(proof.request, r)
    )
      return no('public-material-source-required');
    return { accepted: true as const, commit: e.payload };
  } catch (error) {
    return no(error instanceof Error ? error.message : 'invalid-public-material-operation');
  }
}
