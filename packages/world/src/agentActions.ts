import {
  buyFromPool,
  getInventoryQuantity,
  planProduction,
  sellToPool,
} from '@aivilization/economy';
import { createShortTermMemoryRecord } from '@aivilization/memory';
import {
  advanceClock,
  createEventEnvelope,
  type CommandEnvelope,
  type CoreCommandType,
} from '@aivilization/sim-core';
import {
  accumulateEducation,
  applyEnergyRecovery,
  applyLaborPhysiologyCost,
  applySocialInteraction,
  calculateApplicationQuota,
  createDirectedSocialRelationKey,
  evaluateResidentialTierUpgrade,
  evaluateOccupationApplication,
  isIncapacitated,
  type ResidentialTierUpgradePolicy,
} from '@aivilization/society';
import {
  assertAdvanceSimulationTimePayload,
  assertAgentApplyJobPayload,
  assertAgentEatPayload,
  assertAgentProducePayload,
  assertAgentUpgradeResidentialTierPayload,
  assertAgentSleepPayload,
  assertAgentSocializePayload,
  assertAgentStudyPayload,
  assertAgentTradePayload,
  assertAgentWorkPayload,
} from './commands';
import type { WorldEvent } from './events';
import type { WorldProjection } from './projection';

export type WorldCommandPolicies = {
  readonly satietyRecoveryByCommodity: Readonly<Record<string, number>>;
  readonly maxSatiety: number;
  readonly wageCalculator: (occupationName: string) => number;
  readonly laborCost: {
    readonly energyCostPerHour: number;
    readonly satietyCostPerHour: number;
  };
  readonly criticalThresholds: {
    readonly energy: number;
    readonly health: number;
  };
  readonly sleep?: {
    readonly energyRecoveryPerSecond: number;
    readonly maxEnergy: number;
  };
  readonly jobApplication?: {
    readonly populationEducationScores: readonly number[];
    readonly quotaByResidentialTier: readonly number[];
  };
  readonly residentialTierUpgrade?: ResidentialTierUpgradePolicy;
};

export function dispatchWorldCommand(input: {
  readonly command: CommandEnvelope<CoreCommandType, unknown>;
  readonly projection: WorldProjection;
  readonly policies: WorldCommandPolicies;
  readonly nextSequence: number;
}): WorldEvent[] {
  switch (input.command.type) {
    case 'AdvanceSimulationTime':
      return handleAdvanceSimulationTimeCommand({
        command: input.command as CommandEnvelope<'AdvanceSimulationTime', unknown>,
        projection: input.projection,
        nextSequence: input.nextSequence,
      });
    case 'AgentEat':
      return handleAgentEatCommand({
        command: input.command as CommandEnvelope<'AgentEat', unknown>,
        projection: input.projection,
        satietyRecoveryByCommodity: input.policies.satietyRecoveryByCommodity,
        maxSatiety: input.policies.maxSatiety,
        nextSequence: input.nextSequence,
      });
    case 'AgentStudy':
      return handleAgentStudyCommand({
        command: input.command as CommandEnvelope<'AgentStudy', unknown>,
        projection: input.projection,
        nextSequence: input.nextSequence,
      });
    case 'AgentSleep':
      if (input.policies.sleep === undefined) {
        return rejectCommand(input, 'AgentSleep', 'missing sleep policy');
      }
      return handleAgentSleepCommand({
        command: input.command as CommandEnvelope<'AgentSleep', unknown>,
        projection: input.projection,
        energyRecoveryPerSecond: input.policies.sleep.energyRecoveryPerSecond,
        maxEnergy: input.policies.sleep.maxEnergy,
        nextSequence: input.nextSequence,
      });
    case 'AgentWork':
      return handleAgentWorkCommand({
        command: input.command as CommandEnvelope<'AgentWork', unknown>,
        projection: input.projection,
        wageCalculator: input.policies.wageCalculator,
        laborCost: input.policies.laborCost,
        criticalThresholds: input.policies.criticalThresholds,
        nextSequence: input.nextSequence,
      });
    case 'AgentProduce':
      return handleAgentProduceCommand({
        command: input.command as CommandEnvelope<'AgentProduce', unknown>,
        projection: input.projection,
        nextSequence: input.nextSequence,
      });
    case 'AgentTrade':
      return handleAgentTradeCommand({
        command: input.command as CommandEnvelope<'AgentTrade', unknown>,
        projection: input.projection,
        nextSequence: input.nextSequence,
      });
    case 'AgentApplyJob':
      if (input.policies.jobApplication === undefined) {
        return rejectCommand(input, 'AgentApplyJob', 'missing job application policy');
      }
      return handleAgentApplyJobCommand({
        command: input.command as CommandEnvelope<'AgentApplyJob', unknown>,
        projection: input.projection,
        populationEducationScores: input.policies.jobApplication.populationEducationScores,
        quotaByResidentialTier: input.policies.jobApplication.quotaByResidentialTier,
        nextSequence: input.nextSequence,
      });
    case 'AgentUpgradeResidentialTier':
      if (input.policies.residentialTierUpgrade === undefined) {
        return rejectCommand(
          input,
          'AgentUpgradeResidentialTier',
          'missing residential tier upgrade policy',
        );
      }
      return handleAgentUpgradeResidentialTierCommand({
        command: input.command as CommandEnvelope<'AgentUpgradeResidentialTier', unknown>,
        projection: input.projection,
        policy: input.policies.residentialTierUpgrade,
        nextSequence: input.nextSequence,
      });
    case 'AgentSocialize':
      return handleAgentSocializeCommand({
        command: input.command as CommandEnvelope<'AgentSocialize', unknown>,
        projection: input.projection,
        nextSequence: input.nextSequence,
      });
    default:
      throw new Error(`unsupported world command ${input.command.type}`);
  }
}

