import type { AgentId, CommandEnvelope, CoreCommandType, LocationId } from '@aivilization/sim-core';
import { createDirectedSocialRelationKey } from '@aivilization/society';
import {
  assertAgentAttackPayload,
  assertAgentConfrontPayload,
  assertAgentIntervenePayload,
} from '../commands';
import {
  applyAttackDamage,
  evaluateAttackDamage,
  resolveConflictGrievance,
  type TownConflictPolicy,
} from '../conflict';
import type { WorldEvent } from '../events';
import type { WorldAgentState, WorldProjection } from '../projection';
import {
  makeEvent,
  makeMemoryEvent,
  parsePayload,
  planSocialInteractionEvent,
  rejectCommand,
  requireSignalDeltas,
  resolveCommandAgent,
} from './shared';

export function handleAgentConfrontCommand(input: {
  readonly command: CommandEnvelope<'AgentConfront', unknown>;
  readonly projection: WorldProjection;
  readonly conflict?: TownConflictPolicy;
  readonly nextSequence: number;
}): WorldEvent[] {
  const agent = resolveCommandAgent(input.projection, input.command);
  if (input.conflict === undefined) {
    return rejectCommand(input, 'AgentConfront', 'missing conflict policy');
  }
  const payloadResult = parsePayload(() => assertAgentConfrontPayload(input.command.payload));
  if (payloadResult.status === 'invalid') {
    return rejectCommand(input, 'AgentConfront', payloadResult.reason);
  }
  const payload = payloadResult.payload;
  const context = resolveConflictParties(input, payload.targetAgentId, 'AgentConfront');
  if (Array.isArray(context)) {
    return context;
  }
  const deltas = requireSignalDeltas('hostility');
  const summary = `${agent.agentId} confronted ${payload.targetAgentId}: ${payload.statement}`;
  const relation = planSocialInteractionEvent({
    projection: input.projection,
    sourceAgentId: agent.agentId,
    targetAgentId: payload.targetAgentId,
    summary,
    relationDelta: deltas.relationDelta,
    attitudeDelta: deltas.attitudeDelta,
    outcomeSignals: ['hostility'],
  });
  if (relation.status === 'invalid') {
    return rejectCommand(input, 'AgentConfront', relation.reason);
  }
  const events: WorldEvent[] = [
    makeEvent(input, 0, 'ConfrontationRecorded', {
      conflictId: `conflict-${input.command.id}`,
      initiatorAgentId: agent.agentId,
      targetAgentId: payload.targetAgentId,
      locationId: context.locationId,
      statement: payload.statement,
      witnessAgentIds: context.witnessAgentIds,
      recordedAt: input.command.issuedAt,
    }),
    makeEvent(input, 1, 'SocialInteractionCompleted', relation.payload),
    makeMemoryEvent(input, 2, {
      agentId: agent.agentId,
      kind: 'action',
      summary,
      status: 'succeeded',
      tags: ['town-conflict', 'confrontation', payload.targetAgentId],
    }),
    makeMemoryEvent(input, 3, {
      agentId: payload.targetAgentId,
      kind: 'social-interaction',
      summary,
      status: 'succeeded',
      tags: ['town-conflict', 'confrontation', agent.agentId],
    }),
  ];
  appendConflictWitnessMemories({
    input,
    events,
    witnessAgentIds: context.witnessAgentIds,
    summary: `Witnessed confrontation: ${summary}`,
    eventKind: 'confrontation',
  });
  return events;
}

