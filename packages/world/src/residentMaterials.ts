import { productionEmploymentWage } from '@aivilization/enterprise';
import type { PrincipalCollectivePort } from './principalCollectivePort';
import {
  authorizeWorldPrincipalOperation,
  worldPrincipalAvailable,
  type PublicPrincipalExecution,
} from './resourcePrincipalAuthority';
import {
  decideMaterialStock,
  interruptMaterialProduction,
  MATERIAL_EXPERTISE_POLICY,
  MATERIAL_REGROWTH_POLICY,
  regrowMaterialSources,
  MATERIAL_INTERRUPTION_VERSION,
  materialSourceWorkAvailable,
  decideMaterialProduction,
  settleMaterialProduction,
  offerMaterialReservation,
  offerPrincipalMaterialReservation,
  type PrincipalMaterialReservationCommand,
  returnUnboundMaterialReservation,
  type MaterialReservationOffer,
  type MaterialPorts,
  type MaterialCommand,
  type MaterialDecision,
  type MaterialEvent,
  type MaterialsPolicy,
  type MaterialProduction,
} from '@aivilization/materials';
import { createEventEnvelope, asAgentId } from '@aivilization/sim-core';
import {
  EXCLUSIVE_AGENT_ACTIVITY_TIME_POLICY_VERSION,
  type AgentActivityTimeCommittedPayload,
  type WorldEvent,
} from './events';
import type { WorldProjection } from './projection';
import { premisesStorageCapacity, premisesWorkstationCapacity } from '@aivilization/premises';
import {
  mayOperateWorldPremises,
  mayStoreWorldPremises,
  worldPremisesUseUntil,
} from './premisesAccess';
import type { ProductiveBodyFact, ProductiveMaterialEmployment } from './productiveEmploymentModel';
import { prepareProductiveCompensation, productionEmployer } from './productiveCompensation';
import type { WorldCommandPolicies } from './agentActions';
export function materialWorkstationAvailable(
  w: WorldProjection,
  id: string,
  actorId: string,
  locationId: string,
) {
  if (w.materials?.productions[id]?.sourceId)
    return materialSourceWorkAvailable(w.materials, id, actorId, w.clock.now);
  const capacity = w.premises ? premisesWorkstationCapacity(w.premises, locationId) : undefined;
  if (capacity === undefined) return true;
  // A committed personal session already holds its station; later non-overlapping work must not erase past labor.
  const held = w.materials?.productions[id]?.session;
  if (held?.actorId === actorId)
    return (
      capacity > 0 &&
      (w.premisesRights
        ? worldPremisesUseUntil(w, actorId, locationId, 'operate', held.settledAt) >=
          Math.min(w.clock.now, held.until)
        : mayOperateWorldPremises(w, actorId, locationId))
    );
  const active = activeMaterialWorkstations(w, locationId, id);
  return mayOperateWorldPremises(w, actorId, locationId) && active < capacity;
}
export function activeMaterialWorkstations(
  w: WorldProjection,
  locationId: string,
  excludeProductionId?: string,
) {
  return Object.values(w.materials?.productions ?? {}).filter(
    (p) =>
      !p.sourceId &&
      p.id !== excludeProductionId &&
      p.session &&
      p.session.until > w.clock.now &&
      w.materials?.stocks[p.stockId]?.locationId === locationId,
  ).length;
}
export type MaterialEmploymentInterruption = {
  readonly version: 'resident-material-employment-interruption-v1';
  readonly productionId: string;
  readonly workerId: string;
  readonly enterpriseId: string;
};
export type ResidentMaterialsPayload = {
  readonly interruption?: MaterialEmploymentInterruption;
  readonly employment?: ProductiveMaterialEmployment;
  readonly elapsedBody?: ProductiveBodyFact;
  readonly policyVersion: 'resident-materials-v1';
  readonly events: readonly MaterialEvent[];
  readonly reservation?: AgentActivityTimeCommittedPayload;
  readonly release?: {
    readonly actorId: string;
    readonly startedAt: number;
    readonly previousAvailableAt: number;
    readonly endedAt: number;
  };
};
export type MaterialAuthorization = Pick<
  MaterialPorts,
  'authorize' | 'controlAvailable' | 'hasExternalObligation' | 'mayStoreAt'
