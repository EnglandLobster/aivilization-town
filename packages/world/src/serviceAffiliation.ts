import {
  principalOperationKey,
  type PrincipalControlRequest,
  type PrincipalOperationRequest,
} from '@aivilization/authority';
import {
  SERVICE_AFFILIATION_POLICY,
  currentServiceEnterprise,
  applyServiceAffiliationEvent,
  decideServiceAffiliation,
  decideAffiliatedServiceControl,
  type ServiceAffiliationEvent,
  type ServicesState,
} from '@aivilization/services';
import { createEventEnvelope } from '@aivilization/sim-core';
import {
  hasIndependentServiceAuthority,
  servicePrincipalWorldPorts,
  type ServicePrincipalWorldContext,
} from './servicePrincipals';
import {
  assertWorldPrincipalOperationSource,
  assertWorldPrincipalControlSource,
  type PublicPrincipalExecution,
} from './resourcePrincipalAuthority';
import type { PrincipalCollectivePort } from './principalCollectivePort';
import type { WorldProjection } from './projection';
import type { WorldEvent } from './events';
export type ResidentServiceAffiliationPayload = {
  readonly policyVersion: typeof SERVICE_AFFILIATION_POLICY.version;
  readonly actorId: string;
  readonly events: readonly ServiceAffiliationEvent[];
};
function wrap(
  input: ServicePrincipalWorldContext,
  actorId: string,
  events: readonly ServiceAffiliationEvent[],
): WorldEvent {
  return createEventEnvelope({
    id: `${input.requestId}:service-affiliation`,
    simulationId: input.simulationId,
    sequence: input.nextSequence,
    occurredAt: input.projection.clock.now,
    type: 'ResidentServiceAffiliationCommitted',
    payload: { policyVersion: SERVICE_AFFILIATION_POLICY.version, actorId, events },
  });
}
export function enableServiceAffiliationsEvent(input: ServicePrincipalWorldContext): WorldEvent {
  const e = wrap(input, 'system', [
    { type: 'ServiceAffiliationsEnabled', policy: SERVICE_AFFILIATION_POLICY },
  ]);
  applyServiceAffiliationProjection(input.projection, e, input.directory);
  return e;
}
export function residentServiceAffiliationOperation(
  input: ServicePrincipalWorldContext & {
    readonly actorId: string;
    readonly request: PrincipalOperationRequest | PrincipalControlRequest;
  },
) {
  try {
    const p = servicePrincipalWorldPorts(input),
      d =
        'operation' in input.request
          ? decideServiceAffiliation(
              input.directory,
              input.actorId,
              input.projection.clock.now,
              input.request,
              p,
            )
          : decideAffiliatedServiceControl(
              input.directory,
              input.actorId,
              input.projection.clock.now,
              input.request,
              p,
            );
    if (!d.accepted) return d;
    const e = wrap(input, input.actorId, d.events);
    applyServiceAffiliationProjection(
      input.projection,
      e,
      input.directory,
      input.publicExecution,
      input.collective,
    );
    return { accepted: true as const, events: [e] };
  } catch (error) {
    return {
      accepted: false as const,
      reason: error instanceof Error ? error.message : 'invalid-service-affiliation-operation',
    };
  }
}
export function applyServiceAffiliationProjection(
  w: WorldProjection,
  e: WorldEvent,
  directory?: ServicesState,
  execution?: PublicPrincipalExecution,
  collective?: PrincipalCollectivePort,
): WorldProjection | undefined {
  if (e.type !== 'ResidentServiceAffiliationCommitted') return undefined;
  if (!directory) throw Error('service-principal-directory-port-required');
  const p = e.payload,
    v = p.events[0];
  if (
    p.policyVersion !== SERVICE_AFFILIATION_POLICY.version ||
    p.events.length !== 1 ||
    !v ||
    e.occurredAt !== w.clock.now
  )
    throw Error('invalid-service-affiliation-world-packet');
  if (v.type === 'ServiceAffiliationsEnabled') {
    if (
      p.actorId !== 'system' ||
      (!hasIndependentServiceAuthority(directory) &&
        !w.publicGovernance?.authority.grant.serviceCreation)
    )
      throw Error('invalid-service-affiliations-world-activation');
    applyServiceAffiliationEvent(directory, v);
    return w;
  }
  if (!w.agents[p.actorId] || !directory.affiliations)
    throw Error('service-affiliation-authority-port-required');
  const ports = servicePrincipalWorldPorts({
    projection: w,
    directory,
    actorId: p.actorId,
    requestId: e.id,
    simulationId: e.simulationId,
    nextSequence: e.sequence,
    ...(execution ? { publicExecution: execution } : {}),
    ...(collective ? { collective } : {}),
  });
  const serviceId =
      v.type === 'ServiceAffiliationConsentApproved' ? v.consent.serviceId : v.serviceId,
    service = directory.services[serviceId];
  const enterpriseId = service && currentServiceEnterprise(service);
  if (!service || !enterpriseId || !ports.available({ kind: 'enterprise', id: enterpriseId }))
    throw Error('service-affiliation-enterprise-unavailable');
  if (v.type === 'ServiceAffiliatedPrincipalControlChanged') {
    if (directory.relationPolicy) throw Error('service-supply-control-envelope-required');
    const proof = v.change.control.authorization,
      r = v.change.request;
    if (proof.actorId !== p.actorId || v.change.control.at !== w.clock.now)
      throw Error('service-affiliation-signature-mismatch');
    assertWorldPrincipalControlSource(w, proof, r, p.actorId, execution, collective);
    const target =
      r.command.type === 'offer'
        ? r.command.target
        : r.command.type === 'accept'
          ? service.control?.offer?.target
          : undefined;
    if (target && !ports.available(target)) throw Error('service-principal-target-unavailable');
    if (
      v.inheritedProviders &&
      principalOperationKey(v.inheritedProviders) !==
        principalOperationKey(ports.inheritedProviders(service))
    )
      throw Error('service-provider-inheritance-source-mismatch');
    // The real recorded firm approval was independently audited when committed, not replayed or consumed again here.
  } else {
    const proof =
        v.type === 'ServiceAffiliationConsentApproved' ? v.consent.authorization : v.authorization,
      at = v.type === 'ServiceAffiliationConsentApproved' ? v.consent.approvedAt : v.at;
    if (
      proof.actorId !== p.actorId ||
      at !== w.clock.now ||
      proof.principal.kind !== 'enterprise' ||
      proof.principal.id !== enterpriseId
    )
      throw Error('service-affiliation-signature-mismatch');
    assertWorldPrincipalOperationSource(w, proof, execution, collective);
  }
  applyServiceAffiliationEvent(directory, v);
  return w;
}
export function serviceAffiliationEventsFromWorld(
  e: WorldEvent,
): readonly ServiceAffiliationEvent[] {
  return e.type === 'ResidentServiceAffiliationCommitted'
    ? e.payload.events
    : e.type === 'ResidentPublicGovernanceCommitted'
      ? (e.payload.serviceAffiliationCommit?.events ?? [])
      : [];
}
