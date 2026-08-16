import type {
  ActionResourceEstimate,
  AtomicActionProposal,
  BranchPlanRecord,
  DomainMicroPlanner,
  PrioritizedSubtask,
} from '@aivilization/agent-runtime';
import { commodities, jobTiers, occupations } from '@aivilization/content';
import {
  buyFromPool,
  planProduction,
  planProductionChain,
  resolveProductionDefinition,
  type ProductionAgentState,
  type ProductionChainStep,
} from '@aivilization/economy';
import {
  calculateEducationInvestmentRequirements,
  calculateRecruitmentCycleNumber,
  deriveEducationLevel,
  EDUCATION_SYSTEM_MAX_LEVEL,
  quoteStudyTuition,
  type EducationExamTargetLevel,
  type EducationSystemPolicy,
} from '@aivilization/society';
import { asLocationId, type AgentId, type LocationId } from '@aivilization/sim-core';
import type {
  AgentApplyEducationExamPayload,
  AgentApplyJobPayload,
  AgentEatPayload,
  AgentGiveResourcePayload,
  AgentMoveToPayload,
  AgentObserveLocationPayload,
  AgentProducePayload,
  AgentRaisePetitionPayload,
  AgentSeeDoctorPayload,
  AgentSignPetitionPayload,
  AgentStartConversationPayload,
  AgentUpgradeResidentialTierPayload,
  AgentSleepPayload,
  AgentStudyPayload,
  AgentTradePayload,
  AgentWorkPayload,
  WorldCommandPolicies,
} from '@aivilization/world';
import type { CollectiveActionPolicy } from '@aivilization/society';
import type {
  WorkerDomainRuntimeFactoryInput,
  WorkerDomainRuntimeRegistration,
} from './domainRuntimeRegistry';
import {
  CANONICAL_EDUCATION_RATE_PER_SECOND,
  CANONICAL_STUDY_DURATION_SECONDS,
  CANONICAL_WORK_LABOR_SECONDS,
} from './educationOpportunityCost';
import { createCanonicalSocialDialogueTurns, resolveCanonicalSocialPlan } from './socialPlanning';

export type CanonicalDomainName =
  | 'study'
  | 'work'
  | 'trade'
  | 'sleep'
  | 'social'
  | 'production'
  | 'residential'
  | 'health'
  | 'eat';

export type StudyDomainRuntimeConfig = {
  readonly durationSeconds?: number;
  readonly educationRatePerSecond?: number;
};

export type WorkDomainRuntimeConfig = {
  readonly laborSeconds?: number;
  readonly defaultOccupationName?: string;
};

export type WorkOccupationResolutionInput = {
  readonly config?: WorkDomainRuntimeConfig;
  readonly context: WorkerDomainRuntimeFactoryInput;
  readonly selectedSubtask?: PrioritizedSubtask;
};

export type TradeDomainRuntimeConfig = {
  readonly side?: 'buy' | 'sell';
  readonly commodityName?: string;
  readonly quantity?: number;
};

export type SleepDomainRuntimeConfig = {
  readonly durationSeconds?: number;
};

export type HealthDomainRuntimeConfig = {
  readonly durationSeconds?: number;
};

export type EatDomainRuntimeConfig = {
  readonly commodityName?: string;
  readonly quantity?: number;
};

export type SocialDomainRuntimeConfig = {
  readonly targetAgentId?: AgentId;
  readonly topic?: string;
  readonly openingUtterance?: string;
  readonly responseUtterance?: string;
  readonly relationDelta?: number;
  readonly attitudeDelta?: number;
};

export type ProductionDomainRuntimeConfig = {
  readonly commodityName?: string;
  readonly quantity?: number;
  readonly availableLaborSeconds?: number;
};

export type ResidentialDomainRuntimeConfig = {
  readonly targetResidentialTier?: number;
};

export type ProductionTargetResolutionInput = {
  readonly config?: ProductionDomainRuntimeConfig;
  readonly context: WorkerDomainRuntimeFactoryInput;
  readonly selectedSubtask?: PrioritizedSubtask;
};

export type ResidentialTargetResolutionInput = {
  readonly config?: ResidentialDomainRuntimeConfig;
  readonly context: WorkerDomainRuntimeFactoryInput;
  readonly selectedSubtask?: PrioritizedSubtask;
};

export type CanonicalDomainRuntimeConfig = {
  readonly study?: StudyDomainRuntimeConfig;
  readonly work?: WorkDomainRuntimeConfig;
  readonly trade?: TradeDomainRuntimeConfig;
  readonly sleep?: SleepDomainRuntimeConfig;
  readonly health?: HealthDomainRuntimeConfig;
  readonly eat?: EatDomainRuntimeConfig;
  readonly social?: SocialDomainRuntimeConfig;
  readonly production?: ProductionDomainRuntimeConfig;
  readonly residential?: ResidentialDomainRuntimeConfig;
};

const DEFAULT_OCCUPATION_NAME = 'Cleaner';
const DEFAULT_TRADE_SIDE = 'buy';
const DEFAULT_TRADE_QUANTITY = 1;
const DEFAULT_TRADE_COMMODITY = 'Apple';
const DEFAULT_SLEEP_DURATION_SECONDS = 28800;
const DEFAULT_HEALTH_RECOVERY_DURATION_SECONDS = 1800;
const DEFAULT_EAT_COMMODITY = 'Apple';
const DEFAULT_EAT_QUANTITY = 1;
// Compatibility-only hints. The world derives authoritative directional outcomes from the
// transcript under SOCIAL_OUTCOME_POLICY_VERSION and never trusts an agent-supplied score.
const DEFAULT_SOCIAL_RELATION_DELTA = 0;
const DEFAULT_SOCIAL_ATTITUDE_DELTA = 0;
const DEFAULT_PRODUCTION_COMMODITY = 'Apple';
const DEFAULT_PRODUCTION_QUANTITY = 1;
const DEFAULT_PRODUCTION_AVAILABLE_LABOR_SECONDS = 3600;
const DEFAULT_DOMAIN_LOCATION_IDS: Readonly<Record<CanonicalDomainName, LocationId>> = {
  study: asLocationId('school'),
  work: asLocationId('workshop'),
  trade: asLocationId('market'),
  sleep: asLocationId('residential-block'),
  social: asLocationId('town-square'),
  production: asLocationId('workshop'),
  residential: asLocationId('residential-block'),
  health: asLocationId('clinic'),
  eat: asLocationId('restaurant'),
};

