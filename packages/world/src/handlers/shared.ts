import { createMemoryProvenance, createShortTermMemoryRecord } from '@aivilization/memory';
import {
  asEventId,
  createEventEnvelope,
  type AgentId,
  type CommandEnvelope,
  type CoreCommandType,
} from '@aivilization/sim-core';
import {
  applySocialInteraction,
  createDirectedSocialRelationKey,
  resolveResidentialPhysiologyCap,
  resolveSocialSignalDeltas,
  type ResidentialPhysiologyCapPolicy,
} from '@aivilization/society';
import {
  EXCLUSIVE_AGENT_ACTIVITY_TIME_POLICY_VERSION,
  type AgentActivityKind,
  type AgentActivityTimeCommittedPayload,
  type WorldEvent,
} from '../events';
import type { WorldAgentState, WorldProjection } from '../projection';

/**
 * Shared context and helpers for the world command handlers. Everything here
 * is a pure function of the command envelope and the projection — settlement
 * stays deterministic and replayable by construction.
 */
export type WorldCommandHandlerInput = {
  readonly command: CommandEnvelope<CoreCommandType, unknown>;
  readonly projection: WorldProjection;
  readonly nextSequence: number;
};

export function copyHumanAttribution(command: CommandEnvelope) {
  return command.humanAttribution === undefined
    ? {}
    : {
        humanAttribution: {
          ...command.humanAttribution,
          principalRoles: [...command.humanAttribution.principalRoles],
        },
      };
}

export function planSocialInteractionEvent(input: {
  readonly projection: WorldProjection;
  readonly sourceAgentId: AgentId;
  readonly targetAgentId: AgentId;
  readonly summary: string;
  readonly relationDelta: number;
  readonly attitudeDelta: number;
  readonly outcomePolicyVersion?: string;
  readonly outcomeSignals?: readonly string[];
  readonly outcomeSignalSeverities?: readonly {
    readonly signal: string;
    readonly severity: number;
  }[];
}):
  | {
      readonly status: 'valid';
      readonly payload: Extract<
        WorldEvent,
        { readonly type: 'SocialInteractionCompleted' }
      >['payload'];
    }
  | { readonly status: 'invalid'; readonly reason: string } {
  const relationKeyResult = parsePayload(() =>
    createDirectedSocialRelationKey({
      sourceAgentId: input.sourceAgentId,
      targetAgentId: input.targetAgentId,
    }),
  );
  if (relationKeyResult.status === 'invalid') {
    return relationKeyResult;
  }

  const currentRelation = input.projection.socialRelations[relationKeyResult.payload];
  const relationResult = parsePayload(() =>
    applySocialInteraction({
      sourceAgentId: input.sourceAgentId,
      targetAgentId: input.targetAgentId,
      ...(currentRelation === undefined ? {} : { current: currentRelation }),
      relationDelta: input.relationDelta,
      attitudeDelta: input.attitudeDelta,
      summary: input.summary,
    }),
  );
  if (relationResult.status === 'invalid') {
    return relationResult;
  }

  return {
    status: 'valid',
    payload: {
      sourceAgentId: input.sourceAgentId,
      targetAgentId: input.targetAgentId,
      summary: input.summary.trim(),
      relationDelta: input.relationDelta,
      attitudeDelta: input.attitudeDelta,
      ...(input.outcomePolicyVersion === undefined
        ? {}
        : { outcomePolicyVersion: input.outcomePolicyVersion }),
      ...(input.outcomeSignals === undefined ? {} : { outcomeSignals: [...input.outcomeSignals] }),
      ...(input.outcomeSignalSeverities === undefined
        ? {}
        : {
            outcomeSignalSeverities: input.outcomeSignalSeverities.map((entry) => ({ ...entry })),
          }),
      nextRelation: relationResult.payload,
    },
  };
}

export function resolveCommandAgent(
  projection: WorldProjection,
  command: CommandEnvelope<CoreCommandType, unknown>,
) {
  if (command.actorId === undefined) {
    throw new Error(`${command.type} requires actorId`);
  }
  const agent = projection.agents[command.actorId];
  if (agent === undefined) {
    throw new Error(`unknown agent ${command.actorId}`);
  }

  return agent;
}

