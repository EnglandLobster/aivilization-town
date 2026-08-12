import { getInventoryQuantity, planProduction, type ProductionEfficiencyPolicy, type ProductionRecipeOverride } from '@aivilization/economy';
import { createSeededRandom, type CommandEnvelope } from '@aivilization/sim-core';
import {
  accumulateEducation,
  applyEnergyRecovery,
  applyHealthRecovery,
  applyLaborPhysiologyCost,
  evaluateEducationInvestment,
  evaluateMedicalTreatmentCost,
  isIncapacitated,
  type EducationInvestmentPolicy,
  type MedicalTreatmentCostPolicy,
  type ResidentialPhysiologyCapPolicy,
} from '@aivilization/society';
import {
  assertAgentEatPayload,
  assertAgentProducePayload,
  assertAgentSeeDoctorPayload,
  assertAgentSleepPayload,
  assertAgentStudyPayload,
  assertAgentWorkPayload,
} from '../commands';
import type { WorldEvent } from '../events';
import type { WorldAgentState, WorldProjection } from '../projection';
import {
  makeAgentActivityTimeCommittedEvent,
  makeEvent,
  makeMemoryEvent,
  parsePayload,
  rejectCommand,
  resolveCommandAgent,
  resolveRecoveryMaximum,
} from './shared';