export function handleAgentAttackCommand(input: {
  readonly command: CommandEnvelope<'AgentAttack', unknown>;
  readonly projection: WorldProjection;
  readonly conflict?: TownConflictPolicy;
  readonly nextSequence: number;
}): WorldEvent[] {
  const agent = resolveCommandAgent(input.projection, input.command);
  if (input.conflict === undefined) {
    return rejectCommand(input, 'AgentAttack', 'missing conflict policy');
  }
  const payloadResult = parsePayload(() => assertAgentAttackPayload(input.command.payload));
  if (payloadResult.status === 'invalid') {
    return rejectCommand(input, 'AgentAttack', payloadResult.reason);
  }
  const policy = input.conflict;
  const payload = payloadResult.payload;
  const context = resolveConflictParties(input, payload.targetAgentId, 'AgentAttack');
  if (Array.isArray(context)) {
    return context;
  }
  const grievance = resolveConflictGrievance({
    relations: input.projection.socialRelations,
    commitments: input.projection.socialCommitments,
    ...(input.projection.socialMatters === undefined
      ? {}
      : { matters: input.projection.socialMatters }),
    attackerAgentId: agent.agentId,
    targetAgentId: payload.targetAgentId,
    grievanceRelationThreshold: policy.grievanceRelationThreshold,
  });
  if (grievance === undefined) {
    return rejectCommand(
      input,
      'AgentAttack',
      'attack requires a world-issued grievance (strained relation or betrayal evidence)',
    );
  }
  const target = context.target;
  const damage = evaluateAttackDamage({
    policy,
    attackerEnergy: agent.physiology.energy,
    targetEnergy: target.physiology.energy,
  });
  const nextHealth = applyAttackDamage({
    policy,
    targetHealth: target.physiology.health,
    damage,
  });
  const nextAttackerEnergy = Number(
    Math.max(0, agent.physiology.energy - policy.attackerEnergyCost).toFixed(6),
  );
  const summary = `${agent.agentId} attacked ${payload.targetAgentId} for ${damage} damage.`;
  const betrayal = requireSignalDeltas('betrayal');
  const relation = planSocialInteractionEvent({
    projection: input.projection,
    sourceAgentId: agent.agentId,
    targetAgentId: payload.targetAgentId,
    summary,
    relationDelta: betrayal.relationDelta,
    attitudeDelta: betrayal.attitudeDelta,
    outcomeSignals: ['betrayal'],
  });
  if (relation.status === 'invalid') {
    return rejectCommand(input, 'AgentAttack', relation.reason);
  }
  const events: WorldEvent[] = [
    makeEvent(input, 0, 'AttackRecorded', {
      conflictId: `conflict-${input.command.id}`,
      attackerAgentId: agent.agentId,
      targetAgentId: payload.targetAgentId,
      locationId: context.locationId,
      grievance,
      damage,
      targetPreviousHealth: target.physiology.health,
      targetNextHealth: nextHealth,
      attackerEnergyCost: policy.attackerEnergyCost,
      witnessAgentIds: context.witnessAgentIds,
      recordedAt: input.command.issuedAt,
    }),
    makeEvent(input, 1, 'PhysiologyChanged', {
      agentId: payload.targetAgentId,
      previous: { ...target.physiology },
      next: { ...target.physiology, health: nextHealth },
      reason: 'conflict-attack',
    }),
    makeEvent(input, 2, 'PhysiologyChanged', {
      agentId: agent.agentId,
      previous: { ...agent.physiology },
      next: { ...agent.physiology, energy: nextAttackerEnergy },
      reason: 'conflict-attack-cost',
    }),
    makeEvent(input, 3, 'SocialInteractionCompleted', relation.payload),
    makeMemoryEvent(input, 4, {
      agentId: agent.agentId,
      kind: 'action',
      summary,
      status: 'succeeded',
      tags: ['town-conflict', 'attack', payload.targetAgentId],
    }),
    makeMemoryEvent(input, 5, {
      agentId: payload.targetAgentId,
      kind: 'social-interaction',
      summary,
      status: 'succeeded',
      tags: ['town-conflict', 'attack', agent.agentId],
    }),
  ];
  appendConflictWitnessFallout({
    input,
    events,
    witnessAgentIds: context.witnessAgentIds,
    attackerAgentId: agent.agentId,
    summary: `Witnessed attack: ${summary}`,
    witnessPenaltyScale: policy.witnessAttitudePenaltyScale,
  });
  return events;
}