export function handleAdvanceSimulationTimeCommand(input: {
  readonly command: CommandEnvelope<'AdvanceSimulationTime', unknown>;
  readonly projection: WorldProjection;
  readonly nextSequence: number;
}): WorldEvent[] {
  const payload = assertAdvanceSimulationTimePayload(input.command.payload);
  const previous = input.projection.clock;
  const next = advanceClock(previous, payload.deltaMs);

  return [
    makeEvent(input, 0, 'SimulationTimeAdvanced', {
      previous: { ...previous },
      next: { ...next },
      deltaMs: payload.deltaMs,
    }),
  ];
}

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

export function handleAgentSleepCommand(input: {
  readonly command: CommandEnvelope<'AgentSleep', unknown>;
  readonly projection: WorldProjection;
  readonly energyRecoveryPerSecond: number;
  readonly maxEnergy: number;
  readonly nextSequence: number;
}): WorldEvent[] {
  const agent = resolveCommandAgent(input.projection, input.command);
  const payloadResult = parsePayload(() => assertAgentSleepPayload(input.command.payload));
  if (payloadResult.status === 'invalid') {
    return rejectCommand(input, 'AgentSleep', payloadResult.reason);
  }

  const physiologyResult = parsePayload(() =>
    applyEnergyRecovery({
      ...agent.physiology,
      durationSeconds: payloadResult.payload.durationSeconds,
      energyRecoveryPerSecond: input.energyRecoveryPerSecond,
      maxEnergy: input.maxEnergy,
    }),
  );
  if (physiologyResult.status === 'invalid') {
    return rejectCommand(input, 'AgentSleep', physiologyResult.reason);
  }

  return [
    makeEvent(input, 0, 'PhysiologyChanged', {
      agentId: agent.agentId,
      previous: agent.physiology,
      next: physiologyResult.payload,
      reason: 'sleep',
    }),
    makeMemoryEvent(input, 1, {
      summary: `Slept for ${payloadResult.payload.durationSeconds} seconds.`,
      status: 'succeeded',
      tags: ['sleep'],
      consolidationHint: {
        kind: 'habit',
        patternKey: 'sleep',
        statement: 'Sleeps to restore energy.',
      },
    }),
  ];
}

