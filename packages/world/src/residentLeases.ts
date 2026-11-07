import { prepareLeaseContinuity, leaseHasDepartedParty } from './leaseEstateContinuity';
import { residentPhysicalFinancialAccount } from './residentExitPreservation';
import type { LeaseContinuitySource } from '@aivilization/society';
import { premisesAtLocation, premisesLeaseRightAvailable } from './premisesAccess';
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
  source?: LeaseContinuitySource,
): { accepted: true; events: readonly WorldEvent[] } | { accepted: false; reason: string } {
  if (source && leaseHasDepartedParty(input.projection, event.lease)) {
    try {
      const continuity = prepareLeaseContinuity(
        input.projection,
        event.lease,
        source,
        settlement?.rent ?? 0,
      );
      const e = createEventEnvelope({
        id: input.requestId + ':lease',
        simulationId: input.simulationId,
        type: 'ResidentLeaseChanged',
        sequence: input.nextSequence,
        occurredAt: source.at,
        payload: { lease: event.lease, policyVersion: 'resident-leases-v1', continuity },
      });
      applyWorldEvent(input.projection, e);
      return { accepted: true, events: [e] };
    } catch (error) {
      return {
        accepted: false,
        reason: error instanceof Error ? error.message : 'lease-continuity-failed',
      };
    }
  }
  let w = input.projection;
  const events: WorldEvent[] = [];
  let leaseRecorded = false;
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
    if (t.locationId && premisesAtLocation(w, t.locationId)) {
      // Commit accepted tenancy inside the same atomic application result before the residence action.
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
      leaseRecorded = true;
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
  if (!leaseRecorded)
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
  if (!w.agents[input.actorId]) return { accepted: false, reason: 'lease-living-actor-required' };
  if (!w.residentCommerce) return { accepted: false, reason: 'life-not-enabled' };
  const requestedLease =
    input.command.type === 'offer'
      ? input.command
      : input.command.type === 'accept'
        ? w.residentLeases?.leases[input.command.id]
        : undefined;
  if (
    requestedLease &&
    !premisesLeaseRightAvailable(
      w,
      requestedLease.tenantId,
      requestedLease.locationId,
      requestedLease.expiresAt,
    )
  )
    return { accepted: false, reason: 'lease-conflicts-with-premises-use-rights' };
  if (input.command.type === 'offer') {
    const b = premisesAtLocation(w, input.command.locationId);
    if (
      b &&
      (b.status !== 'operational' ||
        b.condition <= 0 ||
        b.control.controller.kind !== 'resident' ||
        b.control.controller.id !== input.actorId)
    )
      return { accepted: false, reason: 'premises-lease-authority-required' };
  }

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
          (!premisesAtLocation(w, location) ||
            (premisesAtLocation(w, location)!.status === 'operational' &&
              premisesAtLocation(w, location)!.condition > 0)) &&
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
  return settle(
    input,
    d.events[0]!,
    d.settlement,
    input.command.type === 'end' || input.command.type === 'pay'
      ? { kind: 'resident', at: w.clock.now, actorId: input.actorId, operation: input.command.type }
      : undefined,
  );
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
      (residentPhysicalFinancialAccount(w, l.tenantId)?.balance ?? 0) >= l.rent,
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
      { kind: 'boundary', at: nextLeaseBoundary(l)! },
    );
    if (!result.accepted) throw new Error(`lease-settlement-failed:${result.reason}`);
    for (const e of result.events) {
      w = applyWorldEvent(w, e);
      events.push(e);
    }
  }
  return events;
}
