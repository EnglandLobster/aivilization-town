import type { PrincipalCollectivePort } from './principalCollectivePort';
import {
  samePrincipalRequest,
  type PrincipalAuthorization,
  type PrincipalControlRequest,
  type ResourcePrincipal,
  type PrincipalOperationRequest,
  type PrincipalRequest,
  type ControlAuthorizationPort,
} from '@aivilization/authority';
import { authorizeEnterpriseResourceControl, enterpriseController } from '@aivilization/enterprise';
import {
  authorizePublicResourceControl,
  authorizePublicResourceOperation,
  publicEqual,
} from '@aivilization/governance';
import type { WorldProjection } from './projection';

export type PublicPrincipalExecution = {
  readonly proposalId: string;
  readonly proposalRevision: number;
};
export function authorizeWorldPrincipalOperation(
  w: WorldProjection,
  actorId: string,
  p: ResourcePrincipal,
  request: PrincipalOperationRequest,
  publicExecution?: PublicPrincipalExecution,
  collective?: PrincipalCollectivePort,
  decisionId?: string,
): PrincipalAuthorization<PrincipalOperationRequest> | undefined {
  if (!Object.hasOwn(w.agents, actorId)) return undefined;
  if (p.kind === 'resident')
    return p.id === actorId
      ? { actorId, principal: p, request: structuredClone(request), source: { kind: 'personal' } }
      : undefined;
  if (p.kind === 'enterprise') {
    const e = w.enterprises[p.id];
    return e
      ? authorizeEnterpriseResourceControl({
          enterprise: e,
          actorId,
          request,
          authorize: enterprisePrincipalManagementPort(
            w,
            p.id,
            actorId,
            request,
            collective,
            decisionId,
          ),
        })
      : undefined;
  }
  if (p.kind === 'collective')
    return collectivePrincipalProof(p, actorId, request, collective, decisionId);
  if (p.kind === 'public' && publicExecution && w.publicGovernance?.authority.grant.id === p.id) {
    const d = authorizePublicResourceOperation({
      state: w.publicGovernance.authority,
      actorId,
      at: w.clock.now,
      proposalId: publicExecution.proposalId,
      expectedProposalRevision: publicExecution.proposalRevision,
      request,
    });
    return d.accepted ? d.authorization : undefined;
  }
  return undefined;
}
export function assertWorldPrincipalOperationSource(
  w: WorldProjection,
  proof: PrincipalAuthorization<PrincipalOperationRequest>,
  publicExecution?: PublicPrincipalExecution,
  collective?: PrincipalCollectivePort,
) {
  const expected = authorizeWorldPrincipalOperation(
    w,
    proof.actorId,
    proof.principal,
    proof.request,
    publicExecution,
    collective,
    principalCollectiveDecision(proof),
  );
  if (!expected || !publicEqual(expected, proof))
    throw Error('world-principal-operation-source-mismatch');
}
export function worldPrincipalAvailable(
  w: WorldProjection,
  p: ResourcePrincipal,
  collective?: PrincipalCollectivePort,
): boolean {
  switch (p.kind) {
    case 'resident':
      return Object.hasOwn(w.agents, p.id);
    case 'enterprise':
      return w.enterprises[p.id]?.status === 'active';
    case 'public':
      return (
        w.publicGovernance?.authority.grant.id === p.id &&
        !!(
          w.publicGovernance.authority.grant.resourceCustody ||
          w.publicGovernance.authority.grant.periodicObligations ||
          w.publicGovernance.authority.grant.vehicles ||
          w.publicGovernance.authority.grant.services
        )
      );
    // Collective registry is owned by the open society journal, never inferred from an ID in world.
    case 'collective':
      return collective?.available(p.id) ?? false;
  }
}
export function authorizeWorldPrincipalControl(input: {
  world: WorldProjection;
  actorId: string;
  principal: ResourcePrincipal;
  request: PrincipalControlRequest;
  publicExecution?: PublicPrincipalExecution;
  collective?: PrincipalCollectivePort;
  decisionId?: string;
}): PrincipalAuthorization | undefined {
  const { world: w, actorId, principal: p, request } = input;
  if (!Object.hasOwn(w.agents, actorId)) return undefined;
  if (p.kind === 'resident')
    return p.id === actorId
      ? { actorId, principal: p, request: structuredClone(request), source: { kind: 'personal' } }
      : undefined;
  if (p.kind === 'enterprise') {
    const e = w.enterprises[p.id];
    return e
      ? authorizeEnterpriseResourceControl({
          enterprise: e,
          actorId,
          request,
          authorize: enterprisePrincipalManagementPort(
            w,
            p.id,
            actorId,
            request,
            input.collective,
            input.decisionId,
          ),
        })
      : undefined;
  }
  if (p.kind === 'collective')
    return collectivePrincipalProof(p, actorId, request, input.collective, input.decisionId);
  if (
    p.kind !== 'public' ||
    !input.publicExecution ||
    w.publicGovernance?.authority.grant.id !== p.id
  )
    return undefined;
  const result = authorizePublicResourceControl({
    state: w.publicGovernance.authority,
    actorId,
    at: w.clock.now,
    proposalId: input.publicExecution.proposalId,
    expectedProposalRevision: input.publicExecution.proposalRevision,
    request,
  });
  return result.accepted ? result.authorization : undefined;
}
/** Validate the recorded source against the pre-event authority state, including independent public execution. */
export function assertWorldPrincipalControlSource(
  w: WorldProjection,
  proof: PrincipalAuthorization,
  request: PrincipalControlRequest,
  actorId: string,
  publicExecution?: PublicPrincipalExecution,
  collective?: PrincipalCollectivePort,
) {
  const expected = authorizeWorldPrincipalControl({
    world: w,
    actorId,
    principal: proof.principal,
    request,
    ...(publicExecution ? { publicExecution } : {}),
    ...(collective ? { collective } : {}),
    ...(principalCollectiveDecision(proof)
      ? { decisionId: principalCollectiveDecision(proof)! }
      : {}),
  });
  if (!expected || !samePrincipalRequest(proof.request, request) || !publicEqual(expected, proof))
    throw Error('world-principal-authority-source-mismatch');
}

