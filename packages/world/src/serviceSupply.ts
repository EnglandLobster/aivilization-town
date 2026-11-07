import { type PrincipalOperationRequest } from '@aivilization/authority';
import {
  SERVICE_SUPPLY_POLICY,
  applyServiceSupplyEvent,
  decidePrincipalServiceCreation,
  decidePrincipalServiceReopening,
  type ServicesState,
  type ServiceSupplyEvent,
} from '@aivilization/services';
import { enablePublicServiceCreationAuthority } from '@aivilization/governance';
import { createEventEnvelope } from '@aivilization/sim-core';
import {
  hasIndependentServiceAuthority,
  servicePrincipalWorldPorts,
  type ServicePrincipalWorldContext,
} from './servicePrincipals';
import {
  assertWorldPrincipalOperationSource,
  type PublicPrincipalExecution,
} from './resourcePrincipalAuthority';
import { mayOperateWorldPremises } from './premisesAccess';
import type { WorldEvent } from './events';
import type { WorldProjection } from './projection';
import type { PrincipalCollectivePort } from './principalCollectivePort';
export type ResidentServiceSupplyPayload = {
  readonly policyVersion: typeof SERVICE_SUPPLY_POLICY.version;
  readonly actorId: string;
  readonly events: readonly ServiceSupplyEvent[];
};
export function serviceSupplyEventsFromWorld(e: WorldEvent): readonly ServiceSupplyEvent[] {
  return e.type === 'ResidentServiceSupplyCommitted'
    ? e.payload.events
    : e.type === 'ResidentPublicGovernanceCommitted'
      ? (e.payload.serviceSupplyCommit?.events ?? [])
      : [];
}
function wrap(
  input: ServicePrincipalWorldContext,
  actorId: string,
  events: readonly ServiceSupplyEvent[],
): WorldEvent {
  return createEventEnvelope({
    id: `${input.requestId}:service-supply`,
    simulationId: input.simulationId,
    sequence: input.nextSequence,
    occurredAt: input.projection.clock.now,
    type: 'ResidentServiceSupplyCommitted',
    payload: { policyVersion: SERVICE_SUPPLY_POLICY.version, actorId, events },
  });
}
export function enableServiceSupplyEvent(input: ServicePrincipalWorldContext): WorldEvent {
  const event = wrap(input, 'system', [
    { type: 'ServiceSupplyEnabled', policy: SERVICE_SUPPLY_POLICY },
  ]);
  applyServiceSupplyProjection(input.projection, event, input.directory);
  return event;
}
export function residentServiceSupplyOperation(
  input: ServicePrincipalWorldContext & {
    readonly actorId: string;
    readonly request: PrincipalOperationRequest;
  },
) {
  try {
    const ports = servicePrincipalWorldPorts(input),
      s = input.directory,
      now = input.projection.clock.now;
    const d =
      input.request.operation.capability === 'services.create'
        ? decidePrincipalServiceCreation(s, input.actorId, now, input.request, ports)
        : input.request.operation.capability === 'services.reopen'
          ? decidePrincipalServiceReopening(s, input.actorId, now, input.request, ports)
          : { accepted: false as const, reason: 'unsupported-service-supply-operation' };
    if (!d.accepted) return d;
    const event = wrap(input, input.actorId, d.events);
    applyServiceSupplyProjection(
      input.projection,
      event,
      s,
      input.publicExecution,
      input.collective,
    );
    return { accepted: true as const, events: [event] };
  } catch (error) {
    return {
      accepted: false as const,
      reason: error instanceof Error ? error.message : 'invalid-service-supply-operation',
    };
  }
}
/** Validate actual source facts; the owning directory applier reconstructs the resulting record once. */
export function applyServiceSupplyProjection(
  w: WorldProjection,
  e: WorldEvent,
  directory?: ServicesState,
  execution?: PublicPrincipalExecution,
  collective?: PrincipalCollectivePort,
): WorldProjection | undefined {
  if (e.type !== 'ResidentServiceSupplyCommitted') return undefined;
  if (!directory) throw Error('service-principal-directory-port-required');
  const p = e.payload,
    v = p.events[0];
  if (
    p.policyVersion !== SERVICE_SUPPLY_POLICY.version ||
    p.events.length !== 1 ||
    !v ||
    e.occurredAt !== w.clock.now
  )
    throw Error('invalid-service-supply-world-packet');
  if (v.type === 'ServiceSupplyEnabled') {
    if (
      p.actorId !== 'system' ||
      (!hasIndependentServiceAuthority(directory) && !w.publicGovernance?.authority.grant.services)
    )
      throw Error('invalid-service-supply-world-activation');
    applyServiceSupplyEvent(directory, v);
    if (hasIndependentServiceAuthority(directory)) return w;
    if (!w.publicGovernance) throw Error('public-governance-required');
    return {
      ...w,
      publicGovernance: {
        ...w.publicGovernance,
        authority: enablePublicServiceCreationAuthority(w.publicGovernance.authority),
      },
    };
  }
  if (
    !w.agents[p.actorId] ||
    (!hasIndependentServiceAuthority(directory) &&
      !w.publicGovernance?.authority.grant.serviceCreation) ||
    v.authorization.actorId !== p.actorId ||
    v.at !== w.clock.now
  )
    throw Error('service-supply-signature-or-authority-mismatch');
  assertWorldPrincipalOperationSource(w, v.authorization, execution, collective);
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
  if (!ports.available(v.authorization.principal))
    throw Error('service-supply-principal-unavailable');
  if (!mayOperateWorldPremises(w, p.actorId, v.service.locationId))
    throw Error('premises-operation-not-authorized');
  if (ports.service.locationCapacity(v.capacityProof.locationId) !== v.capacityProof.capacity)
    throw Error('service-capacity-world-source-mismatch');
  if (
    v.type === 'PrincipalServiceCreated' &&
    v.service.destinationId !== undefined &&
    ports.service.locationCapacity(v.service.destinationId) !== v.capacityProof.destinationCapacity
  )
    throw Error('service-destination-world-source-mismatch');
  applyServiceSupplyEvent(directory, v);
  return w;
}
