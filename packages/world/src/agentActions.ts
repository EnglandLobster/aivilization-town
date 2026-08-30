import type { CommandEnvelope, CoreCommandType } from '@aivilization/sim-core';
import type { RenewableResourcePolicy } from '@aivilization/economy';
import type {
  EducationInvestmentPolicy,
  EducationSystemPolicy,
  LandValuePolicy,
  MedicalTreatmentCostPolicy,
  PhysiologicalSafetyNetPolicy,
  RecruitmentCyclePolicy,
  ResidentialPhysiologyCapPolicy,
  ResidentialTierUpgradePolicy,
  ResidentialUpkeepPolicy,
  ServiceQualityPolicy,
  SafetyNetSubsidyPolicy,
  SleepDeprivationHealthDecayPolicy,
  StarvationHealthDecayPolicy,
  StochasticIllnessPolicy,
  TownCalendarPolicy,
  TownConditionsPolicy,
  CollectiveActionPolicy,
  LifecyclePolicy,
  OutMigrationPolicy,
  TownDiscoursePolicy,
  TownGovernancePolicy,
  WellbeingPolicy,
} from '@aivilization/society';
import type { TownBulletinPolicy } from './bulletin';
import type { TownConflictPolicy } from './conflict';
import type { CreditPolicy } from './credit';
import type { WorldEconomicPolicies } from './economicPolicies';
import type { SocialMattersPolicy } from './matters';
import type { WorldEvent } from './events';
import type { WorldProjection } from './projection';
import type { TownWeatherPolicy } from './weather';
import { resolveAgentServiceQuality } from './serviceQuality';
import {
  handleAgentConfrontCommand,
  handleAgentAttackCommand,
  handleAgentInterveneCommand,
} from './handlers/conflict';
import {
  handleAgentPostBulletinCommand,
  handleIssueTownBulletinCommand,
} from './handlers/bulletin';
import {
  handleAgentRaisePetitionCommand,
  handleAgentSignPetitionCommand,
} from './handlers/petition';
import { handleAgentStartConversationCommand } from './handlers/conversation';
import { handleAgentConsumeCommand } from './handlers/consumption';
import {
  handleAgentDepositCommand,
  handleAgentRequestLoanCommand,
  handleAgentWithdrawCommand,
} from './handlers/credit';
import {
  handleAgentCloseEnterpriseCommand,
  handleAgentFoundEnterpriseCommand,
  handleAgentFundEnterpriseCommand,
  handleAgentJoinEnterpriseCommand,
  handleAgentLayoffEnterpriseEmployeeCommand,
  handleAgentLeaveEnterpriseCommand,
  handleAgentSetEnterpriseJobPostingCommand,
} from './handlers/enterprise';
import {
  handleAgentApplyJobCommand,
  handleAgentGiveResourceCommand,
  handleAgentTradeCommand,
  handleAgentUpgradeResidentialTierCommand,
} from './handlers/economic';
import { handleAgentApplyEducationExamCommand } from './handlers/educationExam';
import {
  handleAgentAssignMatterCommand,
  handleAgentCloseMatterCommand,
  handleAgentRaiseMatterCommand,
  handleAgentRespondMatterCommand,
} from './handlers/matters';
import { handleAgentMoveToCommand, handleAgentObserveLocationCommand } from './handlers/movement';
import {
  handleAgentEatCommand,
  handleAgentProduceCommand,
  handleAgentSeeDoctorCommand,
  handleAgentSleepCommand,
  handleAgentStudyCommand,
  handleAgentWorkCommand,
} from './handlers/physiology';
import {
  handleAgentExportCommodityCommand,
  handleAgentImportCommodityCommand,
} from './handlers/externalTrade';
import { handleRegisterAgentCommand } from './handlers/registration';
import { handleAdvanceSimulationTimeCommand } from './handlers/timeAdvance';
import {
  handleSetPublicBudgetCommand,
  handleSetSubsidyPolicyCommand,
  handleSetTaxPolicyCommand,
} from './handlers/governance';
import { rejectBusyAgentCommand, rejectCommand } from './handlers/shared';

