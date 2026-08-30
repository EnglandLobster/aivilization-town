import {
  getInventoryQuantity,
  planProduction,
  type ProductionEfficiencyPolicy,
  type ProductionRecipeOverride,
} from '@aivilization/economy';
import { createSeededRandom, type CommandEnvelope } from '@aivilization/sim-core';
import { decidePayWage, isEnterpriseOperational } from '@aivilization/enterprise';
import {
  accumulateEducation,
  applyEnergyRecovery,
  applyHealthRecovery,
  applyLaborPhysiologyCost,
  applyServiceQuality,
  applyStudyEfficiency,
  deriveEducationLevel,
  evaluateEducationInvestment,
  evaluateIncomeTax,
  evaluateMedicalTreatmentCost,
  evaluateStudyCost,
  isIncapacitated,
  isCompulsoryLevel,
  type EducationInvestmentPolicy,
  type EducationSystemPolicy,
  type MedicalTreatmentCostPolicy,
  type ResidentialPhysiologyCapPolicy,
  type TaxPolicy,
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
  /**
   * Discrete education-system policy (education-system-v2). Absent or disabled
   * keeps the legacy continuous-score path byte-for-byte: tuition comes from
   * `educationInvestment` and every level pays for itself.
   */
  readonly educationSystem?: EducationSystemPolicy;
  /** Latest settled regional education quality; absent preserves legacy 1. */
  readonly serviceQuality?: number;
  readonly nextSequence: number;
}): WorldEvent[] {
  const agent = resolveCommandAgent(input.projection, input.command);
  const payloadResult = parsePayload(() => assertAgentStudyPayload(input.command.payload));
  if (payloadResult.status === 'invalid') {
    return rejectCommand(input, 'AgentStudy', payloadResult.reason);
  }

  const educationSystem =
    input.educationSystem !== undefined && input.educationSystem.enabled
      ? input.educationSystem
      : undefined;

  if (educationSystem !== undefined) {
    return settleEducationSystemStudy({
      input,
      agent,
      payload: payloadResult.payload,
      policy: educationSystem,
    });
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

  const educationRatePerSecond =
    input.serviceQuality === undefined
      ? payloadResult.payload.educationRatePerSecond
      : applyServiceQuality(payloadResult.payload.educationRatePerSecond, input.serviceQuality);
  const nextEducationScore = accumulateEducation({
    currentEducationScore: agent.educationScore,
    educationRatePerSecond,
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

/**
 * Education-system study settlement: tuition comes from the level's hourly
 * rate, compulsory levels are billed to the treasury (fallback to self-pay
 * when the treasury feature is off or short), later levels are self-funded,
 * and studying while employed accumulates score at the reduced efficiency.
 */
function settleEducationSystemStudy(input: {
  readonly input: Parameters<typeof handleAgentStudyCommand>[0];
  readonly agent: WorldAgentState;
  readonly payload: { readonly durationSeconds: number; readonly educationRatePerSecond: number };
  readonly policy: EducationSystemPolicy;
}): WorldEvent[] {
  const { agent, payload, policy } = input;
  const level = agent.educationLevel ?? deriveEducationLevel(agent.educationScore, policy);
  const cost = evaluateStudyCost({
    level,
    durationSeconds: payload.durationSeconds,
    balance: agent.balance,
    inventory: agent.inventory,
    treasuryBalance: input.input.projection.treasury ?? null,
    policy,
  });
  if (cost.status === 'rejected') {
    return rejectCommand(input.input, 'AgentStudy', cost.detail);
  }

  const employmentAdjustedEducationRatePerSecond = applyStudyEfficiency({
    educationRatePerSecond: payload.educationRatePerSecond,
    employed: agent.job !== null,
    policy,
  });
  const effectiveEducationRatePerSecond =
    input.input.serviceQuality === undefined
      ? employmentAdjustedEducationRatePerSecond
      : applyServiceQuality(employmentAdjustedEducationRatePerSecond, input.input.serviceQuality);
  const nextEducationScore = accumulateEducation({
    currentEducationScore: agent.educationScore,
    educationRatePerSecond: effectiveEducationRatePerSecond,
    studyDurationSeconds: payload.durationSeconds,
  });

  const events: WorldEvent[] = [];
  if (isCompulsoryLevel(level, policy)) {
    events.push(
      makeEvent(input.input, events.length, 'EducationCompulsoryFeeCovered', {
        agentId: agent.agentId,
        level,
        durationSeconds: payload.durationSeconds,
        coveredAmount: cost.treasuryCoveredCost,
        selfPaidAmount: cost.selfPayCost,
        reason: 'compulsory-education',
      }),
    );
  } else {
    events.push(
      makeEvent(input.input, events.length, 'EducationInvestmentPaid', {
        agentId: agent.agentId,
        durationSeconds: payload.durationSeconds,
        currencyCost: cost.selfPayCost,
        previousBalance: agent.balance,
        nextBalance: agent.balance - cost.selfPayCost,
        consumedInventory: cost.consumedInventory,
        reason: 'study-investment',
      }),
    );
  }
  events.push(
    makeEvent(input.input, events.length, 'EducationChanged', {
      agentId: agent.agentId,
      previousEducationScore: agent.educationScore,
      nextEducationScore,
      reason: 'study',
    }),
  );
  events.push(
    makeAgentActivityTimeCommittedEvent(input.input, events.length, {
      agentId: agent.agentId,
      activity: 'education',
      commandType: 'AgentStudy',
      durationSeconds: payload.durationSeconds,
    }),
  );
  events.push(
    makeMemoryEvent(input.input, events.length, {
      summary: createEducationSystemStudySummary({
        durationSeconds: payload.durationSeconds,
        level,
        compulsory: isCompulsoryLevel(level, policy),
        coveredAmount: cost.treasuryCoveredCost,
        selfPaidAmount: cost.selfPayCost,
        employed: agent.job !== null,
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

function createEducationSystemStudySummary(input: {
  readonly durationSeconds: number;
  readonly level: number;
  readonly compulsory: boolean;
  readonly coveredAmount: number;
  readonly selfPaidAmount: number;
  readonly employed: boolean;
}): string {
  const funding = input.compulsory
    ? `the town treasury covered ${input.coveredAmount}${
        input.selfPaidAmount > 0 ? ` and ${input.selfPaidAmount} was paid from own balance` : ''
      }`
    : `${input.selfPaidAmount} was paid from own balance`;
  const efficiency = input.employed ? ' while working (reduced study efficiency)' : '';
  return `Studied at education level ${input.level} for ${input.durationSeconds} seconds; ${funding}${efficiency}.`;
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
  /** Latest settled regional healthcare quality; absent preserves legacy 1. */
  readonly serviceQuality?: number;
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
      healthRecoveryPerSecond:
        input.serviceQuality === undefined
          ? input.healthRecoveryPerSecond
          : applyServiceQuality(input.healthRecoveryPerSecond, input.serviceQuality),
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
  readonly tax?: TaxPolicy;
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

  const enterprise =
    payload.enterpriseId === undefined
      ? undefined
      : input.projection.enterprises[payload.enterpriseId];
  if (payload.enterpriseId !== undefined) {
    if (enterprise === undefined || !isEnterpriseOperational(enterprise)) {
      return rejectCommand(input, 'AgentWork', 'enterprise is missing or closed');
    }
    if (!enterprise.employeeAgentIds.includes(agent.agentId)) {
      return rejectCommand(input, 'AgentWork', 'agent is not an enterprise employee');
    }
    if (enterprise.occupationName !== payload.occupationName) {
      return rejectCommand(input, 'AgentWork', 'enterprise occupation does not match work');
    }
  }

  // Enterprise employees earn the contracted wage offer recorded at join time;
  // legacy members without an offer and non-enterprise work fall back to the
  // world wage regime.
  const wage =
    enterprise?.employeeWageOffers?.[agent.agentId] ?? input.wageCalculator(payload.occupationName);
  if (!Number.isFinite(wage) || wage < 0) {
    return rejectCommand(input, 'AgentWork', 'wageCalculator must return a non-negative wage');
  }

  // Settle the wage against its funding source. Employer payroll follows the
  // enterprise wage decision: cash shortfalls accrue wage arrears instead of
  // rejecting the work, and later surpluses repay arrears first. Public wages
  // draw on the treasury when the fiscal feature is on; a short treasury pays
  // a discounted wage without recording public debt. Treasury-free runs keep
  // minting the wage (legacy behavior).
  let fundingSource: 'mint' | 'employer' | 'treasury';
  let paid: number;
  let arrearsBefore: number | undefined;
  let arrearsAfter: number | undefined;
  if (enterprise !== undefined) {
    const currentArrears = enterprise.wageArrears ?? 0;
    const payroll = parsePayload(() =>
      decidePayWage({ wage, balance: enterprise.balance, arrears: currentArrears }),
    );
    if (payroll.status === 'invalid') {
      return rejectCommand(input, 'AgentWork', payroll.reason);
    }
    fundingSource = 'employer';
    paid = payroll.payload.paid;
    arrearsBefore = currentArrears;
    arrearsAfter = payroll.payload.nextArrears;
  } else if (input.projection.treasury !== undefined) {
    fundingSource = 'treasury';
    paid = Math.min(wage, input.projection.treasury);
  } else {
    fundingSource = 'mint';
    paid = wage;
  }

  const nextPhysiology = applyLaborPhysiologyCost({
    ...agent.physiology,
    laborSeconds: payload.laborSeconds,
    energyCostPerHour: input.laborCost.energyCostPerHour,
    satietyCostPerHour: input.laborCost.satietyCostPerHour,
  });
  // Income tax applies to wages actually received; unpaid or discounted parts
  // are not taxable income.
  const incomeTax =
    input.tax === undefined || paid <= 0
      ? 0
      : evaluateIncomeTax({ wageAmount: paid, policy: input.tax });

  const events: WorldEvent[] = [];
  if (paid > 0) {
    events.push(
      makeEvent(input, events.length, 'WagePaid', {
        agentId: agent.agentId,
        occupationName: payload.occupationName,
        amount: paid,
        fundingSource,
        ...(enterprise === undefined ? {} : { enterpriseId: enterprise.enterpriseId }),
      }),
    );
  }
  if (
    enterprise !== undefined &&
    arrearsBefore !== undefined &&
    arrearsAfter !== undefined &&
    arrearsAfter !== arrearsBefore
  ) {
    events.push(
      makeEvent(input, events.length, 'EnterpriseWageArrearsUpdated', {
        enterpriseId: enterprise.enterpriseId,
        agentId: agent.agentId,
        wageAmount: wage,
        paidAmount: paid,
        previousArrears: arrearsBefore,
        nextArrears: arrearsAfter,
      }),
    );
  }
  if (incomeTax > 0) {
    events.push(
      makeEvent(input, events.length, 'IncomeTaxCharged', {
        agentId: agent.agentId,
        occupationName: payload.occupationName,
        taxableAmount: paid,
        amount: incomeTax,
        previousBalance: agent.balance + paid,
        nextBalance: agent.balance + paid - incomeTax,
      }),
    );
  }
  events.push(
    makeEvent(input, events.length, 'PhysiologyChanged', {
      agentId: agent.agentId,
      previous: agent.physiology,
      next: nextPhysiology,
      reason: 'work',
    }),
  );
  events.push(
    makeAgentActivityTimeCommittedEvent(input, events.length, {
      agentId: agent.agentId,
      activity: 'labor',
      commandType: 'AgentWork',
      durationSeconds: payload.laborSeconds,
    }),
  );
  events.push(
    makeMemoryEvent(input, events.length, {
      summary: `Worked as ${payload.occupationName} for ${payload.laborSeconds} seconds.`,
      status: 'succeeded',
      tags: ['work', payload.occupationName],
      consolidationHint: {
        kind: 'habit',
        patternKey: `work:${payload.occupationName}`,
        statement: `Works as ${payload.occupationName} when conditions allow.`,
      },
    }),
  );
  if (enterprise !== undefined && paid < wage) {
    events.push(
      makeMemoryEvent(input, events.length, {
        summary: `Worked as ${payload.occupationName}, but ${wage - paid} of the wage went unpaid by ${enterprise.name} (enterprise wage arrears now ${arrearsAfter ?? 0}).`,
        status: 'succeeded',
        tags: ['work', payload.occupationName, 'wage-arrears', enterprise.enterpriseId],
      }),
    );
  }
  if (fundingSource === 'treasury' && paid < wage) {
    events.push(
      makeMemoryEvent(input, events.length, {
        summary: `Worked as ${payload.occupationName}, but the public treasury paid only ${paid} of the ${wage} wage.`,
        status: 'succeeded',
        tags: ['work', payload.occupationName, 'treasury-wage-discount'],
      }),
    );
  }
  return events;
}

export function handleAgentProduceCommand(input: {
  readonly command: CommandEnvelope<'AgentProduce', unknown>;
  readonly projection: WorldProjection;
  readonly randomSeed?: string;
  readonly recipeOverrides?: readonly ProductionRecipeOverride[];
  readonly productionEfficiency?: ProductionEfficiencyPolicy;
  readonly educationSystem?: EducationSystemPolicy;
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
  const enterprise =
    payload.enterpriseId === undefined
      ? undefined
      : input.projection.enterprises[payload.enterpriseId];
  if (payload.enterpriseId !== undefined) {
    if (enterprise === undefined || !isEnterpriseOperational(enterprise)) {
      return rejectCommand(input, 'AgentProduce', 'enterprise is missing or closed');
    }
    if (
      enterprise.ownerAgentId !== agent.agentId &&
      !enterprise.employeeAgentIds.includes(agent.agentId)
    ) {
      return rejectCommand(input, 'AgentProduce', 'agent is not authorized for enterprise');
    }
  }
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

  // production-efficiency-v2: the education factor picks up the discrete-level
  // multiplier only when the education system is enabled; legacy
  // continuous-score runs (ablation pins it off) keep the un-multiplied factor.
  const educationLevel =
    input.educationSystem !== undefined && input.educationSystem.enabled
      ? (agent.educationLevel ?? deriveEducationLevel(agent.educationScore, input.educationSystem))
      : undefined;
  const productionPlan = planProduction({
    commodityName: payload.commodityName,
    quantity: payload.quantity,
    agent: {
      residentialTier: agent.residentialTier,
      energy: agent.physiology.energy,
      satiety: agent.physiology.satiety,
      health: agent.physiology.health,
      availableLaborSeconds: payload.availableLaborSeconds,
      inventory: enterprise?.inventory ?? agent.inventory,
      educationScore: agent.educationScore,
      ...(educationLevel === undefined ? {} : { educationLevel }),
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
      ...(enterprise === undefined ? {} : { enterpriseId: enterprise.enterpriseId }),
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