export function createCanonicalDomainRuntimeRegistrations(
  config: CanonicalDomainRuntimeConfig = {},
  policies?: WorldCommandPolicies,
): readonly WorkerDomainRuntimeRegistration[] {
  return [
    createStudyDomainRuntimeRegistration(
      config.study,
      policies?.educationInvestment,
      policies?.educationSystem,
    ),
    createWorkDomainRuntimeRegistration(config.work, policies?.laborCost),
    createTradeDomainRuntimeRegistration(config.trade),
    createSleepDomainRuntimeRegistration(config.sleep),
    createSocialDomainRuntimeRegistration(config.social, policies?.collectiveAction),
    createProductionDomainRuntimeRegistration(
      config.production,
      policies?.production,
      policies?.educationSystem,
    ),
    createResidentialDomainRuntimeRegistration(
      config.residential,
      policies?.residentialTierUpgrade,
    ),
    createHealthDomainRuntimeRegistration(config.health),
    createEatDomainRuntimeRegistration(config.eat, policies?.satietyRecoveryByCommodity),
  ];
}

export function createStudyDomainRuntimeRegistration(
  config: StudyDomainRuntimeConfig = {},
  educationInvestment?: WorldCommandPolicies['educationInvestment'],
  educationSystemPolicy?: EducationSystemPolicy,
): WorkerDomainRuntimeRegistration {
  return {
    domain: 'study',
    createMicroPlanners: (context) => [
      createContextualDomainMicroPlanner({
        domain: 'study',
        context,
        planRecord: context.planRecord,
        propose: (selectedSubtask) => {
          const examProposal = resolveEducationExamApplicationProposal({
            context,
            selectedSubtask,
            ...(educationSystemPolicy === undefined ? {} : { educationSystemPolicy }),
          });
          if (examProposal !== undefined) {
            return examProposal;
          }
          const educationRatePerSecond =
            config.educationRatePerSecond ?? CANONICAL_EDUCATION_RATE_PER_SECOND;
          const durationSeconds = resolveStudyActionDurationSeconds({
            maximumDurationSeconds: config.durationSeconds ?? CANONICAL_STUDY_DURATION_SECONDS,
            educationRatePerSecond,
            currentEducationScore: context.agent.educationScore,
            objectiveAffinityTags: context.activeObjective.affinityTags,
          });
          return {
            id: createCanonicalActionId('study', selectedSubtask),
            description: `Study for ${selectedSubtask.description}.`,
            commandType: 'AgentStudy',
            priority: selectedSubtask.score,
            payload: {
              durationSeconds,
              educationRatePerSecond,
            },
            resourceEstimate: createStudyActionResourceEstimate({
              durationSeconds,
              context,
              ...(educationInvestment === undefined ? {} : { educationInvestment }),
              ...(educationSystemPolicy === undefined ? {} : { educationSystemPolicy }),
            }),
          };
        },
      }),
    ],
  };
}

/**
 * Exam-application proposal for the deterministic runtime: once an agent at an
 * exam-gated level (2→3 中考, 3→4 高考, 4→5 考研) reaches the next level's
 * score threshold and has not applied in the current exam cycle, applying for
 * the exam is the obviously viable study-domain step. The world handler stays
 * the authority on eligibility details (track constraints, attempt caps).
 */
function resolveEducationExamApplicationProposal(input: {
  readonly context: WorkerDomainRuntimeFactoryInput;
  readonly selectedSubtask: PrioritizedSubtask;
  readonly educationSystemPolicy?: EducationSystemPolicy;
}): CanonicalActionProposal | undefined {
  const policy = input.educationSystemPolicy;
  if (policy === undefined || !policy.enabled) {
    return undefined;
  }
  const agent = input.context.agent;
  const currentLevel = agent.educationLevel ?? deriveEducationLevel(agent.educationScore, policy);
  if (currentLevel < 2 || currentLevel >= EDUCATION_SYSTEM_MAX_LEVEL) {
    return undefined;
  }
  // thresholds[i] is the score required to advance from level i to i+1; the
  // bounds check above keeps the index inside the tuple.
  const thresholdIndex: number = currentLevel;
  const requiredScore: number | undefined = policy.levelScoreThresholds[thresholdIndex];
  if (requiredScore === undefined || agent.educationScore < requiredScore) {
    return undefined;
  }
  const cycleNumber = calculateRecruitmentCycleNumber({
    simulationTime: input.context.projection.clock.now,
    cycleDurationMs: policy.examCycleDurationMs,
  });
  const alreadyApplied = input.context.projection.educationExamApplications.some(
    (application) =>
      application.agentId === agent.agentId && application.cycleNumber === cycleNumber,
  );
  if (alreadyApplied) {
    return undefined;
  }
  const targetLevel = (currentLevel + 1) as EducationExamTargetLevel;
  return {
    id: `${createCanonicalActionId('study', input.selectedSubtask)}-exam-application`,
    description: `Apply for the level-${String(targetLevel)} education exam.`,
    commandType: 'AgentApplyEducationExam',
    priority: input.selectedSubtask.score,
    payload: { targetLevel },
  };
}

/**
 * Study cost estimate aligned with the authoritative settlement: under an
 * enabled education system the level tuition applies and compulsory levels are
 * treasury-covered (self-pay share only); otherwise the legacy flat
 * education-investment rate holds.
 */
function createStudyActionResourceEstimate(input: {
  readonly durationSeconds: number;
  readonly context: WorkerDomainRuntimeFactoryInput;
  readonly educationInvestment?: WorldCommandPolicies['educationInvestment'];
  readonly educationSystemPolicy?: EducationSystemPolicy;
}): ActionResourceEstimate {
  const educationSystemPolicy = input.educationSystemPolicy;
  if (educationSystemPolicy !== undefined && educationSystemPolicy.enabled) {
    const quote = quoteStudyTuition({
      level:
        input.context.agent.educationLevel ??
        deriveEducationLevel(input.context.agent.educationScore, educationSystemPolicy),
      durationSeconds: input.durationSeconds,
      treasuryBalance: input.context.projection.treasury ?? null,
      policy: educationSystemPolicy,
    });
    if (quote !== undefined) {
      return {
        actionSeconds: input.durationSeconds,
        currencyCost: quote.selfPayCost,
        inventoryCosts: {},
      };
    }
  }
  const requirements =
    input.educationInvestment === undefined
      ? undefined
      : calculateEducationInvestmentRequirements({
          studyDurationSeconds: input.durationSeconds,
          policy: input.educationInvestment,
        });
  return {
    actionSeconds: input.durationSeconds,
    ...(requirements === undefined
      ? {}
      : {
          currencyCost: requirements.currencyCost,
          inventoryCosts: requirements.inventoryCosts,
        }),
  };
}