export function handleAgentWorkCommand(input: {
  readonly command: CommandEnvelope<'AgentWork', unknown>;
  readonly projection: WorldProjection;
  readonly wageCalculator: (occupationName: string) => number;
  readonly laborCost: {
    readonly energyCostPerHour: number;
    readonly satietyCostPerHour: number;
  };
  readonly criticalThresholds: {
    readonly energy: number;
    readonly health: number;
  };
  readonly nextSequence: number;
}): WorldEvent[] {
  const agent = resolveCommandAgent(input.projection, input.command);
  const payloadResult = parsePayload(() => assertAgentWorkPayload(input.command.payload));
  if (payloadResult.status === 'invalid') {
    return rejectCommand(input, 'AgentWork', payloadResult.reason);
  }

  const payload = payloadResult.payload;
  if (agent.job !== payload.occupationName) {
    return rejectCommand(
      input,
      'AgentWork',
      `agent job ${agent.job ?? 'none'} does not match ${payload.occupationName}`,
    );
  }

  if (
    isIncapacitated({
      energy: agent.physiology.energy,
      health: agent.physiology.health,
      energyCriticalThreshold: input.criticalThresholds.energy,
      healthCriticalThreshold: input.criticalThresholds.health,
    })
  ) {
    return rejectCommand(input, 'AgentWork', 'agent is incapacitated');
  }

  const wage = input.wageCalculator(payload.occupationName);
  if (!Number.isFinite(wage) || wage < 0) {
    return rejectCommand(input, 'AgentWork', 'wageCalculator must return a non-negative wage');
  }
  const nextPhysiology = applyLaborPhysiologyCost({
    ...agent.physiology,
    laborSeconds: payload.laborSeconds,
    energyCostPerHour: input.laborCost.energyCostPerHour,
    satietyCostPerHour: input.laborCost.satietyCostPerHour,
  });

  return [
    makeEvent(input, 0, 'WagePaid', {
      agentId: agent.agentId,
      occupationName: payload.occupationName,
      amount: wage,
    }),
    makeEvent(input, 1, 'PhysiologyChanged', {
      agentId: agent.agentId,
      previous: agent.physiology,
      next: nextPhysiology,
      reason: 'work',
    }),
    makeMemoryEvent(input, 2, {
      summary: `Worked as ${payload.occupationName} for ${payload.laborSeconds} seconds.`,
      status: 'succeeded',
      tags: ['work', payload.occupationName],
      consolidationHint: {
        kind: 'habit',
        patternKey: `work:${payload.occupationName}`,
        statement: `Works as ${payload.occupationName} when conditions allow.`,
      },
    }),
  ];
}

export function handleAgentProduceCommand(input: {
  readonly command: CommandEnvelope<'AgentProduce', unknown>;
  readonly projection: WorldProjection;
  readonly nextSequence: number;
}): WorldEvent[] {
  const agent = resolveCommandAgent(input.projection, input.command);
  const payloadResult = parsePayload(() => assertAgentProducePayload(input.command.payload));
  if (payloadResult.status === 'invalid') {
    return rejectCommand(input, 'AgentProduce', payloadResult.reason);
  }

  const payload = payloadResult.payload;
  const productionPlan = planProduction({
    commodityName: payload.commodityName,
    quantity: payload.quantity,
    agent: {
      residentialTier: agent.residentialTier,
      energy: agent.physiology.energy,
      satiety: agent.physiology.satiety,
      availableLaborSeconds: payload.availableLaborSeconds,
      inventory: agent.inventory,
    },
  });

  if (productionPlan.status === 'rejected') {
    return rejectCommand(
      input,
      'AgentProduce',
      `${productionPlan.reason}: ${productionPlan.detail}`,
    );
  }

  return [
    makeEvent(input, 0, 'CommodityProduced', {
      agentId: agent.agentId,
      produced: productionPlan.produced,
      consumedInputs: productionPlan.consumedInputs,
      energyCost: productionPlan.energyCost,
      satietyCost: productionPlan.satietyCost,
      laborSeconds: productionPlan.laborSeconds,
    }),
    makeMemoryEvent(input, 1, {
      summary: `Produced ${payload.quantity} ${payload.commodityName}.`,
      status: 'succeeded',
      tags: ['produce', payload.commodityName],
      consolidationHint: {
        kind: 'habit',
        patternKey: `produce:${payload.commodityName}`,
        statement: `Produces ${payload.commodityName} when resources are available.`,
      },
    }),
  ];
}

