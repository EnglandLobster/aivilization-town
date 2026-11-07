import {
  RESOURCE_PRINCIPAL_POLICY,
  assertResourcePrincipalPolicy,
  decidePrincipalControl,
  applyPrincipalControl,
  resourcePrincipalSnapshot,
  assertPrincipalAuthorization,
  principalId,
  principalOperationKey,
  type PrincipalControlRequest,
  type PrincipalControlChanged,
  type PrincipalOperationRequest,
  type PrincipalAuthorization,
  type PrincipalAuthorizationPort,
  type ResourcePrincipal,
} from '@aivilization/authority';
import { assignedRide, type MobilityState, type Vehicle } from './model';
export const VEHICLE_PRINCIPALS_POLICY = {
  version: 'resident-vehicle-principals-v2',
  control: RESOURCE_PRINCIPAL_POLICY,
  maxDrivers: 128,
} as const;
export type VehiclePrincipalsPolicy = typeof VEHICLE_PRINCIPALS_POLICY;
export type VehiclePrincipalCommand = {
  readonly type: 'vehicles.authorize' | 'vehicles.revoke';
  readonly id: string;
  readonly expectedRevision: number;
  readonly residentId: string;
};
export type VehiclePrincipalEvent =
  | { readonly type: 'VehiclePrincipalsEnabled'; readonly policy: VehiclePrincipalsPolicy }
  | {
      readonly type: 'VehiclePrincipalControlChanged';
      readonly id: string;
      readonly previousRevision: number;
      readonly change: PrincipalControlChanged;
    }
  | {
      readonly type: 'VehiclePrincipalDriversChanged';
      readonly id: string;
      readonly previousRevision: number;
      readonly at: number;
      readonly authorized: readonly string[];
      readonly authorization: PrincipalAuthorization<PrincipalOperationRequest>;
    };
export type VehiclePrincipalPorts = {
  readonly available: (p: ResourcePrincipal) => boolean;
  readonly authorizeControl: PrincipalAuthorizationPort;
  readonly authorizeOperation: PrincipalAuthorizationPort<PrincipalOperationRequest>;
  readonly driverReleaseBlocked: (vehicleId: string, driverId: string) => string | undefined;
};
const no = (reason: string) => ({ accepted: false as const, reason });
function policy(p: VehiclePrincipalsPolicy) {
  assertResourcePrincipalPolicy(p.control);
  if (
    p.version !== VEHICLE_PRINCIPALS_POLICY.version ||
    p.maxDrivers !== VEHICLE_PRINCIPALS_POLICY.maxDrivers ||
    Object.keys(p).length !== 3
  )
    throw Error('unsupported-vehicle-principals-policy');
}
export const vehiclePrincipalBusy = (s: MobilityState, id: string) =>
  !!s.vehicles[id]?.journey ||
  Object.values(s.rides).some((r) => r.vehicleId === id && assignedRide(r));
