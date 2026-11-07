import { serviceEstateCashSource } from './serviceEstateAccounting';
import {
  prepareResidentEstateCashBatch,
  type ResidentEstateCashBatch,
} from './residentEstateCashBatch';
import { serviceFacilityFitsLocation } from './serviceFacilityRegistration';
import { prepareServiceCompensation, serviceEmployer } from './serviceCompensation';
import { prepareServiceEnterpriseAccounting } from './serviceEnterpriseAccounting';
import type { WorldCommandPolicies } from './agentActions';
import type { ServiceCompensation } from './serviceEmploymentModel';
import type { ServiceEnterpriseAccounting } from './serviceEmploymentModel';
import { prepareEscrowCommonTransfers, residentEscrowIncoming } from './residentEscrowAccounting';
import { tradeSourceStartFailure } from '@aivilization/commerce';
import {
  decideServiceEngagement,
  endServiceEngagement,
  advanceServiceEngagement,
  applyServiceEngagementCommit,
  SERVICE_ENGAGEMENTS_POLICY,
  type ServiceEngagementEvent,
  type ServiceElapsedBody,
  type ServiceAttendanceBody,
  type ServiceElapsedInterval,
  type ServiceEngagementCommand,
  type ServiceEngagementDecision,
  type ServiceMaterialInstruction,
  type ServiceEngagementPolicy,
} from '@aivilization/services';
import { type AccountingTransaction, type CommonAccountEvent } from '@aivilization/economy';
import {
  applyMaterialCommit,
  settleConsumerMaterials,
  type MaterialEvent,
  type MaterialAllocation,
} from '@aivilization/materials';
import { createEventEnvelope } from '@aivilization/sim-core';
import {
  applyPremisesEvent,
  type PremisesEvent,
  type ServiceFacilityEndowment,
} from '@aivilization/premises';
import { applyWorldEvent, type WorldProjection } from './projection';
import type { WorldEvent } from './events';
import {
  residentServiceEngagementPorts,
  servicePremisesWindowFailure,
  type ServiceEngagementAuthorization,
} from './serviceEngagementPorts';
export type ResidentServiceEngagementsPayload = {
  readonly estateCashBatch?: ResidentEstateCashBatch;
  readonly employment?: ServiceCompensation;
  readonly enterpriseAccounting?: readonly ServiceEnterpriseAccounting[];
  readonly elapsedBody?: ServiceElapsedBody;
  readonly elapsedAttendance?: ServiceAttendanceBody;
  readonly policyVersion: 'resident-service-engagements-v1';
  readonly actorId: string;
  readonly events: readonly ServiceEngagementEvent[];
  readonly transactions: readonly AccountingTransaction[];
  readonly materialInstructions: readonly ServiceMaterialInstruction[];
  readonly materialEvents: readonly MaterialEvent[];
  readonly commonAccountEvents: readonly CommonAccountEvent[];
  readonly premisesEvents: readonly PremisesEvent[];
};
type Context = {
  projection: WorldProjection;
  actorId: string;
  requestId: string;
  simulationId: string;
  nextSequence: number;
  authorization: ServiceEngagementAuthorization;
  elapsedInterval?: ServiceElapsedInterval;
  policies?: WorldCommandPolicies;
  expectedEmploymentRevision?: number;
};
export const serviceMaterialAllocations = (
  instructions: readonly ServiceMaterialInstruction[],
): MaterialAllocation[] =>
  instructions
    .filter((i) => Object.keys(i.consumed).length > 0)
    .map((i) => ({
      reservationId: i.reservationId,
      consumer: { domain: 'services', id: i.engagementId },
      items: i.consumed,
      evidenceId: i.evidenceId,
    }));
