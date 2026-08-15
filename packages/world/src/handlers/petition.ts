import type { CommandEnvelope } from '@aivilization/sim-core';
import { evaluatePetitionThreshold, type CollectiveActionPolicy } from '@aivilization/society';
import { assertAgentRaisePetitionPayload, assertAgentSignPetitionPayload } from '../commands';
import type { WorldEvent } from '../events';
import type { WorldProjection } from '../projection';
import { createPetition } from '../petition';
import {
  makeEvent,
  makeMemoryEvent,
  parsePayload,
  rejectCommand,
  resolveCommandAgent,
} from './shared';

/**
 * Collective-action petition commands (collective-action-v1). Both handlers
 * reject when the collective-action policy is absent (flag off), mirroring
 * the bulletin/matters convention. Raise deduplicates same-raiser open
 * petitions on the same topic; Sign is idempotent per agent and fires the
 * town-wide PetitionThresholdReached exactly once, immediately after the
 * crossing signature.
 */

export function handleAgentRaisePetitionCommand(input: {
  readonly command: CommandEnvelope<'AgentRaisePetition', unknown>;
  readonly projection: WorldProjection;
  readonly collectiveAction?: CollectiveActionPolicy;
  readonly nextSequence: number;
}): WorldEvent[] {
  const agent = resolveCommandAgent(input.projection, input.command);
  if (input.collectiveAction === undefined) {
    return rejectCommand(input, 'AgentRaisePetition', 'missing collective action policy');
  }
  const payloadResult = parsePayload(() => assertAgentRaisePetitionPayload(input.command.payload));
  if (payloadResult.status === 'invalid') {
    return rejectCommand(input, 'AgentRaisePetition', payloadResult.reason);
  }
  const policy = input.collectiveAction;
  const duplicate = (input.projection.petitions ?? []).some(
    (petition) =>
      petition.status === 'open' &&
      petition.raisedByAgentId === agent.agentId &&
      petition.topic === payloadResult.payload.topic,
  );
  if (duplicate) {
    return rejectCommand(
      input,
      'AgentRaisePetition',
      `an open petition on topic ${payloadResult.payload.topic} raised by this agent already exists`,
    );
  }
  const petitionId = `${input.command.id}:petition`;
  if ((input.projection.petitions ?? []).some((petition) => petition.petitionId === petitionId)) {
    return rejectCommand(input, 'AgentRaisePetition', `petition ${petitionId} already exists`);
  }
  const petition = createPetition({
    petitionId,
    topic: payloadResult.payload.topic,
    statement: payloadResult.payload.statement,
    raisedByAgentId: agent.agentId,
    raisedAt: input.projection.clock.now,
    expiresAt: input.projection.clock.now + policy.petitionExpiryMs,
  });
  const events: WorldEvent[] = [
    makeEvent(input, 0, 'PetitionRaised', {
      petition,
      policyVersion: policy.policyVersion,
    }),
    makeMemoryEvent(input, 1, {
      summary: `Raised a petition on ${petition.topic}: ${petition.statement}`,
      status: 'succeeded',
      sourceEventOffsets: [0],
      tags: ['petition', 'petition-raised', petition.petitionId],
      consolidationHint: {
        kind: 'habit',
        patternKey: `petition-raised:${petition.topic}`,
        statement: `Raises petitions about ${petition.topic} when distressed enough.`,
      },
    }),
  ];
  // Threshold 1: the raise alone crosses it.
  if (evaluatePetitionThreshold({ signatureCount: 1, policy })) {
    events.push(
      makeEvent(input, 2, 'PetitionThresholdReached', {
        petitionId: petition.petitionId,
        topic: petition.topic,
        signatureCount: 1,
        threshold: policy.petitionSignatureThreshold,
        reachedAt: input.projection.clock.now,
        policyVersion: policy.policyVersion,
      }),
    );
  }
  return events;
}

export function handleAgentSignPetitionCommand(input: {
  readonly command: CommandEnvelope<'AgentSignPetition', unknown>;
  readonly projection: WorldProjection;
  readonly collectiveAction?: CollectiveActionPolicy;
  readonly nextSequence: number;
}): WorldEvent[] {
  const agent = resolveCommandAgent(input.projection, input.command);
  if (input.collectiveAction === undefined) {
    return rejectCommand(input, 'AgentSignPetition', 'missing collective action policy');
  }
  const payloadResult = parsePayload(() => assertAgentSignPetitionPayload(input.command.payload));
  if (payloadResult.status === 'invalid') {
    return rejectCommand(input, 'AgentSignPetition', payloadResult.reason);
  }
  const policy = input.collectiveAction;
  const petition = (input.projection.petitions ?? []).find(
    (candidate) => candidate.petitionId === payloadResult.payload.petitionId,
  );
  if (petition === undefined) {
    return rejectCommand(
      input,
      'AgentSignPetition',
      `petition ${payloadResult.payload.petitionId} does not exist`,
    );
  }
  if (petition.status !== 'open') {
    return rejectCommand(
      input,
      'AgentSignPetition',
      `petition ${petition.petitionId} is ${petition.status}`,
    );
  }
  if (petition.signatureAgentIds.includes(agent.agentId)) {
    return rejectCommand(
      input,
      'AgentSignPetition',
      `agent ${agent.agentId} already signed petition ${petition.petitionId}`,
    );
  }
  const signatureCount = petition.signatureAgentIds.length + 1;
  const events: WorldEvent[] = [
    makeEvent(input, 0, 'PetitionSigned', {
      petitionId: petition.petitionId,
      agentId: agent.agentId,
      previousSignatureCount: petition.signatureAgentIds.length,
      signatureCount,
    }),
    makeMemoryEvent(input, 1, {
      summary: `Signed the petition on ${petition.topic}.`,
      status: 'succeeded',
      sourceEventOffsets: [0],
      tags: ['petition', 'petition-signed', petition.petitionId],
      consolidationHint: {
        kind: 'habit',
        patternKey: `petition-signed:${petition.topic}`,
        statement: `Supports petitions about ${petition.topic}.`,
      },
    }),
  ];
  if (evaluatePetitionThreshold({ signatureCount, policy })) {
    events.push(
      makeEvent(input, 2, 'PetitionThresholdReached', {
        petitionId: petition.petitionId,
        topic: petition.topic,
        signatureCount,
        threshold: policy.petitionSignatureThreshold,
        reachedAt: input.projection.clock.now,
        policyVersion: policy.policyVersion,
      }),
    );
  }
  return events;
}
