import {
  advanceMobility,
  decideMobility,
  type MobilityCommand,
  type MobilityDecision,
  type MobilityEvent,
  type MobilityPorts,
  type Journey,
} from '@aivilization/mobility';
import { asAgentId, asLocationId, createEventEnvelope } from '@aivilization/sim-core';
import {
  EXCLUSIVE_AGENT_ACTIVITY_TIME_POLICY_VERSION,
  type AgentActivityTimeCommittedPayload,
  type WorldEvent,
} from './events';
import { applyWorldEvent, type WorldProjection } from './projection';
import { resolveSpatialRoute, TOWN_SPATIAL_GRAPH_POLICY_VERSION } from './spatial';
import { residentCommerceEvent } from './residentCommerce';
export type ResidentMobilityPayload = {
  readonly policyVersion: 'resident-mobility-v1';
  readonly events: readonly MobilityEvent[];
};
type Input = {
  readonly projection: WorldProjection;
  readonly simulationId: string;
  readonly requestId: string;
  readonly nextSequence: number;
};
function route(w: WorldProjection, people: readonly string[], from: string, to: string) {
  const target = w.locations[to];
  if (
    !target ||
    people.some(
      (id) =>
        !w.agents[id] ||
        w.agents[id].locationId !== from ||
        w.transitByAgent?.[id] ||
        (w.activityTimeByAgent[id]?.availableAt ?? 0) > w.clock.now,
    )
  )
    return null;
  const usage =
    Object.values(w.agents).filter((a) => a.locationId === to).length +
    Object.values(w.transitByAgent ?? {}).filter((t) => t.toLocationId === to).length;
  if (target.capacity !== null && usage + people.length > target.capacity) return null;
  const value = resolveSpatialRoute({
    locations: w.locations,
    fromLocationId: asLocationId(from),
    toLocationId: asLocationId(to),
    destinationOccupancy: usage,
    activeTransits: Object.values(w.transitByAgent ?? {}),
  });
  return value && value.travelDurationSeconds > 0 ? value : null;
}
function ports(w: WorldProjection): MobilityPorts {
  return {
    exists: (id) => Object.hasOwn(w.agents, id),
    location: (id) => w.agents[id]?.locationId ?? null,
    idle: (id) =>
      !w.transitByAgent?.[id] && (w.activityTimeByAgent[id]?.availableAt ?? 0) <= w.clock.now,
    destinationExists: (id) => Object.hasOwn(w.locations, id),
    arrivalAt: (people, from, to) => {
      const r = route(w, people, from, to);
      return r ? w.clock.now + r.travelDurationSeconds * 1000 : null;
    },
  };
}
function journeyEvents(input: Input, j: Journey): WorldEvent[] {
  const w = input.projection,
    r = route(w, j.people, j.from, j.to);
  if (!r || w.clock.now + r.travelDurationSeconds * 1000 !== j.arrivesAt)
    throw Error('mobility-route-mismatch');
  const events: WorldEvent[] = [];
  for (const id of j.people) {
    events.push(
      createEventEnvelope({
        id: `${input.requestId}:travel:${id}`,
        simulationId: input.simulationId,
        sequence: input.nextSequence + events.length,
        occurredAt: w.clock.now,
        type: 'AgentTravelStarted',
        payload: {
          agentId: asAgentId(id),
          fromLocationId: asLocationId(j.from),
          toLocationId: asLocationId(j.to),
          routeLocationIds: r.locationIds,
          spatialPolicyVersion: TOWN_SPATIAL_GRAPH_POLICY_VERSION,
          baseTravelDurationSeconds: r.baseTravelDurationSeconds,
          congestionMultiplier: r.congestionMultiplier,
          edgeCongestionMultiplier: r.edgeCongestionMultiplier,
          destinationCongestionMultiplier: r.destinationCongestionMultiplier,
          routeEdgeFlows: r.edgeFlows,
          travelDurationSeconds: r.travelDurationSeconds,
          departedAt: j.departedAt,
          arrivesAt: j.arrivesAt,
          reason: 'resident-ride',
        },
      }),
    );
    const activityPayload: AgentActivityTimeCommittedPayload = {
      agentId: asAgentId(id),
      activity: 'travel',
      commandType: 'AgentMoveTo',
      policyVersion: EXCLUSIVE_AGENT_ACTIVITY_TIME_POLICY_VERSION,
      settlementTiming: 'effects-at-completion',
      startedAt: j.departedAt,
      durationSeconds: r.travelDurationSeconds,
      availableAt: j.arrivesAt,
    };
    events.push(
      createEventEnvelope({
        id: `${input.requestId}:activity:${id}`,
        simulationId: input.simulationId,
        sequence: input.nextSequence + events.length,
        occurredAt: w.clock.now,
        type: 'AgentActivityTimeCommitted',
        payload: activityPayload,
      }),
    );
  }
  return events;
}
function integrate(
  input: Input,
  d: MobilityDecision,
): { accepted: true; events: readonly WorldEvent[] } | { accepted: false; reason: string } {
  if (!d.accepted) return d;
  const events: WorldEvent[] = [];
  let working = input.projection;
  const append = (batch: readonly WorldEvent[]) => {
    for (const e of batch) {
      working = applyWorldEvent(working, e);
      events.push(e);
    }
  };
  for (const effect of d.fares) {
    const r = effect.ride,
      id = `ride-deposit-${r.id}`;
    if (!r.driverId || r.fare === undefined) throw Error('mobility-fare-contract-missing');
    const result = residentCommerceEvent({
      projection: working,
      simulationId: input.simulationId,
      requestId: `${input.requestId}:fare:${r.id}`,
      nextSequence: input.nextSequence + events.length,
      mobilitySettlementId: id,
      actorId: effect.kind === 'refund' ? r.driverId : r.riderId,
      command:
        effect.kind === 'fund'
          ? {
              type: 'deposits.lock',
              id,
              beneficiaryId: r.driverId,
              amount: r.fare,
              purpose: `Fixed agreed fare for ride ${r.id}`,
            }
          : {
              type: effect.kind === 'pay' ? 'deposits.settle' : 'deposits.release',
              id,
              expectedRevision: working.residentCommerce?.deposits[id]?.revision ?? 0,
            },
    });
    if (!result.accepted) return result;
    append(result.events);
  }
  for (const e of d.events)
    if (
      e.type === 'VehicleChanged' &&
      e.value.journey &&
      e.value.journey !== input.projection.residentMobility?.vehicles[e.value.id]?.journey
    ) {
      append(
        journeyEvents(
          {
            ...input,
            projection: working,
            nextSequence: input.nextSequence + events.length,
            requestId: `${input.requestId}:${e.value.id}`,
          },
          e.value.journey,
        ),
      );
    }
  if (d.events.length)
    append([
      createEventEnvelope({
        id: `${input.requestId}:mobility`,
        simulationId: input.simulationId,
        sequence: input.nextSequence + events.length,
        occurredAt: working.clock.now,
        type: 'ResidentMobilityCommitted',
        payload: { policyVersion: 'resident-mobility-v1' as const, events: d.events },
      }),
    ]);
  return { accepted: true, events };
}
export function residentMobilityCommand(
  input: Input & { readonly actorId: string; readonly command: MobilityCommand },
) {
  const s = input.projection.residentMobility;
  if (!s) return { accepted: false as const, reason: 'mobility-not-enabled' };
  return integrate(
    input,
    decideMobility(
      s,
      input.actorId,
      input.projection.clock.now,
      input.command,
      ports(input.projection),
    ),
  );
}
export function advanceResidentMobility(input: Input): readonly WorldEvent[] {
  const s = input.projection.residentMobility;
  if (!s) return [];
  const result = integrate(
    input,
    advanceMobility(s, input.projection.clock.now, ports(input.projection)),
  );
  if (!result.accepted) throw Error(`mobility-settlement-failed:${result.reason}`);
  return result.events;
}
