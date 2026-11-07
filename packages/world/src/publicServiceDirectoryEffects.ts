import { publicEqual } from '@aivilization/governance';
import type { ServicesState } from '@aivilization/services';
import type { PrincipalAuthorization, PrincipalRequest } from '@aivilization/authority';
import type { WorldEvent } from './events';
import type { WorldProjection } from './projection';
import type { PrincipalCollectivePort } from './principalCollectivePort';
import { applyServicePrincipalsProjection } from './servicePrincipals';
import { applyServiceSupplyProjection } from './serviceSupply';
import { applyServiceAffiliationProjection } from './serviceAffiliation';
import { applyServiceSupplyRelationsProjection } from './serviceSupplyRelations';
/** One public source, one owning services packet. The composition applies its facts exactly once. */
export function applyPublicServiceDirectoryEffects(
  w: WorldProjection,
  e: Extract<WorldEvent, { type: 'ResidentPublicGovernanceCommitted' }>,
  directory?: ServicesState,
  collective?: PrincipalCollectivePort,
): WorldProjection | undefined {
  const p = e.payload,
    packets = [
      p.serviceDirectoryCommit,
      p.serviceSupplyCommit,
      p.serviceAffiliationCommit,
      p.serviceSupplyRelationsCommit,
    ].filter(Boolean);
  if (!packets.length) return undefined;
  if (packets.length !== 1) throw Error('public-service-directory-extra-effects');
  const first = p.events[0];
  if (first?.type !== 'PublicDecisionExecuted') throw Error('unapproved-public-effects');
  const proposal = w.publicGovernance?.authority.proposals[first.proposalId];
  let proof: PrincipalAuthorization<PrincipalRequest> | undefined,
    actor: string | undefined,
    kind = 'service-directory';
  if (p.serviceDirectoryCommit) {
    const c = p.serviceDirectoryCommit,
      v = c.events[0];
    actor = c.actorId;
    proof =
      v?.type === 'ServicePrincipalControlChanged'
        ? v.change.control.authorization
        : v?.type === 'ServicePrincipalOperationCommitted'
          ? v.authorization
          : undefined;
  } else if (p.serviceSupplyCommit) {
    const c = p.serviceSupplyCommit,
      v = c.events[0];
    actor = c.actorId;
    kind = 'service-supply';
    proof = v && v.type !== 'ServiceSupplyEnabled' ? v.authorization : undefined;
  } else if (p.serviceAffiliationCommit) {
    const c = p.serviceAffiliationCommit,
      v = c.events[0];
    actor = c.actorId;
    kind = 'service-affiliation';
    proof =
      v?.type === 'ServiceAffiliatedPrincipalControlChanged'
        ? v.change.control.authorization
        : undefined;
  } else if (p.serviceSupplyRelationsCommit) {
    const c = p.serviceSupplyRelationsCommit,
      v = c.events[0];
    actor = c.actorId;
    kind = 'service-supply-relations';
    proof =
      v?.type === 'ServiceSupplyPrincipalControlChanged'
        ? v.change.control.authorization
        : v?.type === 'ServiceSupplyRelationChanged'
          ? v.authorization
          : undefined;
  }
  if (
    !proposal ||
    !('request' in proposal.action) ||
    packets[0]?.events.length !== 1 ||
    actor !== first.actorId ||
    !proof ||
    proof.source.kind !== 'public' ||
    proof.source.proposalId !== proposal.id ||
    !publicEqual(proof.request, proposal.action.request)
  )
    throw Error(`public-${kind}-proof-mismatch`);
  const execution = { proposalId: proposal.id, proposalRevision: proposal.revision };
  const applied = p.serviceDirectoryCommit
    ? applyServicePrincipalsProjection(
        w,
        { ...e, type: 'ResidentServicePrincipalsCommitted', payload: p.serviceDirectoryCommit },
        directory,
        execution,
        collective,
      )
    : p.serviceSupplyCommit
      ? applyServiceSupplyProjection(
          w,
          { ...e, type: 'ResidentServiceSupplyCommitted', payload: p.serviceSupplyCommit },
          directory,
          execution,
          collective,
        )
      : p.serviceAffiliationCommit
        ? applyServiceAffiliationProjection(
            w,
            {
              ...e,
              type: 'ResidentServiceAffiliationCommitted',
              payload: p.serviceAffiliationCommit,
            },
            directory,
            execution,
            collective,
          )
        : p.serviceSupplyRelationsCommit
          ? applyServiceSupplyRelationsProjection(
              w,
              {
                ...e,
                type: 'ResidentServiceSupplyRelationsCommitted',
                payload: p.serviceSupplyRelationsCommit,
              },
              directory,
              execution,
              collective,
            )
          : undefined;
  if (!applied) throw Error(`missing-public-${kind}-effects`);
  return applied;
}