export function parsePayload<TPayload>(
  parse: () => TPayload,
):
  | { readonly status: 'valid'; readonly payload: TPayload }
  | { readonly status: 'invalid'; readonly reason: string } {
  try {
    return { status: 'valid', payload: parse() };
  } catch (error) {
    return { status: 'invalid', reason: error instanceof Error ? error.message : String(error) };
  }
}

export function rejectCommand(
  input: {
    readonly command: CommandEnvelope<CoreCommandType, unknown>;
    readonly projection: WorldProjection;
    readonly nextSequence: number;
  },
  commandType: CoreCommandType,
  reason: string,
): WorldEvent[] {
  const agent = resolveCommandAgent(input.projection, input.command);

  return [
    makeEvent(input, 0, 'ActionRejected', {
      agentId: agent.agentId,
      commandType,
      reason,
    }),
    makeMemoryEvent(input, 1, {
      summary: `${commandType} failed: ${reason}`,
      status: 'failed',
      tags: ['failed-action', commandType],
      consolidationHint: {
        kind: 'caution',
        patternKey: `${commandType}:${reason}`,
        statement: `${commandType} can fail when ${reason}.`,
      },
    }),
  ];
}

export function rejectBusyAgentCommand(input: {
  readonly command: CommandEnvelope<CoreCommandType, unknown>;
  readonly projection: WorldProjection;
  readonly nextSequence: number;
}): WorldEvent[] | undefined {
  const agent = resolveCommandAgent(input.projection, input.command);
  const activeActivity = input.projection.activityTimeByAgent[agent.agentId];
  if (activeActivity === undefined || input.projection.clock.now >= activeActivity.availableAt) {
    return undefined;
  }
  return rejectCommand(
    input,
    input.command.type,
    `agent is busy with ${activeActivity.activity} until simulation time ${activeActivity.availableAt} (now ${input.projection.clock.now})`,
  );
}

export function makeMemoryEvent(
  input: {
    readonly command: CommandEnvelope<CoreCommandType, unknown>;
    readonly projection: WorldProjection;
    readonly nextSequence: number;
  },
  offset: number,
  memory: {
    readonly agentId?: AgentId;
    readonly kind?: Parameters<typeof createShortTermMemoryRecord>[0]['kind'];
    readonly summary: string;
    readonly status: Parameters<typeof createShortTermMemoryRecord>[0]['status'];
    readonly sourceEventOffsets?: readonly number[];
    readonly tags: readonly string[];
    readonly consolidationHint?: Parameters<
      typeof createShortTermMemoryRecord
    >[0]['consolidationHint'];
    readonly provenance?: Parameters<typeof createShortTermMemoryRecord>[0]['provenance'];
  },
): WorldEvent {
  const agentId = memory.agentId ?? resolveCommandAgent(input.projection, input.command).agentId;
  if (input.projection.agents[agentId] === undefined) {
    throw new Error(`unknown agent ${agentId}`);
  }
  return makeEvent(input, offset, 'ShortTermMemoryRecorded', {
    record: createShortTermMemoryRecord({
      id: `${input.command.id}:memory:${offset}`,
      agentId,
      kind: memory.kind ?? 'action',
      status: memory.status,
      summary: memory.summary,
      occurredAt: input.command.issuedAt,
      importanceScore: memory.status === 'failed' ? 0.8 : 0.6,
      source: {
        commandId: input.command.id,
        eventIds: createMemorySourceEventIds({
          commandId: input.command.id,
          offset,
          ...(memory.sourceEventOffsets === undefined
            ? {}
            : { sourceEventOffsets: memory.sourceEventOffsets }),
        }),
      },
      tags: memory.tags,
      ...(memory.consolidationHint === undefined
        ? {}
        : { consolidationHint: memory.consolidationHint }),
      // Command-settled memories record what the agent itself did, said, or
      // directly observed: firsthand unless a caller overrides.
      provenance: memory.provenance ?? createMemoryProvenance({ kind: 'firsthand' }),
    }),
  });
}