>;
export function materialSessionReserved(w: WorldProjection, job: MaterialProduction): boolean {
  const session = job.session,
    a = session && w.activityTimeByAgent[session.actorId];
  return (
    !!session &&
    !!a &&
    a.commandType === 'ResidentMaterialWork' &&
    a.startedAt === session.startedAt &&
    a.availableAt === session.until
  );
}
function ports(w: WorldProjection, auth: MaterialAuthorization): MaterialPorts {
  return {
    ...auth,
    mayStoreAt: (actor, location) =>
      w.premisesRights
        ? mayStoreWorldPremises(w, actor, location)
        : auth.mayStoreAt(actor, location),
    ...(w.premisesRights
      ? {
          mayWorkAt: (actor: string, location: string) =>
            mayOperateWorldPremises(w, actor, location),
        }
      : {}),
    locationStorageCapacity: (id) =>
      w.premises ? premisesStorageCapacity(w.premises, id) : undefined,
    workstationAvailable: (id, actor, location) =>
      materialWorkstationAvailable(w, id, actor, location),
    exists: (id) => !!w.agents[id],
    inventory: (id) => w.agents[id]?.inventory ?? {},
    present: (id, loc) => w.agents[id]?.locationId === loc && !w.transitByAgent?.[id],
    idle: (id) =>
      (w.activityTimeByAgent[id]?.availableAt ?? 0) <= w.clock.now && !w.transitByAgent?.[id],
    body: (id) => {
      const a = w.agents[id];
      return a
        ? {
            energy: a.physiology.energy,
            satiety: a.physiology.satiety,
            residentialTier: a.residentialTier,
            capable: a.physiology.health > 0,
          }
        : undefined;
    },
    sessionReserved: (j) => materialSessionReserved(w, j),
  };
}
type Context = {
  readonly interruption?: MaterialEmploymentInterruption;
  readonly collective?: PrincipalCollectivePort;
  readonly publicPrincipalExecution?: PublicPrincipalExecution;
  readonly enterpriseId?: string;
  readonly policies?: WorldCommandPolicies;
  readonly elapsedBody?: ProductiveBodyFact;
  readonly projection: WorldProjection;
  readonly actorId: string;
  readonly requestId: string;
  readonly simulationId: string;
  readonly nextSequence: number;
  readonly authorization: MaterialAuthorization;
};
function wrap(input: Context, d: MaterialDecision) {
  if (!d.accepted) return d;
  const at = input.projection.clock.now;
  if (!d.events.length) return { accepted: true as const, events: [] };
  let employment: ProductiveMaterialEmployment | undefined;
  try {
    employment = prepareProductiveCompensation({
      authorize: input.authorization.authorize,
      projection: input.projection,
      events: d.events,
      actorId: input.actorId,
      eventId: `${input.requestId}:materials`,
      nextSequence: input.nextSequence,
      ...(input.enterpriseId ? { enterpriseId: input.enterpriseId } : {}),
      ...(input.policies ? { policies: input.policies } : {}),
    });
  } catch (error) {
    return {
      accepted: false as const,
      reason: error instanceof Error ? error.message : 'invalid-productive-employment',
    };
  }
  const reservation: AgentActivityTimeCommittedPayload | undefined = d.reservation
    ? {
        agentId: asAgentId(d.reservation.actorId),
        activity: 'production',
        commandType: 'ResidentMaterialWork',
        policyVersion: EXCLUSIVE_AGENT_ACTIVITY_TIME_POLICY_VERSION,
        settlementTiming: 'effects-at-completion',
        startedAt: at,
        durationSeconds: (d.reservation.until - at) / 1000,
        availableAt: d.reservation.until,
      }
    : undefined;
  return {
    accepted: true as const,
    events: [
      createEventEnvelope({
        id: `${input.requestId}:materials`,
        simulationId: input.simulationId,
        type: 'ResidentMaterialsCommitted',
        sequence: input.nextSequence,
        occurredAt: at,
        payload: {
          ...(employment ? { employment } : {}),
          ...(input.interruption ? { interruption: input.interruption } : {}),
          ...(input.elapsedBody ? { elapsedBody: input.elapsedBody } : {}),
          policyVersion: 'resident-materials-v1' as const,
          events: d.events,
          ...(reservation ? { reservation } : {}),
          ...(d.release && (input.elapsedBody?.endedAt ?? at) < d.release.until
            ? {
                release: {
                  actorId: d.release.actorId,
                  startedAt: d.release.startedAt,
                  previousAvailableAt: d.release.until,
                  endedAt: input.elapsedBody?.endedAt ?? at,
                },
              }
            : {}),
        },
      }),
    ],
  };
}
function principalPorts(input: Context): MaterialPorts {
  return {
    ...ports(input.projection, input.authorization),
    principalAvailable: (p) => worldPrincipalAvailable(input.projection, p, input.collective),
    authorizePrincipal: (principal, request) =>
      authorizeWorldPrincipalOperation(
        input.projection,
        input.actorId,
        principal,
        request,
        input.publicPrincipalExecution,
        input.collective,
      ),
  };
}
export function residentMaterialEvent(
  input: Context & { readonly command: MaterialCommand | PrincipalMaterialReservationCommand },
) {
  if (input.enterpriseId !== undefined && !input.enterpriseId.trim())
    return { accepted: false as const, reason: 'invalid-production-employer-id' };
  const s = input.projection.materials;
  if (!s) return { accepted: false as const, reason: 'materials-not-enabled' };
  const c = input.command,
    p = principalPorts(input),
    at = input.projection.clock.now;
  if (c.type === 'reserve-materials') {
    if (!input.projection.premises)
      return { accepted: false as const, reason: 'premises-not-enabled' };
    return wrap(
      input,
      offerPrincipalMaterialReservation(s, input.actorId, at, input.requestId, c.offer, p),
    );
  }
  if (c.type === 'reservation-withdrawn')
    return wrap(
      input,
      returnUnboundMaterialReservation(
        s,
        input.actorId,
        at,
        input.requestId,
        c.id,
        c.expectedRevision,
        p,
      ),
    );
  if (input.projection.premisesRights) {
    if (c.type === 'start-production') {
      const job = s.productions[c.id],
        stock = job && s.stocks[job.stockId];
      if (
        stock &&
        worldPremisesUseUntil(input.projection, input.actorId, stock.locationId, 'operate') <
          c.until
      )
        return { accepted: false as const, reason: 'production-permit-window-exceeded' };
    }
    if (c.type === 'deposit') {
      const stock = s.stocks[c.id];
      if (stock && !mayStoreWorldPremises(input.projection, input.actorId, stock.locationId))
        return { accepted: false as const, reason: 'material-storage-permit-required' };
    }
  }
  const d =
    c.type === 'create-production' ||
    c.type === 'create-extraction' ||
    c.type === 'start-production' ||
    c.type === 'leave-production' ||
    c.type === 'cancel-production'
      ? decideMaterialProduction(s, input.actorId, at, input.requestId, c, p)
      : decideMaterialStock(s, input.actorId, at, input.requestId, c, p);
  return wrap(input, d);
}
export function settleResidentMaterialEvent(input: Context & { readonly productionId: string }) {
  const s = input.projection.materials;
  if (!s) return { accepted: false as const, reason: 'materials-not-enabled' };
  return wrap(
    input,
    settleMaterialProduction(
      s,
      input.productionId,
      input.projection.clock.now,
      input.requestId,
      input.actorId,
      {
        ...ports(input.projection, input.authorization),
        ...(input.elapsedBody
          ? {
              settledWorkMs: () => input.elapsedBody!.workedMs,
              physicalWorkEndedAt: () => input.elapsedBody!.endedAt,
            }
          : {}),
      },
    ),
  );
}
export function residentMaterialReservationEvent(
  input: Context & {
    readonly command:
      | { readonly type: 'offer'; readonly offer: MaterialReservationOffer }
      | { readonly type: 'withdraw'; readonly id: string; readonly revision: number };
  },
) {
  const s = input.projection.materials;
  if (!s) return { accepted: false as const, reason: 'materials-not-enabled' };
  const p = principalPorts(input),
    at = input.projection.clock.now,
    c = input.command;
  return wrap(
    input,
    c.type === 'offer'
      ? offerMaterialReservation(s, input.actorId, at, input.requestId, c.offer, p)
      : returnUnboundMaterialReservation(
          s,
          input.actorId,
          at,
          input.requestId,
          c.id,
          c.revision,
          p,
        ),
  );
}
export function expireResidentMaterialReservationEvent(
  input: Context & { readonly reservationId: string },
) {
  const s = input.projection.materials,
    r = s?.reservations?.records[input.reservationId];
  if (!s || !r) return { accepted: false as const, reason: 'material-reservation-not-found' };
  return wrap(
    input,
    returnUnboundMaterialReservation(
      s,
      input.actorId,
      input.projection.clock.now,
      input.requestId,
      r.id,
      r.revision,
      ports(input.projection, input.authorization),
      true,
    ),
  );
}
export function enableResidentMaterialsEvent(input: {
  simulationId: string;
  requestId: string;
  nextSequence: number;
  at: number;
  policy: MaterialsPolicy;
}): WorldEvent {
  return createEventEnvelope({
    id: `${input.requestId}:materials-enabled`,
    simulationId: input.simulationId,
    type: 'ResidentMaterialsCommitted',
    sequence: input.nextSequence,
    occurredAt: input.at,
    payload: {
      policyVersion: 'resident-materials-v1' as const,
      events: [{ type: 'MaterialsEnabled' as const, policy: input.policy }],
    },
  });
}