export function handleAgentTradeCommand(input: {
  readonly command: CommandEnvelope<'AgentTrade', unknown>;
  readonly projection: WorldProjection;
  readonly nextSequence: number;
}): WorldEvent[] {
  const agent = resolveCommandAgent(input.projection, input.command);
  const payloadResult = parsePayload(() => assertAgentTradePayload(input.command.payload));
  if (payloadResult.status === 'invalid') {
    return rejectCommand(input, 'AgentTrade', payloadResult.reason);
  }

  const payload = payloadResult.payload;
  const pool = input.projection.marketPools[payload.commodityName];
  if (pool === undefined) {
    return rejectCommand(input, 'AgentTrade', `missing AMM pool for ${payload.commodityName}`);
  }

  if (payload.side === 'buy') {
    const tradeResult = parsePayload(() => buyFromPool(pool, payload.quantity));
    if (tradeResult.status === 'invalid') {
      return rejectCommand(input, 'AgentTrade', tradeResult.reason);
    }
    const currencyRequired = tradeResult.payload.currencyDelta;
    if (agent.balance < currencyRequired) {
      return rejectCommand(
        input,
        'AgentTrade',
        `insufficient balance: required ${currencyRequired}, available ${agent.balance}`,
      );
    }

    return createTradeEvents(
      input,
      payload.side,
      payload.commodityName,
      payload.quantity,
      currencyRequired,
      tradeResult.payload.poolAfter,
      tradeResult.payload.moneySupplyDelta,
    );
  }

  const available = getInventoryQuantity(agent.inventory, payload.commodityName);
  if (available < payload.quantity) {
    return rejectCommand(
      input,
      'AgentTrade',
      `insufficient ${payload.commodityName}: required ${payload.quantity}, available ${available}`,
    );
  }

  const tradeResult = parsePayload(() => sellToPool(pool, payload.quantity));
  if (tradeResult.status === 'invalid') {
    return rejectCommand(input, 'AgentTrade', tradeResult.reason);
  }

  return createTradeEvents(
    input,
    payload.side,
    payload.commodityName,
    payload.quantity,
    -tradeResult.payload.currencyDelta,
    tradeResult.payload.poolAfter,
    tradeResult.payload.moneySupplyDelta,
  );
}

