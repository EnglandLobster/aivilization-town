import {
  buyFromPool,
  getInventoryQuantity,
  planProduction,
  sellToPool,
} from '@aivilization/economy';
import { createShortTermMemoryRecord } from '@aivilization/memory';
import {
  asConversationId,
  advanceClock,
  createEventEnvelope,
  createSeededRandom,
  rollProbabilityPercent,
  type AgentId,
  type CommandEnvelope,
  type CoreCommandType,
} from '@aivilization/sim-core';
import {
  accumulateEducation,
  applyEnergyRecovery,
  applyHealthRecovery,
  applyLaborPhysiologyCost,
  applySleepDeprivationHealthDecay,
  applyStochasticIllnessHealthDecay,
  applySocialInteraction,
  calculateStochasticIllnessProbabilityPercent,
  calculateApplicationQuota,
  createDirectedSocialRelationKey,
  evaluateResidentialTierUpgrade,
  evaluateOccupationApplication,
  evaluateSafetyNetSubsidy,
  isIncapacitated,
  type ResidentialTierUpgradePolicy,
  type SafetyNetSubsidyPolicy,
  type SleepDeprivationHealthDecayPolicy,
  type StochasticIllnessPolicy,
} from '@aivilization/society';
import {
  assertAdvanceSimulationTimePayload,
  assertAgentApplyJobPayload,
  assertAgentEatPayload,
  assertAgentMoveToPayload,
  assertAgentObserveLocationPayload,
  assertAgentStartConversationPayload,
  assertAgentProducePayload,
  assertAgentSeeDoctorPayload,
  assertAgentUpgradeResidentialTierPayload,
  assertAgentSleepPayload,
  assertAgentSocializePayload,
  assertAgentStudyPayload,
  assertAgentTradePayload,
  assertAgentWorkPayload,
} from './commands';
import type { WorldEvent } from './events';
import type { WorldAgentState, WorldProjection } from './projection';

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
  readonly seeDoctor?: {
    readonly healthRecoveryPerSecond: number;
    readonly maxHealth: number;
  };
  readonly sleepDeprivation?: SleepDeprivationHealthDecayPolicy;
  readonly stochasticIllness?: StochasticIllnessPolicy;
  readonly safetyNetSubsidy?: SafetyNetSubsidyPolicy;
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
        ...(input.policies.sleepDeprivation === undefined
          ? {}
          : { sleepDeprivation: input.policies.sleepDeprivation }),
        ...(input.policies.stochasticIllness === undefined
          ? {}
          : { stochasticIllness: input.policies.stochasticIllness }),
        ...(input.policies.safetyNetSubsidy === undefined
          ? {}
          : { safetyNetSubsidy: input.policies.safetyNetSubsidy }),
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
    case 'AgentMoveTo':
      return handleAgentMoveToCommand({
        command: input.command as CommandEnvelope<'AgentMoveTo', unknown>,
        projection: input.projection,
        nextSequence: input.nextSequence,
      });
    case 'AgentObserveLocation':
      return handleAgentObserveLocationCommand({
        command: input.command as CommandEnvelope<'AgentObserveLocation', unknown>,
        projection: input.projection,
        nextSequence: input.nextSequence,
      });
    case 'AgentStartConversation':
      return handleAgentStartConversationCommand({
        command: input.command as CommandEnvelope<'AgentStartConversation', unknown>,
        projection: input.projection,
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
    case 'AgentSeeDoctor':
      if (input.policies.seeDoctor === undefined) {
        return rejectCommand(input, 'AgentSeeDoctor', 'missing see doctor policy');
      }
      return handleAgentSeeDoctorCommand({
        command: input.command as CommandEnvelope<'AgentSeeDoctor', unknown>,
        projection: input.projection,
        healthRecoveryPerSecond: input.policies.seeDoctor.healthRecoveryPerSecond,
        maxHealth: input.policies.seeDoctor.maxHealth,
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
  readonly sleepDeprivation?: SleepDeprivationHealthDecayPolicy;
  readonly stochasticIllness?: StochasticIllnessPolicy;
  readonly safetyNetSubsidy?: SafetyNetSubsidyPolicy;
  readonly nextSequence: number;
}): WorldEvent[] {
  const payload = assertAdvanceSimulationTimePayload(input.command.payload);
  const previous = input.projection.clock;
  const next = advanceClock(previous, payload.deltaMs);
  const events: WorldEvent[] = [
    makeEvent(input, 0, 'SimulationTimeAdvanced', {
      previous: { ...previous },
      next: { ...next },
      deltaMs: payload.deltaMs,
    }),
  ];

  if (
    input.sleepDeprivation === undefined &&
    input.stochasticIllness === undefined &&
    input.safetyNetSubsidy === undefined
  ) {
    return events;
  }

  const durationSeconds = payload.deltaMs / 1000;
  const agents = Object.values(input.projection.agents).sort((left, right) =>
    left.agentId.localeCompare(right.agentId),
  );
  const physiologyByAgent = new Map<AgentId, WorldAgentState['physiology']>();

  if (input.sleepDeprivation !== undefined) {
    for (const agent of agents) {
      appendPhysiologyTimeEffect({
        input,
        events,
        physiologyByAgent,
        agent,
        reason: 'sleep-deprivation',
        nextPhysiology: applySleepDeprivationHealthDecay({
          ...getCurrentPhysiology(physiologyByAgent, agent),
          durationSeconds,
          energyThreshold: input.sleepDeprivation.energyThreshold,
          healthDecayPerSecond: input.sleepDeprivation.healthDecayPerSecond,
          minHealth: input.sleepDeprivation.minHealth,
        }),
      });
    }
  }

  if (input.stochasticIllness !== undefined) {
    const probabilityPercent = calculateStochasticIllnessProbabilityPercent({
      illnessProbabilityPercentPerHour: input.stochasticIllness.illnessProbabilityPercentPerHour,
      durationSeconds,
    });
    for (const agent of agents) {
      const illnessOccurs = rollProbabilityPercent(
        probabilityPercent,
        createSeededRandom(createStochasticIllnessSeed({ input, payload, agent })),
      );
      appendPhysiologyTimeEffect({
        input,
        events,
        physiologyByAgent,
        agent,
        reason: 'stochastic-illness',
        nextPhysiology: applyStochasticIllnessHealthDecay({
          ...getCurrentPhysiology(physiologyByAgent, agent),
          illnessOccurs,
          healthDamage: input.stochasticIllness.healthDamage,
          minHealth: input.stochasticIllness.minHealth,
        }),
      });
    }
  }

  if (input.safetyNetSubsidy !== undefined) {
    for (const agent of agents) {
      const decision = evaluateSafetyNetSubsidy({
        balance: agent.balance,
        minimumBalance: input.safetyNetSubsidy.minimumBalance,
        maxSubsidy: input.safetyNetSubsidy.maxSubsidy,
      });
      if (decision.status === 'ineligible') {
        continue;
      }
      events.push(
        makeEvent(input, events.length, 'SubsidyPaid', {
          agentId: agent.agentId,
          amount: decision.amount,
          previousBalance: decision.previousBalance,
          nextBalance: decision.nextBalance,
          reason: 'safety-net',
        }),
      );
    }
  }

  return events;
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

export function handleAgentMoveToCommand(input: {
  readonly command: CommandEnvelope<'AgentMoveTo', unknown>;
  readonly projection: WorldProjection;
  readonly nextSequence: number;
}): WorldEvent[] {
  const agent = resolveCommandAgent(input.projection, input.command);
  const payloadResult = parsePayload(() => assertAgentMoveToPayload(input.command.payload));
  if (payloadResult.status === 'invalid') {
    return rejectCommand(input, 'AgentMoveTo', payloadResult.reason);
  }

  const payload = payloadResult.payload;
  const targetLocation = input.projection.locations[payload.targetLocationId];
  if (targetLocation === undefined) {
    return rejectCommand(
      input,
      'AgentMoveTo',
      `unknown target location ${payload.targetLocationId}`,
    );
  }
  if (agent.locationId === payload.targetLocationId) {
    return rejectCommand(input, 'AgentMoveTo', `agent already at ${payload.targetLocationId}`);
  }

  return [
    makeEvent(input, 0, 'AgentLocationChanged', {
      agentId: agent.agentId,
      previousLocationId: agent.locationId,
      nextLocationId: payload.targetLocationId,
      reason: payload.reason ?? 'move',
    }),
    makeMemoryEvent(input, 1, {
      summary: `Moved to ${targetLocation.name}.`,
      status: 'succeeded',
      tags: ['move', payload.targetLocationId, targetLocation.kind],
      consolidationHint: {
        kind: 'habit',
        patternKey: `move:${payload.targetLocationId}`,
        statement: `Moves to ${targetLocation.name} when the current plan requires ${targetLocation.kind} activities.`,
      },
    }),
  ];
}

export function handleAgentObserveLocationCommand(input: {
  readonly command: CommandEnvelope<'AgentObserveLocation', unknown>;
  readonly projection: WorldProjection;
  readonly nextSequence: number;
}): WorldEvent[] {
  const agent = resolveCommandAgent(input.projection, input.command);
  const payloadResult = parsePayload(() =>
    assertAgentObserveLocationPayload(input.command.payload),
  );
  if (payloadResult.status === 'invalid') {
    return rejectCommand(input, 'AgentObserveLocation', payloadResult.reason);
  }

  if (agent.locationId === null) {
    return rejectCommand(input, 'AgentObserveLocation', 'agent location is unknown');
  }
  const location = input.projection.locations[agent.locationId];
  if (location === undefined) {
    return rejectCommand(
      input,
      'AgentObserveLocation',
      `unknown current location ${agent.locationId}`,
    );
  }

  const observedAgentIds = Object.values(input.projection.agents)
    .filter((candidate) => candidate.agentId !== agent.agentId)
    .filter((candidate) => candidate.locationId === agent.locationId)
    .map((candidate) => candidate.agentId)
    .sort((left, right) => left.localeCompare(right));
  const focus = payloadResult.payload.focus;
  const nearbySummary =
    observedAgentIds.length === 0 ? 'no agents nearby' : `${observedAgentIds.join(', ')} nearby`;

  return [
    makeEvent(input, 0, 'LocationObserved', {
      agentId: agent.agentId,
      locationId: location.locationId,
      locationName: location.name,
      observedAgentIds,
      activityAffinities: [...location.activityAffinities],
      ...(focus === undefined ? {} : { focus }),
    }),
    makeMemoryEvent(input, 1, {
      kind: 'observation',
      summary: `Observed ${location.name} with ${nearbySummary}.${
        focus === undefined ? '' : ` Focus: ${focus}.`
      }`,
      status: 'observed',
      tags: stableUnique([
        'observe',
        location.locationId,
        location.kind,
        ...location.activityAffinities,
        ...observedAgentIds,
      ]),
    }),
  ];
}

export function handleAgentStartConversationCommand(input: {
  readonly command: CommandEnvelope<'AgentStartConversation', unknown>;
  readonly projection: WorldProjection;
  readonly nextSequence: number;
}): WorldEvent[] {
  const agent = resolveCommandAgent(input.projection, input.command);
  const payloadResult = parsePayload(() =>
    assertAgentStartConversationPayload(input.command.payload),
  );
  if (payloadResult.status === 'invalid') {
    return rejectCommand(input, 'AgentStartConversation', payloadResult.reason);
  }

  const payload = payloadResult.payload;
  const targetAgent = input.projection.agents[payload.targetAgentId];
  if (targetAgent === undefined) {
    return rejectCommand(
      input,
      'AgentStartConversation',
      `unknown target agent ${payload.targetAgentId}`,
    );
  }
  if (agent.agentId === targetAgent.agentId) {
    return rejectCommand(input, 'AgentStartConversation', 'conversation target must differ');
  }
  if (agent.locationId === null) {
    return rejectCommand(input, 'AgentStartConversation', 'agent location is unknown');
  }
  if (targetAgent.locationId === null) {
    return rejectCommand(input, 'AgentStartConversation', 'target agent location is unknown');
  }
  if (agent.locationId !== targetAgent.locationId) {
    return rejectCommand(
      input,
      'AgentStartConversation',
      `target agent ${targetAgent.agentId} is at ${targetAgent.locationId}, not co-located with ${agent.agentId} at ${agent.locationId}`,
    );
  }

  const location = input.projection.locations[agent.locationId];
  if (location === undefined) {
    return rejectCommand(
      input,
      'AgentStartConversation',
      `unknown current location ${agent.locationId}`,
    );
  }

  const participantAgentIds = [agent.agentId, targetAgent.agentId] as const;
  const participantSet = new Set<AgentId>(participantAgentIds);
  for (const turn of payload.turns) {
    if (!participantSet.has(turn.speakerAgentId)) {
      return rejectCommand(
        input,
        'AgentStartConversation',
        `conversation turn speaker ${turn.speakerAgentId} is not a participant`,
      );
    }
  }
  const firstTurn = payload.turns[0];
  if (firstTurn?.speakerAgentId !== agent.agentId) {
    return rejectCommand(
      input,
      'AgentStartConversation',
      `conversation first turn must be spoken by initiator ${agent.agentId}`,
    );
  }

  const turns = payload.turns.map((turn, index) => ({
    turnIndex: index,
    speakerAgentId: turn.speakerAgentId,
    utterance: turn.utterance,
    ...(turn.intent === undefined ? {} : { intent: turn.intent }),
  }));
  const summary = formatConversationSummary(payload.topic, turns);
  const sourceRelation = planSocialInteractionEvent({
    projection: input.projection,
    sourceAgentId: agent.agentId,
    targetAgentId: targetAgent.agentId,
    summary,
    relationDelta: payload.relationDelta,
    attitudeDelta: payload.attitudeDelta,
  });
  if (sourceRelation.status === 'invalid') {
    return rejectCommand(input, 'AgentStartConversation', sourceRelation.reason);
  }
  const targetRelation = planSocialInteractionEvent({
    projection: input.projection,
    sourceAgentId: targetAgent.agentId,
    targetAgentId: agent.agentId,
    summary,
    relationDelta: payload.relationDelta,
    attitudeDelta: payload.attitudeDelta,
  });
  if (targetRelation.status === 'invalid') {
    return rejectCommand(input, 'AgentStartConversation', targetRelation.reason);
  }

  return [
    makeEvent(input, 0, 'ConversationRecorded', {
      conversationId: asConversationId(`conversation-${input.command.id}`),
      initiatorAgentId: agent.agentId,
      participantAgentIds,
      locationId: location.locationId,
      topic: payload.topic,
      turns,
    }),
    makeEvent(input, 1, 'SocialInteractionCompleted', sourceRelation.payload),
    makeEvent(input, 2, 'SocialInteractionCompleted', targetRelation.payload),
    makeMemoryEvent(input, 3, {
      agentId: agent.agentId,
      kind: 'social-interaction',
      summary,
      status: 'succeeded',
      tags: stableUnique(['conversation', payload.topic, targetAgent.agentId, location.locationId]),
      consolidationHint: {
        kind: 'social',
        targetAgentId: targetAgent.agentId,
        relationDelta: payload.relationDelta,
        attitudeDelta: payload.attitudeDelta,
        summary,
      },
    }),
    makeMemoryEvent(input, 4, {
      agentId: targetAgent.agentId,
      kind: 'social-interaction',
      summary,
      status: 'succeeded',
      tags: stableUnique(['conversation', payload.topic, agent.agentId, location.locationId]),
      consolidationHint: {
        kind: 'social',
        targetAgentId: agent.agentId,
        relationDelta: payload.relationDelta,
        attitudeDelta: payload.attitudeDelta,
        summary,
      },
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

export function handleAgentSeeDoctorCommand(input: {
  readonly command: CommandEnvelope<'AgentSeeDoctor', unknown>;
  readonly projection: WorldProjection;
  readonly healthRecoveryPerSecond: number;
  readonly maxHealth: number;
  readonly nextSequence: number;
}): WorldEvent[] {
  const agent = resolveCommandAgent(input.projection, input.command);
  const payloadResult = parsePayload(() => assertAgentSeeDoctorPayload(input.command.payload));
  if (payloadResult.status === 'invalid') {
    return rejectCommand(input, 'AgentSeeDoctor', payloadResult.reason);
  }

  const physiologyResult = parsePayload(() =>
    applyHealthRecovery({
      ...agent.physiology,
      durationSeconds: payloadResult.payload.durationSeconds,
      healthRecoveryPerSecond: input.healthRecoveryPerSecond,
      maxHealth: input.maxHealth,
    }),
  );
  if (physiologyResult.status === 'invalid') {
    return rejectCommand(input, 'AgentSeeDoctor', physiologyResult.reason);
  }

  return [
    makeEvent(input, 0, 'PhysiologyChanged', {
      agentId: agent.agentId,
      previous: agent.physiology,
      next: physiologyResult.payload,
      reason: 'see-doctor',
    }),
    makeMemoryEvent(input, 1, {
      summary: `Saw doctor for ${payloadResult.payload.durationSeconds} seconds.`,
      status: 'succeeded',
      tags: ['see-doctor', 'health'],
      consolidationHint: {
        kind: 'habit',
        patternKey: 'see-doctor',
        statement: 'Sees a doctor to recover health.',
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
  const targetAgent = input.projection.agents[payload.targetAgentId];
  if (targetAgent === undefined) {
    return rejectCommand(input, 'AgentSocialize', `unknown target agent ${payload.targetAgentId}`);
  }

  const coLocationFailure = validateKnownCoLocation(agent, targetAgent);
  if (coLocationFailure !== undefined) {
    return rejectCommand(input, 'AgentSocialize', coLocationFailure);
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

function planSocialInteractionEvent(input: {
  readonly projection: WorldProjection;
  readonly sourceAgentId: AgentId;
  readonly targetAgentId: AgentId;
  readonly summary: string;
  readonly relationDelta: number;
  readonly attitudeDelta: number;
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
      nextRelation: relationResult.payload,
    },
  };
}

function formatConversationSummary(
  topic: string,
  turns: readonly { readonly utterance: string }[],
): string {
  return `Conversation about ${topic}: ${turns.map((turn) => turn.utterance).join(' / ')}`;
}

function validateKnownCoLocation(
  sourceAgent: WorldAgentState,
  targetAgent: WorldAgentState,
): string | undefined {
  if (sourceAgent.locationId === null || targetAgent.locationId === null) {
    return undefined;
  }
  if (sourceAgent.locationId === targetAgent.locationId) {
    return undefined;
  }

  return `target agent ${targetAgent.agentId} is at ${targetAgent.locationId}, not co-located with ${sourceAgent.agentId} at ${sourceAgent.locationId}`;
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
    readonly agentId?: AgentId;
    readonly kind?: Parameters<typeof createShortTermMemoryRecord>[0]['kind'];
    readonly summary: string;
    readonly status: Parameters<typeof createShortTermMemoryRecord>[0]['status'];
    readonly tags: readonly string[];
    readonly consolidationHint?: Parameters<
      typeof createShortTermMemoryRecord
    >[0]['consolidationHint'];
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
        eventIds: [],
      },
      tags: memory.tags,
      ...(memory.consolidationHint === undefined
        ? {}
        : { consolidationHint: memory.consolidationHint }),
    }),
  });
}

function stableUnique<TValue>(values: readonly TValue[]): readonly TValue[] {
  return [...new Set(values)];
}

function isSamePhysiology(
  left: WorldAgentState['physiology'],
  right: WorldAgentState['physiology'],
): boolean {
  return (
    left.energy === right.energy && left.satiety === right.satiety && left.health === right.health
  );
}

function appendPhysiologyTimeEffect(input: {
  readonly input: Parameters<typeof handleAdvanceSimulationTimeCommand>[0];
  readonly events: WorldEvent[];
  readonly physiologyByAgent: Map<AgentId, WorldAgentState['physiology']>;
  readonly agent: WorldAgentState;
  readonly reason: string;
  readonly nextPhysiology: WorldAgentState['physiology'];
}): void {
  const previousPhysiology = getCurrentPhysiology(input.physiologyByAgent, input.agent);
  if (isSamePhysiology(previousPhysiology, input.nextPhysiology)) {
    return;
  }

  input.events.push(
    makeEvent(input.input, input.events.length, 'PhysiologyChanged', {
      agentId: input.agent.agentId,
      previous: previousPhysiology,
      next: input.nextPhysiology,
      reason: input.reason,
    }),
  );
  input.physiologyByAgent.set(input.agent.agentId, input.nextPhysiology);
}

function getCurrentPhysiology(
  physiologyByAgent: ReadonlyMap<AgentId, WorldAgentState['physiology']>,
  agent: WorldAgentState,
): WorldAgentState['physiology'] {
  return physiologyByAgent.get(agent.agentId) ?? agent.physiology;
}

function createStochasticIllnessSeed(input: {
  readonly input: Parameters<typeof handleAdvanceSimulationTimeCommand>[0];
  readonly payload: { readonly deltaMs: number };
  readonly agent: WorldAgentState;
}): string {
  return [
    'stochastic-illness',
    input.input.command.simulationId,
    input.input.command.id,
    input.input.projection.clock.now,
    input.payload.deltaMs,
    input.agent.agentId,
  ].join(':');
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