export function handleAgentInterveneCommand(input: {
  readonly command: CommandEnvelope<'AgentIntervene', unknown>;
  readonly projection: WorldProjection;
  readonly conflict?: TownConflictPolicy;
  readonly nextSequence: number;
}): WorldEvent[] {
  const agent = resolveCommandAgent(input.projection, input.command);
  if (input.conflict === undefined) {
    return rejectCommand(input, 'AgentIntervene', 'missing conflict policy');
  }
  const payloadResult = parsePayload(() => assertAgentIntervenePayload(input.command.payload));
  if (payloadResult.status === 'invalid') {
    return rejectCommand(input, 'AgentIntervene', payloadResult.reason);
  }
  const payload = payloadResult.payload;
  if (
    agent.agentId === payload.attackerAgentId ||
    agent.agentId === payload.targetAgentId ||
    payload.attackerAgentId === payload.targetAgentId
  ) {
    return rejectCommand(input, 'AgentIntervene', 'intervention requires three distinct agents');
  }
  const attacker = input.projection.agents[payload.attackerAgentId];
  const target = input.projection.agents[payload.targetAgentId];
  if (attacker === undefined || target === undefined) {
    return rejectCommand(input, 'AgentIntervene', 'unknown conflict party');
  }
  if (
    agent.locationId === null ||
    agent.locationId !== attacker.locationId ||
    agent.locationId !== target.locationId
  ) {
    return rejectCommand(
      input,
      'AgentIntervene',
      'intervention requires co-location with both conflict parties',
    );
  }
  const relationKey = createDirectedSocialRelationKey({
    sourceAgentId: payload.attackerAgentId,
    targetAgentId: payload.targetAgentId,
  });
  const hostility = input.projection.socialRelations[relationKey];
  if (hostility === undefined || hostility.relationScore >= 0) {
    return rejectCommand(input, 'AgentIntervene', 'no active conflict to mediate');
  }
  const locationId = agent.locationId;
  const repair = requireSignalDeltas('repair');
  const summary = `${agent.agentId} intervened between ${payload.attackerAgentId} and ${payload.targetAgentId}: ${payload.statement}`;
  const relation = planSocialInteractionEvent({
    projection: input.projection,
    sourceAgentId: payload.attackerAgentId,
    targetAgentId: payload.targetAgentId,
    summary,
    relationDelta: repair.relationDelta,
    attitudeDelta: repair.attitudeDelta,
    outcomeSignals: ['repair'],
  });
  if (relation.status === 'invalid') {
    return rejectCommand(input, 'AgentIntervene', relation.reason);
  }
  const partyIds = new Set<string>([
    agent.agentId,
    payload.attackerAgentId,
    payload.targetAgentId,
  ]);
  const witnessAgentIds = Object.values(input.projection.agents)
    .filter((candidate) => candidate.locationId === locationId && !partyIds.has(candidate.agentId))
    .map((candidate) => candidate.agentId)
    .sort((left, right) => left.localeCompare(right));
  const events: WorldEvent[] = [
    makeEvent(input, 0, 'InterventionRecorded', {
      conflictId: `conflict-${input.command.id}`,
      intervenerAgentId: agent.agentId,
      attackerAgentId: payload.attackerAgentId,
      targetAgentId: payload.targetAgentId,
      locationId,
      statement: payload.statement,
      witnessAgentIds,
      recordedAt: input.command.issuedAt,
    }),
    makeEvent(input, 1, 'SocialInteractionCompleted', relation.payload),
    makeMemoryEvent(input, 2, {
      agentId: agent.agentId,
      kind: 'action',
      summary,
      status: 'succeeded',
      tags: ['town-conflict', 'intervention', payload.attackerAgentId, payload.targetAgentId],
    }),
    makeMemoryEvent(input, 3, {
      agentId: payload.attackerAgentId,
      kind: 'social-interaction',
      summary,
      status: 'succeeded',
      tags: ['town-conflict', 'intervention', agent.agentId],
    }),
    makeMemoryEvent(input, 4, {
      agentId: payload.targetAgentId,
      kind: 'social-interaction',
      summary,
      status: 'succeeded',
      tags: ['town-conflict', 'intervention', agent.agentId],
    }),
  ];
  appendConflictWitnessMemories({
    input,
    events,
    witnessAgentIds,
    summary: `Witnessed intervention: ${summary}`,
    eventKind: 'intervention',
  });
  return events;
}

