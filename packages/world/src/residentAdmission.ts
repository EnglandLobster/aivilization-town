import {
  RESIDENT_ADMISSION_POLICY as POLICY,
  assertResidentAdmissionPolicy,
  residentAdmissionReservation,
  decideResidentAdmission,
  type ResidentAdmissionFacts,
} from '@aivilization/society';
import { createEventEnvelope } from '@aivilization/sim-core';
import { tradeFactsEqual as equal } from '@aivilization/commerce';
import type { WorldProjection } from './projection';
import type { WorldEvent } from './events';
import { assertResidentExitSnapshot } from './residentExitPreservation';
export type ResidentAdmissionEnabledPayload = {
  readonly actorId: 'system';
  readonly policy: typeof POLICY;
  readonly reservation: ReturnType<typeof residentAdmissionReservation>;
};
function facts(w: WorldProjection): ResidentAdmissionFacts {
  if (!w.residentExits) throw Error('resident-admission-real-exit-state-required');
  assertResidentExitSnapshot(w);
  return {
    living: Object.keys(w.agents).length,
    permanentExits: Object.keys(w.residentExits.records).length,
    cashCapacity: w.residentExits.cash.policy.maxAccounts,
    materialCapacity: w.residentExits.materials.policy.maxRecords,
    ...(w.estateCredit ? { creditCapacity: w.estateCredit.policy.maxCustomers } : {}),
  };
}
export function assertResidentAdmissionSnapshot(w: WorldProjection) {
  if (!w.residentAdmissionPolicy) return;
  assertResidentAdmissionPolicy(w.residentAdmissionPolicy);
  if (residentAdmissionReservation(facts(w)).remaining < 0)
    throw Error('resident-admission-capacity-overcommitted');
}
/** Permanent departure cannot be reversed by creating a replacement body with the same subject ID. */
export function residentIdentityAdmissionRejection(w: WorldProjection, id: string) {
  if (w.residentExits?.records[id]) return 'agent-id-permanently-reserved' as const;
  if (!w.residentAdmissionPolicy) return undefined;
  assertResidentAdmissionSnapshot(w);
  const decision = decideResidentAdmission(w.residentAdmissionPolicy, facts(w));
  return decision.accepted ? undefined : decision.reason;
}
/** Operator/composition activation only. No retroactive allocation or truncation of bodies/assets. */
export function enableResidentAdmissionEvent(input: {
  readonly projection: WorldProjection;
  readonly requestId: string;
  readonly simulationId: string;
  readonly nextSequence: number;
}): Extract<WorldEvent, { type: 'ResidentAdmissionEnabled' }> {
  const event = createEventEnvelope({
    id: `${input.requestId}:resident-admission`,
    simulationId: input.simulationId,
    sequence: input.nextSequence,
    occurredAt: input.projection.clock.now,
    type: 'ResidentAdmissionEnabled' as const,
    payload: {
      actorId: 'system' as const,
      policy: POLICY,
      reservation: residentAdmissionReservation(facts(input.projection)),
    },
  });
  applyResidentAdmissionProjection(input.projection, event);
  return event;
}
export function applyResidentAdmissionProjection(
  w: WorldProjection,
  e: WorldEvent,
): WorldProjection | undefined {
  if (e.type !== 'ResidentAdmissionEnabled') return undefined;
  const p = e.payload;
  if (
    w.residentAdmissionPolicy ||
    e.occurredAt !== w.clock.now ||
    !p ||
    !equal(Object.keys(p).sort(), ['actorId', 'policy', 'reservation'].sort()) ||
    p.actorId !== 'system'
  )
    throw Error('resident-admission-activation-source-mismatch');
  assertResidentAdmissionPolicy(p.policy);
  if (!equal(p.reservation, residentAdmissionReservation(facts(w))))
    throw Error('resident-admission-owning-reservation-mismatch');
  const next = { ...w, residentAdmissionPolicy: structuredClone(p.policy) };
  assertResidentAdmissionSnapshot(next);
  return next;
}