// The command handlers live in ./handlers by domain. They are re-exported here
// so the public @aivilization/world API is unchanged by the split.
export {
  handleAgentConfrontCommand,
  handleAgentAttackCommand,
  handleAgentInterveneCommand,
} from './handlers/conflict';
export {
  handleAgentPostBulletinCommand,
  handleIssueTownBulletinCommand,
} from './handlers/bulletin';
export { handleAgentStartConversationCommand } from './handlers/conversation';
export { handleAgentConsumeCommand } from './handlers/consumption';
export {
  handleAgentDepositCommand,
  handleAgentRequestLoanCommand,
  handleAgentWithdrawCommand,
} from './handlers/credit';
export {
  handleAgentCloseEnterpriseCommand,
  handleAgentFoundEnterpriseCommand,
  handleAgentFundEnterpriseCommand,
  handleAgentJoinEnterpriseCommand,
  handleAgentLayoffEnterpriseEmployeeCommand,
  handleAgentLeaveEnterpriseCommand,
  handleAgentSetEnterpriseJobPostingCommand,
} from './handlers/enterprise';
export {
  handleAgentApplyJobCommand,
  handleAgentGiveResourceCommand,
  handleAgentTradeCommand,
  handleAgentUpgradeResidentialTierCommand,
} from './handlers/economic';
export { handleAgentApplyEducationExamCommand } from './handlers/educationExam';
export {
  handleAgentAssignMatterCommand,
  handleAgentCloseMatterCommand,
  handleAgentRaiseMatterCommand,
  handleAgentRespondMatterCommand,
} from './handlers/matters';
export { handleAgentMoveToCommand, handleAgentObserveLocationCommand } from './handlers/movement';
export {
  handleAgentEatCommand,
  handleAgentProduceCommand,
  handleAgentSeeDoctorCommand,
  handleAgentSleepCommand,
  handleAgentStudyCommand,
  handleAgentWorkCommand,
} from './handlers/physiology';
export {
  handleAgentExportCommodityCommand,
  handleAgentImportCommodityCommand,
} from './handlers/externalTrade';
export { handleRegisterAgentCommand } from './handlers/registration';
export { handleAdvanceSimulationTimeCommand } from './handlers/timeAdvance';
export {
  handleSetPublicBudgetCommand,
  handleSetSubsidyPolicyCommand,
  handleSetTaxPolicyCommand,
} from './handlers/governance';

