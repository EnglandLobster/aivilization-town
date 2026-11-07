import { freightCustodian } from '@aivilization/logistics';
import { samePrincipalRequest, type PrincipalOperationRequest } from '@aivilization/authority';
import {
  VEHICLE_PRINCIPALS_POLICY,
  applyVehiclePrincipalEvent,
  decideVehiclePrincipalOperation,
  decodeVehiclePrincipalOperation,
  vehiclePrincipalRequest,
  type VehiclePrincipalEvent,
  type VehiclePrincipalPorts,
} from '@aivilization/mobility';
import { enablePublicVehiclePrincipalsAuthority } from '@aivilization/governance';
import { createEventEnvelope } from '@aivilization/sim-core';
import type { WorldProjection } from './projection';
import type { WorldEvent } from './events';
import type { PrincipalCollectivePort } from './principalCollectivePort';
import { vehicleFreightCargo } from './logisticsPorts';
import {
  authorizeWorldPrincipalControl,
  authorizeWorldPrincipalOperation,
  assertWorldPrincipalOperationSource,
  worldPrincipalAvailable,
  type PublicPrincipalExecution,
} from './resourcePrincipalAuthority';
export type ResidentVehiclePrincipalsPayload = {
  readonly policyVersion: typeof VEHICLE_PRINCIPALS_POLICY.version;
  readonly actorId: string;
  readonly events: readonly VehiclePrincipalEvent[];
};
type Context = {
  readonly projection: WorldProjection;
  readonly requestId: string;
  readonly simulationId: string;
  readonly nextSequence: number;
  readonly collective?: PrincipalCollectivePort;
  readonly publicExecution?: PublicPrincipalExecution;
};
export function vehiclePrincipalPorts(
  input: Context & { readonly actorId: string },
): VehiclePrincipalPorts {
  const w = input.projection;
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
    driverReleaseBlocked: (id, driver) =>
      vehicleFreightCargo(w, id).some(
        (f) => freightCustodian(w.logistics?.custody, f).carrierId === driver,
      )
        ? 'vehicle-actual-cargo-custody'
        : undefined,
  };
}
function wrap(
  input: Context,
  actorId: string,
  events: readonly VehiclePrincipalEvent[],
): WorldEvent {
  return createEventEnvelope({
    id: `${input.requestId}:vehicle-principals`,
    simulationId: input.simulationId,
    sequence: input.nextSequence,
    occurredAt: input.projection.clock.now,
    type: 'ResidentVehiclePrincipalsCommitted',
    payload: { policyVersion: VEHICLE_PRINCIPALS_POLICY.version, actorId, events },
  });
}
export function enableVehiclePrincipalsEvent(input: Context): WorldEvent {
  const e = wrap(input, 'system', [
    { type: 'VehiclePrincipalsEnabled', policy: VEHICLE_PRINCIPALS_POLICY },
  ]);
  applyVehiclePrincipalsProjection(input.projection, e);
  return e;
}
export function residentVehiclePrincipalOperation(
  input: Context & { readonly actorId: string; readonly request: PrincipalOperationRequest },
) {
  const w = input.projection,
    s = w.residentMobility,
    no = (reason: string) => ({ accepted: false as const, reason });
  if (!s?.principalPolicy) return no('vehicle-principals-not-enabled');
  try {
    const c = decodeVehiclePrincipalOperation(input.request),
      v = s.vehicles[c.id];
    if (!v || !samePrincipalRequest(vehiclePrincipalRequest(v, c), input.request))
      return no('vehicle-principal-version-or-resource-conflict');
    const d = decideVehiclePrincipalOperation(
      s,
      input.actorId,
      w.clock.now,
      c,
      vehiclePrincipalPorts(input),
    );
    if (!d.accepted) return d;
    const e = wrap(input, input.actorId, d.events);
    applyVehiclePrincipalsProjection(w, e, input.publicExecution, input.collective);
    return { accepted: true as const, events: [e] };
  } catch (error) {
    return no(error instanceof Error ? error.message : 'invalid-vehicle-principal-operation');
  }
}
export function applyVehiclePrincipalsProjection(
  w: WorldProjection,
  e: WorldEvent,
  execution?: PublicPrincipalExecution,
  collective?: PrincipalCollectivePort,
): WorldProjection | undefined {
  if (e.type !== 'ResidentVehiclePrincipalsCommitted') return undefined;
  const p = e.payload,
    s = w.residentMobility,
    v = p.events[0];
  if (
    !s ||
    p.policyVersion !== VEHICLE_PRINCIPALS_POLICY.version ||
    e.occurredAt !== w.clock.now ||
    p.events.length !== 1 ||
    !v
  )
    throw Error('invalid-vehicle-principals-world-packet');
  if (v.type === 'VehiclePrincipalsEnabled') {
    if (
      p.actorId !== 'system' ||
      !w.publicGovernance ||
      Object.values(s.vehicles).some(
        (v) => !w.agents[v.ownerId] || v.authorized.some((id) => !w.agents[id]),
      )
    )
      throw Error('invalid-vehicle-principals-world-activation');
    return {
      ...w,
      residentMobility: applyVehiclePrincipalEvent(s, v),
      publicGovernance: {
        ...w.publicGovernance,
        authority: enablePublicVehiclePrincipalsAuthority(w.publicGovernance.authority),
      },
    };
  }
  if (v.type !== 'VehiclePrincipalDriversChanged')
    throw Error('vehicle-control-requires-control-envelope');
  if (v.at !== w.clock.now || v.authorization.actorId !== p.actorId || !w.agents[p.actorId])
    throw Error('invalid-vehicle-principal-signature');
  assertWorldPrincipalOperationSource(w, v.authorization, execution, collective);
  const c = decodeVehiclePrincipalOperation(v.authorization.request);
  if (
    !w.agents[c.residentId] ||
    (c.type === 'vehicles.revoke' &&
      vehicleFreightCargo(w, v.id).some(
        (f) => freightCustodian(w.logistics?.custody, f).carrierId === c.residentId,
      ))
  )
    throw Error('vehicle-principal-driver-missing-or-custody-unsettled');
  return { ...w, residentMobility: applyVehiclePrincipalEvent(s, v) };
}
