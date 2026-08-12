import type { CommandEnvelope } from '@aivilization/sim-core';
import {
  RUNTIME_AGENT_REGISTRATION_INITIAL_BALANCE,
  RUNTIME_AGENT_REGISTRATION_INITIAL_PHYSIOLOGY,
  RUNTIME_AGENT_REGISTRATION_INITIAL_RESIDENTIAL_TIER,
  RUNTIME_AGENT_REGISTRATION_MAX_POPULATION,
  RUNTIME_AGENT_REGISTRATION_POLICY_VERSION,
} from '../events';
import { assertRegisterAgentPayload } from '../commands';
import type { WorldEvent } from '../events';
import type { WorldProjection } from '../projection';
import {
  copyHumanAttribution,
  makeEvent,
  parsePayload,
} from './shared';

export function handleRegisterAgentCommand(input: {
  readonly command: CommandEnvelope<'RegisterAgent', unknown>;
  readonly projection: WorldProjection;
  readonly maxAgentsPerCreator?: number;
  readonly nextSequence: number;
}): WorldEvent[] {
  if (
    input.maxAgentsPerCreator !== undefined &&
    (!Number.isInteger(input.maxAgentsPerCreator) || input.maxAgentsPerCreator < 1)
  ) {
    throw new Error('maxAgentsPerCreator must be a positive integer');
  }
  const parsed = parsePayload(() => assertRegisterAgentPayload(input.command.payload));
  if (parsed.status === 'invalid') {
    if (input.command.actorId === undefined) {
      throw new Error(
        `RegisterAgent requires actorId when its payload is invalid: ${parsed.reason}`,
      );
    }
    return [
      makeEvent(input, 0, 'AgentRegistrationRejected', {
        registrationId: input.command.id,
        policyVersion: RUNTIME_AGENT_REGISTRATION_POLICY_VERSION,
        creatorId: 'unresolved',
        source: input.command.source,
        displayName: input.command.actorId,
        agentId: input.command.actorId,
        reason: 'invalid-registration-payload',
        detail: parsed.reason,
        ...copyHumanAttribution(input.command),
      }),
    ];
  }
  const payload = parsed.payload;
  if (input.command.actorId !== payload.agentId) {
    return [
      makeEvent(input, 0, 'AgentRegistrationRejected', {
        registrationId: input.command.id,
        policyVersion: RUNTIME_AGENT_REGISTRATION_POLICY_VERSION,
        creatorId: payload.creatorId,
        source: input.command.source,
        displayName: payload.displayName,
        agentId: payload.agentId,
        reason: 'invalid-registration-payload',
        detail: 'command actorId must equal payload agentId',
        ...copyHumanAttribution(input.command),
      }),
    ];
  }
  if (input.projection.agents[payload.agentId] !== undefined) {
    return [
      makeEvent(input, 0, 'AgentRegistrationRejected', {
        registrationId: input.command.id,
        policyVersion: RUNTIME_AGENT_REGISTRATION_POLICY_VERSION,
        creatorId: payload.creatorId,
        source: input.command.source,
        displayName: payload.displayName,
        agentId: payload.agentId,
        reason: 'agent-id-already-exists',
        ...copyHumanAttribution(input.command),
      }),
    ];
  }
  if (Object.keys(input.projection.agents).length >= RUNTIME_AGENT_REGISTRATION_MAX_POPULATION) {
    return [
      makeEvent(input, 0, 'AgentRegistrationRejected', {
        registrationId: input.command.id,
        policyVersion: RUNTIME_AGENT_REGISTRATION_POLICY_VERSION,
        creatorId: payload.creatorId,
        source: input.command.source,
        displayName: payload.displayName,
        agentId: payload.agentId,
        reason: 'population-capacity-reached',
        ...copyHumanAttribution(input.command),
      }),
    ];
  }
  if (
    input.maxAgentsPerCreator !== undefined &&
    countAgentsOwnedBy(input.projection, payload.creatorId) >= input.maxAgentsPerCreator
  ) {
    return [
      makeEvent(input, 0, 'AgentRegistrationRejected', {
        registrationId: input.command.id,
        policyVersion: RUNTIME_AGENT_REGISTRATION_POLICY_VERSION,
        creatorId: payload.creatorId,
        source: input.command.source,
        displayName: payload.displayName,
        agentId: payload.agentId,
        reason: 'creator-agent-quota-reached',
        detail: `creator ${payload.creatorId} reached the ${input.maxAgentsPerCreator}-agent quota`,
        ...copyHumanAttribution(input.command),
      }),
    ];
  }

  return [
    makeEvent(input, 0, 'AgentRegistered', {
      registrationId: input.command.id,
      policyVersion: RUNTIME_AGENT_REGISTRATION_POLICY_VERSION,
      creatorId: payload.creatorId,
      source: input.command.source,
      displayName: payload.displayName,
      agentId: payload.agentId,
      initialState: {
        locationId: null,
        physiology: { ...RUNTIME_AGENT_REGISTRATION_INITIAL_PHYSIOLOGY },
        educationScore: 0,
        balance: RUNTIME_AGENT_REGISTRATION_INITIAL_BALANCE,
        residentialTier: RUNTIME_AGENT_REGISTRATION_INITIAL_RESIDENTIAL_TIER,
        job: null,
        inventory: {},
      },
      moneySupplyDelta: RUNTIME_AGENT_REGISTRATION_INITIAL_BALANCE,
      ...copyHumanAttribution(input.command),
    }),
  ];
}

function countAgentsOwnedBy(projection: WorldProjection, creatorId: string): number {
  return Object.values(projection.agents).reduce(
    (count, agent) => count + (agent.registration?.creatorId === creatorId ? 1 : 0),
    0,
  );
}
