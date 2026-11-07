import {
  assertResidentDepartureActivitySource,
  type ResidentDepartureActivitySource,
} from './residentDepartureActivitySource';
import type { PrincipalCollectivePort } from './principalCollectivePort';
import {
  authorizeWorldPrincipalOperation,
  worldPrincipalAvailable,
  type PublicPrincipalExecution,
} from './resourcePrincipalAuthority';
import {
  createConstruction,
  startConstruction,
  interruptConstruction,
  progressConstruction,
  finalizeConstruction,
  recordConstructionSettlementBlock,
  managePremises,
  agePremises,
  applyPremisesEvent,
  applyPremisesCommit,
  initialPublicSiteGrant,
  premisesHasPermitObligations,
  type PremisesPorts,
  type PremisesEvent,
  type ConstructionProject,
  type ConstructionWorkDecision,
  type ConstructionEffort,
  type CreateConstruction,
  type PrincipalCreateConstruction,
  type PremisesCommand,
  type ConstructionSite,
  type PremisesPolicy,
  type PublicLandUsePolicy,
  type PremisesFacilityUsePolicy,
} from '@aivilization/premises';
import {
  applyMaterialCommit,
  settleConsumerMaterials,
  MATERIAL_RESERVATIONS_POLICY,
  type MaterialEvent,
} from '@aivilization/materials';
import { asAgentId, createEventEnvelope } from '@aivilization/sim-core';
import { resolveAgentResidenceLocationId, type WorldProjection } from './projection';
import { settleResidentPremisesProvisions } from './residentPremisesProvision';
import {
  EXCLUSIVE_AGENT_ACTIVITY_TIME_POLICY_VERSION,
  type AgentActivityTimeCommittedPayload,
} from './events';
export type ResidentPremisesPayload = {
  readonly departure?: ResidentDepartureActivitySource;
  readonly policyVersion: 'resident-premises-v1';
  readonly events: readonly PremisesEvent[];
  readonly materialEvents: readonly MaterialEvent[];
  readonly efforts: readonly ConstructionEffort[];
  readonly reservation?: AgentActivityTimeCommittedPayload;
  readonly release?: {
    readonly actorId: string;
    readonly startedAt: number;
    readonly previousAvailableAt: number;
    readonly endedAt: number;
  };
};
export type PremisesAuthorization = Pick<PremisesPorts, 'authorize' | 'controlAvailable'> & {
  readonly additionalObligations: (buildingId: string) => boolean;
  readonly siteGrant?: PremisesPorts['siteGrant'];
};
export function constructionSessionReserved(w: WorldProjection, p: ConstructionProject) {
  const s = p.session,
    a = s && w.activityTimeByAgent[s.actorId];
  return (
    !!s &&
    !!a &&
    a.commandType === 'ResidentConstructionWork' &&
    a.startedAt === s.startedAt &&
    a.availableAt === s.until
  );
}
export function premisesOccupancy(w: WorldProjection, id: string) {
  const b = w.premises?.buildings[id];
  if (!b) return 0;
  return (
    Object.values(w.agents).filter(
      (a) =>
        a.locationId === b.locationId || resolveAgentResidenceLocationId(w, a) === b.locationId,
    ).length +
    Object.values(w.transitByAgent ?? {}).filter((t) => t.toLocationId === b.locationId).length
  );
}
export function premisesWorldObligations(w: WorldProjection, id: string) {
  const b = w.premises?.buildings[id];
  if (!b) return false;
  return (
    premisesHasPermitObligations(w.premisesRights, id, w.clock.now) ||
    Object.values(w.serviceEngagements?.engagements ?? {}).some(
      (e) => e.locationId === b.locationId && ['accepted', 'funded'].includes(e.status),
    ) ||
    Object.values(w.materials?.stocks ?? {}).some(
      (s) => s.locationId === b.locationId && s.status !== 'closed',
    ) ||
    Object.values(w.residentLeases?.leases ?? {}).some(
      (l) => l.locationId === b.locationId && l.status !== 'ended',
    )
  );
}
function ports(w: WorldProjection, auth: PremisesAuthorization): PremisesPorts {
  return {
    exists: (id) => !!w.agents[id],
    present: (id, loc) => w.agents[id]?.locationId === loc && !w.transitByAgent?.[id],
    idle: (id) =>
      (w.activityTimeByAgent[id]?.availableAt ?? 0) <= w.clock.now && !w.transitByAgent?.[id],
    body: (id) => {
      const a = w.agents[id];
      return a
        ? {
            energy: a.physiology.energy,
            satiety: a.physiology.satiety,
            capable: a.physiology.health > 0,
          }
        : undefined;
    },
    reservation: (id) => w.materials?.reservations?.records[id],
    stockLocation: (id) => w.materials?.stocks[id]?.locationId,
    authorize: auth.authorize,
    controlAvailable: auth.controlAvailable,
    siteGrant:
      auth.siteGrant ??
      ((site, controller) =>
        w.premises ? initialPublicSiteGrant(w.premises, site, controller) : undefined),
    occupiedOrReserved: (id) => premisesOccupancy(w, id),
    hasObligations: (id) => premisesWorldObligations(w, id) || auth.additionalObligations(id),
    sessionReserved: (p) => constructionSessionReserved(w, p),
  };
}
type Context = {
  readonly departure?: ResidentDepartureActivitySource;
  readonly projection: WorldProjection;
  readonly actorId: string;
  readonly collective?: PrincipalCollectivePort;
  readonly publicPrincipalExecution?: PublicPrincipalExecution;
  readonly principal?: boolean;
  readonly requestId: string;
  readonly simulationId: string;
  readonly nextSequence: number;
  readonly authorization: PremisesAuthorization;
};
function principalPremisesPorts(input: Context): PremisesPorts {
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
const no = (reason: string) => ({ accepted: false as const, reason });
function wrap(input: Context, d: ConstructionWorkDecision) {
  if (!d.accepted) return d;
  if (!d.events.length) return { accepted: true as const, events: [] };
  const w = input.projection,
    at = w.clock.now;
  const efforts = d.effort ? [d.effort] : [],
    physical = applyPremisesCommit(w.premises, d.events, efforts),
    materialEvents: MaterialEvent[] = [];
  let materials = w.materials;
  if (!materials?.reservations) return no('construction-material-reservations-not-enabled');
  for (const [i, a] of d.materials.entries()) {
    const result = settleConsumerMaterials(
      materials,
      input.actorId,
      at,
      `${input.requestId}-m${i}`,
      a.reservationId,
      a.expectedRevision,
      a.authorization,
    );
    if (!result.accepted) return result;
    materials = applyMaterialCommit(
      materials,
      result.events,
      physical.allocations.filter((v) => v.reservationId === a.reservationId),
    ).state;
    materialEvents.push(...result.events);
  }
  const reservation: AgentActivityTimeCommittedPayload | undefined = d.reservation
    ? {
        agentId: asAgentId(d.reservation.actorId),
        activity: 'production',
        commandType: 'ResidentConstructionWork',
        policyVersion: EXCLUSIVE_AGENT_ACTIVITY_TIME_POLICY_VERSION,
        settlementTiming: 'effects-at-completion',
        startedAt: at,
        availableAt: d.reservation.until,
        durationSeconds: (d.reservation.until - at) / 1000,
      }
    : undefined;
  const payload: ResidentPremisesPayload = {
    policyVersion: 'resident-premises-v1',
    ...(input.departure ? { departure: input.departure } : {}),
    events: d.events,
    materialEvents,
    efforts,
    ...(reservation ? { reservation } : {}),
    ...(d.release && at < d.release.until
      ? {
          release: {
            actorId: d.release.actorId,
            startedAt: d.release.startedAt,
            previousAvailableAt: d.release.until,
            endedAt: at,
          },
        }
      : {}),
  };
  const provisionEvents = settleResidentPremisesProvisions({
    ...input,
    buildingIds: d.events.flatMap((e) =>
      e.type === 'PremisesBuildingChanged' ? [e.building.id] : [],
    ),
  });
  return {
    accepted: true as const,
    events: [
      ...provisionEvents,
      createEventEnvelope({
        id: `${input.requestId}:premises`,
        simulationId: input.simulationId,
        type: 'ResidentPremisesCommitted',
        sequence: input.nextSequence + provisionEvents.length,
        occurredAt: at,
        payload,
      }),
    ],
  };
}
export type ResidentConstructionCommand =
  | {
      readonly type: 'create';
      readonly construction: CreateConstruction | PrincipalCreateConstruction;
    }
  | {
      readonly type: 'start';
      readonly id: string;
      readonly revision: number;
      readonly until: number;
    }
  | {
      readonly type: 'leave' | 'cancel' | 'finish';
      readonly id: string;
      readonly revision: number;
    };
export function residentConstructionEvent(
  input: Context & { readonly command: ResidentConstructionCommand },
) {
  const s = input.projection.premises,
    c = input.command,
    at = input.projection.clock.now;
  if (!s) return no('premises-not-enabled');
  const p = principalPremisesPorts(input);
  if (c.type === 'create') {
    if (
      (c.construction.kind === 'modify' || c.construction.kind === 'demolish') &&
      premisesHasPermitObligations(input.projection.premisesRights, c.construction.buildingId, at)
    )
      return no('premises-use-rights-unsettled');
    const site = s.sites[c.construction.siteId];
    if (!site || !input.projection.locations[site.parentLocationId]?.connections)
      return no('construction-site-graph-required');
    if (
      c.construction.kind === 'build' &&
      input.projection.locations[`premises-${c.construction.buildingId}`]
    )
      return no('construction-location-id-unavailable');
    if (c.construction.kind === 'modify') {
      const b = s.buildings[c.construction.buildingId];
      if (
        b &&
        b.blueprint.primaryUse !== c.construction.blueprint.primaryUse &&
        (p.occupiedOrReserved(b.id) > 0 || p.hasObligations(b.id))
      )
        return no('premises-unsettled');
    }
    return wrap(
      input,
      createConstruction(
        s,
        input.actorId,
        at,
        input.requestId,
        c.construction,
        p,
        input.principal ?? false,
      ),
    );
  }
  if (s.projects[c.id]?.revision !== c.revision) return no('construction-revision-conflict');
  if (c.type === 'start')
    return wrap(input, startConstruction(s, input.actorId, at, c.id, c.revision, c.until, p));
  if (c.type === 'finish')
    return wrap(input, finalizeConstruction(s, input.actorId, at, c.id, input.requestId, p));
  return settle(input, c.id, c.type);
}
function settle(input: Context, id: string, mode: 'tick' | 'leave' | 'cancel') {
  const s = input.projection.premises;
  if (!s) return no('premises-not-enabled');
  const at = input.projection.clock.now,
    p = principalPremisesPorts(input),
    d = progressConstruction(s, input.actorId, at, id, input.requestId, p, mode);
  if (!d.accepted) return d;
  const interim = d.events.reduce(applyPremisesEvent, s),
    project = interim.projects[id];
  if (!project || (mode !== 'cancel' && project.progressMs !== project.plan.workMs))
    return wrap(input, d);
  const f = finalizeConstruction(
    interim,
    input.actorId,
    at,
    id,
    input.requestId,
    p,
    mode === 'cancel',
    d.events.find((e) => e.type === 'PremisesPrincipalOperationRecorded')?.receipt.authorization,
  );
  if (f.accepted)
    return wrap(input, {
      ...d,
      events: [...d.events, ...f.events],
      materials: [...d.materials, ...f.materials],
    });
  if (mode !== 'tick') return f;
  const blocked = recordConstructionSettlementBlock(interim, id, at, f.reason);
  return blocked.accepted
    ? wrap(input, { ...d, events: [...d.events, ...blocked.events] })
    : blocked;
}
export function settleResidentConstructionEvent(input: Context & { readonly projectId: string }) {
  return settle(input, input.projectId, 'tick');
}
export function residentPremisesEvent(
  input: Context & {
    readonly id: string;
    readonly revision: number;
    readonly command: PremisesCommand;
  },
) {
  const s = input.projection.premises;
  if (!s) return no('premises-not-enabled');
  return wrap(
    input,
    managePremises(
      s,
      input.actorId,
      input.projection.clock.now,
      input.id,
      input.revision,
      input.command,
      principalPremisesPorts(input),
    ),
  );
}
export function ageResidentPremisesEvent(input: Context) {
  const s = input.projection.premises;
  return s ? wrap(input, agePremises(s, input.projection.clock.now)) : no('premises-not-enabled');
}
export function enableResidentPremisesEvent(
  input: Omit<Context, 'actorId' | 'authorization'> & {
    readonly policy: PremisesPolicy;
    readonly landUsePolicy: PublicLandUsePolicy;
    readonly sites: readonly ConstructionSite[];
    readonly facilityUsePolicy?: PremisesFacilityUsePolicy;
  },
) {
  const w = input.projection;
  if (w.premises) return no('premises-already-enabled');
  if (!w.materials) return no('materials-not-enabled');
  if (
    input.sites.length > input.policy.maxSites ||
    input.sites.some((s) => !w.locations[s.parentLocationId]?.connections)
  )
    return no('construction-site-graph-required');
  const payload: ResidentPremisesPayload = {
    policyVersion: 'resident-premises-v1',
    efforts: [],
    events: [
      { type: 'PremisesEnabled', policy: input.policy, landUsePolicy: input.landUsePolicy },
      ...(input.facilityUsePolicy
        ? [{ type: 'PremisesFacilityUseEnabled' as const, policy: input.facilityUsePolicy }]
        : []),
      ...input.sites.map((site) => ({ type: 'ConstructionSiteRegistered' as const, site })),
    ],
    materialEvents: w.materials.reservations
      ? []
      : [{ type: 'MaterialReservationsEnabled', policy: MATERIAL_RESERVATIONS_POLICY }],
  };
  applyPremisesCommit(undefined, payload.events);
  return {
    accepted: true as const,
    events: [
      createEventEnvelope({
        id: `${input.requestId}:premises-enabled`,
        simulationId: input.simulationId,
        type: 'ResidentPremisesCommitted',
        sequence: input.nextSequence,
        occurredAt: w.clock.now,
        payload,
      }),
    ],
  };
}
/** Explicit operator migration of finite geometry. This is not a resident capability or a land-use grant. */
export function registerConstructionSiteEvent(
  input: Omit<Context, 'actorId' | 'authorization'> & { readonly site: ConstructionSite },
) {
  const s = input.projection.premises;
  if (!s) return no('premises-not-enabled');
  if (
    input.site.source !== 'authorized-extension' ||
    Object.keys(s.sites).length >= s.policy.maxSites ||
    !input.projection.locations[input.site.parentLocationId]?.connections
  )
    return no('invalid-construction-site-extension');
  const payload: ResidentPremisesPayload = {
    policyVersion: s.policy.version,
    events: [{ type: 'ConstructionSiteRegistered', site: input.site }],
    materialEvents: [],
    efforts: [],
  };
  applyPremisesCommit(s, payload.events);
  return {
    accepted: true as const,
    events: [
      createEventEnvelope({
        id: `${input.requestId}:site`,
        simulationId: input.simulationId,
        type: 'ResidentPremisesCommitted',
        sequence: input.nextSequence,
        occurredAt: input.projection.clock.now,
        payload,
      }),
    ],
  };
}

export function interruptResidentConstructionForDeparture(
  input: Omit<Context, 'actorId'> & {
    readonly projectId: string;
    readonly departure: ResidentDepartureActivitySource;
  },
) {
  const w = input.projection,
    s = w.premises,
    p = s?.projects[input.projectId];
  assertResidentDepartureActivitySource(w, input.departure, input.departure.actorId, w.clock.now);
  if (!s || p?.session?.actorId !== input.departure.actorId)
    return no('departure-construction-source-mismatch');
  return wrap({ ...input, actorId: 'system' }, interruptConstruction(s, p.id, w.clock.now));
}