export function createMemorySourceEventIds(input: {
  readonly commandId: CommandEnvelope<CoreCommandType, unknown>['id'];
  readonly offset: number;
  readonly sourceEventOffsets?: readonly number[];
}) {
  const sourceEventOffsets =
    input.sourceEventOffsets ?? Array.from({ length: input.offset }, (_, index) => index);
  return sourceEventOffsets.map((offset) => asEventId(`${input.commandId}:event:${offset}`));
}

export function stableUnique<TValue>(values: readonly TValue[]): readonly TValue[] {
  return [...new Set(values)];
}

export function resolveRecoveryMaximum(input: {
  readonly agent: WorldAgentState;
  readonly policy: ResidentialPhysiologyCapPolicy | undefined;
  readonly fallback: number;
  readonly field: 'maxEnergy' | 'maxSatiety' | 'maxHealth';
}):
  | {
      readonly status: 'accepted';
      readonly value: number;
    }
  | {
      readonly status: 'rejected';
      readonly reason: string;
    } {
  if (input.policy === undefined) {
    return { status: 'accepted', value: input.fallback };
  }

  const decision = resolveResidentialPhysiologyCap({
    residentialTier: input.agent.residentialTier,
    policy: input.policy,
  });
  if (decision.status === 'rejected') {
    return { status: 'rejected', reason: decision.detail };
  }

  return { status: 'accepted', value: decision.cap[input.field] };
}

export function makeEvent<TType extends WorldEvent['type']>(
  input: {
    readonly command: CommandEnvelope<CoreCommandType, unknown>;
    readonly nextSequence: number;
  },
  offset: number,
  type: TType,
  payload: Extract<WorldEvent, { readonly type: TType }>['payload'],
): Extract<WorldEvent, { readonly type: TType }> {
  return createEventEnvelope({
    id: `${input.command.id}:event:${offset}`,
    simulationId: input.command.simulationId,
    commandId: input.command.id,
    type,
    payload,
    occurredAt: input.command.issuedAt,
    sequence: input.nextSequence + offset,
  }) as unknown as Extract<WorldEvent, { readonly type: TType }>;
}

export function makeAgentActivityTimeCommittedEvent(
  input: {
    readonly command: CommandEnvelope<CoreCommandType, unknown>;
    readonly projection: WorldProjection;
    readonly nextSequence: number;
  },
  offset: number,
  activity: {
    readonly agentId: AgentId;
    readonly activity: AgentActivityKind;
    readonly commandType: CoreCommandType;
    readonly durationSeconds: number;
    readonly settlementTiming?: AgentActivityTimeCommittedPayload['settlementTiming'];
  },
): Extract<WorldEvent, { readonly type: 'AgentActivityTimeCommitted' }> {
  if (!Number.isFinite(activity.durationSeconds) || activity.durationSeconds < 0) {
    throw new Error('agent activity durationSeconds must be non-negative finite');
  }
  const availableAt = input.projection.clock.now + activity.durationSeconds * 1000;
  if (!Number.isFinite(availableAt)) {
    throw new Error('agent activity availableAt must be finite');
  }
  return makeEvent(input, offset, 'AgentActivityTimeCommitted', {
    ...activity,
    policyVersion: EXCLUSIVE_AGENT_ACTIVITY_TIME_POLICY_VERSION,
    settlementTiming: activity.settlementTiming ?? 'effects-at-commit',
    startedAt: input.projection.clock.now,
    availableAt,
  });
}

export function requireSignalDeltas(signal: string): {
  readonly relationDelta: number;
  readonly attitudeDelta: number;
} {
  const deltas = resolveSocialSignalDeltas(signal);
  if (deltas === undefined) {
    throw new Error(`unknown social signal ${signal}`);
  }
  return deltas;
}

/** Witnesses saw the conflict with their own eyes: firsthand observations. */