export function resolveStudyActionDurationSeconds(input: {
  readonly maximumDurationSeconds: number;
  readonly educationRatePerSecond: number;
  readonly currentEducationScore: number;
  readonly objectiveAffinityTags: readonly string[];
}): number {
  const targetEducationScore = input.objectiveAffinityTags
    .map((tag) => /^education-target-(\d+(?:\.\d+)?)$/.exec(tag)?.[1])
    .filter((value): value is string => value !== undefined)
    .map(Number)
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((left, right) => left - right)[0];
  if (targetEducationScore === undefined || input.educationRatePerSecond <= 0) {
    return input.maximumDurationSeconds;
  }
  const missingEducation = Math.max(0, targetEducationScore - input.currentEducationScore);
  return Math.min(
    input.maximumDurationSeconds,
    Math.ceil(missingEducation / input.educationRatePerSecond),
  );
}

export function createWorkDomainRuntimeRegistration(
  config: WorkDomainRuntimeConfig = {},
  laborCost?: WorldCommandPolicies['laborCost'],
): WorkerDomainRuntimeRegistration {
  return {
    domain: 'work',
    createMicroPlanners: (context) => [
      createContextualDomainMicroPlanner({
        domain: 'work',
        context,
        planRecord: context.planRecord,
        propose: (selectedSubtask) => {
          const occupationName =
            context.agent.job ??
            resolveWorkOccupationName({
              config,
              context,
              selectedSubtask,
            });
          if (context.agent.job === null) {
            return {
              id: createCanonicalActionId('work', selectedSubtask),
              description: `Apply for ${occupationName}.`,
              commandType: 'AgentApplyJob',
              priority: selectedSubtask.score,
              payload: { occupationName },
              ...createJobApplicationResourceEstimate({ occupationName, context }),
            };
          }

          const laborSeconds = config.laborSeconds ?? CANONICAL_WORK_LABOR_SECONDS;
          return {
            id: createCanonicalActionId('work', selectedSubtask),
            description: `Work as ${occupationName}.`,
            commandType: 'AgentWork',
            priority: selectedSubtask.score,
            payload: {
              occupationName,
              laborSeconds,
            },
            resourceEstimate: createLaborResourceEstimate(laborSeconds, laborCost),
          };
        },
      }),
    ],
  };
}

export function resolveWorkOccupationName(input: WorkOccupationResolutionInput): string {
  if (input.config?.defaultOccupationName !== undefined) {
    return input.config.defaultOccupationName;
  }

  for (const text of collectContextualTargetTexts(input)) {
    const occupationName = findOccupationNameInText(text);
    if (occupationName !== undefined) {
      return occupationName;
    }
  }

  return DEFAULT_OCCUPATION_NAME;
}

export function createTradeDomainRuntimeRegistration(
  config: TradeDomainRuntimeConfig = {},
): WorkerDomainRuntimeRegistration {
  return {
    domain: 'trade',
    createMicroPlanners: (context) => [
      createContextualDomainMicroPlanner({
        domain: 'trade',
        context,
        planRecord: context.planRecord,
        propose: (selectedSubtask) => {
          const side = config.side ?? resolveContextualTradeSide({ context, selectedSubtask });
          const commodityName =
            config.commodityName ??
            resolveContextualTradeCommodityName({ context, selectedSubtask }) ??
            resolveFirstMarketCommodity(context);
          return {
            id: createCanonicalActionId('trade', selectedSubtask),
            description: `${side} ${commodityName}.`,
            commandType: 'AgentTrade',
            priority: selectedSubtask.score,
            payload: {
              side,
              commodityName,
              quantity: config.quantity ?? DEFAULT_TRADE_QUANTITY,
            },
            ...createTradeResourceEstimate({
              side,
              commodityName,
              quantity: config.quantity ?? DEFAULT_TRADE_QUANTITY,
              context,
            }),
          };
        },
      }),
    ],
  };
}

export function createSleepDomainRuntimeRegistration(
  config: SleepDomainRuntimeConfig = {},
): WorkerDomainRuntimeRegistration {
  return {
    domain: 'sleep',
    createMicroPlanners: (context) => [
      createContextualDomainMicroPlanner({
        domain: 'sleep',
        context,
        planRecord: context.planRecord,
        propose: (selectedSubtask) => ({
          id: createCanonicalActionId('sleep', selectedSubtask),
          description: `Sleep for ${selectedSubtask.description}.`,
          commandType: 'AgentSleep',
          priority: selectedSubtask.score,
          payload: { durationSeconds: config.durationSeconds ?? DEFAULT_SLEEP_DURATION_SECONDS },
          resourceEstimate: {
            actionSeconds: config.durationSeconds ?? DEFAULT_SLEEP_DURATION_SECONDS,
          },
        }),
      }),
    ],
  };
}

export function createHealthDomainRuntimeRegistration(
  config: HealthDomainRuntimeConfig = {},
): WorkerDomainRuntimeRegistration {
  return {
    domain: 'health',
    createMicroPlanners: (context) => [
      createContextualDomainMicroPlanner({
        domain: 'health',
        context,
        planRecord: context.planRecord,
        propose: (selectedSubtask) => {
          const durationSeconds =
            config.durationSeconds ?? DEFAULT_HEALTH_RECOVERY_DURATION_SECONDS;
          return {
            id: createCanonicalActionId('health', selectedSubtask),
            description: `See doctor for ${selectedSubtask.description}.`,
            commandType: 'AgentSeeDoctor',
            priority: selectedSubtask.score,
            payload: { durationSeconds },
            resourceEstimate: { actionSeconds: durationSeconds },
          };
        },
      }),
    ],
  };
}

export function createEatDomainRuntimeRegistration(
  config: EatDomainRuntimeConfig = {},
  satietyRecoveryByCommodity: Readonly<Record<string, number>> = {},
): WorkerDomainRuntimeRegistration {
  return {
    domain: 'eat',
    createMicroPlanners: (context) => [
      createContextualDomainMicroPlanner({
        domain: 'eat',
        context,
        planRecord: context.planRecord,
        propose: (selectedSubtask) => {
          const commodityName = resolveEatCommodityName({
            config,
            context,
            satietyRecoveryByCommodity,
          });
          const quantity = config.quantity ?? DEFAULT_EAT_QUANTITY;
          return {
            id: createCanonicalActionId('eat', selectedSubtask),
            description: `Eat ${commodityName} for ${selectedSubtask.description}.`,
            commandType: 'AgentEat',
            priority: selectedSubtask.score,
            payload: { commodityName, quantity },
            resourceEstimate: { inventoryCosts: { [commodityName]: quantity } },
          };
        },
      }),
    ],
  };
}

/**
 * Deterministic petition proposal (collective-action-v1): sign the newest
 * open petition this agent has not signed; otherwise, when the settled
 * wellbeing band is distressed, raise a town-welfare petition (deduplicated
 * per open topic by the handler). These proposals also put the petition
 * commandTypes into the per-agent allowedCommandTypes so the LLM can
 * generate richer petition actions.
 */
