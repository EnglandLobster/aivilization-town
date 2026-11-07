import { createEventEnvelope } from '@aivilization/sim-core';
import { SERVICE_PHYSIOLOGY_VERSION, type ElapsedPhysiologyInput } from '@aivilization/society';
import {
  serviceFactsEqual,
  decideServiceElapsedBody,
  decideServiceAttendanceBody,
  type ServiceAttendanceBody,
  type ServiceElapsedBody,
} from '@aivilization/services';
import type { WorldProjection } from './projection';
import type { WorldCommandPolicies } from './agentActions';
import type { WorldEvent } from './events';
import { residentServiceEngagementPorts } from './serviceEngagementPorts';
import { settleResidentServiceEngagementEvent } from './residentServiceEngagements';
export type ServiceTimeState = {
  readonly policyVersion: 'resident-service-time-v1';
  readonly bodyPolicyVersion: typeof SERVICE_PHYSIOLOGY_VERSION;
  readonly decay: ElapsedPhysiologyInput['decay'];
  readonly deprivation?: NonNullable<ElapsedPhysiologyInput['deprivation']>;
};
export function enableServiceTimeEvent(input: {
  projection: WorldProjection;
  policies: WorldCommandPolicies;
  simulationId: string;
  requestId: string;
  nextSequence: number;
}): WorldEvent {
  const w = input.projection;
  if (
    w.serviceTime ||
    !w.residentRest ||
    !w.serviceEngagements ||
    Object.values(w.serviceEngagements.engagements).some(
      (e) => e.providerPresence || e.recipientPresence,
    )
  )
    throw Error('service-time-needs-rest-and-no-active-service');
  const payload: ServiceTimeState = {
    policyVersion: 'resident-service-time-v1',
    bodyPolicyVersion: SERVICE_PHYSIOLOGY_VERSION,
    decay: input.policies.calendar?.physiologicalDecay ?? { energyPerHour: 0, satietyPerHour: 0 },
    ...(input.policies.sleepDeprivation ? { deprivation: input.policies.sleepDeprivation } : {}),
  };
  return createEventEnvelope({
    id: `${input.requestId}:service-time`,
    simulationId: input.simulationId,
    sequence: input.nextSequence,
    occurredAt: w.clock.now,
    type: 'ResidentServiceTimeEnabled',
    payload,
  });
}
export function applyServiceTimeProjection(
  w: WorldProjection,
  e: WorldEvent,
): WorldProjection | undefined {
  if (e.type !== 'ResidentServiceTimeEnabled') return undefined;
  const p = e.payload;
  if (
    w.serviceTime ||
    !w.residentRest ||
    !w.serviceEngagements ||
    Object.values(w.serviceEngagements.engagements).some(
      (e) => e.providerPresence || e.recipientPresence,
    ) ||
    e.occurredAt !== w.clock.now ||
    p.policyVersion !== 'resident-service-time-v1' ||
    p.bodyPolicyVersion !== SERVICE_PHYSIOLOGY_VERSION ||
    [...Object.values(p.decay), ...Object.values(p.deprivation ?? {})].some(
      (n) => !Number.isFinite(n) || n < 0,
    ) ||
    (p.deprivation?.minHealth ?? 0) > 100
  )
    throw Error('invalid-service-time-activation');
  return { ...w, serviceTime: structuredClone(p) };
}
export function assertServiceTimePolicy(
  w: WorldProjection,
  policies: Pick<WorldCommandPolicies, 'calendar' | 'sleepDeprivation'>,
) {
  if (
    w.serviceTime &&
    (w.serviceTime.policyVersion !== 'resident-service-time-v1' ||
      w.serviceTime.bodyPolicyVersion !== SERVICE_PHYSIOLOGY_VERSION ||
      !w.residentRest ||
      !w.serviceEngagements ||
      !serviceFactsEqual(
        w.serviceTime.decay,
        policies.calendar?.physiologicalDecay ?? { energyPerHour: 0, satietyPerHour: 0 },
      ) ||
      !serviceFactsEqual(w.serviceTime.deprivation, policies.sleepDeprivation))
  )
    throw Error('service-physiology-policy-mismatch');
}
export function assertServiceElapsedBody(w: WorldProjection, body: ServiceElapsedBody): void {
  const state = w.serviceTime,
    e = w.serviceEngagements?.engagements[body.engagementId];
  if (
    !state ||
    !e ||
    body.until > w.clock.now ||
    body.from !== e.settledAt ||
    !serviceFactsEqual(body.decay, state.decay) ||
    !serviceFactsEqual(body.deprivation, state.deprivation)
  )
    throw Error('service-elapsed-source-mismatch');
  const at = { ...w, clock: { ...w.clock, now: body.until } },
    p = residentServiceEngagementPorts(at, {
      authorize: () => undefined,
      controllerAvailable: () => false,
    }),
    provider = p.condition(e.providerId),
    recipient = p.condition(e.recipientId);
  if (!provider || !recipient || !e.providerPresence || !e.recipientPresence)
    throw Error('service-elapsed-person-missing');
  const available =
    [e.providerPresence, e.recipientPresence].every(
      (v) => p.present(v.actorId, e.locationId) && p.sessionReserved(e.id, v),
    ) &&
    provider.health > 0 &&
    recipient.health > 0 &&
    p.locationAvailable(e.locationId) &&
    (p.mayOperateDuring
      ? p.mayOperateDuring(e, body.from, body.until)
      : p.mayOperate(e.providerId, e.locationId)) &&
    p.facilityAvailable(e, body.until);
  const expected = decideServiceElapsedBody(
    e,
    {
      from: body.from,
      until: body.until,
      decay: state.decay,
      ...(state.deprivation ? { deprivation: state.deprivation } : {}),
    },
    provider,
    recipient,
    available,
  );
  if (!serviceFactsEqual(body, expected)) throw Error('service-elapsed-body-proof-mismatch');
}
export function settleServiceElapsedInterval(input: {
  projection: WorldProjection;
  id: string;
  from: number;
  until: number;
  simulationId: string;
  requestId: string;
  nextSequence: number;
}): readonly WorldEvent[] {
  const w = input.projection,
    state = w.serviceTime,
    e = w.serviceEngagements?.engagements[input.id];
  if (!state || !e?.providerPresence || (!e.recipientPresence && !w.serviceEmployment)) return [];
  const d = settleResidentServiceEngagementEvent({
    ...input,
    projection: { ...w, clock: { ...w.clock, now: input.until } },
    actorId: 'system',
    authorization: { authorize: () => undefined, controllerAvailable: () => false },
    elapsedInterval: {
      from: input.from,
      until: input.until,
      decay: state.decay,
      ...(state.deprivation ? { deprivation: state.deprivation } : {}),
    },
  });
  if (!d.accepted) throw Error(`service-elapsed-settlement-failed:${d.reason}`);
  return d.events;
}