/** Explicit, versioned opt-in for learning by doing and/or natural source regrowth. */
export function enableResidentMaterialGrowthEvent(input: {
  readonly simulationId: string;
  readonly requestId: string;
  readonly nextSequence: number;
  readonly at: number;
  readonly expertise: boolean;
  readonly regrowth: boolean;
}): WorldEvent {
  const events: MaterialEvent[] = [
    ...(input.expertise
      ? [{ type: 'MaterialExpertiseEnabled' as const, policy: MATERIAL_EXPERTISE_POLICY }]
      : []),
    ...(input.regrowth
      ? [
          {
            type: 'MaterialRegrowthEnabled' as const,
            policy: MATERIAL_REGROWTH_POLICY,
            at: input.at,
          },
        ]
      : []),
  ];
  if (!events.length) throw Error('material-growth-activation-empty');
  return createEventEnvelope({
    id: `${input.requestId}:material-growth-enabled`,
    simulationId: input.simulationId,
    type: 'ResidentMaterialsCommitted',
    sequence: input.nextSequence,
    occurredAt: input.at,
    payload: { policyVersion: 'resident-materials-v1' as const, events },
  });
}
/** Time-boundary regrowth of finite sources; empty when regrowth is not enabled. */
export function regrowResidentMaterialSourcesEvent(input: {
  readonly projection: WorldProjection;
  readonly simulationId: string;
  readonly requestId: string;
  readonly nextSequence: number;
}): readonly WorldEvent[] {
  const s = input.projection.materials,
    at = input.projection.clock.now;
  if (!s?.regrowth || at <= s.regrowth.lastAt) return [];
  return [
    createEventEnvelope({
      id: `${input.requestId}:material-regrowth`,
      simulationId: input.simulationId,
      type: 'ResidentMaterialsCommitted',
      sequence: input.nextSequence,
      occurredAt: at,
      payload: {
        policyVersion: 'resident-materials-v1' as const,
        events: regrowMaterialSources(s, at),
      },
    }),
  ];
}

