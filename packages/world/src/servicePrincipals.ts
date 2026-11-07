import {
  principalOperationKey,
  type PrincipalControlRequest,
  type PrincipalOperationRequest,
} from '@aivilization/authority';
import {
  SERVICE_PRINCIPALS_POLICY,
  INDEPENDENT_SERVICE_PRINCIPALS_POLICY,
  applyServicePrincipalEvent,
  decideServicePrincipalControl,
  decideServicePrincipalOperation,
  canProvide,
  currentServiceEnterprise,
  type ServicesState,
  type ServicesPorts,
  type ServicePrincipalEvent,
  type ServicePrincipalsPorts,
} from '@aivilization/services';
import { enterpriseManagementAuthority, isEnterpriseOperational } from '@aivilization/enterprise';
import { enablePublicServicePrincipalsAuthority } from '@aivilization/governance';
import { createEventEnvelope } from '@aivilization/sim-core';
import type { WorldProjection } from './projection';
import type { WorldEvent } from './events';
import type { PrincipalCollectivePort } from './principalCollectivePort';
import { premisesAtLocation } from './premisesAccess';
import { mayOperateWorldPremises } from './premisesAccess';
import {
  authorizeWorldPrincipalControl,
  authorizeWorldPrincipalOperation,
  assertWorldPrincipalControlSource,
  assertWorldPrincipalOperationSource,
  worldPrincipalAvailable,
  type PublicPrincipalExecution,
} from './resourcePrincipalAuthority';
export type ResidentServicePrincipalsPayload = {
  readonly policyVersion:
    | typeof SERVICE_PRINCIPALS_POLICY.version
    | typeof INDEPENDENT_SERVICE_PRINCIPALS_POLICY.version;
  readonly actorId: string;
  readonly events: readonly ServicePrincipalEvent[];
};
type Context = {
  readonly projection: WorldProjection;
  readonly directory: ServicesState;
  readonly requestId: string;
  readonly simulationId: string;
  readonly nextSequence: number;
  readonly collective?: PrincipalCollectivePort;
  readonly publicExecution?: PublicPrincipalExecution;
};
export type ServicePrincipalWorldContext = Context;
export function servicePrincipalWorldPorts(
  input: Context & { readonly actorId: string },
): ServicePrincipalsPorts {
  const w = input.projection,
    s = input.directory;
  const service: ServicesPorts = {
    exists: (id) => Object.hasOwn(w.agents, id),
    locationCapacity: (id) => {
      const l = w.locations[id],
        b = premisesAtLocation(w, id);
      return l
        ? b && (b.status !== 'operational' || b.condition <= 0)
          ? 0
          : (l.capacity ?? s.policy.maxCapacity)
        : undefined;
    },
    presentAndIdle: (id, location) =>
      w.agents[id]?.locationId === location &&
      !w.transitByAgent?.[id] &&
      (w.activityTimeByAgent[id]?.availableAt ?? 0) <= w.clock.now,
    controlsEnterprise: (actor, id) => {
      const e = w.enterprises[id];
      return (
        !!e &&
        isEnterpriseOperational(e) &&
        !!enterpriseManagementAuthority(e, actor, 'authorize-service')
      );
    },
    employedBy: (actor, id) => {
      const e = w.enterprises[id];
      return !!e && isEnterpriseOperational(e) && e.employeeAgentIds.some((id) => id === actor);
    },
  };
  return {
    available: (p) => worldPrincipalAvailable(w, p, input.collective),
    authorizeControl: (principal, request) =>
      authorizeWorldPrincipalControl({
        world: w,
        actorId: input.actorId,
        principal,
        request,
        ...(input.publicExecution ? { publicExecution: input.publicExecution } : {}),
        ...(input.collective ? { collective: input.collective } : {}),
      }),
    authorizeOperation: (p, r) =>
      authorizeWorldPrincipalOperation(
        w,
        input.actorId,
        p,
        r,
        input.publicExecution,
        input.collective,
      ),
    service,
    inheritedProviders: (v) => {
      const controller = v.control?.controller ?? { kind: 'resident' as const, id: v.ownerId },
        candidates = [
          ...(controller.kind === 'resident' ? [controller.id] : []),
          ...(currentServiceEnterprise(v)
            ? (w.enterprises[currentServiceEnterprise(v)!]?.employeeAgentIds ?? [])
            : []),
        ];
      return [...new Set(candidates)].filter((id) => !!w.agents[id] && canProvide(v, id, service));
    },
  };
}
function wrap(
  input: Context,
  actorId: string,
  events: readonly ServicePrincipalEvent[],
): WorldEvent {
  return createEventEnvelope({
    id: `${input.requestId}:service-principals`,
    simulationId: input.simulationId,
    sequence: input.nextSequence,
    occurredAt: input.projection.clock.now,
    type: 'ResidentServicePrincipalsCommitted',
    payload: {
      policyVersion:
        events[0]?.type === 'ServicePrincipalsEnabled' ||
        events[0]?.type === 'ServicePrincipalAuthoritySeparated'
          ? events[0].policy.version
          : (input.directory.principalPolicy?.version ?? SERVICE_PRINCIPALS_POLICY.version),
      actorId,
      events,
    },
  });
}
export function enableServicePrincipalsEvent(input: Context): WorldEvent {
  const e = wrap(input, 'system', [
    { type: 'ServicePrincipalsEnabled', policy: SERVICE_PRINCIPALS_POLICY },
  ]);
  applyServicePrincipalsProjection(input.projection, e, input.directory);
  return e;
}
/** Explicit integration transition; public grants are neither required nor expanded. */
export function separateServiceAuthorityEvent(input: Context): WorldEvent {
  const event = wrap(input, 'system', [
    input.directory.principalPolicy
      ? {
          type: 'ServicePrincipalAuthoritySeparated',
          previousVersion: SERVICE_PRINCIPALS_POLICY.version,
          policy: INDEPENDENT_SERVICE_PRINCIPALS_POLICY,
        }
      : { type: 'ServicePrincipalsEnabled', policy: INDEPENDENT_SERVICE_PRINCIPALS_POLICY },
  ]);
  applyServicePrincipalsProjection(input.projection, event, input.directory);
  return event;
}
export function hasIndependentServiceAuthority(directory: ServicesState): boolean {
  return directory.principalPolicy?.version === INDEPENDENT_SERVICE_PRINCIPALS_POLICY.version;
}
export function residentServicePrincipalOperation(
  input: Context & {
    readonly actorId: string;
    readonly request: PrincipalControlRequest | PrincipalOperationRequest;
  },
) {
  const no = (reason: string) => ({ accepted: false as const, reason });
  if (!input.directory.principalPolicy) return no('service-principals-not-enabled');
  try {
    const p = servicePrincipalWorldPorts(input),
      d =
        'operation' in input.request
          ? decideServicePrincipalOperation(
              input.directory,
              input.actorId,
              input.projection.clock.now,
              input.request,
              p,
            )
          : decideServicePrincipalControl(
              input.directory,
              input.actorId,
              input.projection.clock.now,
              input.request,
              p,
            );
    if (!d.accepted) return d;
    const e = wrap(input, input.actorId, d.events);
    applyServicePrincipalsProjection(
      input.projection,
      e,
      input.directory,
      input.publicExecution,
      input.collective,
    );
    return { accepted: true as const, events: [e] };
  } catch (error) {
    return no(error instanceof Error ? error.message : 'invalid-service-principal-command');
  }
}
/** Pure source validation. The directory remains in the composition journal and its owning applier. */
export function applyServicePrincipalsProjection(
  w: WorldProjection,
  e: WorldEvent,
  directory?: ServicesState,
  execution?: PublicPrincipalExecution,
  collective?: PrincipalCollectivePort,
): WorldProjection | undefined {
  if (e.type !== 'ResidentServicePrincipalsCommitted') return undefined;
  if (!directory) throw Error('service-principal-directory-port-required');
  const p = e.payload,
    v = p.events[0];
  if (
    p.policyVersion !==
      (v?.type === 'ServicePrincipalsEnabled' || v?.type === 'ServicePrincipalAuthoritySeparated'
        ? v.policy.version
        : (directory.principalPolicy?.version ?? SERVICE_PRINCIPALS_POLICY.version)) ||
    p.events.length !== 1 ||
    !v ||
    e.occurredAt !== w.clock.now
  )
    throw Error('invalid-service-principals-world-packet');
  if (v.type === 'ServicePrincipalAuthoritySeparated') {
    if (p.actorId !== 'system') throw Error('invalid-service-authority-transition-actor');
    applyServicePrincipalEvent(directory, v);
    return w;
  }
  if (v.type === 'ServicePrincipalsEnabled') {
    if (v.policy.version === INDEPENDENT_SERVICE_PRINCIPALS_POLICY.version) {
      if (
        p.actorId !== 'system' ||
        Object.values(directory.services).some((s) => !w.agents[s.ownerId])
      )
        throw Error('invalid-service-principals-world-activation');
      applyServicePrincipalEvent(directory, v);
      return w;
    }
    if (
      p.actorId !== 'system' ||
      !w.publicGovernance ||
      Object.values(directory.services).some((s) => !w.agents[s.ownerId])
    )
      throw Error('invalid-service-principals-world-activation');
    applyServicePrincipalEvent(directory, v);
    return {
      ...w,
      publicGovernance: {
        ...w.publicGovernance,
        authority: enablePublicServicePrincipalsAuthority(w.publicGovernance.authority),
      },
    };
  }
  if (
    !w.agents[p.actorId] ||
    (!hasIndependentServiceAuthority(directory) && !w.publicGovernance?.authority.grant.services)
  )
    throw Error('service-principal-authority-port-required');
  const context = {
      projection: w,
      directory,
      actorId: p.actorId,
      requestId: e.id,
      simulationId: e.simulationId,
      nextSequence: e.sequence,
      ...(execution ? { publicExecution: execution } : {}),
      ...(collective ? { collective } : {}),
    },
    ports = servicePrincipalWorldPorts(context);
  if (v.type === 'ServicePrincipalControlChanged') {
    if (directory.relationPolicy) throw Error('service-supply-control-envelope-required');
    const proof = v.change.control.authorization,
      r = v.change.request;
    if (proof.actorId !== p.actorId || v.change.control.at !== w.clock.now)
      throw Error('service-principal-signature-mismatch');
    assertWorldPrincipalControlSource(w, proof, r, p.actorId, execution, collective);
    if (v.affiliationAuthorization)
      assertWorldPrincipalControlSource(
        w,
        v.affiliationAuthorization,
        r,
        v.affiliationAuthorization.actorId,
        execution,
        collective,
      );
    const service = directory.services[v.serviceId],
      target =
        r.command.type === 'offer'
          ? r.command.target
          : r.command.type === 'accept'
            ? service?.control?.offer?.target
            : undefined;
    if (target && !ports.available(target)) throw Error('service-principal-target-unavailable');
    if (
      v.inheritedProviders &&
      (!service ||
        principalOperationKey(v.inheritedProviders) !==
          principalOperationKey(ports.inheritedProviders(service)))
    )
      throw Error('service-provider-inheritance-source-mismatch');
  } else {
    if (v.authorization.actorId !== p.actorId || v.at !== w.clock.now)
      throw Error('service-principal-signature-mismatch');
    assertWorldPrincipalOperationSource(w, v.authorization, execution, collective);
    if (v.authorization.request.operation.capability === 'services.schedule') {
      const service = directory.services[v.serviceId];
      if (!service || !mayOperateWorldPremises(w, p.actorId, service.locationId))
        throw Error('premises-operation-not-authorized');
    }
    if (
      v.capacityProof &&
      ports.service.locationCapacity(v.capacityProof.locationId) !== v.capacityProof.capacity
    )
      throw Error('service-capacity-world-source-mismatch');
    const id = v.authorization.request.operation.arguments.residentId;
    if (id !== undefined && (typeof id !== 'string' || !w.agents[id]))
      throw Error('service-provider-resident-required');
  }
  applyServicePrincipalEvent(directory, v);
  return w;
}
export function servicePrincipalEventsFromWorld(e: WorldEvent): readonly ServicePrincipalEvent[] {
  if (e.type === 'ResidentServicePrincipalsCommitted') return e.payload.events;
  if (e.type === 'ResidentPublicGovernanceCommitted')
    return e.payload.serviceDirectoryCommit?.events ?? [];
  return [];
}
