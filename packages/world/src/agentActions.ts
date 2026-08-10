import {
  buyFromPool,
  getInventoryQuantity,
  planProduction,
  sellToPool,
  type AmmTradeResult,
  type ProductionEfficiencyPolicy,
  type ProductionRecipeOverride,
} from '@aivilization/economy';
import {
  createShortTermMemoryRecord,
  type SocialKnowledgeClaim,
  type SocialKnowledgeClaimStatus,
} from '@aivilization/memory';
import {
  asConversationId,
  asEventId,
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
  calculateCompletedRecruitmentCycleNumbers,
  calculateRecruitmentCycleNumber,
  createDirectedSocialRelationKey,
  classifySocialCommitmentIntent,
  evaluateMedicalTreatmentCost,
  evaluateEducationInvestment,
  evaluateConversationSocialOutcomes,
  evaluateResourceTransferSocialOutcome,
  evaluatePhysiologicalSafetyNet,
  evaluateResidentialUpkeep,
  evaluateResidentialTierUpgrade,
  evaluateOccupationApplication,
  evaluateSafetyNetSubsidy,
  isIncapacitated,
  resolveResidentialPhysiologyCap,
  resolveRecruitmentCycle,
  type MedicalTreatmentCostPolicy,
  type EducationInvestmentPolicy,
  type PhysiologicalSafetyNetPolicy,
  type ResidentialPhysiologyCapPolicy,
  type ResidentialUpkeepPolicy,
  type ResidentialTierUpgradePolicy,
  type RecruitmentCyclePolicy,
  type SafetyNetSubsidyPolicy,
  type SleepDeprivationHealthDecayPolicy,
  type StochasticIllnessPolicy,
} from '@aivilization/society';
import {
  assertAdvanceSimulationTimePayload,
  assertRegisterAgentPayload,
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
  assertAgentGiveResourcePayload,
  assertAgentWorkPayload,
} from './commands';
import {
  EXCLUSIVE_AGENT_ACTIVITY_TIME_POLICY_VERSION,
  RUNTIME_AGENT_REGISTRATION_INITIAL_BALANCE,
  RUNTIME_AGENT_REGISTRATION_INITIAL_PHYSIOLOGY,
  RUNTIME_AGENT_REGISTRATION_INITIAL_RESIDENTIAL_TIER,
  RUNTIME_AGENT_REGISTRATION_MAX_POPULATION,
  RUNTIME_AGENT_REGISTRATION_POLICY_VERSION,
  type AgentActivityTimeCommittedPayload,
  type AgentActivityKind,
  type WorldEvent,
} from './events';
import type { WorldAgentState, WorldProjection } from './projection';
import { resolveAgentRegion, resolveMarketPool } from './regionalMarkets';
import { resolveSpatialRoute, TOWN_SPATIAL_GRAPH_POLICY_VERSION } from './spatial';

export type WorldCommandPolicies = {
  readonly randomSeed?: string;
  readonly agentRegistration?: {
    readonly maxAgentsPerCreator?: number;
  };
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
  readonly educationInvestment?: EducationInvestmentPolicy;
  readonly residentialPhysiologyCaps?: ResidentialPhysiologyCapPolicy;
  readonly production?: {
    readonly recipeOverrides?: readonly ProductionRecipeOverride[];
    readonly efficiency?: ProductionEfficiencyPolicy;
  };
  readonly tradeActivity?: {
    readonly durationSeconds: number;
  };
  /**
   * Optional regional-markets configuration. When enabled, each trade settles
   * against the AMM pool of the region the agent currently stands in, and the
   * handler gates the trade on regional co-location (an agent must be located in
   * the region whose pool it trades against). Disabled/omitted keeps the legacy
   * single-global-pool behavior byte-for-byte.
   */
  readonly regionalMarkets?: {
    readonly enabled: boolean;
  };
  readonly sleep?: {
    readonly energyRecoveryPerSecond: number;
    readonly maxEnergy: number;
  };
  readonly seeDoctor?: {
    readonly healthRecoveryPerSecond: number;
    readonly maxHealth: number;
    readonly treatmentCost?: MedicalTreatmentCostPolicy;
  };
  readonly sleepDeprivation?: SleepDeprivationHealthDecayPolicy;
  readonly stochasticIllness?: StochasticIllnessPolicy;
  readonly residentialUpkeep?: ResidentialUpkeepPolicy;
  /** Optional legacy balance-floor transfer; canonical AIvilization uses physiologicalSafetyNet. */
  readonly safetyNetSubsidy?: SafetyNetSubsidyPolicy;
  readonly physiologicalSafetyNet?: PhysiologicalSafetyNetPolicy;
  readonly jobApplication?: {
    readonly populationEducationScores: readonly number[];
    readonly quotaByResidentialTier: readonly number[];
    readonly recruitmentCycle?: RecruitmentCyclePolicy;
  };
  readonly residentialTierUpgrade?: ResidentialTierUpgradePolicy;
};

