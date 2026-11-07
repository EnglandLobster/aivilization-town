import {
  startResidentRest,
  interruptResidentRest,
  type ResidentialPhysiologyCapPolicy,
  RESIDENT_REST_POLICY,
} from '@aivilization/society';
import { createEventEnvelope, type CommandEnvelope } from '@aivilization/sim-core';
import { assertResidentRestTimeCompatibility } from './residentRestTime';
import type { WorldCommandPolicies } from './agentActions';
import { assertAgentSleepPayload } from './commands';
import { RESIDENT_ACTIVITY_PROGRESS_VERSION, type WorldEvent } from './events';
import type { WorldProjection } from './projection';
import {
  makeEvent,
  makeMemoryEvent,
  parsePayload,
  rejectCommand,
  resolveCommandAgent,
  resolveRecoveryMaximum,
} from './handlers/shared';

export function enableResidentRestEvent(input: {
  readonly projection: WorldProjection;
  readonly policies: WorldCommandPolicies;
  readonly requestId: string;
  readonly simulationId: string;
  readonly nextSequence: number;
}): WorldEvent {
  assertResidentRestTimeCompatibility(input.policies);
  if (input.projection.residentRest) throw Error('resident-rest-already-enabled');
  if (
    Object.values(input.projection.activityTimeByAgent).some(
      (a) =>
        a.availableAt > input.projection.clock.now && a.settlementTiming === 'effects-at-commit',
    )
  )
    throw Error('rest-activation-requires-no-active-prepaid-effects');
  return createEventEnvelope({
    id: `${input.requestId}:rest-enabled`,
    simulationId: input.simulationId,
    type: 'ResidentRestEnabled',
    payload: { policy: RESIDENT_REST_POLICY },
    sequence: input.nextSequence,
    occurredAt: input.projection.clock.now,
  });
}

export function handleElapsedSleep(input: {
  readonly command: CommandEnvelope<'AgentSleep', unknown>;
  readonly projection: WorldProjection;
  readonly energyRecoveryPerSecond: number;
  readonly maxEnergy: number;
  readonly residentialPhysiologyCaps?: ResidentialPhysiologyCapPolicy;
  readonly nextSequence: number;
}): WorldEvent[] {
  const state = input.projection.residentRest;
  if (!state) return rejectCommand(input, 'AgentSleep', 'resident-rest-not-enabled');
  const agent = resolveCommandAgent(input.projection, input.command);
  const parsed = parsePayload(() => assertAgentSleepPayload(input.command.payload));
  if (parsed.status === 'invalid') return rejectCommand(input, 'AgentSleep', parsed.reason);
  const cap = resolveRecoveryMaximum({
    agent,
    policy: input.residentialPhysiologyCaps,
    fallback: input.maxEnergy,
    field: 'maxEnergy',
  });
  if (cap.status === 'rejected') return rejectCommand(input, 'AgentSleep', cap.reason);
  const decision = startResidentRest({
    state,
    actorId: agent.agentId,
    id: `${input.command.id}:rest`,
    locationId: agent.locationId ?? '',
    at: input.projection.clock.now,
    durationMs: parsed.payload.durationSeconds * 1000,
    energyPerSecond: input.energyRecoveryPerSecond,
    maximum: cap.value,
  });
  if (!decision.accepted) return rejectCommand(input, 'AgentSleep', decision.reason);
  const event = decision.events[0]!;
  return [
    makeEvent(input, 0, 'ResidentRestSessionChanged', {
      previousRevision: event.previousRevision,
      session: event.session,
    }),
    makeEvent(input, 1, 'AgentActivityTimeCommitted', {
      agentId: agent.agentId,
      activity: 'sleep',
      commandType: 'AgentSleep',
      policyVersion: RESIDENT_ACTIVITY_PROGRESS_VERSION,
      settlementTiming: 'effects-during-activity',
      startedAt: event.session.startedAt,
      availableAt: event.session.until,
      durationSeconds: parsed.payload.durationSeconds,
    }),
    makeMemoryEvent(input, 2, {
      summary: `Started sleeping until ${event.session.until}; recovery depends on elapsed time.`,
      status: 'succeeded',
      tags: ['sleep-started'],
    }),
  ];
}

/** Explicit exception to the generic busy rejection, with exact ownership and reservation checks. */
export function handleStopResidentRest(input: {
  readonly command: CommandEnvelope<'AgentStopRest', unknown>;
  readonly projection: WorldProjection;
  readonly nextSequence: number;
}): WorldEvent[] {
  const state = input.projection.residentRest,
    payload = input.command.payload;
  if (!state) return rejectCommand(input, 'AgentStopRest', 'resident-rest-not-enabled');
  if (
    !payload ||
    typeof payload !== 'object' ||
    Array.isArray(payload) ||
    Object.keys(payload).sort().join(',') !== 'expectedRevision,id' ||
    !('id' in payload) ||
    typeof payload.id !== 'string' ||
    !('expectedRevision' in payload) ||
    typeof payload.expectedRevision !== 'number'
  )
    return rejectCommand(input, 'AgentStopRest', 'invalid-rest-interruption-payload');
  const actor = resolveCommandAgent(input.projection, input.command);
  const decision = interruptResidentRest({
    state,
    actorId: actor.agentId,
    id: payload.id,
    expectedRevision: payload.expectedRevision,
    at: input.projection.clock.now,
  });
  if (!decision.accepted) return rejectCommand(input, 'AgentStopRest', decision.reason);
  const event = decision.events[0]!,
    session = event.session;
  const reservation = input.projection.activityTimeByAgent[actor.agentId];
  if (
    !reservation ||
    reservation.policyVersion !== RESIDENT_ACTIVITY_PROGRESS_VERSION ||
    reservation.commandType !== 'AgentSleep' ||
    reservation.startedAt !== session.startedAt ||
    reservation.availableAt !== session.until
  )
    return rejectCommand(input, 'AgentStopRest', 'rest-interruption-reservation-mismatch');
  return [
    makeEvent(input, 0, 'ResidentRestSessionChanged', {
      previousRevision: event.previousRevision,
      session,
    }),
    makeMemoryEvent(input, 1, {
      summary: `Personally stopped sleeping after ${session.elapsedMs / 1000} seconds.`,
      status: 'succeeded',
      tags: ['sleep-interrupted'],
    }),
  ];
}
