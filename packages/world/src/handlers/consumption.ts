import { getInventoryQuantity } from '@aivilization/economy';
import type { CommandEnvelope } from '@aivilization/sim-core';
import { resolveCommodityConsumptionRule, type ConsumptionPolicy } from '@aivilization/society';
import { assertAgentConsumePayload } from '../commands';
import type { WorldEvent } from '../events';
import type { WorldProjection } from '../projection';
import {
  makeEvent,
  makeMemoryEvent,
  parsePayload,
  rejectCommand,
  resolveCommandAgent,
} from './shared';

export function handleAgentConsumeCommand(input: {
  readonly command: CommandEnvelope<'AgentConsume', unknown>;
  readonly projection: WorldProjection;
  readonly policy: ConsumptionPolicy;
  readonly nextSequence: number;
}): WorldEvent[] {
  const agent = resolveCommandAgent(input.projection, input.command);
  const payloadResult = parsePayload(() => assertAgentConsumePayload(input.command.payload));
  if (payloadResult.status === 'invalid') {
    return rejectCommand(input, 'AgentConsume', payloadResult.reason);
  }
  const payload = payloadResult.payload;
  const ruleResult = parsePayload(() =>
    resolveCommodityConsumptionRule(input.policy, payload.commodityName),
  );
  if (ruleResult.status === 'invalid') {
    return rejectCommand(input, 'AgentConsume', ruleResult.reason);
  }
  const rule = ruleResult.payload;
  if (rule === undefined) {
    return rejectCommand(input, 'AgentConsume', `${payload.commodityName} is not a final good`);
  }
  const available = getInventoryQuantity(agent.inventory, payload.commodityName);
  if (available < payload.quantity) {
    return rejectCommand(
      input,
      'AgentConsume',
      `insufficient ${payload.commodityName}: required ${payload.quantity}, available ${available}`,
    );
  }
  const durableLotId = `${input.command.id}:durable:${payload.commodityName}`;
  const events: WorldEvent[] = [
    makeEvent(input, 0, 'CommodityConsumed', {
      agentId: agent.agentId,
      commodityName: payload.commodityName,
      quantity: payload.quantity,
      utilityPoints: rule.utilityPoints * payload.quantity,
      kind: rule.kind,
      policyVersion: input.policy.policyVersion,
      ...(rule.kind === 'durable'
        ? {
            durableLotId,
            expiresAt: input.projection.clock.now + rule.lifetimeSeconds * 1000,
          }
        : {}),
    }),
  ];
  events.push(
    makeMemoryEvent(input, 1, {
      summary:
        rule.kind === 'durable'
          ? `Put ${payload.quantity} ${payload.commodityName} into use.`
          : `Consumed ${payload.quantity} ${payload.commodityName}.`,
      status: 'succeeded',
      tags: ['consume', rule.kind, payload.commodityName],
      sourceEventOffsets: [0],
    }),
  );
  return events;
}