function wrap(input: Context, d: ServiceEngagementDecision) {
  if (!d.accepted) return d;
  if (!d.events.length) return { accepted: true as const, events: [] };
  const w = input.projection,
    at = w.clock.now,
    result = applyServiceEngagementCommit(
      w.serviceEngagements,
      d.events,
      d.transactions,
      d.materialInstructions,
    ),
    materialEvents: MaterialEvent[] = [],
    commonAccountEvents: CommonAccountEvent[] = [];
  let materials = w.materials,
    common = w.commonAccounts;
  for (const [index, instruction] of d.materialInstructions.entries()) {
    if (!materials) return { accepted: false as const, reason: 'service-materials-not-enabled' };
    const decision = settleConsumerMaterials(
      materials,
      input.actorId,
      at,
      `${input.requestId}-sm${index}`,
      instruction.reservationId,
      instruction.expectedRevision,
      {
        consumer: { domain: 'services', id: instruction.engagementId },
        beneficiary: instruction.controller,
        evidenceId: instruction.evidenceId,
        ...(Object.keys(instruction.consumed).length ? { allocation: instruction.consumed } : {}),
        ...(instruction.finish ? { finish: true } : {}),
      },
    );
    if (!decision.accepted) return decision;
    materials = applyMaterialCommit(
      materials,
      decision.events,
      serviceMaterialAllocations([instruction]),
    ).state;
    materialEvents.push(...decision.events);
  }
  const changed = d.events.find((e) => e.type === 'ServiceEngagementChanged');
  const accounting = prepareEscrowCommonTransfers({
    state: common,
    context: 'services',
    referenceId: changed?.engagement.id ?? 'enable',
    actorId: input.actorId,
    at,
    requestId: input.requestId,
    transactions: d.transactions,
  });
  if (!accounting.accepted) return accounting;
  common = accounting.state;
  commonAccountEvents.push(...accounting.events);
  for (const a of Object.values(common?.accounts ?? {}))
    if (
      a.balance + residentEscrowIncoming({ ...w, serviceEngagements: result.state }, a.id) >
      common!.policy.maxBalance + 1e-8
    )
      return {
        accepted: false as const,
        reason: 'service-common-account-refund-or-revenue-capacity',
      };
  let enterpriseAccounting: readonly ServiceEnterpriseAccounting[];
  try {
    enterpriseAccounting = prepareServiceEnterpriseAccounting(w, d.events);
  } catch (error) {
    return {
      accepted: false as const,
      reason: error instanceof Error ? error.message : 'invalid-service-enterprise-accounting',
    };
  }
  let employment: ServiceCompensation | undefined;
  try {
    employment = prepareServiceCompensation({
      ...input,
      events: d.events,
      financial: enterpriseAccounting,
      ...(d.elapsedAttendance ? { attendance: d.elapsedAttendance } : {}),
      eventId: `${input.requestId}:service`,
    });
  } catch (error) {
    return {
      accepted: false as const,
      reason: error instanceof Error ? error.message : 'invalid-service-compensation',
    };
  }
  const estateSource = serviceEstateCashSource(w, d.events, d.transactions);
  const estateCashBatch = estateSource
    ? prepareResidentEstateCashBatch(w, estateSource, d.transactions, at)
    : undefined;
  const payload: ResidentServiceEngagementsPayload = {
    ...(estateCashBatch ? { estateCashBatch } : {}),
    ...(employment ? { employment } : {}),
    ...(enterpriseAccounting.length ? { enterpriseAccounting } : {}),
    policyVersion: SERVICE_ENGAGEMENTS_POLICY.version,
    ...(d.elapsedBody ? { elapsedBody: d.elapsedBody } : {}),
    ...(d.elapsedAttendance ? { elapsedAttendance: d.elapsedAttendance } : {}),
    actorId: input.actorId,
    events: d.events,
    transactions: d.transactions,
    materialInstructions: d.materialInstructions,
    materialEvents,
    commonAccountEvents,
    premisesEvents: [],
  };
  return {
    accepted: true as const,
    events: [
      createEventEnvelope({
        id: `${input.requestId}:service`,
        simulationId: input.simulationId,
        sequence: input.nextSequence,
        occurredAt: at,
        type: 'ResidentServiceEngagementsCommitted',
        payload,
      }),
    ],
  };
}
export function residentServiceEngagementEvent(
  input: Context & { command: ServiceEngagementCommand },
) {
  const s = input.projection.serviceEngagements;
  if (!s) return { accepted: false as const, reason: 'service-engagements-not-enabled' };
  if (input.command.type === 'start') {
    const engagement = input.projection.serviceEngagements?.engagements[input.command.id];
    if (
      input.command.expectedEmploymentRevision !== undefined &&
      (!input.projection.serviceEmployment ||
        engagement?.providerId !== input.actorId ||
        !serviceEmployer(input.projection, input.command.id))
    )
      return { accepted: false as const, reason: 'own-service-employment-acceptance-required' };
    const windowFailure =
      engagement &&
      servicePremisesWindowFailure(
        input.projection,
        engagement,
        input.actorId,
        input.command.until,
      );
    if (windowFailure) return { accepted: false as const, reason: windowFailure };
    const reason = tradeSourceStartFailure(input.projection.residentTrade, {
      kind: 'service',
      id: input.command.id,
    });
    if (reason) return { accepted: false as const, reason };
  }
  return wrap(
    {
      ...input,
      ...(input.command.type === 'start' && input.command.expectedEmploymentRevision !== undefined
        ? { expectedEmploymentRevision: input.command.expectedEmploymentRevision }
        : {}),
    },
    decideServiceEngagement(
      s,
      input.actorId,
      input.projection.clock.now,
      input.command,
      residentServiceEngagementPorts(input.projection, input.authorization),
    ),
  );
}
export function settleResidentServiceEngagementEvent(input: Context & { id: string }) {
  const s = input.projection.serviceEngagements;
  const e = s?.engagements[input.id];
  if (
    input.projection.serviceTime &&
    e?.providerPresence &&
    e.recipientPresence &&
    input.projection.clock.now > e.settledAt &&
    !input.elapsedInterval
  )
    throw Error('service-actual-interval-required');
  if (!s) return { accepted: false as const, reason: 'service-engagements-not-enabled' };
  return wrap(
    input,
    advanceServiceEngagement(s, input.id, input.projection.clock.now, {
      ...residentServiceEngagementPorts(input.projection, input.authorization),
      ...(input.elapsedInterval ? { elapsedInterval: input.elapsedInterval } : {}),
    }),
  );
}
export function advanceResidentServiceEngagements(
  input: Omit<Context, 'actorId' | 'authorization'>,
) {
  const events: WorldEvent[] = [];
  let projection = input.projection;
  for (const id of Object.keys(projection.serviceEngagements?.engagements ?? {}).sort()) {
    const result = settleResidentServiceEngagementEvent({
      ...input,
      projection,
      id,
      actorId: 'system',
      requestId: `${input.requestId}-${events.length}`,
      nextSequence: input.nextSequence + events.length,
      authorization: { authorize: () => undefined, controllerAvailable: () => false },
    });
    if (!result.accepted) throw Error(`service-settlement-failed:${id}:${result.reason}`);
    for (const event of result.events) {
      projection = applyWorldEvent(projection, event);
      events.push(event);
    }
  }
  return events;
}
export function enableResidentServiceEngagementsEvent(
  input: Omit<Context, 'actorId' | 'authorization'> & {
    policy: ServiceEngagementPolicy;
    facilities?: readonly ServiceFacilityEndowment[];
  },
) {
  const w = input.projection;
  if (w.serviceEngagements)
    return { accepted: false as const, reason: 'service-engagements-already-enabled' };
  if (!w.materials?.reservations || !w.premises)
    return { accepted: false as const, reason: 'service-materials-and-premises-required' };
  const premisesEvents: PremisesEvent[] = [];
  let premises = w.premises;
  for (const endowment of input.facilities ?? []) {
    if (!serviceFacilityFitsLocation(w, endowment))
      return {
        accepted: false as const,
        reason: 'service-endowment-exceeds-real-location-capacity',
      };
    const event: PremisesEvent = { type: 'ServiceFacilityEndowed', endowment };
    try {
      premises = applyPremisesEvent(premises, event);
    } catch {
      return { accepted: false as const, reason: 'invalid-service-facility-endowment' };
    }
    premisesEvents.push(event);
  }
  const payload: ResidentServiceEngagementsPayload = {
    policyVersion: input.policy.version,
    actorId: 'system',
    events: [{ type: 'ServiceEngagementsEnabled', policy: input.policy }],
    premisesEvents,
    materialInstructions: [],
    materialEvents: [],
    commonAccountEvents: [],
    transactions: [],
  };
  return {
    accepted: true as const,
    events: [
      createEventEnvelope({
        id: `${input.requestId}:service-enabled`,
        simulationId: input.simulationId,
        sequence: input.nextSequence,
        occurredAt: w.clock.now,
        type: 'ResidentServiceEngagementsCommitted',
        payload,
      }),
    ],
  };
}

/** Application-only lifecycle port; a departed employment source cannot keep reserving the worker. */
export function stopResidentEmployedServiceEvent(input: Context & { id: string }) {
  const w = input.projection,
    s = w.serviceEngagements,
    e = s?.engagements[input.id];
  if (!w.serviceEmployment || !s || !e?.providerPresence || e.settledAt !== w.clock.now)
    return {
      accepted: false as const,
      reason: 'service-employment-stop-needs-settled-actual-time',
    };
  return wrap(
    input,
    endServiceEngagement(
      s,
      e,
      w.clock.now,
      'participant-unavailable',
      residentServiceEngagementPorts(w, input.authorization),
    ),
  );
}