function principalCollectiveDecision(proof: PrincipalAuthorization<PrincipalRequest>) {
  return proof.source.kind === 'collective'
    ? proof.source.decisionId
    : proof.source.kind === 'enterprise'
      ? (proof.source.managementDecisionId ?? undefined)
      : undefined;
}
function collectivePrincipalProof<R extends PrincipalRequest>(
  principal: ResourcePrincipal,
  actorId: string,
  request: R,
  port?: PrincipalCollectivePort,
  decisionId?: string,
): PrincipalAuthorization<R> | undefined {
  const grant = port?.authorize({
    collectiveId: principal.id,
    principal,
    actorId,
    request,
    ...(decisionId ? { decisionId } : {}),
  });
  return grant
    ? {
        actorId,
        principal,
        request: structuredClone(request),
        source: { kind: 'collective', ...grant },
      }
    : undefined;
}
function enterprisePrincipalManagementPort(
  w: WorldProjection,
  id: string,
  actorId: string,
  request: PrincipalRequest,
  port?: PrincipalCollectivePort,
  decisionId?: string,
): ControlAuthorizationPort {
  return (controller) => {
    const e = w.enterprises[id];
    if (!e || controller.kind !== 'collective' || enterpriseController(e).id !== controller.id)
      return undefined;
    const grant = port?.authorize({
      collectiveId: controller.id,
      principal: { kind: 'enterprise', id },
      actorId,
      request,
      ...(decisionId ? { decisionId } : {}),
    });
    return grant ? { actorId, decisionId: grant.decisionId } : undefined;
  };
}