export function resolveConflictParties(
  input: {
    readonly command: CommandEnvelope<CoreCommandType, unknown>;
    readonly projection: WorldProjection;
    readonly nextSequence: number;
  },
  targetAgentId: AgentId,
  commandType: 'AgentConfront' | 'AgentAttack',
):
  | {
      readonly target: WorldAgentState;
      readonly locationId: LocationId;
      readonly witnessAgentIds: readonly AgentId[];
    }
  | WorldEvent[] {
  const agent = resolveCommandAgent(input.projection, input.command);
  const target = input.projection.agents[targetAgentId];
  if (target === undefined) {
    return rejectCommand(input, commandType, `unknown target agent ${targetAgentId}`);
  }
  if (agent.agentId === targetAgentId) {
    return rejectCommand(input, commandType, 'cannot target oneself');
  }
  if (agent.locationId === null || agent.locationId !== target.locationId) {
    return rejectCommand(input, commandType, 'conflict requires co-location with the target');
  }
  const partyIds = new Set<string>([agent.agentId, targetAgentId]);
  const witnessAgentIds = Object.values(input.projection.agents)
    .filter(
      (candidate) => candidate.locationId === agent.locationId && !partyIds.has(candidate.agentId),
    )
    .map((candidate) => candidate.agentId)
    .sort((left, right) => left.localeCompare(right));
  return { target, locationId: agent.locationId, witnessAgentIds };
}

export function appendConflictWitnessMemories(input: {
  readonly input: {
    readonly command: CommandEnvelope<CoreCommandType, unknown>;
    readonly projection: WorldProjection;
    readonly nextSequence: number;
  };
  readonly events: WorldEvent[];
  readonly witnessAgentIds: readonly AgentId[];
  readonly summary: string;
  readonly eventKind: 'confrontation' | 'intervention';
}): void {
  for (const witnessAgentId of input.witnessAgentIds) {
    input.events.push(
      makeMemoryEvent(input.input, input.events.length, {
        agentId: witnessAgentId,
        kind: 'observation',
        summary: input.summary,
        status: 'observed',
        tags: ['town-conflict', input.eventKind, 'witness'],
      }),
    );
  }
}

/**
 * Attack fallout on witnesses: each witness's attitude toward the attacker
 * worsens by the scaled hostility deltas (attitude penalty is a world rule,
 * not a self-report), and every witness gains a firsthand observation memory.
 */

export function appendConflictWitnessFallout(input: {
  readonly input: {
    readonly command: CommandEnvelope<CoreCommandType, unknown>;
    readonly projection: WorldProjection;
    readonly nextSequence: number;
  };
  readonly events: WorldEvent[];
  readonly witnessAgentIds: readonly AgentId[];
  readonly attackerAgentId: AgentId;
  readonly summary: string;
  readonly witnessPenaltyScale: number;
}): void {
  const hostility = requireSignalDeltas('hostility');
  for (const witnessAgentId of input.witnessAgentIds) {
    const relation = planSocialInteractionEvent({
      projection: input.input.projection,
      sourceAgentId: witnessAgentId,
      targetAgentId: input.attackerAgentId,
      summary: input.summary,
      relationDelta: Number((hostility.relationDelta * input.witnessPenaltyScale).toFixed(6)),
      attitudeDelta: Number((hostility.attitudeDelta * input.witnessPenaltyScale).toFixed(6)),
      outcomeSignals: ['hostility'],
    });
    if (relation.status === 'invalid') {
      throw new Error(`conflict witness outcome invalid: ${relation.reason}`);
    }
    input.events.push(
      makeEvent(input.input, input.events.length, 'SocialInteractionCompleted', relation.payload),
      makeMemoryEvent(input.input, input.events.length + 1, {
        agentId: witnessAgentId,
        kind: 'observation',
        summary: input.summary,
        status: 'observed',
        tags: ['town-conflict', 'attack', 'witness'],
      }),
    );
  }
}
