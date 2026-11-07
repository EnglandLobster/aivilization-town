import {
  freightCustodyRecordedCommand,
  type FreightCustodyCollectivePort,
  type FreightCustodyAuthorization,
} from './freightCustodyAuthority';
import {
  FREIGHT_CUSTODY_HANDOFF_VERSION,
  FREIGHT_CUSTODY_COLLECTIVE_VERSION,
  applyFreightCustodyEvent,
  decideFreightCustody,
  emptyFreightCustodyState,
  freightCustodian,
  freightFactsEqual,
  physicalLoadUnits,
  type Freight,
  type FreightCustodyCommand,
  type FreightCustodyEvent,
  type FreightCustodyPorts,
} from '@aivilization/logistics';
import { authorizedDriver } from '@aivilization/mobility';
import { createEventEnvelope } from '@aivilization/sim-core';
import type { WorldEvent } from './events';
import type { WorldProjection } from './projection';
import { personalPhysicalLoad, vehicleFreightCargo } from './logisticsPorts';
import { mayEnterWorldPremises } from './premisesAccess';
import { residentFinancialAccount } from './residentFinancialAccounts';

export type ResidentFreightCustodyPacket = {
  readonly version: typeof FREIGHT_CUSTODY_HANDOFF_VERSION;
} & (
  | { readonly type: 'enable' }
  | {
      readonly type: 'enable-collectives';
      readonly policyVersion: typeof FREIGHT_CUSTODY_COLLECTIVE_VERSION;
    }
  | {
      readonly type: 'handoff';
      readonly event: FreightCustodyEvent;
      readonly authorization?: FreightCustodyAuthorization;
    }
);
type Context = {
  readonly collective?: FreightCustodyCollectivePort;
  readonly collectiveAuthorization?: FreightCustodyAuthorization;
  readonly projection: WorldProjection;
  readonly actorId: string;
  readonly simulationId: string;
  readonly requestId: string;
  readonly nextSequence: number;
};
const live = (w: WorldProjection, id: string) =>
  !!w.agents[id] && w.agents[id].physiology.health > 0;