export function dispatchWorldCommand(input: {
  readonly command: CommandEnvelope<CoreCommandType, unknown>;
  readonly projection: WorldProjection;
  readonly policies: WorldCommandPolicies;
  readonly nextSequence: number;
}): WorldEvent[] {
  if (input.command.type.startsWith('Agent')) {
    const busyRejection = rejectBusyAgentCommand(input);
    if (busyRejection !== undefined) {
      return busyRejection;
    }
  }

  switch (input.command.type) {
    case 'RegisterAgent':
      return handleRegisterAgentCommand({
        command: input.command as CommandEnvelope<'RegisterAgent', unknown>,
        projection: input.projection,
        ...(input.policies.agentRegistration?.maxAgentsPerCreator === undefined
          ? {}
          : {
              maxAgentsPerCreator: input.policies.agentRegistration.maxAgentsPerCreator,
            }),
        nextSequence: input.nextSequence,
      });
    case 'AdvanceSimulationTime':
      return handleAdvanceSimulationTimeCommand({
        command: input.command as CommandEnvelope<'AdvanceSimulationTime', unknown>,
        projection: input.projection,
        ...(input.policies.randomSeed === undefined
          ? {}
          : { randomSeed: input.policies.randomSeed }),
        ...(input.policies.sleepDeprivation === undefined
          ? {}
          : { sleepDeprivation: input.policies.sleepDeprivation }),
        ...(input.policies.stochasticIllness === undefined
          ? {}
          : { stochasticIllness: input.policies.stochasticIllness }),
        ...(input.policies.residentialUpkeep === undefined
          ? {}
          : { residentialUpkeep: input.policies.residentialUpkeep }),
        ...(input.policies.safetyNetSubsidy === undefined
          ? {}
          : { safetyNetSubsidy: input.policies.safetyNetSubsidy }),
        ...(input.policies.physiologicalSafetyNet === undefined
          ? {}
          : { physiologicalSafetyNet: input.policies.physiologicalSafetyNet }),
        ...(input.policies.jobApplication?.recruitmentCycle === undefined
          ? {}
          : { recruitmentCycle: input.policies.jobApplication.recruitmentCycle }),
        nextSequence: input.nextSequence,
      });
    case 'AgentEat':
      return handleAgentEatCommand({
        command: input.command as CommandEnvelope<'AgentEat', unknown>,
        projection: input.projection,
        satietyRecoveryByCommodity: input.policies.satietyRecoveryByCommodity,
        maxSatiety: input.policies.maxSatiety,
        ...(input.policies.residentialPhysiologyCaps === undefined
          ? {}
          : { residentialPhysiologyCaps: input.policies.residentialPhysiologyCaps }),
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
        ...(input.policies.educationInvestment === undefined
          ? {}
          : { educationInvestment: input.policies.educationInvestment }),
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
        ...(input.policies.residentialPhysiologyCaps === undefined
          ? {}
          : { residentialPhysiologyCaps: input.policies.residentialPhysiologyCaps }),
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
        ...(input.policies.seeDoctor.treatmentCost === undefined
          ? {}
          : { treatmentCost: input.policies.seeDoctor.treatmentCost }),
        ...(input.policies.residentialPhysiologyCaps === undefined
          ? {}
          : { residentialPhysiologyCaps: input.policies.residentialPhysiologyCaps }),
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
        ...(input.policies.randomSeed === undefined
          ? {}
          : { randomSeed: input.policies.randomSeed }),
        ...(input.policies.production?.recipeOverrides === undefined
          ? {}
          : { recipeOverrides: input.policies.production.recipeOverrides }),
        ...(input.policies.production?.efficiency === undefined
          ? {}
          : { productionEfficiency: input.policies.production.efficiency }),
        criticalThresholds: input.policies.criticalThresholds,
        nextSequence: input.nextSequence,
      });
    case 'AgentTrade':
      return handleAgentTradeCommand({
        command: input.command as CommandEnvelope<'AgentTrade', unknown>,
        projection: input.projection,
        ...(input.policies.tradeActivity === undefined
          ? {}
          : { activityDurationSeconds: input.policies.tradeActivity.durationSeconds }),
        ...(input.policies.regionalMarkets === undefined
          ? {}
          : { regionalMarketsEnabled: input.policies.regionalMarkets.enabled }),
        nextSequence: input.nextSequence,
      });
    case 'AgentGiveResource':
      return handleAgentGiveResourceCommand({
        command: input.command as CommandEnvelope<'AgentGiveResource', unknown>,
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
        ...(input.policies.jobApplication.recruitmentCycle === undefined
          ? {}
          : { recruitmentCycle: input.policies.jobApplication.recruitmentCycle }),
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

function copyHumanAttribution(command: CommandEnvelope) {
  return command.humanAttribution === undefined
    ? {}
    : {
        humanAttribution: {
          ...command.humanAttribution,
          principalRoles: [...command.humanAttribution.principalRoles],
        },
      };
}

export function handleAdvanceSimulationTimeCommand(input: {
  readonly command: CommandEnvelope<'AdvanceSimulationTime', unknown>;
  readonly projection: WorldProjection;
  readonly randomSeed?: string;
  readonly sleepDeprivation?: SleepDeprivationHealthDecayPolicy;
  readonly stochasticIllness?: StochasticIllnessPolicy;
  readonly residentialUpkeep?: ResidentialUpkeepPolicy;
  readonly safetyNetSubsidy?: SafetyNetSubsidyPolicy;
  readonly physiologicalSafetyNet?: PhysiologicalSafetyNetPolicy;
  readonly recruitmentCycle?: RecruitmentCyclePolicy;
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
  appendCompletedTravelArrivals({ input, events, nextSimulationTime: next.now });

  if (
    input.sleepDeprivation === undefined &&
    input.stochasticIllness === undefined &&
    input.residentialUpkeep === undefined &&
    input.safetyNetSubsidy === undefined &&
    input.physiologicalSafetyNet === undefined &&
    input.recruitmentCycle === undefined
  ) {
    return events;
  }

  const durationSeconds = payload.deltaMs / 1000;
  const agents = Object.values(input.projection.agents).sort((left, right) =>
    left.agentId.localeCompare(right.agentId),
  );
  const physiologyByAgent = new Map<AgentId, WorldAgentState['physiology']>();
  const balanceByAgent = new Map<AgentId, number>();

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

  if (input.residentialUpkeep !== undefined) {
    for (const agent of agents) {
      const decision = evaluateResidentialUpkeep({
        residentialTier: agent.residentialTier,
        balance: getCurrentBalance(balanceByAgent, agent),
        durationSeconds,
        policy: input.residentialUpkeep,
      });
      if (decision.status === 'rejected') {
        throw new Error(decision.detail);
      }
      if (decision.status === 'uncharged') {
        continue;
      }
      events.push(
        makeEvent(input, events.length, 'ResidentialUpkeepCharged', {
          agentId: agent.agentId,
          residentialTier: decision.residentialTier,
          amount: decision.amount,
          unpaidAmount: decision.unpaidAmount,
          previousBalance: decision.previousBalance,
          nextBalance: decision.nextBalance,
          reason: 'residential-upkeep',
        }),
      );
      balanceByAgent.set(agent.agentId, decision.nextBalance);
    }
  }

  if (input.safetyNetSubsidy !== undefined) {
    for (const agent of agents) {
      const decision = evaluateSafetyNetSubsidy({
        balance: getCurrentBalance(balanceByAgent, agent),
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
      balanceByAgent.set(agent.agentId, decision.nextBalance);
    }
  }

  if (input.physiologicalSafetyNet !== undefined) {
    appendPhysiologicalSafetyNetEvents({
      input,
      events,
      agents,
      physiologyByAgent,
      previousSimulationTime: previous.now,
      currentSimulationTime: next.now,
      policy: input.physiologicalSafetyNet,
    });
  }

  if (input.recruitmentCycle !== undefined) {
    appendRecruitmentCycleEvents({
      input,
      events,
      previousSimulationTime: previous.now,
      nextSimulationTime: next.now,
      policy: input.recruitmentCycle,
    });
  }

  return events;
}

function appendPhysiologicalSafetyNetEvents(input: {
  readonly input: Parameters<typeof handleAdvanceSimulationTimeCommand>[0];
  readonly events: WorldEvent[];
  readonly agents: readonly WorldAgentState[];
  readonly physiologyByAgent: ReadonlyMap<AgentId, WorldAgentState['physiology']>;
  readonly previousSimulationTime: number;
  readonly currentSimulationTime: number;
  readonly policy: PhysiologicalSafetyNetPolicy;
}): void {
  for (const agent of input.agents) {
    const previousDistressState =
      input.input.projection.physiologicalDistressByAgent?.[agent.agentId];
    const decision = evaluatePhysiologicalSafetyNet({
      previousPhysiology: agent.physiology,
      currentPhysiology: getCurrentPhysiology(input.physiologyByAgent, agent),
      inventory: agent.inventory,
      ...(previousDistressState === undefined ? {} : { previousDistressState }),
      previousSimulationTime: input.previousSimulationTime,
      currentSimulationTime: input.currentSimulationTime,
      policy: input.policy,
    });
    const sourceEventOffsets: number[] = [];

    if (decision.transition === 'started' || decision.transition === 'updated') {
      if (decision.distressState === null) {
        throw new Error('active physiological distress transition requires state');
      }
      const distressOffset = input.events.length;
      input.events.push(
        makeEvent(input.input, distressOffset, 'PhysiologicalDistressChanged', {
          agentId: agent.agentId,
          status: 'active',
          state: decision.distressState,
          evaluatedAt: input.currentSimulationTime,
          reason: decision.transition,
        }),
      );
      sourceEventOffsets.push(distressOffset);
    } else if (decision.transition === 'cleared') {
      if (previousDistressState === undefined) {
        throw new Error('cleared physiological distress transition requires previous state');
      }
      input.events.push(
        makeEvent(input.input, input.events.length, 'PhysiologicalDistressChanged', {
          agentId: agent.agentId,
          status: 'cleared',
          previousState: previousDistressState,
          evaluatedAt: input.currentSimulationTime,
          reason: 'recovered',
        }),
      );
    }

    if (decision.grant === null) {
      continue;
    }
    const grantOffset = input.events.length;
    input.events.push(
      makeEvent(input.input, grantOffset, 'SafetyNetGranted', {
        agentId: agent.agentId,
        policyVersion: input.policy.policyVersion,
        grantedAt: decision.grant.grantedAt,
        distressDurationMs: decision.grant.distressDurationMs,
        lowAxes: decision.grant.lowAxes,
        inventory: decision.grant.inventory,
        reason: 'persistent-physiological-distress',
      }),
    );
    sourceEventOffsets.push(grantOffset);
    input.events.push(
      makeMemoryEvent(input.input, input.events.length, {
        agentId: agent.agentId,
        summary: `Received safety-net essentials after ${decision.grant.distressDurationMs} ms of physiological distress: ${createInventorySummary(decision.grant.inventory)}.`,
        status: 'succeeded',
        sourceEventOffsets,
        tags: [
          'safety-net',
          'physiological-distress',
          ...decision.grant.lowAxes.map((axis) => `low-${axis}`),
        ],
        consolidationHint: {
          kind: 'caution',
          patternKey: `safety-net:${decision.grant.lowAxes.join('+')}`,
          statement: `Persistent low ${decision.grant.lowAxes.join(', ')} can trigger essential welfare support.`,
        },
      }),
    );
  }
}

function createInventorySummary(inventory: Readonly<Record<string, number>>): string {
  return Object.entries(inventory)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([itemName, quantity]) => `${quantity} ${itemName}`)
    .join(', ');
}

function appendRecruitmentCycleEvents(input: {
  readonly input: Parameters<typeof handleAdvanceSimulationTimeCommand>[0];
  readonly events: WorldEvent[];
  readonly previousSimulationTime: number;
  readonly nextSimulationTime: number;
  readonly policy: RecruitmentCyclePolicy;
}): void {
  const cycleNumbers = calculateCompletedRecruitmentCycleNumbers({
    previousSimulationTime: input.previousSimulationTime,
    nextSimulationTime: input.nextSimulationTime,
    cycleDurationMs: input.policy.cycleDurationMs,
  });
  const jobByAgent = new Map(
    Object.values(input.input.projection.agents).map(
      (agent) => [agent.agentId, agent.job] as const,
    ),
  );

  for (const cycleNumber of cycleNumbers) {
    const applications = input.input.projection.jobApplications
      .filter(
        (application) =>
          application.cycleNumber === cycleNumber && application.status === 'pending',
      )
      .map((application) => ({
        applicationId: application.applicationId,
        agentId: application.agentId,
        occupationName: application.occupationName,
        educationScore: application.educationScore,
        residentialTier: application.residentialTier,
        submittedAt: application.submittedAt,
      }));
    const decision = resolveRecruitmentCycle({ applications, policy: input.policy });
    const acceptedByApplicationId = new Map(
      decision.acceptedApplications.map((application) => [application.applicationId, application]),
    );

    for (const resolution of decision.resolutions) {
      const resolutionOffset = input.events.length;
      input.events.push(
        makeEvent(input.input, resolutionOffset, 'JobApplicationResolved', {
          applicationId: resolution.applicationId,
          cycleNumber,
          agentId: resolution.agentId as AgentId,
          occupationName: resolution.occupationName,
          status: resolution.status,
          reason: resolution.reason,
        }),
      );

      const sourceEventOffsets = [resolutionOffset];
      const accepted = acceptedByApplicationId.get(resolution.applicationId);
      if (accepted !== undefined) {
        const assignmentOffset = input.events.length;
        input.events.push(
          makeEvent(input.input, assignmentOffset, 'JobAssigned', {
            applicationId: accepted.applicationId,
            cycleNumber,
            agentId: accepted.agentId as AgentId,
            occupationName: accepted.occupationName,
            previousJob: jobByAgent.get(accepted.agentId as AgentId) ?? null,
          }),
        );
        sourceEventOffsets.push(assignmentOffset);
        jobByAgent.set(accepted.agentId as AgentId, accepted.occupationName);
      }

      input.events.push(
        makeMemoryEvent(input.input, input.events.length, {
          agentId: resolution.agentId as AgentId,
          summary:
            resolution.status === 'accepted'
              ? `Recruitment cycle ${cycleNumber} accepted the application for ${resolution.occupationName}.`
              : `Recruitment cycle ${cycleNumber} rejected the application for ${resolution.occupationName}: ${resolution.reason}.`,
          status: resolution.status === 'accepted' ? 'succeeded' : 'failed',
          sourceEventOffsets,
          tags: [
            'recruitment-cycle',
            `recruitment-cycle:${cycleNumber}`,
            resolution.occupationName,
            resolution.status,
          ],
          consolidationHint:
            resolution.status === 'accepted'
              ? {
                  kind: 'habit',
                  patternKey: `recruitment-accepted:${resolution.occupationName}`,
                  statement: `Competes successfully for ${resolution.occupationName}.`,
                }
              : {
                  kind: 'caution',
                  patternKey: `recruitment-rejected:${resolution.occupationName}:${resolution.reason}`,
                  statement: `${resolution.occupationName} applications can be rejected because ${resolution.reason}.`,
                },
        }),
      );
    }

    input.events.push(
      makeEvent(input.input, input.events.length, 'RecruitmentCycleCompleted', {
        cycleNumber,
        cycleStartedAt: cycleNumber * input.policy.cycleDurationMs,
        cycleEndedAt: (cycleNumber + 1) * input.policy.cycleDurationMs,
        policyVersion: input.policy.policyVersion,
        applicationCount: decision.resolutions.length,
        acceptedCount: decision.acceptedApplications.length,
        rejectedCount: decision.resolutions.length - decision.acceptedApplications.length,
      }),
    );
  }
}

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

  const destinationOccupancy = Object.values(input.projection.agents).filter(
    (candidate) => candidate.locationId === payload.targetLocationId,
  ).length;
  const destinationReservations = Object.values(input.projection.transitByAgent ?? {}).filter(
    (transit) => transit.toLocationId === payload.targetLocationId,
  ).length;
  const destinationCapacityUsage = destinationOccupancy + destinationReservations;
  if (targetLocation.capacity !== null && destinationCapacityUsage >= targetLocation.capacity) {
    return rejectCommand(
      input,
      'AgentMoveTo',
      `target location ${payload.targetLocationId} is at capacity ${targetLocation.capacity}`,
    );
  }
  const route = resolveSpatialRoute({
    locations: input.projection.locations,
    fromLocationId: agent.locationId,
    toLocationId: payload.targetLocationId,
    destinationOccupancy: destinationCapacityUsage,
  });
  if (route === null) {
    return rejectCommand(
      input,
      'AgentMoveTo',
      `no route from ${agent.locationId ?? 'unplaced'} to ${payload.targetLocationId}`,
    );
  }
  const usesSpatialGraph =
    targetLocation.connections !== undefined ||
    (agent.locationId !== null &&
      input.projection.locations[agent.locationId]?.connections !== undefined);

  const events: WorldEvent[] = [];
  if (usesSpatialGraph && route.travelDurationSeconds > 0 && agent.locationId !== null) {
    events.push(
      makeEvent(input, events.length, 'AgentTravelStarted', {
        agentId: agent.agentId,
        fromLocationId: agent.locationId,
        toLocationId: payload.targetLocationId,
        routeLocationIds: route.locationIds,
        spatialPolicyVersion: TOWN_SPATIAL_GRAPH_POLICY_VERSION,
        baseTravelDurationSeconds: route.baseTravelDurationSeconds,
        congestionMultiplier: route.congestionMultiplier,
        travelDurationSeconds: route.travelDurationSeconds,
        departedAt: input.projection.clock.now,
        arrivesAt: input.projection.clock.now + route.travelDurationSeconds * 1000,
        reason: payload.reason ?? 'move',
      }),
    );
  } else {
    events.push(
      makeEvent(input, events.length, 'AgentLocationChanged', {
        agentId: agent.agentId,
        previousLocationId: agent.locationId,
        nextLocationId: payload.targetLocationId,
        reason: payload.reason ?? 'move',
        ...(usesSpatialGraph
          ? {
              spatialPolicyVersion: TOWN_SPATIAL_GRAPH_POLICY_VERSION,
              routeLocationIds: route.locationIds,
              baseTravelDurationSeconds: route.baseTravelDurationSeconds,
              congestionMultiplier: route.congestionMultiplier,
              travelDurationSeconds: route.travelDurationSeconds,
            }
          : {}),
      }),
    );
  }
  if (route.travelDurationSeconds > 0) {
    events.push(
      makeAgentActivityTimeCommittedEvent(input, events.length, {
        agentId: agent.agentId,
        activity: 'travel',
        commandType: 'AgentMoveTo',
        durationSeconds: route.travelDurationSeconds,
        settlementTiming: 'effects-at-completion',
      }),
    );
  }
  events.push(
    makeMemoryEvent(input, events.length, {
      summary:
        route.travelDurationSeconds === 0
          ? `Moved to ${targetLocation.name}.`
          : `Started traveling to ${targetLocation.name}; arrival is due in ${route.travelDurationSeconds} seconds via ${route.locationIds.join(' -> ')}.`,
      status: 'succeeded',
      tags: [
        'move',
        payload.targetLocationId,
        targetLocation.kind,
        ...(usesSpatialGraph ? [TOWN_SPATIAL_GRAPH_POLICY_VERSION] : []),
      ],
      consolidationHint: {
        kind: 'habit',
        patternKey: `move:${payload.targetLocationId}`,
        statement: usesSpatialGraph
          ? `Travels to ${targetLocation.name} when the current plan requires ${targetLocation.kind} activities; the route costs ${route.travelDurationSeconds} seconds under current congestion.`
          : `Moves to ${targetLocation.name} when the current plan requires ${targetLocation.kind} activities.`,
      },
    }),
  );
  return events;
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
  const outcomeTurns = verifyConversationCommitmentSignals({
    projection: input.projection,
    participantAgentIds,
    topic: payload.topic,
    turns,
  });
  const socialOutcomes = evaluateConversationSocialOutcomes({
    initiatorAgentId: agent.agentId,
    targetAgentId: targetAgent.agentId,
    turns: outcomeTurns,
  });
  const knowledgeClaims = extractSocialKnowledgeClaims(payload.topic, turns);
  const sourceKnowledgeClaims = knowledgeClaims.filter(
    (claim) => claim.sourceAgentId === targetAgent.agentId,
  );
  const targetKnowledgeClaims = knowledgeClaims.filter(
    (claim) => claim.sourceAgentId === agent.agentId,
  );
  const sourceRelation = planSocialInteractionEvent({
    projection: input.projection,
    sourceAgentId: agent.agentId,
    targetAgentId: targetAgent.agentId,
    summary,
    relationDelta: socialOutcomes.initiatorToTarget.relationDelta,
    attitudeDelta: socialOutcomes.initiatorToTarget.attitudeDelta,
    outcomePolicyVersion: socialOutcomes.policyVersion,
    outcomeSignals: socialOutcomes.initiatorToTarget.signals,
  });
  if (sourceRelation.status === 'invalid') {
    return rejectCommand(input, 'AgentStartConversation', sourceRelation.reason);
  }
  const targetRelation = planSocialInteractionEvent({
    projection: input.projection,
    sourceAgentId: targetAgent.agentId,
    targetAgentId: agent.agentId,
    summary,
    relationDelta: socialOutcomes.targetToInitiator.relationDelta,
    attitudeDelta: socialOutcomes.targetToInitiator.attitudeDelta,
    outcomePolicyVersion: socialOutcomes.policyVersion,
    outcomeSignals: socialOutcomes.targetToInitiator.signals,
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
      sourceEventOffsets: [0, 1, 2],
      tags: stableUnique([
        'conversation',
        payload.topic,
        targetAgent.agentId,
        location.locationId,
        ...socialOutcomes.initiatorToTarget.signals,
      ]),
      consolidationHint: {
        kind: 'social',
        targetAgentId: targetAgent.agentId,
        relationDelta: socialOutcomes.initiatorToTarget.relationDelta,
        attitudeDelta: socialOutcomes.initiatorToTarget.attitudeDelta,
        summary,
        outcomePolicyVersion: socialOutcomes.policyVersion,
        outcomeSignals: socialOutcomes.initiatorToTarget.signals,
        knowledgeClaims: sourceKnowledgeClaims,
      },
    }),
    makeMemoryEvent(input, 4, {
      agentId: targetAgent.agentId,
      kind: 'social-interaction',
      summary,
      status: 'succeeded',
      sourceEventOffsets: [0, 1, 2],
      tags: stableUnique([
        'conversation',
        payload.topic,
        agent.agentId,
        location.locationId,
        ...socialOutcomes.targetToInitiator.signals,
      ]),
      consolidationHint: {
        kind: 'social',
        targetAgentId: agent.agentId,
        relationDelta: socialOutcomes.targetToInitiator.relationDelta,
        attitudeDelta: socialOutcomes.targetToInitiator.attitudeDelta,
        summary,
        outcomePolicyVersion: socialOutcomes.policyVersion,
        outcomeSignals: socialOutcomes.targetToInitiator.signals,
        knowledgeClaims: targetKnowledgeClaims,
      },
    }),
  ];
}

export function handleAgentGiveResourceCommand(input: {
  readonly command: CommandEnvelope<'AgentGiveResource', unknown>;
  readonly projection: WorldProjection;
  readonly nextSequence: number;
}): WorldEvent[] {
  const sourceAgent = resolveCommandAgent(input.projection, input.command);
  const payloadResult = parsePayload(() => assertAgentGiveResourcePayload(input.command.payload));
  if (payloadResult.status === 'invalid') {
    return rejectCommand(input, 'AgentGiveResource', payloadResult.reason);
  }
  const payload = payloadResult.payload;
  const targetAgent = input.projection.agents[payload.targetAgentId];
  if (targetAgent === undefined) {
    return rejectCommand(
      input,
      'AgentGiveResource',
      `unknown target agent ${payload.targetAgentId}`,
    );
  }
  if (sourceAgent.agentId === targetAgent.agentId) {
    return rejectCommand(input, 'AgentGiveResource', 'resource transfer target must differ');
  }
  if (
    sourceAgent.locationId === null ||
    targetAgent.locationId === null ||
    sourceAgent.locationId !== targetAgent.locationId
  ) {
    return rejectCommand(
      input,
      'AgentGiveResource',
      'resource transfer participants must be co-located at a known location',
    );
  }
  const availableQuantity = getInventoryQuantity(sourceAgent.inventory, payload.commodityName);
  if (availableQuantity < payload.quantity) {
    return rejectCommand(
      input,
      'AgentGiveResource',
      `insufficient ${payload.commodityName}: required ${payload.quantity}, available ${availableQuantity}`,
    );
  }

  const socialOutcome = evaluateResourceTransferSocialOutcome({
    recipientAgentId: targetAgent.agentId,
    providerAgentId: sourceAgent.agentId,
    quantity: payload.quantity,
  });
  const summary = `${sourceAgent.agentId} gave ${payload.quantity} ${payload.commodityName} to ${targetAgent.agentId}${
    payload.note === undefined ? '.' : `: ${payload.note}`
  }`;
  const recipientRelation = planSocialInteractionEvent({
    projection: input.projection,
    sourceAgentId: targetAgent.agentId,
    targetAgentId: sourceAgent.agentId,
    summary,
    relationDelta: socialOutcome.relationDelta,
    attitudeDelta: socialOutcome.attitudeDelta,
    outcomePolicyVersion: socialOutcome.policyVersion,
    outcomeSignals: socialOutcome.signals,
  });
  if (recipientRelation.status === 'invalid') {
    return rejectCommand(input, 'AgentGiveResource', recipientRelation.reason);
  }

  return [
    makeEvent(input, 0, 'ResourceTransferred', {
      sourceAgentId: sourceAgent.agentId,
      targetAgentId: targetAgent.agentId,
      commodityName: payload.commodityName,
      quantity: payload.quantity,
      ...(payload.note === undefined ? {} : { note: payload.note }),
    }),
    makeEvent(input, 1, 'SocialInteractionCompleted', recipientRelation.payload),
    makeMemoryEvent(input, 2, {
      agentId: sourceAgent.agentId,
      kind: 'action',
      summary,
      status: 'succeeded',
      sourceEventOffsets: [0, 1],
      tags: ['resource-transfer', 'provided-help', payload.commodityName, targetAgent.agentId],
    }),
    makeMemoryEvent(input, 3, {
      agentId: targetAgent.agentId,
      kind: 'social-interaction',
      summary,
      status: 'succeeded',
      sourceEventOffsets: [0, 1],
      tags: [
        'resource-transfer',
        'received-help',
        payload.commodityName,
        sourceAgent.agentId,
        ...socialOutcome.signals,
      ],
      consolidationHint: {
        kind: 'social',
        targetAgentId: sourceAgent.agentId,
        relationDelta: socialOutcome.relationDelta,
        attitudeDelta: socialOutcome.attitudeDelta,
        summary,
        outcomePolicyVersion: socialOutcome.policyVersion,
        outcomeSignals: socialOutcome.signals,
      },
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

export function handleAgentTradeCommand(input: {
  readonly command: CommandEnvelope<'AgentTrade', unknown>;
  readonly projection: WorldProjection;
  readonly activityDurationSeconds?: number;
  readonly regionalMarketsEnabled?: boolean;
  readonly nextSequence: number;
}): WorldEvent[] {
  const agent = resolveCommandAgent(input.projection, input.command);
  const payloadResult = parsePayload(() => assertAgentTradePayload(input.command.payload));
  if (payloadResult.status === 'invalid') {
    return rejectCommand(input, 'AgentTrade', payloadResult.reason);
  }

  const payload = payloadResult.payload;
  const regionalMarketsEnabled = input.regionalMarketsEnabled === true;

  // Resolve which regional pool the trade settles against. When regional
  // markets are disabled this always resolves to the default region, so the
  // pool key is the bare commodity name — identical to the legacy global lookup.
  const agentRegionId = resolveAgentRegion({
    projection: input.projection,
    agentLocationId: agent.locationId,
  });
  const requestedRegionId = regionalMarketsEnabled
    ? (payload.regionId ?? agentRegionId)
    : undefined;

  if (regionalMarketsEnabled) {
    // Co-location gate: an agent may only trade against the region it currently
    // stands in. This is the friction that makes regional price divergence
    // durable — exploiting a cheaper foreign region requires physically moving
    // there first. It mirrors the existing co-location gate used by conversation
    // and resource transfer. A locationless agent is treated as standing in the
    // default region and may still trade there.
    if (
      agent.locationId !== null &&
      payload.regionId !== undefined &&
      payload.regionId !== agentRegionId
    ) {
      return rejectCommand(
        input,
        'AgentTrade',
        `trade-requires-regional-co-location: agent in region ${agentRegionId}, requested ${payload.regionId}`,
      );
    }
  }

  const pool = resolveMarketPool(input.projection, {
    regionId: requestedRegionId,
    commodity: payload.commodityName,
  });
  if (pool === undefined) {
    const regionHint =
      regionalMarketsEnabled && requestedRegionId !== undefined ? ` in region ${requestedRegionId}` : '';
    return rejectCommand(
      input,
      'AgentTrade',
      `missing AMM pool for ${payload.commodityName}${regionHint}`,
    );
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
      tradeResult.payload,
      input.activityDurationSeconds,
      requestedRegionId,
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
    tradeResult.payload,
    input.activityDurationSeconds,
    requestedRegionId,
  );
}

export function handleAgentApplyJobCommand(input: {
  readonly command: CommandEnvelope<'AgentApplyJob', unknown>;
  readonly projection: WorldProjection;
  readonly populationEducationScores: readonly number[];
  readonly quotaByResidentialTier: readonly number[];
  readonly recruitmentCycle?: RecruitmentCyclePolicy;
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

  const cycleNumber =
    input.recruitmentCycle === undefined
      ? 0
      : calculateRecruitmentCycleNumber({
          simulationTime: input.projection.clock.now,
          cycleDurationMs: input.recruitmentCycle.cycleDurationMs,
        });
  const applicationsInQuotaWindow = input.projection.jobApplications.filter(
    (application) =>
      application.agentId === agent.agentId &&
      (input.recruitmentCycle === undefined || application.cycleNumber === cycleNumber),
  );
  const usedApplications = applicationsInQuotaWindow.length;
  if (usedApplications >= quotaResult.payload) {
    return rejectCommand(
      input,
      'AgentApplyJob',
      `application quota exceeded: allowed ${quotaResult.payload}, used ${usedApplications}`,
    );
  }

  const payload = payloadResult.payload;
  if (
    input.recruitmentCycle !== undefined &&
    applicationsInQuotaWindow.some(
      (application) => application.occupationName === payload.occupationName,
    )
  ) {
    return rejectCommand(
      input,
      'AgentApplyJob',
      `duplicate application for ${payload.occupationName} in recruitment cycle ${cycleNumber}`,
    );
  }
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
  const applicationId = `${input.command.id}:application`;
  const submittedEvent = makeEvent(input, baseOffset, 'JobApplicationSubmitted', {
    applicationId,
    cycleNumber,
    agentId: agent.agentId,
    occupationName: payload.occupationName,
    residentialTier: agent.residentialTier,
    educationScore: agent.educationScore,
  });

  if (input.recruitmentCycle !== undefined) {
    return [
      ...prerequisiteEvents,
      submittedEvent,
      makeMemoryEvent(input, baseOffset + 1, {
        summary: `Submitted an application for ${payload.occupationName} in recruitment cycle ${cycleNumber}.`,
        status: 'succeeded',
        tags: ['apply-job', payload.occupationName, `recruitment-cycle:${cycleNumber}`],
        consolidationHint: {
          kind: 'habit',
          patternKey: `apply-job:${payload.occupationName}`,
          statement: `Applies for ${payload.occupationName} when qualified.`,
        },
      }),
    ];
  }

  return [
    ...prerequisiteEvents,
    submittedEvent,
    makeEvent(input, baseOffset + 1, 'JobAssigned', {
      applicationId,
      cycleNumber,
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
  readonly outcomePolicyVersion?: string;
  readonly outcomeSignals?: readonly string[];
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

function extractSocialKnowledgeClaims(
  topic: string,
  turns: readonly {
    readonly speakerAgentId: AgentId;
    readonly utterance: string;
    readonly intent?: string;
  }[],
): readonly SocialKnowledgeClaim[] {
  return turns.flatMap((turn) => {
    const status = resolveKnowledgeClaimStatus(turn.intent);
    return status === undefined
      ? []
      : [
          {
            sourceAgentId: turn.speakerAgentId,
            topic,
            statement: turn.utterance,
            status,
          },
        ];
  });
}

function verifyConversationCommitmentSignals(input: {
  readonly projection: WorldProjection;
  readonly participantAgentIds: readonly [AgentId, AgentId];
  readonly topic: string;
  readonly turns: readonly {
    readonly turnIndex: number;
    readonly speakerAgentId: AgentId;
    readonly utterance: string;
    readonly intent?: string;
  }[];
}) {
  const openCommitmentByPromisor = new Map<AgentId, boolean>();
  for (const promisorAgentId of input.participantAgentIds) {
    openCommitmentByPromisor.set(
      promisorAgentId,
      hasOpenConversationCommitment({
        projection: input.projection,
        participantAgentIds: input.participantAgentIds,
        topic: input.topic,
        promisorAgentId,
      }),
    );
  }

  return input.turns.map((turn) => {
    const intent = normalizeSocialIntent(turn.intent);
    const requiresOpenCommitment = isCommitmentResolutionIntent(intent);
    const hasOpenCommitment = openCommitmentByPromisor.get(turn.speakerAgentId) ?? false;
    if (requiresOpenCommitment && !hasOpenCommitment) {
      return { ...turn, intent: 'unverified-social-claim' };
    }
    if (requiresOpenCommitment) {
      openCommitmentByPromisor.set(turn.speakerAgentId, false);
    }
    return turn;
  });
}

function hasOpenConversationCommitment(input: {
  readonly projection: WorldProjection;
  readonly participantAgentIds: readonly [AgentId, AgentId];
  readonly topic: string;
  readonly promisorAgentId: AgentId;
}): boolean {
  return Object.values(input.projection.socialCommitments).some(
    (commitment) =>
      commitment.status === 'open' &&
      commitment.promisorAgentId === input.promisorAgentId &&
      commitment.topic === input.topic &&
      input.participantAgentIds.includes(commitment.beneficiaryAgentId),
  );
}

function normalizeSocialIntent(intent: string | undefined): string {
  return intent?.trim().toLowerCase().replaceAll('_', '-') ?? '';
}

function isCommitmentResolutionIntent(intent: string): boolean {
  const commitmentIntent = classifySocialCommitmentIntent(intent);
  return commitmentIntent === 'fulfilled' || commitmentIntent === 'breached';
}

function resolveKnowledgeClaimStatus(
  intent: string | undefined,
): SocialKnowledgeClaimStatus | undefined {
  const normalized = intent?.trim().toLowerCase().replaceAll('_', '-') ?? '';
  if (containsAnySignal(normalized, ['misinform', 'deceive', 'lie'])) {
    return 'suspected-misinformation';
  }
  if (containsAnySignal(normalized, ['correct-information', 'correct-claim'])) {
    return 'corrected';
  }
  if (containsAnySignal(normalized, ['dispute-information', 'dispute-claim'])) {
    return 'disputed';
  }
  if (containsAnySignal(normalized, ['share-information', 'assert-claim', 'report-fact'])) {
    return 'asserted';
  }
  return undefined;
}

function containsAnySignal(value: string, signals: readonly string[]): boolean {
  return signals.some((signal) => value.includes(signal));
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
  tradeResult: AmmTradeResult,
  activityDurationSeconds: number | undefined,
  regionId: string | undefined,
): WorldEvent[] {
  const agent = resolveCommandAgent(input.projection, input.command);
  const memoryOffset = activityDurationSeconds === undefined ? 1 : 2;

  return [
    makeEvent(input, 0, 'TradeExecuted', {
      agentId: agent.agentId,
      side,
      commodityName,
      commodityQuantity,
      currencyQuantity,
      poolAfter: tradeResult.poolAfter,
      moneySupplyDelta: tradeResult.moneySupplyDelta,
      effectivePrice: tradeResult.effectivePrice,
      spotPriceBefore: tradeResult.spotPriceBefore,
      spotPriceAfter: tradeResult.spotPriceAfter,
      slippageRatio: tradeResult.slippageRatio,
      invariantBefore: tradeResult.invariantBefore,
      invariantAfter: tradeResult.invariantAfter,
      ...(regionId === undefined ? {} : { regionId }),
    }),
    ...(activityDurationSeconds === undefined
      ? []
      : [
          makeAgentActivityTimeCommittedEvent(input, 1, {
            agentId: agent.agentId,
            activity: 'trade',
            commandType: 'AgentTrade',
            durationSeconds: activityDurationSeconds,
          }),
        ]),
    makeMemoryEvent(input, memoryOffset, {
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

function rejectBusyAgentCommand(input: {
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
    readonly sourceEventOffsets?: readonly number[];
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
    }),
  });
}

function createMemorySourceEventIds(input: {
  readonly commandId: CommandEnvelope<CoreCommandType, unknown>['id'];
  readonly offset: number;
  readonly sourceEventOffsets?: readonly number[];
}) {
  const sourceEventOffsets =
    input.sourceEventOffsets ?? Array.from({ length: input.offset }, (_, index) => index);
  return sourceEventOffsets.map((offset) => asEventId(`${input.commandId}:event:${offset}`));
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

function getCurrentBalance(
  balanceByAgent: ReadonlyMap<AgentId, number>,
  agent: WorldAgentState,
): number {
  return balanceByAgent.get(agent.agentId) ?? agent.balance;
}

function resolveRecoveryMaximum(input: {
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

function createStochasticIllnessSeed(input: {
  readonly input: Parameters<typeof handleAdvanceSimulationTimeCommand>[0];
  readonly payload: { readonly deltaMs: number };
  readonly agent: WorldAgentState;
}): string {
  return [
    'stochastic-illness',
    ...(input.input.randomSeed === undefined ? [] : [input.input.randomSeed]),
    input.input.command.simulationId,
    input.input.command.id,
    input.input.projection.clock.now,
    input.payload.deltaMs,
    input.agent.agentId,
  ].join(':');
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

function makeAgentActivityTimeCommittedEvent(
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

function appendCompletedTravelArrivals(input: {
  readonly input: Parameters<typeof handleAdvanceSimulationTimeCommand>[0];
  readonly events: WorldEvent[];
  readonly nextSimulationTime: number;
}): void {
  const completed = Object.values(input.input.projection.transitByAgent ?? {})
    .filter((transit) => transit.arrivesAt <= input.nextSimulationTime)
    .sort((left, right) =>
      left.arrivesAt === right.arrivesAt
        ? left.agentId.localeCompare(right.agentId)
        : left.arrivesAt - right.arrivesAt,
    );
  for (const transit of completed) {
    input.events.push(
      makeEvent(input.input, input.events.length, 'AgentLocationChanged', {
        agentId: transit.agentId,
        previousLocationId: transit.fromLocationId,
        nextLocationId: transit.toLocationId,
        reason: 'travel-arrival',
        spatialPolicyVersion: transit.spatialPolicyVersion,
        routeLocationIds: transit.routeLocationIds,
        baseTravelDurationSeconds: transit.baseTravelDurationSeconds,
        congestionMultiplier: transit.congestionMultiplier,
        travelDurationSeconds: transit.travelDurationSeconds,
      }),
    );
  }
}