export function handleAgentEatCommand(input: {
  readonly command: CommandEnvelope<'AgentEat', unknown>;
  readonly projection: WorldProjection;
  readonly satietyRecoveryByCommodity: Readonly<Record<string, number>>;
  readonly maxSatiety: number;
  readonly residentialPhysiologyCaps?: ResidentialPhysiologyCapPolicy;
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
  const maxSatiety = resolveRecoveryMaximum({
    agent,
    policy: input.residentialPhysiologyCaps,
    fallback: input.maxSatiety,
    field: 'maxSatiety',
  });
  if (maxSatiety.status === 'rejected') {
    return rejectCommand(input, 'AgentEat', maxSatiety.reason);
  }

  const nextPhysiology = {
    ...agent.physiology,
    satiety: Math.min(
      maxSatiety.value,
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
  readonly educationInvestment?: EducationInvestmentPolicy;
  readonly nextSequence: number;
}): WorldEvent[] {
  const agent = resolveCommandAgent(input.projection, input.command);
  const payloadResult = parsePayload(() => assertAgentStudyPayload(input.command.payload));
  if (payloadResult.status === 'invalid') {
    return rejectCommand(input, 'AgentStudy', payloadResult.reason);
  }

  const investment =
    input.educationInvestment === undefined
      ? undefined
      : evaluateEducationInvestment({
          agent: {
            balance: agent.balance,
            inventory: agent.inventory,
          },
          studyDurationSeconds: payloadResult.payload.durationSeconds,
          policy: input.educationInvestment,
        });
  if (investment?.status === 'rejected') {
    return rejectCommand(input, 'AgentStudy', investment.detail);
  }

  const nextEducationScore = accumulateEducation({
    currentEducationScore: agent.educationScore,
    educationRatePerSecond: payloadResult.payload.educationRatePerSecond,
    studyDurationSeconds: payloadResult.payload.durationSeconds,
  });

  const events: WorldEvent[] = [];
  if (investment !== undefined) {
    events.push(
      makeEvent(input, events.length, 'EducationInvestmentPaid', {
        agentId: agent.agentId,
        durationSeconds: payloadResult.payload.durationSeconds,
        currencyCost: investment.currencyCost,
        previousBalance: investment.previousBalance,
        nextBalance: investment.nextBalance,
        consumedInventory: investment.consumedInventory,
        reason: 'study-investment',
      }),
    );
  }
  events.push(
    makeEvent(input, events.length, 'EducationChanged', {
      agentId: agent.agentId,
      previousEducationScore: agent.educationScore,
      nextEducationScore,
      reason: 'study',
    }),
  );
  events.push(
    makeAgentActivityTimeCommittedEvent(input, events.length, {
      agentId: agent.agentId,
      activity: 'education',
      commandType: 'AgentStudy',
      durationSeconds: payloadResult.payload.durationSeconds,
    }),
  );
  events.push(
    makeMemoryEvent(input, events.length, {
      summary:
        investment === undefined
          ? `Studied for ${payloadResult.payload.durationSeconds} seconds.`
          : createStudyInvestmentSummary({
              durationSeconds: payloadResult.payload.durationSeconds,
              currencyCost: investment.currencyCost,
              consumedInventory: investment.consumedInventory,
            }),
      status: 'succeeded',
      tags: ['study'],
      consolidationHint: {
        kind: 'habit',
        patternKey: 'study',
        statement: 'Studies to improve education score.',
      },
    }),
  );
  return events;
}

function createStudyInvestmentSummary(input: {
  readonly durationSeconds: number;
  readonly currencyCost: number;
  readonly consumedInventory: Readonly<Record<string, number>>;
}): string {
  const resourceSummary = Object.entries(input.consumedInventory)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([itemName, quantity]) => `${quantity} ${itemName}`)
    .join(', ');
  const investmentSummary = [
    `${input.currencyCost} currency`,
    ...(resourceSummary.length === 0 ? [] : [resourceSummary]),
  ].join(' and ');
  return `Studied for ${input.durationSeconds} seconds by investing ${investmentSummary}.`;
}

export function handleAgentSleepCommand(input: {
  readonly command: CommandEnvelope<'AgentSleep', unknown>;
  readonly projection: WorldProjection;
  readonly energyRecoveryPerSecond: number;
  readonly maxEnergy: number;
  readonly residentialPhysiologyCaps?: ResidentialPhysiologyCapPolicy;
  readonly nextSequence: number;
}): WorldEvent[] {
  const agent = resolveCommandAgent(input.projection, input.command);
  const payloadResult = parsePayload(() => assertAgentSleepPayload(input.command.payload));
  if (payloadResult.status === 'invalid') {
    return rejectCommand(input, 'AgentSleep', payloadResult.reason);
  }
  const maxEnergy = resolveRecoveryMaximum({
    agent,
    policy: input.residentialPhysiologyCaps,
    fallback: input.maxEnergy,
    field: 'maxEnergy',
  });
  if (maxEnergy.status === 'rejected') {
    return rejectCommand(input, 'AgentSleep', maxEnergy.reason);
  }

  const physiologyResult = parsePayload(() =>
    applyEnergyRecovery({
      ...agent.physiology,
      durationSeconds: payloadResult.payload.durationSeconds,
      energyRecoveryPerSecond: input.energyRecoveryPerSecond,
      maxEnergy: maxEnergy.value,
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
    makeAgentActivityTimeCommittedEvent(input, 1, {
      agentId: agent.agentId,
      activity: 'sleep',
      commandType: 'AgentSleep',
      durationSeconds: payloadResult.payload.durationSeconds,
    }),
    makeMemoryEvent(input, 2, {
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
  readonly treatmentCost?: MedicalTreatmentCostPolicy;
  readonly residentialPhysiologyCaps?: ResidentialPhysiologyCapPolicy;
  readonly nextSequence: number;
}): WorldEvent[] {
  const agent = resolveCommandAgent(input.projection, input.command);
  const payloadResult = parsePayload(() => assertAgentSeeDoctorPayload(input.command.payload));
  if (payloadResult.status === 'invalid') {
    return rejectCommand(input, 'AgentSeeDoctor', payloadResult.reason);
  }
  const maxHealth = resolveRecoveryMaximum({
    agent,
    policy: input.residentialPhysiologyCaps,
    fallback: input.maxHealth,
    field: 'maxHealth',
  });
  if (maxHealth.status === 'rejected') {
    return rejectCommand(input, 'AgentSeeDoctor', maxHealth.reason);
  }
  const treatmentCost =
    input.treatmentCost === undefined
      ? { status: 'uncharged' as const, reason: 'zero-cost' as const }
      : evaluateMedicalTreatmentCost({
          balance: agent.balance,
          durationSeconds: payloadResult.payload.durationSeconds,
          policy: input.treatmentCost,
        });
  if (treatmentCost.status === 'rejected') {
    return rejectCommand(input, 'AgentSeeDoctor', treatmentCost.detail);
  }

  const physiologyResult = parsePayload(() =>
    applyHealthRecovery({
      ...agent.physiology,
      durationSeconds: payloadResult.payload.durationSeconds,
      healthRecoveryPerSecond: input.healthRecoveryPerSecond,
      maxHealth: maxHealth.value,
    }),
  );
  if (physiologyResult.status === 'invalid') {
    return rejectCommand(input, 'AgentSeeDoctor', physiologyResult.reason);
  }

  const events: WorldEvent[] = [];
  if (treatmentCost.status === 'charged') {
    events.push(
      makeEvent(input, events.length, 'MedicalTreatmentCharged', {
        agentId: agent.agentId,
        amount: treatmentCost.amount,
        previousBalance: treatmentCost.previousBalance,
        nextBalance: treatmentCost.nextBalance,
        reason: 'medical-treatment',
      }),
    );
  }
  events.push(
    makeEvent(input, events.length, 'PhysiologyChanged', {
      agentId: agent.agentId,
      previous: agent.physiology,
      next: physiologyResult.payload,
      reason: 'see-doctor',
    }),
  );
  events.push(
    makeAgentActivityTimeCommittedEvent(input, events.length, {
      agentId: agent.agentId,
      activity: 'healthcare',
      commandType: 'AgentSeeDoctor',
      durationSeconds: payloadResult.payload.durationSeconds,
    }),
  );
  events.push(
    makeMemoryEvent(input, events.length, {
      summary: `Saw doctor for ${payloadResult.payload.durationSeconds} seconds.`,
      status: 'succeeded',
      tags: ['see-doctor', 'health'],
      consolidationHint: {
        kind: 'habit',
        patternKey: 'see-doctor',
        statement: 'Sees a doctor to recover health.',
      },
    }),
  );

  return events;
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
    makeAgentActivityTimeCommittedEvent(input, 2, {
      agentId: agent.agentId,
      activity: 'labor',
      commandType: 'AgentWork',
      durationSeconds: payload.laborSeconds,
    }),
    makeMemoryEvent(input, 3, {
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
  readonly randomSeed?: string;
  readonly recipeOverrides?: readonly ProductionRecipeOverride[];
  readonly productionEfficiency?: ProductionEfficiencyPolicy;
  readonly criticalThresholds?: {
    readonly energy: number;
    readonly health: number;
  };
  readonly nextSequence: number;
}): WorldEvent[] {
  const agent = resolveCommandAgent(input.projection, input.command);
  const payloadResult = parsePayload(() => assertAgentProducePayload(input.command.payload));
  if (payloadResult.status === 'invalid') {
    return rejectCommand(input, 'AgentProduce', payloadResult.reason);
  }

  const payload = payloadResult.payload;
  if (
    input.criticalThresholds !== undefined &&
    isIncapacitated({
      energy: agent.physiology.energy,
      health: agent.physiology.health,
      energyCriticalThreshold: input.criticalThresholds.energy,
      healthCriticalThreshold: input.criticalThresholds.health,
    })
  ) {
    return rejectCommand(input, 'AgentProduce', 'agent is incapacitated');
  }

  const productionPlan = planProduction({
    commodityName: payload.commodityName,
    quantity: payload.quantity,
    agent: {
      residentialTier: agent.residentialTier,
      energy: agent.physiology.energy,
      satiety: agent.physiology.satiety,
      health: agent.physiology.health,
      availableLaborSeconds: payload.availableLaborSeconds,
      inventory: agent.inventory,
      educationScore: agent.educationScore,
    },
    rng: createSeededRandom(createProductionRewardSeed({ input, payload, agent })),
    ...(input.recipeOverrides === undefined ? {} : { recipeOverrides: input.recipeOverrides }),
    ...(input.productionEfficiency === undefined
      ? {}
      : { productionEfficiency: input.productionEfficiency }),
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
      ...(productionPlan.productionEfficiency === undefined
        ? {}
        : { productionEfficiency: productionPlan.productionEfficiency }),
    }),
    makeAgentActivityTimeCommittedEvent(input, 1, {
      agentId: agent.agentId,
      activity: 'production',
      commandType: 'AgentProduce',
      durationSeconds: productionPlan.laborSeconds,
    }),
    makeMemoryEvent(input, 2, {
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

function createProductionRewardSeed(input: {
  readonly input: Parameters<typeof handleAgentProduceCommand>[0];
  readonly payload: { readonly commodityName: string; readonly quantity: number };
  readonly agent: WorldAgentState;
}): string {
  return [
    'production-reward',
    ...(input.input.randomSeed === undefined ? [] : [input.input.randomSeed]),
    input.input.command.simulationId,
    input.input.command.id,
    input.input.projection.clock.now,
    input.agent.agentId,
    input.payload.commodityName,
    input.payload.quantity,
  ].join(':');
}