const departure = (w: WorldProjection, id: string) => {
  const r = w.residentExits?.records[id];
  return r ? { actorId: id, populationEventId: r.populationEventId, at: r.at } : undefined;
};
/** A parked vehicle or a recorded departure place anchors custody. An interrupted route is not a node. */
export function freightCustodyTakingFailure(
  w: WorldProjection,
  f: Freight,
  previousCarrierId: string,
  nextCarrierId: string,
  vehicleId: string | undefined,
): string | undefined {
  const holder = freightCustodian(w.logistics?.custody, f);
  const cargo = w.materials?.custodies?.records[f.id];
  if (
    holder.carrierId !== previousCarrierId ||
    !cargo ||
    cargo.status !== 'loaded' ||
    cargo.consumerId !== f.id ||
    !freightFactsEqual(cargo.held, f.items)
  )
    return 'custody-actual-material-required';
  const oldVehicle = holder.vehicleId ? w.residentMobility?.vehicles[holder.vehicleId] : undefined;
  const exit = w.residentExits?.records[previousCarrierId];
  const exitBag = exit ? w.residentExits?.materials.records[exit.backpackCustodyId] : undefined;
  const location = holder.vehicleId
    ? oldVehicle && !oldVehicle.journey
      ? oldVehicle.locationId
      : null
    : w.transitByAgent?.[previousCarrierId] || w.interruptedTravelByAgent?.[previousCarrierId]
      ? null
      : (w.agents[previousCarrierId]?.locationId ?? exitBag?.source.locationId);
  if (!location || !w.locations[location]) return 'custody-shared-stationary-location-required';
  const present = (id: string) =>
    live(w, id) &&
    w.agents[id]!.locationId === location &&
    !w.transitByAgent?.[id] &&
    !w.interruptedTravelByAgent?.[id] &&
    (w.activityTimeByAgent[id]?.availableAt ?? 0) <= w.clock.now &&
    mayEnterWorldPremises(w, id, location);
  if (!present(nextCarrierId) || (live(w, previousCarrierId) && !present(previousCarrierId)))
    return 'custody-participants-not-present-and-idle';
  if (!live(w, previousCarrierId) && !exit) return 'custody-original-carrier-departure-required';
  const units = physicalLoadUnits(cargo.held);
  if (!vehicleId)
    return personalPhysicalLoad(w, nextCarrierId) + units >
      w.logistics!.policy.personalLoadCapacity + 1e-8
      ? 'custody-personal-load-capacity'
      : undefined;
  const vehicle = w.residentMobility?.vehicles[vehicleId];
  if (
    !vehicle ||
    vehicle.journey ||
    vehicle.locationId !== location ||
    !authorizedDriver(vehicle, nextCarrierId)
  )
    return 'custody-vehicle-not-present-and-authorized';
  const other = vehicleFreightCargo(w, vehicleId).filter((v) => v.id !== f.id);
  if (other.some((v) => freightCustodian(w.logistics?.custody, v).carrierId !== nextCarrierId))
    return 'custody-vehicle-other-custodian-required';
  const otherUnits = other.reduce((n, v) => {
    const c = w.materials?.custodies?.records[v.id];
    if (!c || c.status !== 'loaded') throw Error('freight-physical-custody-mismatch');
    return n + physicalLoadUnits(c.held);
  }, 0);
  return otherUnits + units + personalPhysicalLoad(w, nextCarrierId) >
    (vehicle.cargoCapacity?.units ?? 0) + 1e-8
    ? 'custody-vehicle-load-capacity'
    : undefined;
}
function ports(
  w: WorldProjection,
  collective?: FreightCustodyCollectivePort,
  authorization?: FreightCustodyAuthorization,
  actorId?: string,
): FreightCustodyPorts {
  return {
    authorize: (c) =>
      authorization && actorId && c.kind === 'collective' && c.id === authorization.collectiveId
        ? { actorId, decisionId: authorization.decisionId }
        : undefined,
    collectiveConsentValid: (proposal, role) => collective?.consentValid(proposal, role) ?? false,
    exists: (id) => live(w, id),
    payerController: (f) => residentFinancialAccount(w, f.payer)?.controller,
    departure: (id) => departure(w, id),
    takingFailure: (f, before, after, vehicle) =>
      freightCustodyTakingFailure(w, f, before, after, vehicle),
  };
}
function envelope(input: Context, custody: ResidentFreightCustodyPacket): WorldEvent {
  return createEventEnvelope({
    id: `${input.requestId}:freight-custody`,
    simulationId: input.simulationId,
    sequence: input.nextSequence,
    occurredAt: input.projection.clock.now,
    type: 'ResidentLogisticsCommitted',
    payload: {
      policyVersion: 'resident-logistics-v1' as const,
      actorId: input.actorId,
      custody,
      events: [],
      transactions: [],
      materialProofs: [],
      materialEvents: [],
      commonAccountEvents: [],
    },
  });
}
export function enableResidentFreightCustodyEvent(input: Context): WorldEvent {
  if (
    input.actorId !== 'system' ||
    !input.projection.logistics ||
    input.projection.logistics.custody
  )
    throw Error('invalid-freight-custody-enablement');
  return envelope(input, { version: FREIGHT_CUSTODY_HANDOFF_VERSION, type: 'enable' });
}
export function enableCollectiveFreightCustodyEvent(input: Context): WorldEvent {
  if (
    input.actorId !== 'system' ||
    !input.projection.logistics?.custody ||
    input.projection.logistics.custody.collectiveGrantsVersion
  )
    throw Error('invalid-collective-freight-custody-enablement');
  return envelope(input, {
    version: FREIGHT_CUSTODY_HANDOFF_VERSION,
    type: 'enable-collectives',
    policyVersion: FREIGHT_CUSTODY_COLLECTIVE_VERSION,
  });
}
export function residentFreightCustodyEvent(
  input: Context & { readonly freightId: string; readonly command: FreightCustodyCommand },
) {
  const s = input.projection.logistics,
    f = s?.freight[input.freightId];
  if (!s?.custody || !f)
    return { accepted: false as const, reason: 'freight-custody-not-enabled-or-missing' };
  if (
    !s.custody.collectiveGrantsVersion &&
    (f.controller.kind !== 'resident' ||
      f.recipient.kind !== 'resident' ||
      f.payer.sector !== 'agent')
  )
    return { accepted: false as const, reason: 'custody-collective-grant-adapter-required' };
  if (
    input.collectiveAuthorization &&
    (!s.custody.collectiveGrantsVersion ||
      !input.collective?.authorize({
        ...input.collectiveAuthorization,
        actorId: input.actorId,
        freightId: input.freightId,
        command: input.command,
      }))
  )
    return { accepted: false as const, reason: 'custody-exact-collective-decision-required' };
  const d = decideFreightCustody({
    state: s.custody,
    freight: f,
    actorId: input.actorId,
    at: input.projection.clock.now,
    command: input.command,
    ports: ports(input.projection, input.collective, input.collectiveAuthorization, input.actorId),
  });
  if (!d.accepted) return d;
  return {
    accepted: true as const,
    events: [
      envelope(input, {
        version: FREIGHT_CUSTODY_HANDOFF_VERSION,
        type: 'handoff',
        event: d.event,
        ...(input.collectiveAuthorization ? { authorization: input.collectiveAuthorization } : {}),
      }),
    ],
  };
}
/** Validate recorded evidence; never rerun the proposal decision or change physical stock/contract fees. */
export function applyResidentFreightCustody(
  w: WorldProjection,
  e: WorldEvent & { type: 'ResidentLogisticsCommitted' },
  collective?: FreightCustodyCollectivePort,
): WorldProjection {
  const p = e.payload,
    packet = p.custody,
    s = w.logistics;
  if (
    !packet ||
    !s ||
    packet.version !== FREIGHT_CUSTODY_HANDOFF_VERSION ||
    e.occurredAt !== w.clock.now ||
    p.events.length ||
    p.transactions.length ||
    p.materialEvents.length ||
    p.materialProofs.length ||
    p.commonAccountEvents.length ||
    p.estateCashBatch
  )
    throw Error('invalid-freight-custody-envelope');
  if (packet.type === 'enable') {
    if (p.actorId !== 'system' || s.custody) throw Error('invalid-freight-custody-enablement');
    return { ...w, logistics: { ...s, custody: emptyFreightCustodyState() } };
  }
  if (packet.type === 'enable-collectives') {
    if (
      p.actorId !== 'system' ||
      !s.custody ||
      s.custody.collectiveGrantsVersion ||
      packet.policyVersion !== FREIGHT_CUSTODY_COLLECTIVE_VERSION
    )
      throw Error('invalid-collective-freight-custody-enablement');
    return {
      ...w,
      logistics: { ...s, custody: { ...s.custody, collectiveGrantsVersion: packet.policyVersion } },
    };
  }
  const v = packet.event.value,
    f = s.freight[v.freightId],
    old = s.custody?.proposals[v.id];
  if (
    !s.custody ||
    !f ||
    v.lastActorId !== p.actorId ||
    v.at !== e.occurredAt ||
    !live(w, p.actorId) ||
    (!s.custody.collectiveGrantsVersion &&
      (f.controller.kind !== 'resident' ||
        f.recipient.kind !== 'resident' ||
        f.payer.sector !== 'agent')) ||
    !freightFactsEqual(v.principals.payer, residentFinancialAccount(w, f.payer)?.controller)
  )
    throw Error('invalid-freight-custody-source');
  if (
    !old &&
    p.actorId !== freightCustodian(s.custody, f).carrierId &&
    (f.controller.kind !== 'resident' || p.actorId !== f.controller.id) &&
    !packet.authorization
  )
    throw Error('custody-source-or-current-carrier-required');
  if (
    v.departure
      ? live(w, v.previousCarrierId) ||
        !freightFactsEqual(v.departure, departure(w, v.previousCarrierId))
      : !live(w, v.previousCarrierId)
  )
    throw Error('custody-departure-source-changed');
  const command = freightCustodyRecordedCommand(old, v),
    auth = packet.authorization;
  const collectiveSubject =
    command.type === 'propose'
      ? v.createdByCollectiveId
      : command.type === 'consent' && v.principals[command.role]?.kind === 'collective'
        ? v.principals[command.role].id
        : command.type === 'withdraw'
          ? v.withdrawalAuthority?.collectiveId
          : undefined;
  if (
    collectiveSubject
      ? !s.custody.collectiveGrantsVersion ||
        !auth ||
        auth.collectiveId !== collectiveSubject ||
        !collective?.authorize({ ...auth, actorId: p.actorId, freightId: f.id, command })
      : !!auth
  )
    throw Error('custody-exact-collective-decision-required');
  if (
    (command.type === 'consent' &&
      auth &&
      v.consents[command.role]?.decisionId !== auth.decisionId) ||
    (v.withdrawalAuthority && v.withdrawalAuthority.decisionId !== auth?.decisionId)
  )
    throw Error('custody-collective-proof-mismatch');
  if (!live(w, v.nextCarrierId)) throw Error('custody-successor-unavailable');
  for (const [role, consent] of Object.entries(v.consents)) {
    const r = role as keyof typeof v.principals,
      principal = v.principals[r];
    if (principal?.kind === 'collective') {
      if (
        !s.custody.collectiveGrantsVersion ||
        !consent.decisionId ||
        (v.status === 'accepted' && !collective?.consentValid(v, r))
      )
        throw Error('custody-invalid-collective-consent');
    } else if (
      !principal ||
      principal.id !== consent.actorId ||
      consent.decisionId ||
      (v.status === 'accepted' && !live(w, consent.actorId))
    )
      throw Error('custody-invalid-personal-consent');
  }
  if (v.status === 'accepted') {
    const failure = freightCustodyTakingFailure(
      w,
      f,
      v.previousCarrierId,
      v.nextCarrierId,
      v.vehicleId,
    );
    if (failure) throw Error(failure);
  }
  return {
    ...w,
    logistics: { ...s, custody: applyFreightCustodyEvent(s.custody, f, packet.event) },
  };
}