export function assertServiceAttendanceBody(w: WorldProjection, body: ServiceAttendanceBody): void {
  const e = w.serviceEngagements?.engagements[body.engagementId],
    state = w.serviceTime;
  if (
    !w.serviceEmployment ||
    !state ||
    !e?.providerPresence ||
    e.recipientPresence ||
    e.settledAt !== body.from ||
    body.until > w.clock.now ||
    !serviceFactsEqual(body.decay, state.decay) ||
    !serviceFactsEqual(body.deprivation, state.deprivation)
  )
    throw Error('invalid-service-attendance-source');
  const p = residentServiceEngagementPorts(w, {
    authorize: () => undefined,
    controllerAvailable: () => false,
  });
  const provider = p.condition(e.providerId);
  if (!provider) throw Error('service-attendance-provider-required');
  const available =
    provider.health > 0 &&
    p.present(e.providerId, e.locationId) &&
    p.sessionReserved(e.id, e.providerPresence) &&
    p.locationAvailable(e.locationId) &&
    (p.mayOperateDuring
      ? p.mayOperateDuring(e, body.from, body.until)
      : p.mayOperate(e.providerId, e.locationId)) &&
    p.facilityAvailable(e, body.until);
  const expected = decideServiceAttendanceBody(
    e,
    {
      from: body.from,
      until: body.until,
      decay: state.decay,
      ...(state.deprivation ? { deprivation: state.deprivation } : {}),
    },
    provider,
    available,
  );
  if (!serviceFactsEqual(body, expected)) throw Error('service-attendance-body-proof-mismatch');
}