export function handleAgentApplyJobCommand(input: {
  readonly command: CommandEnvelope<'AgentApplyJob', unknown>;
  readonly projection: WorldProjection;
  readonly populationEducationScores: readonly number[];
  readonly quotaByResidentialTier: readonly number[];
  readonly nextSequence: number;
}): WorldEvent[] {
  const agent = resolveCommandAgent(input.projection, input.command);
  const payloadResult = parsePayload(() => assertAgentApplyJobPayload(input.command.payload));
  if (payloadResult.status === 'invalid') {
    return rejectCommand(input, 'AgentApplyJob', payloadResult.reason);
  }

  const quotaResult = parsePayload(() =>
    calculateApplicationQuota({
      residentialTier: agent.residentialTier,
      quotaByResidentialTier: input.quotaByResidentialTier,
    }),
  );
  if (quotaResult.status === 'invalid') {
    return rejectCommand(input, 'AgentApplyJob', quotaResult.reason);
  }

  const usedApplications = input.projection.jobApplications.filter(
    (application) => application.agentId === agent.agentId,
  ).length;
  if (usedApplications >= quotaResult.payload) {
    return rejectCommand(
      input,
      'AgentApplyJob',
      `application quota exceeded: allowed ${quotaResult.payload}, used ${usedApplications}`,
    );
  }

  const payload = payloadResult.payload;
  const applicationResult = parsePayload(() =>
    evaluateOccupationApplication({
      occupationName: payload.occupationName,
      agent: {
        residentialTier: agent.residentialTier,
        educationScore: agent.educationScore,
        inventory: agent.inventory,
      },
      populationEducationScores: input.populationEducationScores,
    }),
  );
  if (applicationResult.status === 'invalid') {
    return rejectCommand(input, 'AgentApplyJob', applicationResult.reason);
  }
  if (applicationResult.payload.status === 'rejected') {
    return rejectCommand(
      input,
      'AgentApplyJob',
      `${applicationResult.payload.reason}: ${applicationResult.payload.detail}`,
    );
  }

  const consumedInventory = applicationResult.payload.consumedInventory;
  const prerequisiteEvents: WorldEvent[] = Object.entries(consumedInventory)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([itemName, quantity], index) =>
      makeEvent(input, index, 'InventoryChanged', {
        agentId: agent.agentId,
        itemName,
        delta: -quantity,
        reason: 'job-application-prerequisite',
      }),
    );
  const baseOffset = prerequisiteEvents.length;

  return [
    ...prerequisiteEvents,
    makeEvent(input, baseOffset, 'JobApplicationSubmitted', {
      agentId: agent.agentId,
      occupationName: payload.occupationName,
      residentialTier: agent.residentialTier,
      educationScore: agent.educationScore,
    }),
    makeEvent(input, baseOffset + 1, 'JobAssigned', {
      agentId: agent.agentId,
      occupationName: payload.occupationName,
      previousJob: agent.job,
    }),
    makeMemoryEvent(input, baseOffset + 2, {
      summary: `Applied for ${payload.occupationName} and was assigned.`,
      status: 'succeeded',
      tags: ['apply-job', payload.occupationName],
      consolidationHint: {
        kind: 'habit',
        patternKey: `apply-job:${payload.occupationName}`,
        statement: `Applies for ${payload.occupationName} when qualified.`,
      },
    }),
  ];
}

export function handleAgentUpgradeResidentialTierCommand(input: {
  readonly command: CommandEnvelope<'AgentUpgradeResidentialTier', unknown>;
  readonly projection: WorldProjection;
  readonly policy: ResidentialTierUpgradePolicy;
  readonly nextSequence: number;
}): WorldEvent[] {
  const agent = resolveCommandAgent(input.projection, input.command);
  const payloadResult = parsePayload(() =>
    assertAgentUpgradeResidentialTierPayload(input.command.payload),
  );
  if (payloadResult.status === 'invalid') {
    return rejectCommand(input, 'AgentUpgradeResidentialTier', payloadResult.reason);
  }

  const decision = evaluateResidentialTierUpgrade({
    agent: {
      residentialTier: agent.residentialTier,
      balance: agent.balance,
      educationScore: agent.educationScore,
      inventory: agent.inventory,
    },
    targetResidentialTier: payloadResult.payload.targetResidentialTier,
    policy: input.policy,
  });
  if (decision.status === 'rejected') {
    return rejectCommand(
      input,
      'AgentUpgradeResidentialTier',
      `${decision.reason}: ${decision.detail}`,
    );
  }

  return [
    makeEvent(input, 0, 'ResidentialTierUpgraded', {
      agentId: agent.agentId,
      previousResidentialTier: decision.previousResidentialTier,
      nextResidentialTier: decision.nextResidentialTier,
      currencyCost: decision.currencyCost,
      consumedInventory: decision.consumedInventory,
    }),
    makeMemoryEvent(input, 1, {
      summary: `Upgraded residential tier from ${decision.previousResidentialTier} to ${decision.nextResidentialTier}.`,
      status: 'succeeded',
      tags: ['upgrade-residential-tier', String(decision.nextResidentialTier)],
      consolidationHint: {
        kind: 'habit',
        patternKey: `upgrade-residential-tier:${decision.nextResidentialTier}`,
        statement: `Invests in residential tier ${decision.nextResidentialTier} when upgrade requirements are met.`,
      },
    }),
  ];
}

