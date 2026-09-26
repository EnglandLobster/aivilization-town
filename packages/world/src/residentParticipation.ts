import { asAgentId, createEventEnvelope } from '@aivilization/sim-core';
import type { WorldProjection } from './projection';
import {
  EXCLUSIVE_AGENT_ACTIVITY_TIME_POLICY_VERSION,
  type WorldEvent,
  type AgentActivityTimeCommittedPayload,
} from './events';
/** Application port used only after the services aggregate accepts a personal check-in. */
export function reserveResidentParticipation(input: {
  projection: WorldProjection;
  actorId: string;
  locationId: string;
  until: number;
  simulationId: string;
  requestId: string;
  nextSequence: number;
}): WorldEvent {
  const w = input.projection,
    agent = w.agents[input.actorId],
    at = w.clock.now;
  if (
    !agent ||
    agent.locationId !== input.locationId ||
    w.transitByAgent?.[input.actorId] ||
    (w.activityTimeByAgent[input.actorId]?.availableAt ?? 0) > at ||
    !Number.isSafeInteger(input.until) ||
    input.until <= at
  )
    throw new Error('invalid-resident-participation');
  const payload: AgentActivityTimeCommittedPayload = {
    agentId: asAgentId(input.actorId),
    activity: 'participation',
    commandType: 'ResidentParticipate',
    policyVersion: EXCLUSIVE_AGENT_ACTIVITY_TIME_POLICY_VERSION,
    settlementTiming: 'effects-at-completion',
    startedAt: at,
    durationSeconds: (input.until - at) / 1000,
    availableAt: input.until,
  };
  return createEventEnvelope({
    id: input.requestId + ':participation',
    simulationId: input.simulationId,
    type: 'AgentActivityTimeCommitted',
    occurredAt: at,
    sequence: input.nextSequence,
    payload,
  });
}

/** Release only the reservation created for this participation, never unrelated work/travel. */
export function endResidentParticipation(input: {
  projection: WorldProjection;
  actorId: string;
  startedAt: number;
  expectedUntil: number;
  simulationId: string;
  requestId: string;
  nextSequence: number;
}): WorldEvent {
  const previous = input.projection.activityTimeByAgent[input.actorId];
  const at = input.projection.clock.now;
  if (
    !previous ||
    previous.commandType !== 'ResidentParticipate' ||
    previous.startedAt !== input.startedAt ||
    previous.availableAt !== input.expectedUntil ||
    at < previous.startedAt ||
    at >= previous.availableAt
  )
    throw new Error('participation-reservation-mismatch');
  return createEventEnvelope({
    id: input.requestId + ':participation-ended',
    simulationId: input.simulationId,
    type: 'ResidentParticipationEnded',
    sequence: input.nextSequence,
    occurredAt: at,
    payload: {
      policyVersion: 'resident-participation-end-v1' as const,
      agentId: asAgentId(input.actorId),
      startedAt: previous.startedAt,
      previousAvailableAt: previous.availableAt,
      durationSeconds: (at - previous.startedAt) / 1000,
      endedAt: at,
    },
  });
}