function resolveSocialPetitionProposal(input: {
  readonly context: WorkerDomainRuntimeFactoryInput;
  readonly selectedSubtask: PrioritizedSubtask;
  readonly collectiveActionPolicy?: CollectiveActionPolicy;
}): CanonicalActionProposal | undefined {
  const policy = input.collectiveActionPolicy;
  if (policy === undefined) {
    return undefined;
  }
  const agent = input.context.agent;
  const open = (input.context.projection.petitions ?? [])
    .filter((petition) => petition.status === 'open')
    .sort(
      (left, right) =>
        right.raisedAt - left.raisedAt || left.petitionId.localeCompare(right.petitionId),
    );
  const unsigned = open.find((petition) => !petition.signatureAgentIds.includes(agent.agentId));
  if (unsigned !== undefined) {
    return {
      id: `${createCanonicalActionId('social', input.selectedSubtask)}-sign-petition`,
      description: `Sign the petition on ${unsigned.topic}.`,
      commandType: 'AgentSignPetition',
      priority: input.selectedSubtask.score,
      payload: { petitionId: unsigned.petitionId },
    };
  }
  const wellbeing = agent.wellbeing ?? 50;
  if (wellbeing >= 20) {
    return undefined;
  }
  return {
    id: `${createCanonicalActionId('social', input.selectedSubtask)}-raise-petition`,
    description: 'Raise a petition about town welfare.',
    commandType: 'AgentRaisePetition',
    priority: input.selectedSubtask.score,
    payload: {
      topic: 'town-welfare',
      statement: 'Living conditions in town have become too hard; we ask for relief.',
    },
  };
}

export function createSocialDomainRuntimeRegistration(
  config: SocialDomainRuntimeConfig = {},
  collectiveActionPolicy?: CollectiveActionPolicy,
): WorkerDomainRuntimeRegistration {
  return {
    domain: 'social',
    createMicroPlanners: (context) => [
      createContextualDomainMicroPlanner({
        domain: 'social',
        context,
        planRecord: context.planRecord,
        resolveTargetLocationId: () =>
          config.targetAgentId === undefined
            ? DEFAULT_DOMAIN_LOCATION_IDS.social
            : (context.projection.agents[config.targetAgentId]?.locationId ??
              DEFAULT_DOMAIN_LOCATION_IDS.social),
        propose: (selectedSubtask) => {
          // Collective action outranks dyadic plans when it applies: signing
          // an open petition the agent has not signed, or raising one when
          // their settled wellbeing is distressed enough to organize.
          const petitionProposal = resolveSocialPetitionProposal({
            context,
            selectedSubtask,
            ...(collectiveActionPolicy === undefined ? {} : { collectiveActionPolicy }),
          });
          if (petitionProposal !== undefined) {
            return petitionProposal;
          }
          const socialPlan = resolveCanonicalSocialPlan({
            context,
            selectedSubtask,
            ...(config.targetAgentId === undefined
              ? {}
              : { configuredTargetAgentId: config.targetAgentId }),
            ...(config.topic === undefined ? {} : { configuredTopic: config.topic }),
          });
          if (socialPlan === undefined) {
            return {
              id: createCanonicalActionId('social', selectedSubtask),
              description: `Observe location before ${selectedSubtask.description}.`,
              commandType: 'AgentObserveLocation',
              priority: selectedSubtask.score,
              payload: { focus: selectedSubtask.description },
            };
          }
          if (isSocialCautionObjective(context)) {
            return {
              id: createCanonicalActionId('social', selectedSubtask),
              description: `Observe before engaging ${socialPlan.targetAgentId}.`,
              commandType: 'AgentObserveLocation',
              priority: selectedSubtask.score,
              payload: {
                focus: `Verify commitments and social context around ${socialPlan.targetAgentId}.`,
              },
            };
          }
          const resourceGift = resolveSocialResourceGift({
            context,
            selectedSubtask,
          });
          if (resourceGift !== undefined) {
            return {
              id: createCanonicalActionId('social', selectedSubtask),
              description: `Give ${resourceGift.quantity} ${resourceGift.commodityName} to ${socialPlan.targetAgentId}.`,
              commandType: 'AgentGiveResource',
              priority: selectedSubtask.score,
              payload: {
                targetAgentId: socialPlan.targetAgentId,
                commodityName: resourceGift.commodityName,
                quantity: resourceGift.quantity,
                note: `Grounded help for ${selectedSubtask.description}.`,
              },
              resourceEstimate: {
                inventoryCosts: {
                  [resourceGift.commodityName]: resourceGift.quantity,
                },
              },
            };
          }
          return {
            id: createCanonicalActionId('social', selectedSubtask),
            description: `Start conversation for ${selectedSubtask.description}.`,
            commandType: 'AgentStartConversation',
            priority: selectedSubtask.score,
            payload: {
              targetAgentId: socialPlan.targetAgentId,
              topic: socialPlan.topic,
              relationDelta: config.relationDelta ?? DEFAULT_SOCIAL_RELATION_DELTA,
              attitudeDelta: config.attitudeDelta ?? DEFAULT_SOCIAL_ATTITUDE_DELTA,
              turns: createCanonicalSocialDialogueTurns({
                agentId: context.agentId,
                targetAgentId: socialPlan.targetAgentId,
                topic: socialPlan.topic,
                context,
                ...(config.openingUtterance === undefined
                  ? {}
                  : { openingUtterance: config.openingUtterance }),
                ...(config.responseUtterance === undefined
                  ? {}
                  : { responseUtterance: config.responseUtterance }),
              }),
              planningContext: socialPlan.planningContext,
            },
          };
        },
      }),
    ],
  };
}

export function createProductionDomainRuntimeRegistration(
  config: ProductionDomainRuntimeConfig = {},
  productionPolicy?: WorldCommandPolicies['production'],
  educationSystemPolicy?: EducationSystemPolicy,
): WorkerDomainRuntimeRegistration {
  return {
    domain: 'production',
    createMicroPlanners: (context) => [
      createContextualDomainMicroPlanner({
        domain: 'production',
        context,
        planRecord: context.planRecord,
        propose: (selectedSubtask) => {
          const commodityName = resolveProductionTargetCommodityName({
            config,
            context,
            selectedSubtask,
          });
          const quantity = config.quantity ?? DEFAULT_PRODUCTION_QUANTITY;
          const availableLaborSeconds =
            config.availableLaborSeconds ?? DEFAULT_PRODUCTION_AVAILABLE_LABOR_SECONDS;
          const nextProductionStep = resolveNextProductionStep({
            commodityName,
            quantity,
            availableLaborSeconds,
            context,
            productionPolicy,
            ...(educationSystemPolicy === undefined ? {} : { educationSystemPolicy }),
          });
          const actionCommodityName = nextProductionStep?.commodityName ?? commodityName;
          const actionQuantity = nextProductionStep?.quantity ?? quantity;

          return {
            id: createCanonicalActionId('production', selectedSubtask),
            description:
              nextProductionStep === undefined || nextProductionStep.commodityName === commodityName
                ? `Produce ${commodityName}.`
                : `Produce ${nextProductionStep.commodityName} for ${commodityName}.`,
            commandType: 'AgentProduce',
            priority: selectedSubtask.score,
            payload: {
              commodityName: actionCommodityName,
              quantity: actionQuantity,
              availableLaborSeconds,
            },
            ...(nextProductionStep === undefined
              ? createProductionResourceEstimate({
                  commodityName,
                  quantity,
                  availableLaborSeconds,
                  context,
                  productionPolicy,
                  ...(educationSystemPolicy === undefined ? {} : { educationSystemPolicy }),
                })
              : { resourceEstimate: createProductionStepResourceEstimate(nextProductionStep) }),
          };
        },
      }),
    ],
  };
}