export function vehiclePrincipalRequest(
  v: Vehicle,
  c: VehiclePrincipalCommand,
): PrincipalOperationRequest {
  return {
    resourceKind: 'vehicle',
    resourceId: v.id,
    resourceRevision: c.expectedRevision,
    controlVersion: resourcePrincipalSnapshot(v).version,
    operation: { capability: c.type, arguments: structuredClone(c) },
  };
}
export function decodeVehiclePrincipalOperation(
  r: PrincipalOperationRequest,
): VehiclePrincipalCommand {
  const c = r.operation.arguments;
  if (
    Object.keys(c).length !== 4 ||
    (c.type !== 'vehicles.authorize' && c.type !== 'vehicles.revoke') ||
    r.operation.capability !== c.type ||
    typeof c.id !== 'string' ||
    typeof c.residentId !== 'string' ||
    typeof c.expectedRevision !== 'number'
  )
    throw Error('invalid-vehicle-principal-command');
  return { type: c.type, id: c.id, residentId: c.residentId, expectedRevision: c.expectedRevision };
}
function drivers(v: Vehicle, c: VehiclePrincipalCommand, max: number) {
  if (!principalId(c.residentId)) throw Error('invalid-vehicle-driver');
  const next =
    c.type === 'vehicles.authorize'
      ? [...new Set([...v.authorized, c.residentId])]
      : v.authorized.filter((id) => id !== c.residentId);
  if (next.length > max) throw Error('vehicle-driver-limit');
  return next;
}
export function decideVehiclePrincipalControl(
  s: MobilityState,
  actorId: string,
  at: number,
  request: PrincipalControlRequest,
  ports: VehiclePrincipalPorts,
) {
  if (!s.principalPolicy) return no('vehicle-principals-not-enabled');
  try {
    policy(s.principalPolicy);
    const v = s.vehicles[request.resourceId];
    if (!v || request.resourceKind !== 'vehicle') return no('vehicle-principal-resource-not-found');
    if (v.revision !== request.resourceRevision || !Number.isSafeInteger(v.revision + 1))
      return no('vehicle-principal-revision-conflict');
    if (!Number.isSafeInteger(at) || at < (v.principalAt ?? 0))
      return no('invalid-vehicle-principal-control-time');
    if (vehiclePrincipalBusy(s, v.id)) return no('vehicle-principal-journey-or-booking-unsettled');
    const d = decidePrincipalControl({
      policy: s.principalPolicy.control,
      snapshot: resourcePrincipalSnapshot(v),
      request,
      actorId,
      at,
      authorize: ports.authorizeControl,
      available: ports.available,
    });
    if (!d.accepted) return d;
    const event: VehiclePrincipalEvent = {
      type: 'VehiclePrincipalControlChanged',
      id: v.id,
      previousRevision: v.revision,
      change: d.event,
    };
    applyVehiclePrincipalEvent(s, event);
    return { accepted: true as const, events: [event] };
  } catch (error) {
    return no(error instanceof Error ? error.message : 'invalid-vehicle-principal-control');
  }
}
export function decideVehiclePrincipalOperation(
  s: MobilityState,
  actorId: string,
  at: number,
  command: VehiclePrincipalCommand,
  ports: VehiclePrincipalPorts,
) {
  if (!s.principalPolicy) return no('vehicle-principals-not-enabled');
  try {
    policy(s.principalPolicy);
    const v = s.vehicles[command.id];
    if (!v?.control) return no('vehicle-principal-control-required');
    if (v.control.offer) return no('vehicle-principal-handover-pending');
    if (v.revision !== command.expectedRevision || !Number.isSafeInteger(v.revision + 1))
      return no('vehicle-principal-revision-conflict');
    if (
      !Number.isSafeInteger(at) ||
      at < (v.principalAt ?? v.control.at) ||
      !ports.available({ kind: 'resident', id: actorId }) ||
      !ports.available({ kind: 'resident', id: command.residentId })
    )
      return no('invalid-vehicle-principal-actor-driver-or-time');
    if (vehiclePrincipalBusy(s, v.id)) return no('vehicle-principal-journey-or-booking-unsettled');
    if (command.type === 'vehicles.revoke') {
      const failure = ports.driverReleaseBlocked(v.id, command.residentId);
      if (failure) return no(failure);
    }
    const request = vehiclePrincipalRequest(v, command),
      authorization = ports.authorizeOperation(v.control.controller, request);
    if (!authorization) return no('vehicle-principal-operation-authority-required');
    assertPrincipalAuthorization(authorization, v.control.controller, request, actorId);
    const event: VehiclePrincipalEvent = {
      type: 'VehiclePrincipalDriversChanged',
      id: v.id,
      previousRevision: v.revision,
      at,
      authorized: drivers(v, command, s.principalPolicy.maxDrivers),
      authorization,
    };
    applyVehiclePrincipalEvent(s, event);
    return { accepted: true as const, events: [event] };
  } catch (error) {
    return no(error instanceof Error ? error.message : 'invalid-vehicle-principal-operation');
  }
}
export function applyVehiclePrincipalEvent(
  s: MobilityState,
  e: VehiclePrincipalEvent,
): MobilityState {
  if (e.type === 'VehiclePrincipalsEnabled') {
    policy(e.policy);
    if (
      s.principalPolicy ||
      Object.values(s.vehicles).some(
        (v) =>
          v.control ||
          !principalId(v.ownerId) ||
          new Set([...v.authorized, v.ownerId]).size > e.policy.maxDrivers,
      )
    )
      throw Error('invalid-vehicle-principals-activation');
    return { ...s, principalPolicy: structuredClone(e.policy) };
  }
  if (!s.principalPolicy) throw Error('vehicle-principals-not-enabled');
  policy(s.principalPolicy);
  const v = s.vehicles[e.id];
  if (
    !v ||
    v.revision !== e.previousRevision ||
    !Number.isSafeInteger(v.revision + 1) ||
    vehiclePrincipalBusy(s, v.id)
  )
    throw Error('invalid-vehicle-principal-state');
  if (e.type === 'VehiclePrincipalControlChanged') {
    if (e.change.control.at < (v.principalAt ?? 0))
      throw Error('vehicle-principal-control-time-regressed');
    if (
      e.change.request.resourceKind !== 'vehicle' ||
      e.change.request.resourceId !== v.id ||
      e.change.request.resourceRevision !== v.revision
    )
      throw Error('vehicle-principal-control-source-mismatch');
    const control = applyPrincipalControl(resourcePrincipalSnapshot(v), e.change);
    // Preserve legacy implicit self-use as a finite, explicit, revocable permission.
    const authorized = v.control ? v.authorized : [...new Set([...v.authorized, v.ownerId])];
    return {
      ...s,
      vehicles: {
        ...s.vehicles,
        [v.id]: { ...v, control, authorized, principalAt: control.at, revision: v.revision + 1 },
      },
    };
  }
  if (
    !v.control ||
    v.control.offer ||
    !Number.isSafeInteger(e.at) ||
    e.at < (v.principalAt ?? v.control.at)
  )
    throw Error('invalid-vehicle-principal-driver-state');
  const c = decodeVehiclePrincipalOperation(e.authorization.request),
    request = vehiclePrincipalRequest(v, c);
  if (c.id !== v.id || c.expectedRevision !== v.revision || e.authorization.actorId === 'system')
    throw Error('invalid-vehicle-principal-driver-source');
  assertPrincipalAuthorization(
    e.authorization,
    v.control.controller,
    request,
    e.authorization.actorId,
  );
  const authorized = drivers(v, c, s.principalPolicy.maxDrivers);
  if (
    authorized.length !== e.authorized.length ||
    authorized.some((id, index) => id !== e.authorized[index])
  )
    throw Error('vehicle-principal-driver-effect-mismatch');
  return {
    ...s,
    vehicles: {
      ...s.vehicles,
      [v.id]: { ...v, authorized, principalAt: e.at, revision: v.revision + 1 },
    },
  };
}
/** Ordinary physical movement cannot overwrite the separate custody/permission aggregate. */
export function sameVehiclePrincipalAuthority(a: Vehicle, b: Vehicle): boolean {
  if (a.principalAt !== b.principalAt) return false;
  if (!a.control && !b.control) return true;
  if (!a.control || !b.control) return false;
  return (
    a.control.version === b.control.version &&
    principalOperationKey(a.control.authorization) ===
      principalOperationKey(b.control.authorization) &&
    principalOperationKey(a.control) === principalOperationKey(b.control) &&
    a.authorized.length === b.authorized.length &&
    a.authorized.every((id, index) => id === b.authorized[index])
  );
}