export function handleAgentSocializeCommand(input: {
  readonly command: CommandEnvelope<'AgentSocialize', unknown>;
  readonly projection: WorldProjection;
  readonly nextSequence: number;
}): WorldEvent[] {
  const agent = resolveCommandAgent(input.projection, input.command);
  const payloadResult = parsePayload(() => assertAgentSocializePayload(input.command.payload));
  if (payloadResult.status === 'invalid') {
    return rejectCommand(input, 'AgentSocialize', payloadResult.reason);
  }

  const payload = payloadResult.payload;
  if (input.projection.agents[payload.targetAgentId] === undefined) {
    return rejectCommand(input, 'AgentSocialize', `unknown target agent ${payload.targetAgentId}`);
  }

  const relationKeyResult = parsePayload(() =>
    createDirectedSocialRelationKey({
      sourceAgentId: agent.agentId,
      targetAgentId: payload.targetAgentId,
    }),
  );
  if (relationKeyResult.status === 'invalid') {
    return rejectCommand(input, 'AgentSocialize', relationKeyResult.reason);
  }

  const currentRelation = input.projection.socialRelations[relationKeyResult.payload];
  const relationResult = parsePayload(() =>
    applySocialInteraction({
      sourceAgentId: agent.agentId,
      targetAgentId: payload.targetAgentId,
      ...(currentRelation === undefined ? {} : { current: currentRelation }),
      relationDelta: payload.relationDelta,
      attitudeDelta: payload.attitudeDelta,
      summary: payload.summary,
    }),
  );
  if (relationResult.status === 'invalid') {
    return rejectCommand(input, 'AgentSocialize', relationResult.reason);
  }

  return [
    makeEvent(input, 0, 'SocialInteractionCompleted', {
      sourceAgentId: agent.agentId,
      targetAgentId: payload.targetAgentId,
      summary: payload.summary.trim(),
      relationDelta: payload.relationDelta,
      attitudeDelta: payload.attitudeDelta,
      nextRelation: relationResult.payload,
    }),
    makeMemoryEvent(input, 1, {
      kind: 'social-interaction',
      summary: payload.summary,
      status: 'succeeded',
      tags: ['socialize', payload.targetAgentId],
      consolidationHint: {
        kind: 'social',
        targetAgentId: payload.targetAgentId,
        relationDelta: payload.relationDelta,
        attitudeDelta: payload.attitudeDelta,
        summary: payload.summary.trim(),
      },
    }),
  ];
}

function createTradeEvents(
  input: {
    readonly command: CommandEnvelope<'AgentTrade', unknown>;
    readonly projection: WorldProjection;
    readonly nextSequence: number;
  },
  side: 'buy' | 'sell',
  commodityName: string,
  commodityQuantity: number,
  currencyQuantity: number,
  poolAfter: Extract<WorldEvent, { readonly type: 'TradeExecuted' }>['payload']['poolAfter'],
  moneySupplyDelta: number,
): WorldEvent[] {
  const agent = resolveCommandAgent(input.projection, input.command);

  return [
    makeEvent(input, 0, 'TradeExecuted', {
      agentId: agent.agentId,
      side,
      commodityName,
      commodityQuantity,
      currencyQuantity,
      poolAfter,
      moneySupplyDelta,
    }),
    makeMemoryEvent(input, 1, {
      summary: `${side === 'buy' ? 'Bought' : 'Sold'} ${commodityQuantity} ${commodityName}.`,
      status: 'succeeded',
      tags: ['trade', side, commodityName],
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
    readonly kind?: Parameters<typeof createShortTermMemoryRecord>[0]['kind'];
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
      kind: memory.kind ?? 'action',
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