export function createResidentialDomainRuntimeRegistration(
  config: ResidentialDomainRuntimeConfig = {},
  upgradePolicy?: WorldCommandPolicies['residentialTierUpgrade'],
): WorkerDomainRuntimeRegistration {
  return {
    domain: 'residential',
    createMicroPlanners: (context) => [
      createContextualDomainMicroPlanner({
        domain: 'residential',
        context,
        planRecord: context.planRecord,
        propose: (selectedSubtask) => {
          const inferredTargetResidentialTier = resolveResidentialTargetTier({
            config,
            context,
            selectedSubtask,
          });
          const targetResidentialTier = resolveNextResidentialUpgradeTier({
            currentResidentialTier: context.agent.residentialTier,
            targetResidentialTier: inferredTargetResidentialTier,
          });
          return {
            id: createCanonicalActionId('residential', selectedSubtask),
            description: `Upgrade residential tier toward ${inferredTargetResidentialTier}.`,
            commandType: 'AgentUpgradeResidentialTier',
            priority: selectedSubtask.score,
            payload: { targetResidentialTier },
            ...createResidentialUpgradeResourceEstimate({
              targetResidentialTier,
              upgradePolicy,
            }),
          };
        },
      }),
    ],
  };
}

export function resolveProductionTargetCommodityName(
  input: ProductionTargetResolutionInput,
): string {
  if (input.config?.commodityName !== undefined) {
    return input.config.commodityName;
  }

  for (const text of collectContextualTargetTexts(input)) {
    const commodityName = findProducibleCommodityNameInText(text);
    if (commodityName !== undefined) {
      return commodityName;
    }
  }

  return DEFAULT_PRODUCTION_COMMODITY;
}

export function resolveResidentialTargetTier(input: ResidentialTargetResolutionInput): number {
  let targetResidentialTier =
    input.config?.targetResidentialTier ?? input.context.agent.residentialTier + 1;

  for (const text of collectContextualTargetTexts(input)) {
    for (const commodityName of findMatchingTargetNamesInText(text, COMMODITY_TARGETS)) {
      const minResidentialTier = COMMODITY_BY_NAME.get(commodityName)?.minResidentialTier;
      if (minResidentialTier !== undefined && minResidentialTier !== null) {
        targetResidentialTier = Math.max(targetResidentialTier, minResidentialTier);
      }
    }

    for (const occupationName of findMatchingTargetNamesInText(text, OCCUPATION_TARGETS)) {
      const occupation = OCCUPATION_BY_NAME.get(occupationName);
      if (occupation === undefined) {
        continue;
      }
      const jobTier = JOB_TIER_BY_TIER.get(occupation.jobTier);
      targetResidentialTier = Math.max(
        targetResidentialTier,
        occupation.minResidentialTier,
        jobTier?.minResidentialTier ?? 0,
      );
    }
  }

  return targetResidentialTier;
}

export function resolveEatCommodityName(input: {
  readonly config?: EatDomainRuntimeConfig;
  readonly context: WorkerDomainRuntimeFactoryInput;
  readonly satietyRecoveryByCommodity?: Readonly<Record<string, number>>;
}): string {
  if (input.config?.commodityName !== undefined) {
    return input.config.commodityName;
  }

  const satietyRecoveryByCommodity = input.satietyRecoveryByCommodity ?? {};
  const edibleInventoryCommodity = Object.keys(input.context.agent.inventory)
    .filter((commodityName) => (input.context.agent.inventory[commodityName] ?? 0) > 0)
    .filter((commodityName) => hasValidSatietyRecovery(satietyRecoveryByCommodity, commodityName))
    .sort()[0];
  if (edibleInventoryCommodity !== undefined) {
    return edibleInventoryCommodity;
  }

  return (
    Object.keys(satietyRecoveryByCommodity)
      .filter((commodityName) => hasValidSatietyRecovery(satietyRecoveryByCommodity, commodityName))
      .sort()[0] ?? DEFAULT_EAT_COMMODITY
  );
}

type ContextualDomainMicroPlannerInput = {
  readonly domain: CanonicalDomainName;
  readonly context: WorkerDomainRuntimeFactoryInput;
  readonly planRecord: BranchPlanRecord;
  readonly propose: (selectedSubtask: PrioritizedSubtask) => CanonicalActionProposal;
  readonly resolveTargetLocationId?: (selectedSubtask: PrioritizedSubtask) => LocationId | null;
};

export type CanonicalActionProposal =
  | AtomicActionProposal<'AgentEat', AgentEatPayload>
  | AtomicActionProposal<'AgentMoveTo', AgentMoveToPayload>
  | AtomicActionProposal<'AgentObserveLocation', AgentObserveLocationPayload>
  | AtomicActionProposal<'AgentStudy', AgentStudyPayload>
  | AtomicActionProposal<'AgentSleep', AgentSleepPayload>
  | AtomicActionProposal<'AgentSeeDoctor', AgentSeeDoctorPayload>
  | AtomicActionProposal<'AgentWork', AgentWorkPayload>
  | AtomicActionProposal<'AgentApplyJob', AgentApplyJobPayload>
  | AtomicActionProposal<'AgentApplyEducationExam', AgentApplyEducationExamPayload>
  | AtomicActionProposal<'AgentTrade', AgentTradePayload>
  | AtomicActionProposal<'AgentGiveResource', AgentGiveResourcePayload>
  | AtomicActionProposal<'AgentStartConversation', AgentStartConversationPayload>
  | AtomicActionProposal<'AgentProduce', AgentProducePayload>
  | AtomicActionProposal<'AgentUpgradeResidentialTier', AgentUpgradeResidentialTierPayload>
  | AtomicActionProposal<'AgentRaisePetition', AgentRaisePetitionPayload>
  | AtomicActionProposal<'AgentSignPetition', AgentSignPetitionPayload>;

