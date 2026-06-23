import { getInventoryQuantity } from '@aivilization/economy';
import { createShortTermMemoryRecord } from '@aivilization/memory';
import {
  createEventEnvelope,
  type CommandEnvelope,
  type CoreCommandType,
} from '@aivilization/sim-core';
import { accumulateEducation } from '@aivilization/society';
import {
  assertAgentEatPayload,
  assertAgentStudyPayload,
  type AgentEatPayload,
  type AgentStudyPayload,
} from './commands';
import type { WorldEvent } from './events';
import type { WorldProjection } from './projection';

export function handleAgentEatCommand(input: {
  readonly command: CommandEnvelope<'AgentEat', unknown>;
  readonly projection: WorldProjection;
  readonly satietyRecoveryByCommodity: Readonly<Record<string, number>>;
  readonly maxSatiety: number;
  readonly nextSequence: number;
}): WorldEvent[] {
  const agent = resolveCommandAgent(input.projection, input.command);
  const payloadResult = parsePayload(() => assertAgentEatPayload(input.command.payload));
  if (payloadResult.status === 'invalid') {
    return rejectCommand(input, 'AgentEat', payloadResult.reason);
  }

  const payload = payloadResult.payload;
  const available = getInventoryQuantity(agent.inventory, payload.commodityName);
  if (available < payload.quantity) {
    return rejectCommand(
      input,
      'AgentEat',
      `insufficient ${payload.commodityName}: required ${payload.quantity}, available ${available}`,
    );
  }

  const satietyRecovery = input.satietyRecoveryByCommodity[payload.commodityName];
  if (satietyRecovery === undefined) {
    return rejectCommand(
      input,
      'AgentEat',
      `missing satiety recovery for ${payload.commodityName}`,
    );
  }
  if (!Number.isFinite(satietyRecovery) || satietyRecovery < 0) {
    return rejectCommand(input, 'AgentEat', 'satiety recovery must be non-negative');
  }

  const nextPhysiology = {
    ...agent.physiology,
    satiety: Math.min(
      input.maxSatiety,
      agent.physiology.satiety + satietyRecovery * payload.quantity,
    ),
  };

  return [
    makeEvent(input, 0, 'InventoryChanged', {
      agentId: agent.agentId,
      itemName: payload.commodityName,
      delta: -payload.quantity,
      reason: 'eat',
    }),
    makeEvent(input, 1, 'PhysiologyChanged', {
      agentId: agent.agentId,
      previous: agent.physiology,
      next: nextPhysiology,
      reason: 'eat',
    }),
    makeMemoryEvent(input, 2, {
      summary: `Ate ${payload.quantity} ${payload.commodityName}.`,
      status: 'succeeded',
      tags: ['eat', payload.commodityName],
    }),
  ];
}

export function handleAgentStudyCommand(input: {
  readonly command: CommandEnvelope<'AgentStudy', unknown>;
  readonly projection: WorldProjection;
  readonly nextSequence: number;
}): WorldEvent[] {
  const agent = resolveCommandAgent(input.projection, input.command);
  const payloadResult = parsePayload(() => assertAgentStudyPayload(input.command.payload));
  if (payloadResult.status === 'invalid') {
    return rejectCommand(input, 'AgentStudy', payloadResult.reason);
  }

  const nextEducationScore = accumulateEducation({
    currentEducationScore: agent.educationScore,
    educationRatePerSecond: payloadResult.payload.educationRatePerSecond,
    studyDurationSeconds: payloadResult.payload.durationSeconds,
  });

  return [
    makeEvent(input, 0, 'EducationChanged', {
      agentId: agent.agentId,
      previousEducationScore: agent.educationScore,
      nextEducationScore,
      reason: 'study',
    }),
    makeMemoryEvent(input, 1, {
      summary: `Studied for ${payloadResult.payload.durationSeconds} seconds.`,
      status: 'succeeded',
      tags: ['study'],
      consolidationHint: {
        kind: 'habit',
        patternKey: 'study',
        statement: 'Studies to improve education score.',
      },
    }),
  ];
}

function resolveCommandAgent(
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

function parsePayload<TPayload>(
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

function rejectCommand(
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

function makeMemoryEvent(
  input: {
    readonly command: CommandEnvelope<CoreCommandType, unknown>;
    readonly projection: WorldProjection;
    readonly nextSequence: number;
  },
  offset: number,
  memory: {
    readonly summary: string;
    readonly status: 'succeeded' | 'failed';
    readonly tags: readonly string[];
    readonly consolidationHint?: Parameters<
      typeof createShortTermMemoryRecord
    >[0]['consolidationHint'];
  },
): WorldEvent {
  const agent = resolveCommandAgent(input.projection, input.command);
  return makeEvent(input, offset, 'ShortTermMemoryRecorded', {
    record: createShortTermMemoryRecord({
      id: `${input.command.id}:memory:${offset}`,
      agentId: agent.agentId,
      kind: 'action',
      status: memory.status,
      summary: memory.summary,
      occurredAt: input.command.issuedAt,
      importanceScore: memory.status === 'failed' ? 0.8 : 0.6,
      source: {
        commandId: input.command.id,
        eventIds: [],
      },
      tags: memory.tags,
      ...(memory.consolidationHint === undefined
        ? {}
        : { consolidationHint: memory.consolidationHint }),
    }),
  });
}

function makeEvent<TType extends WorldEvent['type']>(
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
