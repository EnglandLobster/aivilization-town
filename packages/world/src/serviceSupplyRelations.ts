import {
  principalOperationKey,
  type PrincipalControlRequest,
  type PrincipalOperationRequest,
} from '@aivilization/authority';
import {
  SERVICE_SUPPLY_RELATION_POLICY,
  applyServiceSupplyRelationEvent,
  decideServiceSupplyRelation,
  decideServiceSupplyControl,
  decodeServiceSupplyRelationOperation,
  currentServiceEnterprise,
  type ServiceSupplyRelationEvent,
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
export type ResidentServiceSupplyRelationsPayload = {
  readonly policyVersion: typeof SERVICE_SUPPLY_RELATION_POLICY.version;
  readonly actorId: string;
  readonly events: readonly ServiceSupplyRelationEvent[];
};
function wrap(
  input: ServicePrincipalWorldContext,
  actorId: string,
  events: readonly ServiceSupplyRelationEvent[],
): WorldEvent {
  return createEventEnvelope({
    id: `${input.requestId}:service-supply-relations`,
    simulationId: input.simulationId,
    sequence: input.nextSequence,
    occurredAt: input.projection.clock.now,
    type: 'ResidentServiceSupplyRelationsCommitted',
    payload: { policyVersion: SERVICE_SUPPLY_RELATION_POLICY.version, actorId, events },
  });
}
export function enableServiceSupplyRelationsEvent(input: ServicePrincipalWorldContext): WorldEvent {
  const e = wrap(input, 'system', [
    { type: 'ServiceSupplyRelationsEnabled', policy: SERVICE_SUPPLY_RELATION_POLICY },
  ]);
  applyServiceSupplyRelationsProjection(input.projection, e, input.directory);
  return e;
}
export function residentServiceSupplyRelationOperation(
  input: ServicePrincipalWorldContext & {
    readonly actorId: string;
    readonly request: PrincipalControlRequest | PrincipalOperationRequest;
  },
) {
  try {
    const p = servicePrincipalWorldPorts(input),
      d =
        'operation' in input.request
          ? decideServiceSupplyRelation(
              input.directory,
              input.actorId,
              input.projection.clock.now,
              input.request,
              p,
            )
          : decideServiceSupplyControl(
              input.directory,
              input.actorId,
              input.projection.clock.now,
              input.request,
              p,
            );
    if (!d.accepted) return d;
    const e = wrap(input, input.actorId, d.events);
    applyServiceSupplyRelationsProjection(
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
      reason: error instanceof Error ? error.message : 'invalid-service-supply-relation-operation',
    };
  }
}
export function applyServiceSupplyRelationsProjection(
  w: WorldProjection,
  e: WorldEvent,
  directory?: ServicesState,
  execution?: PublicPrincipalExecution,
  collective?: PrincipalCollectivePort,
): WorldProjection | undefined {
  if (e.type !== 'ResidentServiceSupplyRelationsCommitted') return undefined;
  if (!directory) throw Error('service-principal-directory-port-required');
  const p = e.payload,
    v = p.events[0];
  if (
    p.policyVersion !== SERVICE_SUPPLY_RELATION_POLICY.version ||
    p.events.length !== 1 ||
    !v ||
    e.occurredAt !== w.clock.now
  )
    throw Error('invalid-service-supply-relations-world-packet');
  if (v.type === 'ServiceSupplyRelationsEnabled') {
    if (
      p.actorId !== 'system' ||
      (!hasIndependentServiceAuthority(directory) &&
        !w.publicGovernance?.authority.grant.serviceCreation)
    )
      throw Error('invalid-service-supply-relations-world-activation');
    applyServiceSupplyRelationEvent(directory, v);
    return w;
  }
  if (!w.agents[p.actorId] || !directory.relationPolicy)
    throw Error('service-supply-relation-authority-port-required');
  const ports = servicePrincipalWorldPorts({
      projection: w,
      directory,
      actorId: p.actorId,
      requestId: e.id,
      simulationId: e.simulationId,
      nextSequence: e.sequence,
      ...(execution ? { publicExecution: execution } : {}),
      ...(collective ? { collective } : {}),
    }),
    service = directory.services[v.serviceId];
  if (!service) throw Error('service-principal-resource-not-found');
  if (v.type === 'ServiceSupplyRelationChanged') {
    const proof = v.authorization,
      c = decodeServiceSupplyRelationOperation(proof.request);
    if (proof.actorId !== p.actorId || v.at !== w.clock.now)
      throw Error('service-supply-relation-signature-mismatch');
    assertWorldPrincipalOperationSource(w, proof, execution, collective);
    const target =
      c.type === 'services.offer-supply'
        ? { kind: 'enterprise' as const, id: c.enterpriseId }
        : c.type === 'services.accept-supply'
          ? proof.principal
          : undefined;
    if (target && !ports.available(target)) throw Error('service-supply-enterprise-unavailable');
  } else {
    const proof = v.change.control.authorization,
      r = v.change.request,
      id = currentServiceEnterprise(service);
    if (proof.actorId !== p.actorId || v.change.control.at !== w.clock.now)
      throw Error('service-supply-relation-signature-mismatch');
    assertWorldPrincipalControlSource(w, proof, r, p.actorId, execution, collective);
    if (id && !ports.available({ kind: 'enterprise', id }))
      throw Error('service-supply-enterprise-unavailable');
    if (v.affiliationAuthorization)
      assertWorldPrincipalControlSource(
        w,
        v.affiliationAuthorization,
        r,
        p.actorId,
        execution,
        collective,
      );
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
  }
  applyServiceSupplyRelationEvent(directory, v);
  return w;
}
export function serviceSupplyRelationEventsFromWorld(
  e: WorldEvent,
): readonly ServiceSupplyRelationEvent[] {
  return e.type === 'ResidentServiceSupplyRelationsCommitted'
    ? e.payload.events
    : e.type === 'ResidentPublicGovernanceCommitted'
      ? (e.payload.serviceSupplyRelationsCommit?.events ?? [])
      : [];
}