/**
 * Runtime mirror of the canonical proposal command types. `satisfies` pins it
 * to the union (no invented types); the exhaustive flag below fails to compile
 * when a new union member is not mirrored here. The reactive-correction
 * whitelist must cover every entry (AGENT_CONTEXT_DESIGN.md §5 whitelist
 * reconciliation) — enforced by test in canonicalDomainRuntimes.test.ts.
 */
export const CANONICAL_ACTION_PROPOSAL_COMMAND_TYPES = [
  'AgentEat',
  'AgentMoveTo',
  'AgentObserveLocation',
  'AgentStudy',
  'AgentSleep',
  'AgentSeeDoctor',
  'AgentWork',
  'AgentApplyJob',
  'AgentApplyEducationExam',
  'AgentTrade',
  'AgentGiveResource',
  'AgentStartConversation',
  'AgentProduce',
  'AgentUpgradeResidentialTier',
  'AgentRaisePetition',
  'AgentSignPetition',
] as const satisfies readonly CanonicalActionProposal['commandType'][];

// Non-distributive: a distributive conditional over never collapses to never,
// which would defeat the check.
type RequireNever<T> = [T] extends [never] ? true : never;

/** Compiles only while the runtime list above mirrors the union exhaustively. */
export const CANONICAL_COMMAND_TYPE_LIST_IS_EXHAUSTIVE: RequireNever<
  Exclude<
    CanonicalActionProposal['commandType'],
    (typeof CANONICAL_ACTION_PROPOSAL_COMMAND_TYPES)[number]
  >
> = true;

function resolveSocialResourceGift(input: {
  readonly context: WorkerDomainRuntimeFactoryInput;
  readonly selectedSubtask: PrioritizedSubtask;
}): { readonly commodityName: string; readonly quantity: number } | undefined {
  const intent = [
    input.selectedSubtask.description,
    input.context.activeObjective.statement,
    ...input.context.activeObjective.affinityTags,
  ]
    .join(' ')
    .toLowerCase();
  if (!/(?:give|gift|share-resource|resource-help|provide-food|donate)/u.test(intent)) {
    return undefined;
  }
  const commodityName = Object.entries(input.context.agent.inventory)
    .filter(([, quantity]) => Number.isFinite(quantity) && quantity > 1)
    .map(([name]) => name)
    .sort()[0];
  return commodityName === undefined ? undefined : { commodityName, quantity: 1 };
}

function isSocialCautionObjective(context: WorkerDomainRuntimeFactoryInput): boolean {
  const objectiveContext = [
    context.activeObjective.statement,
    ...context.activeObjective.affinityTags,
  ]
    .join(' ')
    .toLowerCase();
  return /(?:social-caution|verify-commitment|rebuild(?:ing)? trust|before engaging)/u.test(
    objectiveContext,
  );
}

function createContextualDomainMicroPlanner(
  input: ContextualDomainMicroPlannerInput,
): DomainMicroPlanner {
  return {
    domain: input.domain,
    supports: (selectedSubtask) =>
      selectedSubtaskMatchesDomain({
        domain: input.domain,
        planRecord: input.planRecord,
        selectedSubtask,
      }),
    propose: ({ selectedSubtask }) =>
      createLocationAwareActionProposal({
        domain: input.domain,
        context: input.context,
        selectedSubtask,
        action: input.propose(selectedSubtask),
        ...(input.resolveTargetLocationId === undefined
          ? {}
          : { resolveTargetLocationId: input.resolveTargetLocationId }),
      }),
  };
}

function createLocationAwareActionProposal(input: {
  readonly domain: CanonicalDomainName;
  readonly context: WorkerDomainRuntimeFactoryInput;
  readonly selectedSubtask: PrioritizedSubtask;
  readonly action: CanonicalActionProposal;
  readonly resolveTargetLocationId?: (selectedSubtask: PrioritizedSubtask) => LocationId | null;
}): readonly CanonicalActionProposal[] {
  const targetLocationId =
    input.resolveTargetLocationId?.(input.selectedSubtask) ??
    DEFAULT_DOMAIN_LOCATION_IDS[input.domain];
  if (targetLocationId === null) {
    return [input.action];
  }
  if (input.context.projection.locations[targetLocationId] === undefined) {
    return [input.action];
  }
  if (
    input.context.agent.locationId === null ||
    input.context.agent.locationId === targetLocationId
  ) {
    return [input.action];
  }

  const targetLocation = input.context.projection.locations[targetLocationId];
  return [
    {
      id: `${createCanonicalActionId(input.domain, input.selectedSubtask)}-move`,
      description: `Move to ${targetLocation.name} before ${input.selectedSubtask.description}.`,
      commandType: 'AgentMoveTo',
      priority: input.selectedSubtask.score,
      payload: {
        targetLocationId,
        reason: input.domain,
      },
    },
  ];
}

function selectedSubtaskMatchesDomain(input: {
  readonly domain: CanonicalDomainName;
  readonly planRecord: BranchPlanRecord;
  readonly selectedSubtask: PrioritizedSubtask;
}): boolean {
  const tokens = new Set<string>();
  addTextTokens(input.selectedSubtask.branchId, tokens);
  addTextTokens(input.selectedSubtask.subtaskId, tokens);

  const branch = input.planRecord.plan.branches.find(
    (candidate) => candidate.id === input.selectedSubtask.branchId,
  );
  if (branch !== undefined) {
    addTextTokens(branch.id, tokens);
    const subtask = branch.subtasks.find(
      (candidate) => candidate.id === input.selectedSubtask.subtaskId,
    );
    if (subtask !== undefined) {
      addTextTokens(subtask.id, tokens);
      addTagTokens(subtask.intentionAffinityTags, tokens);
      addTagTokens(subtask.memoryAffinityTags, tokens);
      addTagTokens(subtask.profileAffinityTags, tokens);
    }
  }

  return tokens.has(input.domain);
}

function resolveFirstMarketCommodity(context: WorkerDomainRuntimeFactoryInput): string {
  return Object.keys(context.projection.marketPools).sort()[0] ?? DEFAULT_TRADE_COMMODITY;
}

function resolveContextualTradeSide(input: {
  readonly context: WorkerDomainRuntimeFactoryInput;
  readonly selectedSubtask?: PrioritizedSubtask;
}): 'buy' | 'sell' {
  for (const text of collectContextualTargetTexts(input)) {
    const tokens = new Set(tokenizeText(text));
    if (tokens.has('sell')) {
      return 'sell';
    }
    if (tokens.has('buy') || tokens.has('purchase')) {
      return 'buy';
    }
  }
  return DEFAULT_TRADE_SIDE;
}

