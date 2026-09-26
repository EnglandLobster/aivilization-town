import {
  emptyResidentLeaseState,
  decideResidentLease,
  nextLeaseBoundary,
  settleLeaseBoundary,
  type ResidentLeaseCommand,
  type ResidentLeaseEvent,
  type LeaseSettlement,
} from '@aivilization/society';
import type { CommerceCommand } from '@aivilization/commerce';
import { asLocationId, createCommandEnvelope, createEventEnvelope } from '@aivilization/sim-core';
import {
  applyWorldEvent,
  resolveAgentResidenceLocationId,
  resolveResidentialOccupancy,
  type WorldProjection,
} from './projection';
import { dispatchWorldCommand, type WorldCommandPolicies } from './agentActions';
import { residentCommerceEvent } from './residentCommerce';
import type { WorldEvent } from './events';
type LeaseApplication = {
  projection: WorldProjection;
  simulationId: string;
  requestId: string;
  nextSequence: number;
  policies: WorldCommandPolicies;
};
function settle(
  input: LeaseApplication,
  event: ResidentLeaseEvent,
  settlement: LeaseSettlement | undefined,
): { accepted: true; events: readonly WorldEvent[] } | { accepted: false; reason: string } {
  let w = input.projection;
  const events: WorldEvent[] = [];
  const append = (es: readonly WorldEvent[]) => {
    for (const e of es) {
      w = applyWorldEvent(w, e);
      events.push(e);
    }
  };
  if (settlement) {
    const t = settlement;
    const transact = (actorId: string, command: CommerceCommand) => {
      const d = residentCommerceEvent({
        projection: w,
        actorId,
        command,
        leaseSettlementId: t.depositId,
        simulationId: input.simulationId,
        requestId: input.requestId + '-' + events.length,
        nextSequence: input.nextSequence + events.length,
      });
      if (d.accepted) append(d.events);
      return d;
    };
    if (t.rent > 0) {
      const d = transact(t.payerId, {
        type: 'payments.transfer',
        targetId: t.hostId,
        amount: t.rent,
        note: `Authorized lease ${event.lease.id}`,
      });
      if (!d.accepted) return d;
    }
    if (t.depositAction === 'lock') {
      const d = transact(t.payerId, {
        type: 'deposits.lock',
        id: t.depositId,
        beneficiaryId: t.hostId,
        amount: t.deposit,
        purpose: `Refundable lease ${event.lease.id}`,
      });
      if (!d.accepted) return d;
    }
    if (t.depositAction === 'return') {
      const deposit = w.residentCommerce?.deposits[t.depositId];
      if (!deposit || deposit.status !== 'held')
        return { accepted: false, reason: 'lease-deposit-not-held' };
      // The accepted lease authorizes unconditional return at termination, including expiry.
      const d = transact(t.hostId, {
        type: 'deposits.release',
        id: t.depositId,
        expectedRevision: deposit.revision,
      });
      if (!d.accepted) return d;
    }
    if (t.locationId && resolveAgentResidenceLocationId(w, w.agents[t.payerId]!) !== t.locationId) {
      const es = dispatchWorldCommand({
        projection: w,
        policies: input.policies,
        nextSequence: input.nextSequence + events.length,
        command: createCommandEnvelope({
          id: input.requestId + '-residence',
          simulationId: input.simulationId,
          actorId: t.payerId,
          type: 'AgentChooseResidence',
          source: 'agent-runtime',
          issuedAt: w.clock.now,
          payload: { locationId: asLocationId(t.locationId) },
        }),
      });
      const rejected = es.find((e) => e.type === 'ActionRejected');
      if (rejected) return { accepted: false, reason: rejected.payload.reason };
      append(es);
    }
  }
  append([
    createEventEnvelope({
      id: input.requestId + ':lease',
      simulationId: input.simulationId,
      type: 'ResidentLeaseChanged',
      sequence: input.nextSequence + events.length,
      occurredAt: w.clock.now,
      payload: { lease: event.lease, policyVersion: 'resident-leases-v1' },
    }),
  ]);
  return { accepted: true, events };
}
export function residentLeaseCommand(
  input: LeaseApplication & { actorId: string; command: ResidentLeaseCommand },
): { accepted: true; events: readonly WorldEvent[] } | { accepted: false; reason: string } {
  const w = input.projection;
  if (!w.residentCommerce) return { accepted: false, reason: 'life-not-enabled' };
  const d = decideResidentLease(
    w.residentLeases ?? emptyResidentLeaseState(),
    input.actorId,
    w.clock.now,
    input.command,
    {
      exists: (id) => Object.hasOwn(w.agents, id),
      residence: (id) =>
        w.agents[id] ? (resolveAgentResidenceLocationId(w, w.agents[id]) ?? undefined) : undefined,
      canMoveIn: (id, location) => {
        const l = w.locations[location],
          a = w.agents[id];
        return (
          !!a &&
          l?.kind === 'residence' &&
          a.locationId === location &&
          !w.transitByAgent?.[id] &&
          (w.activityTimeByAgent[id]?.availableAt ?? 0) <= w.clock.now &&
          (resolveAgentResidenceLocationId(w, a) === location ||
            l.capacity === null ||
            resolveResidentialOccupancy(w, l.locationId) < l.capacity)
        );
      },
    },
  );
  if (!d.accepted) return d;
  return settle(input, d.events[0]!, d.settlement);
}
export function nextResidentLeaseBoundary(w: WorldProjection): number | undefined {
  const values = Object.values(w.residentLeases?.leases ?? {}).flatMap((l) => {
    const at = nextLeaseBoundary(l);
    return at === undefined ? [] : [at];
  });
  return values.length ? Math.min(...values) : undefined;
}
export function advanceResidentLeases(input: LeaseApplication): readonly WorldEvent[] {
  let w = input.projection;
  const events: WorldEvent[] = [];
  for (;;) {
    const l = Object.values(w.residentLeases?.leases ?? {})
      .filter((l) => (nextLeaseBoundary(l) ?? Infinity) <= w.clock.now)
      .sort(
        (a, b) => nextLeaseBoundary(a)! - nextLeaseBoundary(b)! || a.id.localeCompare(b.id, 'en'),
      )[0];
    if (!l) break;
    const d = settleLeaseBoundary(
      l,
      nextLeaseBoundary(l)!,
      (w.agents[l.tenantId]?.balance ?? 0) >= l.rent,
    );
    const result = settle(
      {
        ...input,
        projection: w,
        requestId: input.requestId + '-due-' + events.length,
        nextSequence: input.nextSequence + events.length,
      },
      d.event,
      d.settlement,
    );
    if (!result.accepted) throw new Error(`lease-settlement-failed:${result.reason}`);
    for (const e of result.events) {
      w = applyWorldEvent(w, e);
      events.push(e);
    }
  }
  return events;
}