export type WorldCommandPolicies = WorldEconomicPolicies & {
  readonly governance?: TownGovernancePolicy;
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
  /**
   * Optional discrete education-system policy (education-system-v2). When
   * present and enabled, AgentStudy settles tuition per level (compulsory
   * levels are billed to the treasury) with the employed-study efficiency
   * penalty, and AdvanceSimulationTime settles automatic promotions inside the
   * compulsory stage. Absent or disabled keeps the legacy continuous-score
   * study semantics byte-for-byte.
   */
  readonly educationSystem?: EducationSystemPolicy;
  readonly residentialPhysiologyCaps?: ResidentialPhysiologyCapPolicy;
  /**
   * Optional regional-markets configuration. When enabled, each trade settles
   * against the AMM pool of the region the agent currently stands in, and the
   * handler gates the trade on regional co-location (an agent must be located in
   * the region whose pool it trades against). Disabled/omitted keeps the legacy
   * single-global-pool behavior byte-for-byte.
   */
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
  /** Optional starvation pressure; omitted preserves legacy non-lethal hunger. */
  readonly starvation?: StarvationHealthDecayPolicy;
  readonly stochasticIllness?: StochasticIllnessPolicy;
  /**
   * Optional finite regional stocks for primary production. The economy domain
   * owns extraction/regeneration arithmetic; world records each factual stock
   * transition beside the production event. Omitted preserves legacy infinite
   * primary production.
   */
  readonly renewableResources?: RenewableResourcePolicy;
  /**
   * Optional town-weather policy. When
   * present, AdvanceSimulationTime evaluates the Markov transition matrix once
   * per cadence and emits WeatherChanged events. Omitted keeps the world free
   * of any weather state or events, byte-for-byte identical to legacy runs.
   */
  readonly weather?: TownWeatherPolicy;
  /**
   * Optional town-calendar policy (town-calendar-v1). When present,
   * AdvanceSimulationTime emits one TownDayPhaseChanged per crossed phase
   * start and settles the passive physiological decay (energy/satiety) per
   * agent and interval before the wellbeing block. Omitted keeps the world
   * calendar-free and decay-free, byte-for-byte identical to legacy runs.
   */
  readonly calendar?: TownCalendarPolicy;
  /**
   * Optional versioned town-lifecycle policy. When present, the
   * lifecycle block of AdvanceSimulationTime settles aging (AgentAged),
   * forced retirement with the treasury pension (AgentRetired/PensionPaid),
   * and pre-rolled-lifespan or illness deaths with estate liquidation
   * (EnterpriseEmployeeLeft + LoanWrittenOff/DepositForfeited +
   * AgentDied). Omitted keeps the population static, byte-for-byte identical
   * to legacy runs.
   */
  readonly lifecycle?: LifecyclePolicy;
  /**
   * Optional town-discourse policy (town-discourse-v1). When present,
   * AgentStartConversation can additionally propagate one of the speaker's
   * recent memories to the listener as a distorted hearsay copy. Omitted
   * keeps conversations byte-for-byte identical to legacy runs.
   */
  readonly discourse?: TownDiscoursePolicy;
  /**
   * Optional collective-action policy (collective-action-v1). When present,
   * AgentRaisePetition/AgentSignPetition settle petitions (aggregate →
   * threshold → town-wide event). Omitted rejects both commands and keeps
   * the world petition-free.
   */
  readonly collectiveAction?: CollectiveActionPolicy;
  /**
   * Optional out-migration policy (town-migration-v2). When present, the
   * population-turnover block of AdvanceSimulationTime additionally rolls
   * the CS2 NotHappy departure per agent and cadence; departing agents
   * liquidate through the shared estate path. Omitted keeps the population
   * closed, byte-for-byte identical to legacy runs.
   */
  readonly migration?: OutMigrationPolicy;
  /**
   * Optional town-condition catalog.
   * Read-path only: command handlers never consume it. When present, planning
   * context builders derive per-agent conditions from durable physiology axes,
   * the projection weather, and location exposure. Omitted keeps every read
   * path condition-free, byte-for-byte identical to legacy runs.
   */
  readonly conditions?: TownConditionsPolicy;
  /**
   * Optional town-bulletin policy (town bulletin board slice). When present,
   * AgentPostBulletin/IssueTownBulletin settle onto the authoritative board;
   * omitted rejects both commands and keeps the world bulletin-free.
   */
  readonly bulletin?: TownBulletinPolicy;
  /**
   * Optional social-matters policy (social matters slice). When present, the
   * matter lifecycle commands settle and conversation commitments escalate
   * into latent matters; omitted rejects the commands and leaves conversation
   * commitments exactly as before.
   */
  readonly socialMatters?: SocialMattersPolicy;
  /**
   * Optional town-conflict policy (conflict system slice). When present,
   * confront/attack/intervene settle with world-adjudicated grievance, damage,
   * and social fallout; omitted rejects all three commands.
   */
  readonly conflict?: TownConflictPolicy;
  readonly residentialUpkeep?: ResidentialUpkeepPolicy;
  /**
   * Optional regional land value policy. When present, AdvanceSimulationTime
   * re-evaluates the smoothed per-region land value index at each policy
   * cadence (recorded as RegionalLandValueUpdated) and residential upkeep
   * pricing may reference the index. Omitted keeps flat v1 upkeep pricing
   * byte-for-byte.
   */
  readonly landValue?: LandValuePolicy;
  /** Authority-scoped because service occupancy must be town-wide. */
  readonly serviceQuality?: ServiceQualityPolicy;
  /**
   * Optional town-bank credit policy. When present, AgentDeposit,
   * AgentWithdraw and AgentRequestLoan settle against the bank aggregate and
   * AdvanceSimulationTime settles the daily credit accrual cadence (loan
   * interest/amortized auto-collection, missed-payment defaults, deposit
   * interest) — all as supply-neutral transfers. Omitted rejects the banking
   * commands and keeps the world bank-free, byte-for-byte.
   */
  readonly credit?: CreditPolicy;
  /**
   * Optional per-agent time-settlement amortization. When present, the
   * per-agent time effects (sleep deprivation, stochastic illness, residential
   * upkeep, safety nets) settle only for the agent bucket
   * `hash(agentId) % buckets == tickIndex % buckets`, and each settlement charges
   * the elapsed time since the agent's previous settlement. Total charged per
   * agent over time is unchanged; per-tick load is divided by `buckets`.
   * Requires a uniform AdvanceSimulationTime cadence. Omitted keeps the legacy
   * settle-every-agent-every-tick behavior byte-for-byte.
   */
  readonly timeSettlementAmortization?: {
    readonly buckets: number;
  };
  /** Optional legacy balance-floor transfer; canonical AIvilization uses physiologicalSafetyNet. */
  readonly safetyNetSubsidy?: SafetyNetSubsidyPolicy;
  /**
   * Optional tax policy. When present, AgentWork appends an IncomeTaxCharged
   * transfer (progressive brackets over the wage) and sell-side AgentTrade
   * appends a TradeTaxCharged transfer on the sale proceeds; both credit the
   * projection treasury without moving moneySupply. When the projection
   * carries a treasury, safety-net subsidies are funded from it instead of
   * minted. Omitted keeps the world tax-free and mint-funded, byte-for-byte.
   */
  /**
   * Optional lifestyle (wealth-tiered consumption) policy. Read-path only:
   * command handlers never consume it. When present, planning context builders
   * derive each agent's lifestyle tier from its net worth, and action-synthesis
   * budgets cap struggling-tier non-survival spending. Omitted keeps every
   * read path lifestyle-free, byte-for-byte identical to legacy runs.
   */
  readonly physiologicalSafetyNet?: PhysiologicalSafetyNetPolicy;
  /**
   * Optional town-wellbeing policy (town-wellbeing-v1). When present,
   * AdvanceSimulationTime settles the durable per-agent wellbeing scalar from
   * the current tick's physiology, employment, housing, lifestyle, arrears,
   * distress, and social relation factors, emitting WellbeingChanged whenever
   * the value moves. Omitted keeps runs wellbeing-free, byte-for-byte
   * identical to legacy runs.
   */
  readonly wellbeing?: WellbeingPolicy;
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
        ...(input.policies.starvation === undefined
          ? {}
          : { starvation: input.policies.starvation }),
        ...(input.policies.stochasticIllness === undefined
          ? {}
          : { stochasticIllness: input.policies.stochasticIllness }),
        ...(input.policies.weather === undefined ? {} : { weather: input.policies.weather }),
        ...(input.policies.calendar === undefined ? {} : { calendar: input.policies.calendar }),
        ...(input.policies.lifecycle === undefined ? {} : { lifecycle: input.policies.lifecycle }),
        ...(input.policies.migration === undefined ? {} : { migration: input.policies.migration }),
        ...(input.policies.residentialUpkeep === undefined
          ? {}
          : { residentialUpkeep: input.policies.residentialUpkeep }),
        ...(input.policies.landValue === undefined ? {} : { landValue: input.policies.landValue }),
        ...(input.policies.serviceQuality === undefined
          ? {}
          : { serviceQuality: input.policies.serviceQuality }),
        ...(input.policies.safetyNetSubsidy === undefined
          ? {}
          : { safetyNetSubsidy: input.policies.safetyNetSubsidy }),
        ...(input.policies.physiologicalSafetyNet === undefined
          ? {}
          : { physiologicalSafetyNet: input.policies.physiologicalSafetyNet }),
        ...(input.policies.timeSettlementAmortization === undefined
          ? {}
          : { timeSettlementAmortization: input.policies.timeSettlementAmortization }),
        ...(input.policies.jobApplication?.recruitmentCycle === undefined
          ? {}
          : { recruitmentCycle: input.policies.jobApplication.recruitmentCycle }),
        ...(input.policies.consumption === undefined
          ? {}
          : { consumption: input.policies.consumption }),
        ...(input.policies.externalMarket === undefined
          ? {}
          : { externalMarket: input.policies.externalMarket }),
        ...(input.policies.externalTrade === undefined
          ? {}
          : { externalTrade: input.policies.externalTrade }),
        ...(input.policies.publicBudget === undefined
          ? {}
          : { publicBudget: input.policies.publicBudget }),
        ...(input.policies.enterprise === undefined
          ? {}
          : { enterprise: input.policies.enterprise }),
        ...(input.policies.tax === undefined ? {} : { tax: input.policies.tax }),
        ...(input.policies.credit === undefined ? {} : { credit: input.policies.credit }),
        ...(input.policies.educationSystem === undefined
          ? {}
          : { educationSystem: input.policies.educationSystem }),
        ...(input.policies.lifestyle === undefined ? {} : { lifestyle: input.policies.lifestyle }),
        ...(input.policies.wellbeing === undefined ? {} : { wellbeing: input.policies.wellbeing }),
        nextSequence: input.nextSequence,
      });
    case 'AgentRaisePetition':
      return handleAgentRaisePetitionCommand({
        command: input.command as CommandEnvelope<'AgentRaisePetition', unknown>,
        projection: input.projection,
        ...(input.policies.collectiveAction === undefined
          ? {}
          : { collectiveAction: input.policies.collectiveAction }),
        nextSequence: input.nextSequence,
      });
    case 'AgentSignPetition':
      return handleAgentSignPetitionCommand({
        command: input.command as CommandEnvelope<'AgentSignPetition', unknown>,
        projection: input.projection,
        ...(input.policies.collectiveAction === undefined
          ? {}
          : { collectiveAction: input.policies.collectiveAction }),
        nextSequence: input.nextSequence,
      });
    case 'AgentPostBulletin':
      return handleAgentPostBulletinCommand({
        command: input.command as CommandEnvelope<'AgentPostBulletin', unknown>,
        projection: input.projection,
        ...(input.policies.bulletin === undefined ? {} : { bulletin: input.policies.bulletin }),
        nextSequence: input.nextSequence,
      });
    case 'IssueTownBulletin':
      return handleIssueTownBulletinCommand({
        command: input.command as CommandEnvelope<'IssueTownBulletin', unknown>,
        projection: input.projection,
        ...(input.policies.bulletin === undefined ? {} : { bulletin: input.policies.bulletin }),
        nextSequence: input.nextSequence,
      });
    case 'SetTaxPolicy':
      return handleSetTaxPolicyCommand({
        command: input.command as CommandEnvelope<'SetTaxPolicy', unknown>,
        projection: input.projection,
        ...(input.policies.governance === undefined
          ? {}
          : { governance: input.policies.governance }),
        nextSequence: input.nextSequence,
      });
    case 'SetPublicBudget':
      return handleSetPublicBudgetCommand({
        command: input.command as CommandEnvelope<'SetPublicBudget', unknown>,
        projection: input.projection,
        ...(input.policies.governance === undefined
          ? {}
          : { governance: input.policies.governance }),
        nextSequence: input.nextSequence,
      });
    case 'SetSubsidyPolicy':
      return handleSetSubsidyPolicyCommand({
        command: input.command as CommandEnvelope<'SetSubsidyPolicy', unknown>,
        projection: input.projection,
        ...(input.policies.governance === undefined
          ? {}
          : { governance: input.policies.governance }),
        nextSequence: input.nextSequence,
      });
    case 'AgentRaiseMatter':
      return handleAgentRaiseMatterCommand({
        command: input.command as CommandEnvelope<'AgentRaiseMatter', unknown>,
        projection: input.projection,
        ...(input.policies.socialMatters === undefined
          ? {}
          : { socialMatters: input.policies.socialMatters }),
        nextSequence: input.nextSequence,
      });
    case 'AgentRespondMatter':
      return handleAgentRespondMatterCommand({
        command: input.command as CommandEnvelope<'AgentRespondMatter', unknown>,
        projection: input.projection,
        ...(input.policies.socialMatters === undefined
          ? {}
          : { socialMatters: input.policies.socialMatters }),
        nextSequence: input.nextSequence,
      });
    case 'AgentAssignMatter':
      return handleAgentAssignMatterCommand({
        command: input.command as CommandEnvelope<'AgentAssignMatter', unknown>,
        projection: input.projection,
        ...(input.policies.socialMatters === undefined
          ? {}
          : { socialMatters: input.policies.socialMatters }),
        nextSequence: input.nextSequence,
      });
    case 'AgentCloseMatter':
      return handleAgentCloseMatterCommand({
        command: input.command as CommandEnvelope<'AgentCloseMatter', unknown>,
        projection: input.projection,
        ...(input.policies.socialMatters === undefined
          ? {}
          : { socialMatters: input.policies.socialMatters }),
        nextSequence: input.nextSequence,
      });
    case 'AgentConfront':
      return handleAgentConfrontCommand({
        command: input.command as CommandEnvelope<'AgentConfront', unknown>,
        projection: input.projection,
        ...(input.policies.conflict === undefined ? {} : { conflict: input.policies.conflict }),
        nextSequence: input.nextSequence,
      });
    case 'AgentAttack':
      return handleAgentAttackCommand({
        command: input.command as CommandEnvelope<'AgentAttack', unknown>,
        projection: input.projection,
        ...(input.policies.conflict === undefined ? {} : { conflict: input.policies.conflict }),
        ...(input.policies.wellbeing === undefined ? {} : { wellbeing: input.policies.wellbeing }),
        nextSequence: input.nextSequence,
      });
    case 'AgentIntervene':
      return handleAgentInterveneCommand({
        command: input.command as CommandEnvelope<'AgentIntervene', unknown>,
        projection: input.projection,
        ...(input.policies.conflict === undefined ? {} : { conflict: input.policies.conflict }),
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
    case 'AgentConsume':
      if (input.policies.consumption === undefined) {
        return rejectCommand(input, 'AgentConsume', 'missing consumption policy');
      }
      return handleAgentConsumeCommand({
        command: input.command as CommandEnvelope<'AgentConsume', unknown>,
        projection: input.projection,
        policy: input.policies.consumption,
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
        ...(input.policies.socialMatters === undefined
          ? {}
          : { socialMatters: input.policies.socialMatters }),
        ...(input.policies.discourse === undefined ? {} : { discourse: input.policies.discourse }),
        nextSequence: input.nextSequence,
      });
    case 'AgentStudy': {
      const actor = input.projection.agents[input.command.actorId ?? ''];
      const settledQuality =
        actor === undefined
          ? undefined
          : resolveAgentServiceQuality({
              projection: input.projection,
              agent: actor,
              service: 'education',
            });
      return handleAgentStudyCommand({
        command: input.command as CommandEnvelope<'AgentStudy', unknown>,
        projection: input.projection,
        ...(input.policies.educationInvestment === undefined
          ? {}
          : { educationInvestment: input.policies.educationInvestment }),
        ...(input.policies.educationSystem === undefined
          ? {}
          : { educationSystem: input.policies.educationSystem }),
        ...(settledQuality === undefined ? {} : { serviceQuality: settledQuality.quality }),
        nextSequence: input.nextSequence,
      });
    }
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
    case 'AgentSeeDoctor': {
      if (input.policies.seeDoctor === undefined) {
        return rejectCommand(input, 'AgentSeeDoctor', 'missing see doctor policy');
      }
      const actor = input.projection.agents[input.command.actorId ?? ''];
      const settledQuality =
        actor === undefined
          ? undefined
          : resolveAgentServiceQuality({
              projection: input.projection,
              agent: actor,
              service: 'healthcare',
            });
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
        ...(settledQuality === undefined ? {} : { serviceQuality: settledQuality.quality }),
        nextSequence: input.nextSequence,
      });
    }
    case 'AgentWork':
      return handleAgentWorkCommand({
        command: input.command as CommandEnvelope<'AgentWork', unknown>,
        projection: input.projection,
        wageCalculator: input.policies.wageCalculator,
        laborCost: input.policies.laborCost,
        criticalThresholds: input.policies.criticalThresholds,
        ...(input.policies.tax === undefined ? {} : { tax: input.policies.tax }),
        nextSequence: input.nextSequence,
      });
    case 'AgentFoundEnterprise':
      if (input.policies.enterprise === undefined) {
        return rejectCommand(input, 'AgentFoundEnterprise', 'missing enterprise policy');
      }
      return handleAgentFoundEnterpriseCommand({
        command: input.command as CommandEnvelope<'AgentFoundEnterprise', unknown>,
        projection: input.projection,
        policy: input.policies.enterprise,
        nextSequence: input.nextSequence,
      });
    case 'AgentJoinEnterprise':
      if (input.policies.enterprise === undefined) {
        return rejectCommand(input, 'AgentJoinEnterprise', 'missing enterprise policy');
      }
      return handleAgentJoinEnterpriseCommand({
        command: input.command as CommandEnvelope<'AgentJoinEnterprise', unknown>,
        projection: input.projection,
        policy: input.policies.enterprise,
        nextSequence: input.nextSequence,
      });
    case 'AgentFundEnterprise':
      if (input.policies.enterprise === undefined) {
        return rejectCommand(input, 'AgentFundEnterprise', 'missing enterprise policy');
      }
      return handleAgentFundEnterpriseCommand({
        command: input.command as CommandEnvelope<'AgentFundEnterprise', unknown>,
        projection: input.projection,
        policy: input.policies.enterprise,
        nextSequence: input.nextSequence,
      });
    case 'AgentCloseEnterprise':
      if (input.policies.enterprise === undefined) {
        return rejectCommand(input, 'AgentCloseEnterprise', 'missing enterprise policy');
      }
      return handleAgentCloseEnterpriseCommand({
        command: input.command as CommandEnvelope<'AgentCloseEnterprise', unknown>,
        projection: input.projection,
        policy: input.policies.enterprise,
        nextSequence: input.nextSequence,
      });
    case 'AgentSetEnterpriseJobPosting':
      if (input.policies.enterprise === undefined) {
        return rejectCommand(input, 'AgentSetEnterpriseJobPosting', 'missing enterprise policy');
      }
      return handleAgentSetEnterpriseJobPostingCommand({
        command: input.command as CommandEnvelope<'AgentSetEnterpriseJobPosting', unknown>,
        projection: input.projection,
        policy: input.policies.enterprise,
        nextSequence: input.nextSequence,
      });
    case 'AgentLeaveEnterprise':
      if (input.policies.enterprise === undefined) {
        return rejectCommand(input, 'AgentLeaveEnterprise', 'missing enterprise policy');
      }
      return handleAgentLeaveEnterpriseCommand({
        command: input.command as CommandEnvelope<'AgentLeaveEnterprise', unknown>,
        projection: input.projection,
        policy: input.policies.enterprise,
        nextSequence: input.nextSequence,
      });
    case 'AgentLayoffEnterpriseEmployee':
      if (input.policies.enterprise === undefined) {
        return rejectCommand(input, 'AgentLayoffEnterpriseEmployee', 'missing enterprise policy');
      }
      return handleAgentLayoffEnterpriseEmployeeCommand({
        command: input.command as CommandEnvelope<'AgentLayoffEnterpriseEmployee', unknown>,
        projection: input.projection,
        policy: input.policies.enterprise,
        nextSequence: input.nextSequence,
      });
    case 'AgentDeposit':
      if (input.policies.credit === undefined) {
        return rejectCommand(input, 'AgentDeposit', 'missing credit policy');
      }
      return handleAgentDepositCommand({
        command: input.command as CommandEnvelope<'AgentDeposit', unknown>,
        projection: input.projection,
        policy: input.policies.credit,
        nextSequence: input.nextSequence,
      });
    case 'AgentWithdraw':
      if (input.policies.credit === undefined) {
        return rejectCommand(input, 'AgentWithdraw', 'missing credit policy');
      }
      return handleAgentWithdrawCommand({
        command: input.command as CommandEnvelope<'AgentWithdraw', unknown>,
        projection: input.projection,
        policy: input.policies.credit,
        nextSequence: input.nextSequence,
      });
    case 'AgentRequestLoan':
      if (input.policies.credit === undefined) {
        return rejectCommand(input, 'AgentRequestLoan', 'missing credit policy');
      }
      return handleAgentRequestLoanCommand({
        command: input.command as CommandEnvelope<'AgentRequestLoan', unknown>,
        projection: input.projection,
        policy: input.policies.credit,
        nextSequence: input.nextSequence,
      });
    case 'AgentExportCommodity':
      if (input.policies.externalTrade === undefined) {
        return rejectCommand(input, 'AgentExportCommodity', 'missing external trade policy');
      }
      return handleAgentExportCommodityCommand({
        command: input.command as CommandEnvelope<'AgentExportCommodity', unknown>,
        projection: input.projection,
        policy: input.policies.externalTrade,
        ...(input.policies.regionalMarkets === undefined
          ? {}
          : { regionalMarketsEnabled: input.policies.regionalMarkets.enabled }),
        nextSequence: input.nextSequence,
      });
    case 'AgentImportCommodity':
      if (input.policies.externalTrade === undefined) {
        return rejectCommand(input, 'AgentImportCommodity', 'missing external trade policy');
      }
      return handleAgentImportCommodityCommand({
        command: input.command as CommandEnvelope<'AgentImportCommodity', unknown>,
        projection: input.projection,
        policy: input.policies.externalTrade,
        ...(input.policies.regionalMarkets === undefined
          ? {}
          : { regionalMarketsEnabled: input.policies.regionalMarkets.enabled }),
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
        ...(input.policies.renewableResources === undefined
          ? {}
          : { renewableResources: input.policies.renewableResources }),
        ...(input.policies.educationSystem === undefined
          ? {}
          : { educationSystem: input.policies.educationSystem }),
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
        ...(input.policies.tax === undefined ? {} : { tax: input.policies.tax }),
        nextSequence: input.nextSequence,
      });
    case 'AgentGiveResource':
      return handleAgentGiveResourceCommand({
        command: input.command as CommandEnvelope<'AgentGiveResource', unknown>,
        projection: input.projection,
        ...(input.policies.socialMatters === undefined
          ? {}
          : { socialMatters: input.policies.socialMatters }),
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
        ...(input.policies.educationSystem === undefined
          ? {}
          : { educationSystem: input.policies.educationSystem }),
        nextSequence: input.nextSequence,
      });
    case 'AgentApplyEducationExam':
      if (input.policies.educationSystem === undefined) {
        return rejectCommand(input, 'AgentApplyEducationExam', 'missing education system policy');
      }
      return handleAgentApplyEducationExamCommand({
        command: input.command as CommandEnvelope<'AgentApplyEducationExam', unknown>,
        projection: input.projection,
        policy: input.policies.educationSystem,
        ...(input.policies.wellbeing === undefined ? {} : { wellbeing: input.policies.wellbeing }),
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
    default:
      throw new Error(`unsupported world command ${input.command.type}`);
  }
}