export function assertResidentMaterialInterruption(
  w: WorldProjection,
  proof: MaterialEmploymentInterruption | undefined,
  events: readonly MaterialEvent[],
) {
  const receipts = events.filter(
    (e) =>
      e.type === 'MaterialReceiptRecorded' && e.receipt.operation === MATERIAL_INTERRUPTION_VERSION,
  );
  if (!proof && !receipts.length) return;
  if (
    !proof ||
    receipts.length !== 1 ||
    proof.version !== 'resident-material-employment-interruption-v1'
  )
    throw Error('material-interruption-proof-required');
  const job = w.materials?.productions[proof.productionId],
    employer = productionEmployer(w, proof.productionId),
    actor = w.agents[proof.workerId];
  if (
    !w.productiveEmployment ||
    !job?.session ||
    job.session.actorId !== proof.workerId ||
    job.session.settledAt !== w.clock.now ||
    !actor ||
    !employer ||
    employer.enterpriseId !== proof.enterpriseId ||
    (productionEmploymentWage(employer, job.id, asAgentId(proof.workerId), w.clock.now, true) !==
      undefined &&
      actor.physiology.health > 0) ||
    receipts.some(
      (e) =>
        e.type !== 'MaterialReceiptRecorded' ||
        e.receipt.productionId !== job.id ||
        e.receipt.at !== w.clock.now ||
        e.receipt.actorId !== 'system',
    )
  )
    throw Error('material-interruption-actual-unavailability-required');
}
/** Internal lifecycle port, not the resident's voluntary leave command. */
export function interruptResidentEmployedMaterialEvent(
  input: Omit<Context, 'actorId' | 'interruption'> & { readonly productionId: string },
) {
  const w = input.projection,
    job = w.materials?.productions[input.productionId],
    employer = productionEmployer(w, input.productionId);
  if (!w.materials || !job?.session || !employer)
    return { accepted: false as const, reason: 'active-employed-material-work-required' };
  const interruption: MaterialEmploymentInterruption = {
    version: 'resident-material-employment-interruption-v1',
    productionId: job.id,
    workerId: job.session.actorId,
    enterpriseId: employer.enterpriseId,
  };
  const d = interruptMaterialProduction(w.materials, job.id, w.clock.now, input.requestId);
  if (!d.accepted) return d;
  assertResidentMaterialInterruption(w, interruption, d.events);
  return wrap({ ...input, actorId: 'system', interruption }, d);
}