function resolveContextualTradeCommodityName(input: {
  readonly context: WorkerDomainRuntimeFactoryInput;
  readonly selectedSubtask?: PrioritizedSubtask;
}): string | undefined {
  for (const text of collectContextualTargetTexts(input)) {
    const commodity = findMatchingTargetNamesInText(text, COMMODITY_TARGETS).find(
      (candidate) => input.context.projection.marketPools[candidate] !== undefined,
    );
    if (commodity !== undefined) {
      return commodity;
    }
  }
  return undefined;
}

function hasValidSatietyRecovery(
  satietyRecoveryByCommodity: Readonly<Record<string, number>>,
  commodityName: string,
): boolean {
  const recovery = satietyRecoveryByCommodity[commodityName];
  return recovery !== undefined && Number.isFinite(recovery) && recovery >= 0;
}

type TextTargetCandidate = {
  readonly name: string;
  readonly tokens: readonly string[];
};

const OCCUPATION_TARGETS: readonly TextTargetCandidate[] = occupations
  .map((occupation) => ({
    name: occupation.name,
    tokens: tokenizeText(occupation.name),
  }))
  .filter((candidate) => candidate.tokens.length > 0)
  .sort(
    (left, right) =>
      right.tokens.length - left.tokens.length ||
      right.name.length - left.name.length ||
      left.name.localeCompare(right.name),
  );

type CommodityContent = (typeof commodities)[number];
type OccupationContent = (typeof occupations)[number];
type JobTierContent = (typeof jobTiers)[number];

const OCCUPATION_BY_NAME: ReadonlyMap<string, OccupationContent> = new Map(
  occupations.map((occupation) => [occupation.name, occupation]),
);

const JOB_TIER_BY_TIER: ReadonlyMap<number, JobTierContent> = new Map(
  jobTiers.map((jobTier) => [jobTier.tier, jobTier]),
);

const COMMODITY_TARGETS: readonly TextTargetCandidate[] = commodities
  .map((commodity) => ({
    name: commodity.name,
    tokens: tokenizeText(commodity.name),
  }))
  .filter((candidate) => candidate.tokens.length > 0)
  .sort(
    (left, right) =>
      right.tokens.length - left.tokens.length ||
      right.name.length - left.name.length ||
      left.name.localeCompare(right.name),
  );

const COMMODITY_BY_NAME: ReadonlyMap<string, CommodityContent> = new Map(
  commodities.map((commodity) => [commodity.name, commodity]),
);

const PRODUCIBLE_PRODUCTION_TARGETS: readonly TextTargetCandidate[] = commodities
  .map((commodity) => ({
    name: commodity.name,
    tokens: tokenizeText(commodity.name),
  }))
  .filter(
    (candidate) =>
      candidate.tokens.length > 0 && resolveProductionDefinition(candidate.name) !== undefined,
  )
  .sort(
    (left, right) =>
      right.tokens.length - left.tokens.length ||
      right.name.length - left.name.length ||
      left.name.localeCompare(right.name),
  );

function collectContextualTargetTexts(input: {
  readonly context: WorkerDomainRuntimeFactoryInput;
  readonly selectedSubtask?: PrioritizedSubtask;
}): readonly string[] {
  const texts: string[] = [];
  const addText = (text: string | undefined): void => {
    if (text !== undefined && text.trim().length > 0) {
      texts.push(text);
    }
  };
  const selectedSubtask = input.selectedSubtask;

  addText(selectedSubtask?.description);

  const branch =
    selectedSubtask === undefined
      ? undefined
      : input.context.planRecord.plan.branches.find(
          (candidate) => candidate.id === selectedSubtask.branchId,
        );
  const subtask =
    branch === undefined || selectedSubtask === undefined
      ? undefined
      : branch.subtasks.find((candidate) => candidate.id === selectedSubtask.subtaskId);

  addText(subtask?.description);
  addText(branch?.objective);
  addText(input.context.planRecord.plan.objective);
  addText(input.context.activeObjective.statement);
  addText(selectedSubtask?.subtaskId);
  addText(selectedSubtask?.branchId);
  addText(subtask?.id);
  addText(branch?.id);
  for (const tag of subtask?.intentionAffinityTags ?? []) {
    addText(tag);
  }
  for (const tag of subtask?.memoryAffinityTags ?? []) {
    addText(tag);
  }
  for (const tag of subtask?.profileAffinityTags ?? []) {
    addText(tag);
  }

  return texts;
}

function findProducibleCommodityNameInText(text: string): string | undefined {
  return findMatchingTargetNamesInText(text, PRODUCIBLE_PRODUCTION_TARGETS)[0];
}

function findOccupationNameInText(text: string): string | undefined {
  return findMatchingTargetNamesInText(text, OCCUPATION_TARGETS)[0];
}

function findMatchingTargetNamesInText(
  text: string,
  candidates: readonly TextTargetCandidate[],
): readonly string[] {
  const textTokens = tokenizeText(text);
  if (textTokens.length === 0) {
    return [];
  }

  return candidates
    .filter((candidate) => containsTokenPhrase(textTokens, candidate.tokens))
    .map((candidate) => candidate.name);
}

function createJobApplicationResourceEstimate(input: {
  readonly occupationName: string;
  readonly context: WorkerDomainRuntimeFactoryInput;
}): { readonly resourceEstimate?: ActionResourceEstimate } {
  const occupation = occupations.find((candidate) => candidate.name === input.occupationName);
  const jobTier = jobTiers.find((candidate) => candidate.tier === occupation?.jobTier);
  const prerequisiteCommodity = jobTier?.prerequisiteCommodity;
  if (prerequisiteCommodity === undefined || prerequisiteCommodity === null) {
    return {};
  }

  if ((input.context.agent.inventory[prerequisiteCommodity] ?? 0) < 1) {
    return {};
  }

  return { resourceEstimate: { inventoryCosts: { [prerequisiteCommodity]: 1 } } };
}

function containsTokenPhrase(
  textTokens: readonly string[],
  candidateTokens: readonly string[],
): boolean {
  if (candidateTokens.length === 0 || candidateTokens.length > textTokens.length) {
    return false;
  }

  for (let start = 0; start <= textTokens.length - candidateTokens.length; start += 1) {
    const matches = candidateTokens.every((candidateToken, index) =>
      productionTargetTokenMatches({
        candidateToken,
        textToken: textTokens[start + index] ?? '',
        isLastToken: index === candidateTokens.length - 1,
      }),
    );
    if (matches) {
      return true;
    }
  }

  return false;
}

function productionTargetTokenMatches(input: {
  readonly candidateToken: string;
  readonly textToken: string;
  readonly isLastToken: boolean;
}): boolean {
  return (
    input.textToken === input.candidateToken ||
    (input.isLastToken && input.textToken === `${input.candidateToken}s`)
  );
}

function createLaborResourceEstimate(
  laborSeconds: number,
  laborCost: WorldCommandPolicies['laborCost'] | undefined,
): ActionResourceEstimate {
  if (laborCost === undefined) {
    return { actionSeconds: laborSeconds };
  }

  const laborHours = laborSeconds / 3600;
  return {
    actionSeconds: laborSeconds,
    energyCost: laborCost.energyCostPerHour * laborHours,
    satietyCost: laborCost.satietyCostPerHour * laborHours,
  };
}

function createTradeResourceEstimate(input: {
  readonly side: 'buy' | 'sell';
  readonly commodityName: string;
  readonly quantity: number;
  readonly context: WorkerDomainRuntimeFactoryInput;
}): { readonly resourceEstimate?: ActionResourceEstimate } {
  if (input.side === 'sell') {
    return { resourceEstimate: { inventoryCosts: { [input.commodityName]: input.quantity } } };
  }

  const pool = input.context.projection.marketPools[input.commodityName];
  if (pool === undefined) {
    return {};
  }

  try {
    return {
      resourceEstimate: {
        currencyCost: buyFromPool(pool, input.quantity).currencyDelta,
      },
    };
  } catch {
    return {};
  }
}

function createResidentialUpgradeResourceEstimate(input: {
  readonly targetResidentialTier: number;
  readonly upgradePolicy?: WorldCommandPolicies['residentialTierUpgrade'];
}): { readonly resourceEstimate?: ActionResourceEstimate } {
  const cost = input.upgradePolicy?.costs.find(
    (candidate) => candidate.targetResidentialTier === input.targetResidentialTier,
  );
  if (cost === undefined) {
    return {};
  }

  const resourceEstimate: ActionResourceEstimate = {
    ...(cost.currencyCost === undefined ? {} : { currencyCost: cost.currencyCost }),
    ...(cost.inventoryCosts === undefined || Object.keys(cost.inventoryCosts).length === 0
      ? {}
      : { inventoryCosts: { ...cost.inventoryCosts } }),
  };
  return Object.keys(resourceEstimate).length === 0 ? {} : { resourceEstimate };
}

function resolveNextResidentialUpgradeTier(input: {
  readonly currentResidentialTier: number;
  readonly targetResidentialTier: number;
}): number {
  if (input.targetResidentialTier <= input.currentResidentialTier) {
    return input.currentResidentialTier + 1;
  }

  return Math.min(input.targetResidentialTier, input.currentResidentialTier + 1);
}

function resolveNextProductionStep(input: {
  readonly commodityName: string;
  readonly quantity: number;
  readonly availableLaborSeconds: number;
  readonly context: WorkerDomainRuntimeFactoryInput;
  readonly productionPolicy?: WorldCommandPolicies['production'];
  readonly educationSystemPolicy?: EducationSystemPolicy;
}): ProductionChainStep | undefined {
  const productionChain = planProductionChain({
    commodityName: input.commodityName,
    quantity: input.quantity,
    agent: createProductionEstimateAgentState(input),
    ...(input.productionPolicy?.recipeOverrides === undefined
      ? {}
      : { recipeOverrides: input.productionPolicy.recipeOverrides }),
    ...(input.productionPolicy?.efficiency === undefined
      ? {}
      : { productionEfficiency: input.productionPolicy.efficiency }),
  });
  if (productionChain.status === 'rejected') {
    return undefined;
  }

  return productionChain.steps[0];
}

/**
 * Agent state for production planning estimates. Mirrors the settlement
 * handler: the discrete education level (and with it the production-efficiency
 * level multiplier) is only supplied when the education-system policy is
 * enabled, with the score-derived fallback for legacy snapshots.
 */
function createProductionEstimateAgentState(input: {
  readonly availableLaborSeconds: number;
  readonly context: WorkerDomainRuntimeFactoryInput;
  readonly educationSystemPolicy?: EducationSystemPolicy;
}): ProductionAgentState {
  const agent = input.context.agent;
  const educationLevel =
    input.educationSystemPolicy !== undefined && input.educationSystemPolicy.enabled
      ? (agent.educationLevel ??
        deriveEducationLevel(agent.educationScore, input.educationSystemPolicy))
      : undefined;
  return {
    residentialTier: agent.residentialTier,
    energy: agent.physiology.energy,
    satiety: agent.physiology.satiety,
    health: agent.physiology.health,
    availableLaborSeconds: input.availableLaborSeconds,
    inventory: agent.inventory,
    educationScore: agent.educationScore,
    ...(educationLevel === undefined ? {} : { educationLevel }),
  };
}

function createProductionStepResourceEstimate(step: ProductionChainStep): ActionResourceEstimate {
  return {
    actionSeconds: step.laborSeconds,
    energyCost: step.energyCost,
    satietyCost: step.satietyCost,
    ...(Object.keys(step.consumedInputs).length === 0
      ? {}
      : { inventoryCosts: step.consumedInputs }),
  };
}

function createProductionResourceEstimate(input: {
  readonly commodityName: string;
  readonly quantity: number;
  readonly availableLaborSeconds: number;
  readonly context: WorkerDomainRuntimeFactoryInput;
  readonly productionPolicy?: WorldCommandPolicies['production'];
  readonly educationSystemPolicy?: EducationSystemPolicy;
}): { readonly resourceEstimate?: ActionResourceEstimate } {
  const productionPlan = planProduction({
    commodityName: input.commodityName,
    quantity: input.quantity,
    agent: createProductionEstimateAgentState(input),
    ...(input.productionPolicy?.recipeOverrides === undefined
      ? {}
      : { recipeOverrides: input.productionPolicy.recipeOverrides }),
    ...(input.productionPolicy?.efficiency === undefined
      ? {}
      : { productionEfficiency: input.productionPolicy.efficiency }),
  });
  if (productionPlan.status === 'rejected') {
    return {};
  }

  return {
    resourceEstimate: {
      actionSeconds: productionPlan.laborSeconds,
      energyCost: productionPlan.energyCost,
      satietyCost: productionPlan.satietyCost,
      ...(Object.keys(productionPlan.consumedInputs).length === 0
        ? {}
        : { inventoryCosts: productionPlan.consumedInputs }),
    },
  };
}

function createCanonicalActionId(
  domain: CanonicalDomainName,
  selectedSubtask: PrioritizedSubtask,
): string {
  return `canonical-${domain}-${selectedSubtask.subtaskId}`;
}

function addTagTokens(tags: readonly string[] | undefined, tokens: Set<string>): void {
  for (const tag of tags ?? []) {
    addTextTokens(tag, tokens);
  }
}

function addTextTokens(text: string, tokens: Set<string>): void {
  for (const token of tokenizeText(text)) {
    tokens.add(token);
  }
}

function tokenizeText(text: string): readonly string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}
