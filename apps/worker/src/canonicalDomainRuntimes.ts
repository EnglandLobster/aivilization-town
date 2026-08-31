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
  AgentBuildHousingPayload,
  AgentChooseResidencePayload,
  AgentEatPayload,
  AgentExportCommodityPayload,
  AgentFoundEnterprisePayload,
  AgentFundEnterprisePayload,
  AgentGiveResourcePayload,
  AgentImportCommodityPayload,
  AgentJoinEnterprisePayload,
  AgentMoveToPayload,
  AgentObserveLocationPayload,
  AgentProducePayload,
  AgentRaisePetitionPayload,
  AgentRequestLoanPayload,
  AgentSeeDoctorPayload,
  AgentSetEnterpriseJobPostingPayload,
  AgentSignPetitionPayload,
  AgentStartConversationPayload,
  AgentUpgradeResidentialTierPayload,
  AgentSleepPayload,
  AgentStudyPayload,
  AgentTradePayload,
  AgentWorkPayload,
  SetTaxPolicyPayload,
  SetPublicBudgetPayload,
  SetSubsidyPolicyPayload,
  WorldCommandPolicies,
} from '@aivilization/world';
import { activeLoansByBorrower, resolveCreditLimit } from '@aivilization/world';
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
import {
  assertValidExternalTradeActionProposerPolicy,
  createExternalTradePlanningQuotes,
  DEFAULT_EXTERNAL_TRADE_ACTION_PROPOSER_POLICY,
  resolveEnterpriseExternalTradeOpportunity,
  type ExternalTradeActionProposerPolicy,
} from './externalTradePlanning';
import { createCanonicalSocialDialogueTurns, resolveCanonicalSocialPlan } from './socialPlanning';
import {
  assertValidSocialMatterActionProposerPolicy,
  DEFAULT_SOCIAL_MATTER_ACTION_PROPOSER_POLICY,
  resolveSocialMatterActionProposal,
  resolveSocialMatterTargetAgentId,
  type SocialMatterActionProposal,
  type SocialMatterActionProposerPolicy,
} from './socialMatterPlanning';
import { resolveAgentMarketPools } from './worldDecisionContext';
import {
  DEFAULT_CONFLICT_ACTION_PROPOSER_POLICY,
  resolveConflictActionProposal,
  type ConflictActionProposal,
  type ConflictActionProposerPolicy,
} from './conflictPlanning';
import { isEnterpriseOccupationQualified } from './enterprisePlanning';

export type CanonicalDomainName =
  | 'study'
  | 'work'
  | 'trade'
  | 'sleep'
  | 'social'
  | 'production'
  | 'residential'
  | 'health'
  | 'eat'
  | 'banking'
  | 'enterprise'
  | 'governance';

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
  readonly banking?: BankingDomainRuntimeConfig;
  readonly enterprise?: EnterpriseDomainRuntimeConfig;
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
  // No dedicated bank premise exists in scenarios; bank commands settle
  // against the town-bank aggregate wherever the citizen stands, so the
  // market doubles as the financial anchor. Enterprise actions anchor at the
  // workshop like other productive work.
  banking: asLocationId('market'),
  enterprise: asLocationId('workshop'),
  governance: asLocationId('town-square'),
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
    createTradeDomainRuntimeRegistration(config.trade, policies?.externalTrade),
    createSleepDomainRuntimeRegistration(config.sleep),
    createSocialDomainRuntimeRegistration(
      config.social,
      policies?.collectiveAction,
      policies?.socialMatters,
      policies?.conflict,
    ),
    createProductionDomainRuntimeRegistration(
      config.production,
      policies?.production,
      policies?.educationSystem,
    ),
    createResidentialDomainRuntimeRegistration(
      config.residential,
      policies?.residentialTierUpgrade,
      policies?.housingConstruction,
      policies?.residentialAssignment,
    ),
    createHealthDomainRuntimeRegistration(config.health),
    createEatDomainRuntimeRegistration(config.eat, policies?.satietyRecoveryByCommodity),
    createBankingDomainRuntimeRegistration(config.banking, policies?.credit),
    createEnterpriseDomainRuntimeRegistration(config.enterprise, policies?.enterprise),
    ...(policies?.governance === undefined
      ? []
      : [createGovernanceDomainRuntimeRegistration(policies)]),
  ];
}

export function createGovernanceDomainRuntimeRegistration(
  policies: WorldCommandPolicies,
): WorkerDomainRuntimeRegistration {
  return {
    domain: 'governance',
    createMicroPlanners: (context) => [
      {
        domain: 'governance',
        supports: (selectedSubtask) =>
          (context.worldDecisionContext?.governance?.eligiblePetitions.length ?? 0) > 0 &&
          selectedSubtaskMatchesDomain({
            domain: 'governance',
            planRecord: context.planRecord,
            selectedSubtask,
          }),
        propose: ({ selectedSubtask }) => {
          const proposal = createGovernanceActionProposal({ context, selectedSubtask, policies });
          return proposal === undefined ? [] : [proposal];
        },
      },
    ],
  };
}

function createGovernanceActionProposal(input: {
  readonly context: WorkerDomainRuntimeFactoryInput;
  readonly selectedSubtask: PrioritizedSubtask;
  readonly policies: WorldCommandPolicies;
}): CanonicalActionProposal | undefined {
  const governance = input.context.worldDecisionContext?.governance;
  const petition = governance?.eligiblePetitions[0];
  if (governance === undefined || petition === undefined) return undefined;
  const common = {
    id: `${createCanonicalActionId('governance', input.selectedSubtask)}:${petition.petitionId}`,
    priority: input.selectedSubtask.score,
  };
  if (petition.topic === 'tax-policy') {
    const direction = governanceChangeDirection(petition.statement);
    const adjustRate = (rate: number) => roundPolicyNumber(clamp(rate + direction * 0.01, 0, 1));
    return {
      ...common,
      description: `Enact the threshold petition ${petition.petitionId} as a tax policy change.`,
      commandType: 'SetTaxPolicy',
      payload: {
        neutralRate: adjustRate(governance.tax.neutralRate),
        incomeTaxBrackets: governance.tax.incomeTaxBrackets.map((bracket) => ({
          ...bracket,
          rate: adjustRate(bracket.rate),
        })),
        tradeTaxRate: adjustRate(governance.tax.tradeTaxRate),
        ...(governance.tax.dividendTaxRate === undefined
          ? {}
          : { dividendTaxRate: adjustRate(governance.tax.dividendTaxRate) }),
        reason: petition.statement,
        petitionId: petition.petitionId,
        expectedGovernanceRevision: governance.revision,
      },
    };
  }
  if (petition.topic === 'public-budget') {
    const direction = governanceChangeDirection(petition.statement);
    const mentionedService = governance.publicBudget.allocations.find((allocation) =>
      petition.statement.toLowerCase().includes(allocation.service.toLowerCase()),
    )?.service;
    const targetService = mentionedService ?? governance.publicBudget.allocations[0]?.service;
    if (targetService === undefined) return undefined;
    const maximum = input.policies.governance?.maximumAllocationPerCadence ?? Number.MAX_VALUE;
    return {
      ...common,
      description: `Enact the threshold petition ${petition.petitionId} as a public budget change.`,
      commandType: 'SetPublicBudget',
      payload: {
        cadenceMs: governance.publicBudget.cadenceMs,
        minimumTreasuryReserve: governance.publicBudget.minimumTreasuryReserve,
        allocations: governance.publicBudget.allocations.map((allocation) =>
          allocation.service === targetService
            ? {
                ...allocation,
                amountPerCadence: roundPolicyNumber(
                  clamp(allocation.amountPerCadence + direction * 10, 0, maximum),
                ),
              }
            : { ...allocation },
        ),
        reason: petition.statement,
        petitionId: petition.petitionId,
        expectedGovernanceRevision: governance.revision,
      },
    };
  }
  const direction = governanceChangeDirection(petition.statement);
  const current = governance.subsidy ?? { minimumBalance: 0, maxSubsidy: 0 };
  const maximumFloor = input.policies.governance?.maximumSubsidyBalanceFloor ?? Number.MAX_VALUE;
  const maximumAmount = input.policies.governance?.maximumSubsidyPerCadence ?? Number.MAX_VALUE;
  return {
    ...common,
    description: `Enact the threshold petition ${petition.petitionId} as a subsidy policy change.`,
    commandType: 'SetSubsidyPolicy',
    payload: {
      minimumBalance: roundPolicyNumber(
        clamp(current.minimumBalance + direction * 10, 0, maximumFloor),
      ),
      maxSubsidy: roundPolicyNumber(clamp(current.maxSubsidy + direction * 10, 0, maximumAmount)),
      reason: petition.statement,
      petitionId: petition.petitionId,
      expectedGovernanceRevision: governance.revision,
    },
  };
}

function governanceChangeDirection(statement: string): -1 | 1 {
  return /\b(?:lower|reduce|decrease|cut|less)\b/iu.test(statement) ||
    /(?:下降|降低|削减|减少)/u.test(statement)
    ? -1
    : 1;
}

function roundPolicyNumber(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
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
          const employer = Object.values(context.projection.enterprises)
            .filter(
              (enterprise) =>
                (enterprise.status === 'active' || enterprise.status === 'insolvent') &&
                enterprise.occupationName === occupationName &&
                enterprise.employeeAgentIds.includes(context.agent.agentId),
            )
            .sort((left, right) => left.enterpriseId.localeCompare(right.enterpriseId))[0];
          return {
            id: createCanonicalActionId('work', selectedSubtask),
            description: `Work as ${occupationName}.`,
            commandType: 'AgentWork',
            priority: selectedSubtask.score,
            payload: {
              occupationName,
              laborSeconds,
              ...(employer === undefined ? {} : { enterpriseId: employer.enterpriseId }),
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
  externalTradePolicy?: WorldCommandPolicies['externalTrade'],
): WorkerDomainRuntimeRegistration {
  const externalTradeProposerPolicy = DEFAULT_EXTERNAL_TRADE_ACTION_PROPOSER_POLICY;
  assertValidExternalTradeActionProposerPolicy(externalTradeProposerPolicy);
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
          const quantity = config.quantity ?? DEFAULT_TRADE_QUANTITY;
          if (
            externalTradePolicy !== undefined &&
            hasEnterpriseExternalTradeIntent({ context, selectedSubtask })
          ) {
            const externalProposal = resolveEnterpriseExternalTradeProposal({
              context,
              selectedSubtask,
              direction: side === 'sell' ? 'export' : 'import',
              commodityName,
              quantity,
              externalTradePolicy,
              proposerPolicy: externalTradeProposerPolicy,
            });
            if (externalProposal !== undefined) {
              return externalProposal;
            }
            return {
              id: `${createCanonicalActionId('trade', selectedSubtask)}-external-observe`,
              description: `Recheck external and town-market ${commodityName} quotes before trading for an enterprise.`,
              commandType: 'AgentObserveLocation',
              priority: selectedSubtask.score,
              payload: { focus: `external ${side} ${commodityName} enterprise quote` },
            };
          }
          const enterprise = resolveEnterpriseForOperationalAction({
            context,
            selectedSubtask,
          });
          return {
            id: createCanonicalActionId('trade', selectedSubtask),
            description: `${side} ${commodityName}.`,
            commandType: 'AgentTrade',
            priority: selectedSubtask.score,
            payload: {
              side,
              commodityName,
              quantity,
              ...(enterprise === undefined ? {} : { enterpriseId: enterprise.enterpriseId }),
            },
            ...(enterprise === undefined
              ? createTradeResourceEstimate({
                  side,
                  commodityName,
                  quantity,
                  context,
                })
              : {}),
          };
        },
      }),
    ],
  };
}

export function resolveEnterpriseExternalTradeProposal(input: {
  readonly context: WorkerDomainRuntimeFactoryInput;
  readonly selectedSubtask: PrioritizedSubtask;
  readonly direction: 'export' | 'import';
  readonly commodityName: string;
  readonly quantity: number;
  readonly externalTradePolicy: NonNullable<WorldCommandPolicies['externalTrade']>;
  readonly proposerPolicy: ExternalTradeActionProposerPolicy;
}):
  | AtomicActionProposal<'AgentExportCommodity', AgentExportCommodityPayload>
  | AtomicActionProposal<'AgentImportCommodity', AgentImportCommodityPayload>
  | undefined {
  const marketPools = resolveVisibleMarketPools(input.context);
  const opportunity = resolveEnterpriseExternalTradeOpportunity({
    agentId: input.context.agent.agentId,
    enterprises: input.context.projection.enterprises,
    marketPools,
    externalQuotes: createExternalTradePlanningQuotes({
      marketPools,
      balancesByCommodity: input.context.projection.externalTrade?.balancesByCommodity ?? {},
      quantity: input.quantity,
      externalTradePolicy: input.externalTradePolicy,
    }),
    quantity: input.quantity,
    proposerPolicy: input.proposerPolicy,
    direction: input.direction,
    commodityName: input.commodityName,
  });
  if (opportunity === undefined) {
    return undefined;
  }

  const advantagePercent = (opportunity.relativeAdvantageRatio * 100).toFixed(2);
  const base = {
    id: `${createCanonicalActionId('trade', input.selectedSubtask)}-enterprise-${opportunity.direction}`,
    priority: input.selectedSubtask.score,
    payload: {
      commodityName: opportunity.commodityName,
      quantity: opportunity.quantity,
      asEnterpriseId: opportunity.enterpriseId,
    },
  };
  if (opportunity.direction === 'export') {
    return {
      ...base,
      description: `Export ${opportunity.quantity} ${opportunity.commodityName} for enterprise ${opportunity.enterpriseId}; the external quote is ${advantagePercent}% better than the visible town AMM.`,
      commandType: 'AgentExportCommodity',
      resourceEstimate: {
        inventoryCosts: { [opportunity.commodityName]: opportunity.quantity },
      },
    };
  }
  return {
    ...base,
    description: `Import ${opportunity.quantity} ${opportunity.commodityName} for enterprise ${opportunity.enterpriseId}; the external quote is ${advantagePercent}% better than the visible town AMM.`,
    commandType: 'AgentImportCommodity',
    resourceEstimate: { currencyCost: opportunity.externalTotal },
  };
}

function hasEnterpriseExternalTradeIntent(input: {
  readonly context: WorkerDomainRuntimeFactoryInput;
  readonly selectedSubtask: PrioritizedSubtask;
}): boolean {
  return collectContextualTargetTexts(input).some((text) => {
    const tokens = new Set(tokenizeText(text));
    return tokens.has('external') || tokens.has('export') || tokens.has('import');
  });
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
  socialMattersPolicy?: WorldCommandPolicies['socialMatters'],
  conflictPolicy?: WorldCommandPolicies['conflict'],
  matterProposerPolicy: SocialMatterActionProposerPolicy = DEFAULT_SOCIAL_MATTER_ACTION_PROPOSER_POLICY,
  conflictProposerPolicy: ConflictActionProposerPolicy = DEFAULT_CONFLICT_ACTION_PROPOSER_POLICY,
): WorkerDomainRuntimeRegistration {
  assertValidSocialMatterActionProposerPolicy(matterProposerPolicy);
  return {
    domain: 'social',
    createMicroPlanners: (context) => [
      createContextualDomainMicroPlanner({
        domain: 'social',
        context,
        planRecord: context.planRecord,
        resolveTargetLocationId: (selectedSubtask) => {
          const matterTarget =
            socialMattersPolicy === undefined
              ? undefined
              : resolveSocialMatterTargetAgentId({ context, selectedSubtask });
          const targetAgentId = matterTarget ?? config.targetAgentId;
          if (targetAgentId === undefined) return DEFAULT_DOMAIN_LOCATION_IDS.social;
          const targetLocationId =
            context.projection.agents[targetAgentId]?.locationId ??
            context.worldDecisionContext?.society?.agents.find(
              (agent) => agent.agentId === targetAgentId,
            )?.locationId ??
            DEFAULT_DOMAIN_LOCATION_IDS.social;
          return targetLocationId === null ? null : asLocationId(targetLocationId);
        },
        propose: (selectedSubtask) => {
          if (socialMattersPolicy !== undefined) {
            const matterProposal = resolveSocialMatterActionProposal({
              context,
              selectedSubtask,
              actionId: createCanonicalActionId('social', selectedSubtask),
              proposerPolicy: matterProposerPolicy,
            });
            if (matterProposal !== undefined) {
              return matterProposal;
            }
          }
          if (conflictPolicy !== undefined) {
            const conflictProposal = resolveConflictActionProposal({
              context,
              selectedSubtask,
              conflictPolicy,
              proposerPolicy: conflictProposerPolicy,
              actionId: createCanonicalActionId('social', selectedSubtask),
            });
            if (conflictProposal !== undefined) {
              return conflictProposal;
            }
          }
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
          const enterprise = resolveEnterpriseForOperationalAction({
            context,
            selectedSubtask,
          });
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
            ...(enterprise === undefined ? {} : { inventory: enterprise.inventory }),
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
              ...(enterprise === undefined ? {} : { enterpriseId: enterprise.enterpriseId }),
            },
            ...(nextProductionStep === undefined
              ? createProductionResourceEstimate({
                  commodityName,
                  quantity,
                  availableLaborSeconds,
                  context,
                  productionPolicy,
                  ...(enterprise === undefined ? {} : { inventory: enterprise.inventory }),
                  ...(educationSystemPolicy === undefined ? {} : { educationSystemPolicy }),
                })
              : {
                  resourceEstimate: createProductionStepResourceEstimate(
                    nextProductionStep,
                    enterprise !== undefined,
                  ),
                }),
          };
        },
      }),
    ],
  };
}

export function createResidentialDomainRuntimeRegistration(
  config: ResidentialDomainRuntimeConfig = {},
  upgradePolicy?: WorldCommandPolicies['residentialTierUpgrade'],
  housingConstructionPolicy?: WorldCommandPolicies['housingConstruction'],
  residentialAssignmentPolicy?: WorldCommandPolicies['residentialAssignment'],
): WorkerDomainRuntimeRegistration {
  return {
    domain: 'residential',
    createMicroPlanners: (context) => [
      createContextualDomainMicroPlanner({
        domain: 'residential',
        context,
        planRecord: context.planRecord,
        propose: (selectedSubtask) => {
          const residenceProposal = resolveResidenceChoiceProposal({
            context,
            selectedSubtask,
            policy: residentialAssignmentPolicy,
          });
          if (residenceProposal !== undefined) {
            return residenceProposal;
          }
          const constructionProposal = resolveHousingConstructionProposal({
            context,
            selectedSubtask,
            policy: housingConstructionPolicy,
          });
          if (constructionProposal !== undefined) {
            return constructionProposal;
          }
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
        resolveTargetLocationId: () =>
          resolveResidenceChoiceLocationId(context, residentialAssignmentPolicy) ??
          resolveHousingConstructionLocationId(context, housingConstructionPolicy) ??
          DEFAULT_DOMAIN_LOCATION_IDS.residential,
      }),
    ],
  };
}

function resolveResidenceChoiceProposal(input: {
  readonly context: WorkerDomainRuntimeFactoryInput;
  readonly selectedSubtask: PrioritizedSubtask;
  readonly policy?: WorldCommandPolicies['residentialAssignment'];
}): AtomicActionProposal<'AgentChooseResidence', AgentChooseResidencePayload> | undefined {
  const locationId = resolveResidenceChoiceLocationId(input.context, input.policy);
  if (locationId === undefined || input.context.worldDecisionContext?.agent.housed !== false) {
    return undefined;
  }
  return {
    id: `${createCanonicalActionId('residential', input.selectedSubtask)}-choose-home`,
    description: `Choose ${locationId} as a durable home.`,
    commandType: 'AgentChooseResidence',
    priority: input.selectedSubtask.score,
    payload: { locationId },
  };
}

function resolveResidenceChoiceLocationId(
  context: WorkerDomainRuntimeFactoryInput,
  policy?: WorldCommandPolicies['residentialAssignment'],
): LocationId | undefined {
  if (policy === undefined || context.worldDecisionContext?.agent.housed !== false) {
    return undefined;
  }
  return context.worldDecisionContext.society?.housing?.residences
    .filter((residence) => residence.vacancies > 0)
    .sort(
      (left, right) =>
        right.vacancies - left.vacancies || left.locationId.localeCompare(right.locationId),
    )
    .map((residence) => asLocationId(residence.locationId))[0];
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
  | AtomicActionProposal<'AgentBuildHousing', AgentBuildHousingPayload>
  | AtomicActionProposal<'AgentChooseResidence', AgentChooseResidencePayload>
  | AtomicActionProposal<'AgentRaisePetition', AgentRaisePetitionPayload>
  | AtomicActionProposal<'AgentSignPetition', AgentSignPetitionPayload>
  | SocialMatterActionProposal
  | ConflictActionProposal
  | AtomicActionProposal<'AgentRequestLoan', AgentRequestLoanPayload>
  | AtomicActionProposal<'AgentJoinEnterprise', AgentJoinEnterprisePayload>
  | AtomicActionProposal<'AgentFoundEnterprise', AgentFoundEnterprisePayload>
  | AtomicActionProposal<'AgentFundEnterprise', AgentFundEnterprisePayload>
  | AtomicActionProposal<'AgentSetEnterpriseJobPosting', AgentSetEnterpriseJobPostingPayload>
  | AtomicActionProposal<'AgentExportCommodity', AgentExportCommodityPayload>
  | AtomicActionProposal<'AgentImportCommodity', AgentImportCommodityPayload>
  | AtomicActionProposal<'SetTaxPolicy', SetTaxPolicyPayload>
  | AtomicActionProposal<'SetPublicBudget', SetPublicBudgetPayload>
  | AtomicActionProposal<'SetSubsidyPolicy', SetSubsidyPolicyPayload>;

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
  'AgentBuildHousing',
  'AgentChooseResidence',
  'AgentRaisePetition',
  'AgentSignPetition',
  'AgentRaiseMatter',
  'AgentRespondMatter',
  'AgentAssignMatter',
  'AgentCloseMatter',
  'AgentConfront',
  'AgentAttack',
  'AgentIntervene',
  'AgentRequestLoan',
  'AgentJoinEnterprise',
  'AgentFoundEnterprise',
  'AgentFundEnterprise',
  'AgentSetEnterpriseJobPosting',
  'AgentExportCommodity',
  'AgentImportCommodity',
  'SetTaxPolicy',
  'SetPublicBudget',
  'SetSubsidyPolicy',
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

export const BANKING_ACTION_PROPOSER_POLICY_VERSION = 'banking-action-proposer-v1';

/**
 * Versioned gates for the banking domain's deterministic loan proposal
 * (AGENT_CONTEXT_DESIGN.md §5: rigid conditions — never "has credit, takes
 * credit"). The macro backstop is the credit domain's reserve-ratio
 * constraint; this policy only governs when the proposer nominates a loan.
 */
export type BankingActionProposerPolicy = {
  readonly policyVersion: string;
  /**
   * Balance floor: below it, together with an active physiological need, a
   * deterministic survival gap exists and a bridge loan is nominated.
   */
  readonly survivalBalanceFloor: number;
};

export const DEFAULT_BANKING_ACTION_PROPOSER_POLICY: BankingActionProposerPolicy = {
  policyVersion: BANKING_ACTION_PROPOSER_POLICY_VERSION,
  survivalBalanceFloor: 50,
};

export function assertValidBankingActionProposerPolicy(policy: BankingActionProposerPolicy): void {
  if (policy.policyVersion.trim().length === 0) {
    throw new Error('banking action proposer policyVersion must not be empty');
  }
  if (!Number.isFinite(policy.survivalBalanceFloor) || policy.survivalBalanceFloor <= 0) {
    throw new Error('banking action proposer survivalBalanceFloor must be positive finite');
  }
}

export type BankingDomainRuntimeConfig = {
  /** Overrides the survival balance floor of the proposer policy. */
  readonly survivalBalanceFloor?: number;
};

export type EnterpriseDomainRuntimeConfig = {
  /** Minimum balance the owner keeps before funding their own enterprise. */
  readonly fundingOwnerBalanceFloor?: number;
  /** Maximum headcount chosen by the Agent for a newly founded enterprise. */
  readonly foundingMaximumEmployees?: number;
  /** Number of open positions published after the enterprise proves demand. */
  readonly hiringOpenSlots?: number;
};

const DEFAULT_ENTERPRISE_FUNDING_OWNER_BALANCE_FLOOR = 100;
export const ENTERPRISE_ACTION_PROPOSER_POLICY_VERSION = 'enterprise-action-proposer-v3';
export type EnterpriseActionProposerPolicy = {
  readonly policyVersion: string;
  readonly ownerBalanceFloor: number;
  readonly targetResidentsPerFirm: number;
  readonly minimumResidentsForFounding: number;
  readonly payrollReserveCycles: number;
  readonly foundingMaximumEmployees: number;
  readonly hiringOpenSlots: number;
};

export const DEFAULT_ENTERPRISE_ACTION_PROPOSER_POLICY: EnterpriseActionProposerPolicy = {
  policyVersion: ENTERPRISE_ACTION_PROPOSER_POLICY_VERSION,
  ownerBalanceFloor: DEFAULT_ENTERPRISE_FUNDING_OWNER_BALANCE_FLOOR,
  targetResidentsPerFirm: 8,
  minimumResidentsForFounding: 2,
  payrollReserveCycles: 1,
  foundingMaximumEmployees: 3,
  hiringOpenSlots: 1,
};

export function assertValidEnterpriseActionProposerPolicy(
  policy: EnterpriseActionProposerPolicy,
): void {
  if (policy.policyVersion.trim().length === 0) {
    throw new Error('enterprise action proposer policyVersion must not be empty');
  }
  for (const [name, value] of [
    ['ownerBalanceFloor', policy.ownerBalanceFloor],
    ['targetResidentsPerFirm', policy.targetResidentsPerFirm],
    ['payrollReserveCycles', policy.payrollReserveCycles],
  ] as const) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`enterprise action proposer ${name} must be positive finite`);
    }
  }
  if (!Number.isInteger(policy.foundingMaximumEmployees) || policy.foundingMaximumEmployees <= 0) {
    throw new Error('enterprise action proposer foundingMaximumEmployees must be positive integer');
  }
  if (
    !Number.isInteger(policy.minimumResidentsForFounding) ||
    policy.minimumResidentsForFounding <= 0
  ) {
    throw new Error(
      'enterprise action proposer minimumResidentsForFounding must be positive integer',
    );
  }
  if (!Number.isInteger(policy.hiringOpenSlots) || policy.hiringOpenSlots <= 0) {
    throw new Error('enterprise action proposer hiringOpenSlots must be positive integer');
  }
}

export function createEnterpriseActionProposerPolicyManifest() {
  return {
    ...DEFAULT_ENTERPRISE_ACTION_PROPOSER_POLICY,
    founderElection: 'highest-balance-eligible-agent-then-agent-id' as const,
    capitalRule: 'surplus-above-owner-balance-floor-clamped-to-domain-policy' as const,
    hiringGate: 'realized-sales-plus-payroll-reserve-plus-capacity' as const,
  };
}

/**
 * Deterministic survival-bridge loan proposal. All gates are rigid: a bank
 * must exist, an active physiological need (the same energy/satiety/health
 * bands objective renewal uses), a positive balance gap under the proposer
 * floor, a free concurrency slot, and a credit limit that covers the whole
 * gap. Any gate failing means no nomination — the agent falls back to
 * observe, never to "borrow because the limit exists".
 */
export function resolveBankingLoanProposal(input: {
  readonly context: WorkerDomainRuntimeFactoryInput;
  readonly selectedSubtask: PrioritizedSubtask;
  readonly creditPolicy: NonNullable<WorldCommandPolicies['credit']>;
  readonly proposerPolicy: BankingActionProposerPolicy;
}): AtomicActionProposal<'AgentRequestLoan', AgentRequestLoanPayload> | undefined {
  const bank = input.context.projection.bank;
  if (bank === undefined) {
    return undefined;
  }
  const agent = input.context.agent;
  const physiologyNeed =
    agent.physiology.energy < 30 || agent.physiology.satiety < 30 || agent.physiology.health < 50;
  if (!physiologyNeed) {
    return undefined;
  }
  const gap = input.proposerPolicy.survivalBalanceFloor - agent.balance;
  if (!(gap > 0)) {
    return undefined;
  }
  if (activeLoansByBorrower(bank, agent.agentId).length >= input.creditPolicy.maxLoansPerAgent) {
    return undefined;
  }
  const maxLoanAmount = resolveCreditLimit({
    history: bank.creditHistoryByAgent[agent.agentId],
    policy: input.creditPolicy,
  });
  if (maxLoanAmount < gap) {
    return undefined;
  }
  return {
    id: `${createCanonicalActionId('banking', input.selectedSubtask)}-survival-loan`,
    description: `Request a bank bridge loan of ${Math.ceil(gap)} to cover the survival shortfall.`,
    commandType: 'AgentRequestLoan',
    priority: input.selectedSubtask.score,
    payload: { amount: Math.ceil(gap) },
  };
}

/**
 * Deterministic employment proposal: join the alphabetically-first active
 * enterprise the agent neither works for nor owns, that posts open slots and
 * still has employee headroom.
 */
export function resolveEnterpriseJoinProposal(input: {
  readonly context: WorkerDomainRuntimeFactoryInput;
  readonly selectedSubtask: PrioritizedSubtask;
}): AtomicActionProposal<'AgentJoinEnterprise', AgentJoinEnterprisePayload> | undefined {
  const agent = input.context.agent;
  const candidate = Object.values(input.context.projection.enterprises)
    .filter((enterprise) => enterprise.status === 'active')
    .filter((enterprise) => {
      const occupationRule = input.context.worldDecisionContext?.rules?.occupations.find(
        (rule) => rule.occupationName === enterprise.occupationName,
      );
      return isEnterpriseOccupationQualified(occupationRule);
    })
    .filter(
      (enterprise) =>
        enterprise.ownerAgentId !== agent.agentId &&
        !enterprise.employeeAgentIds.includes(agent.agentId),
    )
    .filter((enterprise) => (enterprise.jobPosting?.openSlots ?? 0) > 0)
    .filter((enterprise) => enterprise.employeeAgentIds.length < enterprise.maxEmployees)
    .sort((left, right) => left.enterpriseId.localeCompare(right.enterpriseId))[0];
  if (candidate === undefined) {
    return undefined;
  }
  return {
    id: `${createCanonicalActionId('enterprise', input.selectedSubtask)}-join`,
    description: `Join ${candidate.name} — it is hiring with ${candidate.jobPosting?.openSlots} open slot(s).`,
    commandType: 'AgentJoinEnterprise',
    priority: input.selectedSubtask.score,
    payload: { enterpriseId: candidate.enterpriseId },
  };
}

/**
 * Endogenous firm ignition. The strategy elects at most one founder from the
 * current authoritative projection while firm density is below its target.
 * Capital and headcount are clamped to the external enterprise policy; the
 * aggregate validates the same constraints again at settlement.
 */
export function resolveEnterpriseFoundingProposal(input: {
  readonly context: WorkerDomainRuntimeFactoryInput;
  readonly selectedSubtask: PrioritizedSubtask;
  readonly enterprisePolicy: NonNullable<WorldCommandPolicies['enterprise']>;
  readonly proposerPolicy: EnterpriseActionProposerPolicy;
}): AtomicActionProposal<'AgentFoundEnterprise', AgentFoundEnterprisePayload> | undefined {
  if (!hasEnterpriseIntent(input, 'found')) {
    return undefined;
  }
  const operationalEnterprises = Object.values(input.context.projection.enterprises).filter(
    (enterprise) => enterprise.status === 'active' || enterprise.status === 'insolvent',
  );
  if (
    Object.keys(input.context.projection.agents).length <
    input.proposerPolicy.minimumResidentsForFounding
  ) {
    return undefined;
  }
  const targetEnterpriseCount = Math.max(
    1,
    Math.ceil(
      Object.keys(input.context.projection.agents).length /
        input.proposerPolicy.targetResidentsPerFirm,
    ),
  );
  if (operationalEnterprises.length >= targetEnterpriseCount) {
    return undefined;
  }
  const minimumFounderBalance =
    input.proposerPolicy.ownerBalanceFloor + input.enterprisePolicy.minimumInitialCapital;
  const selectedFounder = resolveEnterpriseFounderAgentId({
    projection: input.context.projection,
    minimumFounderBalance,
  });
  if (selectedFounder !== input.context.agent.agentId) {
    return undefined;
  }
  const founder = input.context.agent;
  const initialCapital = Math.min(
    input.enterprisePolicy.maximumInitialCapital,
    Math.floor(founder.balance - input.proposerPolicy.ownerBalanceFloor),
  );
  if (initialCapital < input.enterprisePolicy.minimumInitialCapital) {
    return undefined;
  }
  const enterpriseId = createAgentEnterpriseId(founder.agentId);
  const maxEmployees = Math.min(
    input.enterprisePolicy.maximumEmployees,
    input.proposerPolicy.foundingMaximumEmployees,
  );
  return {
    id: `${createCanonicalActionId('enterprise', input.selectedSubtask)}-found`,
    description: `Found ${enterpriseId} with ${initialCapital} capital.`,
    commandType: 'AgentFoundEnterprise',
    priority: input.selectedSubtask.score,
    payload: {
      enterpriseId,
      name: `${founder.registration?.displayName ?? founder.agentId} Works`,
      occupationName: DEFAULT_OCCUPATION_NAME,
      initialCapital,
      maxEmployees,
    },
  };
}

export function resolveEnterpriseJobPostingProposal(input: {
  readonly context: WorkerDomainRuntimeFactoryInput;
  readonly selectedSubtask: PrioritizedSubtask;
  readonly proposerPolicy: EnterpriseActionProposerPolicy;
}):
  | AtomicActionProposal<'AgentSetEnterpriseJobPosting', AgentSetEnterpriseJobPostingPayload>
  | undefined {
  if (!hasEnterpriseIntent(input, 'hire')) {
    return undefined;
  }
  const enterprise = Object.values(input.context.projection.enterprises)
    .filter(
      (candidate) =>
        candidate.ownerAgentId === input.context.agent.agentId && candidate.status === 'active',
    )
    .sort((left, right) => left.enterpriseId.localeCompare(right.enterpriseId))[0];
  if (
    enterprise === undefined ||
    enterprise.cumulativeSales <= 0 ||
    (enterprise.jobPosting?.openSlots ?? 0) > enterprise.employeeAgentIds.length
  ) {
    return undefined;
  }
  const occupation = input.context.worldDecisionContext?.rules?.occupations.find(
    (candidate) => candidate.occupationName === enterprise.occupationName,
  );
  const wageOffer = occupation?.currentWage ?? occupation?.baseWage;
  const openSlots = Math.min(
    enterprise.maxEmployees,
    enterprise.employeeAgentIds.length + input.proposerPolicy.hiringOpenSlots,
  );
  if (
    wageOffer === undefined ||
    wageOffer <= 0 ||
    openSlots <= 0 ||
    enterprise.balance < wageOffer * input.proposerPolicy.payrollReserveCycles
  ) {
    return undefined;
  }
  return {
    id: `${createCanonicalActionId('enterprise', input.selectedSubtask)}-post-job`,
    description: `Publish ${openSlots} ${enterprise.occupationName} opening(s) at ${enterprise.name}.`,
    commandType: 'AgentSetEnterpriseJobPosting',
    priority: input.selectedSubtask.score,
    payload: { enterpriseId: enterprise.enterpriseId, wageOffer, openSlots },
  };
}

/**
 * Deterministic funding proposal: the owner of an active enterprise funds it
 * with everything above the configured owner-balance floor.
 */
export function resolveEnterpriseFundProposal(input: {
  readonly context: WorkerDomainRuntimeFactoryInput;
  readonly selectedSubtask: PrioritizedSubtask;
  readonly fundingOwnerBalanceFloor: number;
}): AtomicActionProposal<'AgentFundEnterprise', AgentFundEnterprisePayload> | undefined {
  const agent = input.context.agent;
  const owned = Object.values(input.context.projection.enterprises)
    .filter(
      (enterprise) => enterprise.ownerAgentId === agent.agentId && enterprise.status === 'active',
    )
    .sort((left, right) => left.enterpriseId.localeCompare(right.enterpriseId))[0];
  if (owned === undefined) {
    return undefined;
  }
  const fundable = agent.balance - input.fundingOwnerBalanceFloor;
  if (!(fundable > 0)) {
    return undefined;
  }
  return {
    id: `${createCanonicalActionId('enterprise', input.selectedSubtask)}-fund`,
    description: `Invest ${Math.floor(fundable)} of surplus balance into ${owned.name}.`,
    commandType: 'AgentFundEnterprise',
    priority: input.selectedSubtask.score,
    payload: { enterpriseId: owned.enterpriseId, amount: Math.floor(fundable) },
  };
}

export function createBankingDomainRuntimeRegistration(
  config: BankingDomainRuntimeConfig = {},
  creditPolicy?: WorldCommandPolicies['credit'],
): WorkerDomainRuntimeRegistration {
  const proposerPolicy: BankingActionProposerPolicy = {
    ...DEFAULT_BANKING_ACTION_PROPOSER_POLICY,
    ...(config.survivalBalanceFloor === undefined
      ? {}
      : { survivalBalanceFloor: config.survivalBalanceFloor }),
  };
  assertValidBankingActionProposerPolicy(proposerPolicy);
  return {
    domain: 'banking',
    createMicroPlanners: (context) => [
      createContextualDomainMicroPlanner({
        domain: 'banking',
        context,
        planRecord: context.planRecord,
        resolveTargetLocationId: () => DEFAULT_DOMAIN_LOCATION_IDS.banking,
        propose: (selectedSubtask) => {
          if (creditPolicy !== undefined) {
            const loanProposal = resolveBankingLoanProposal({
              context,
              selectedSubtask,
              creditPolicy,
              proposerPolicy,
            });
            if (loanProposal !== undefined) {
              return loanProposal;
            }
          }
          return {
            id: createCanonicalActionId('banking', selectedSubtask),
            description: `Check the bank's rates before ${selectedSubtask.description}.`,
            commandType: 'AgentObserveLocation',
            priority: selectedSubtask.score,
            payload: { focus: selectedSubtask.description },
          };
        },
      }),
    ],
  };
}

export function createEnterpriseDomainRuntimeRegistration(
  config: EnterpriseDomainRuntimeConfig = {},
  enterprisePolicy?: WorldCommandPolicies['enterprise'],
): WorkerDomainRuntimeRegistration {
  const fundingOwnerBalanceFloor =
    config.fundingOwnerBalanceFloor ?? DEFAULT_ENTERPRISE_FUNDING_OWNER_BALANCE_FLOOR;
  const proposerPolicy: EnterpriseActionProposerPolicy = {
    ...DEFAULT_ENTERPRISE_ACTION_PROPOSER_POLICY,
    ownerBalanceFloor: fundingOwnerBalanceFloor,
    ...(config.foundingMaximumEmployees === undefined
      ? {}
      : { foundingMaximumEmployees: config.foundingMaximumEmployees }),
    ...(config.hiringOpenSlots === undefined ? {} : { hiringOpenSlots: config.hiringOpenSlots }),
  };
  assertValidEnterpriseActionProposerPolicy(proposerPolicy);
  return {
    domain: 'enterprise',
    createMicroPlanners: (context) => [
      createContextualDomainMicroPlanner({
        domain: 'enterprise',
        context,
        planRecord: context.planRecord,
        resolveTargetLocationId: () => DEFAULT_DOMAIN_LOCATION_IDS.enterprise,
        propose: (selectedSubtask) => {
          if (enterprisePolicy !== undefined) {
            const foundingIntent = hasEnterpriseIntent({ context, selectedSubtask }, 'found');
            const foundingProposal = resolveEnterpriseFoundingProposal({
              context,
              selectedSubtask,
              enterprisePolicy,
              proposerPolicy,
            });
            if (foundingProposal !== undefined) {
              return foundingProposal;
            }
            if (foundingIntent) {
              return {
                id: `${createCanonicalActionId('enterprise', selectedSubtask)}-found-observe`,
                description: 'Recheck capital and town firm density before founding.',
                commandType: 'AgentObserveLocation',
                priority: selectedSubtask.score,
                payload: { focus: 'enterprise founding eligibility' },
              };
            }
            const hiringIntent = hasEnterpriseIntent({ context, selectedSubtask }, 'hire');
            const postingProposal = resolveEnterpriseJobPostingProposal({
              context,
              selectedSubtask,
              proposerPolicy,
            });
            if (postingProposal !== undefined) {
              return postingProposal;
            }
            const ownsOperationalEnterprise = Object.values(context.projection.enterprises).some(
              (enterprise) =>
                enterprise.ownerAgentId === context.agent.agentId &&
                (enterprise.status === 'active' || enterprise.status === 'insolvent'),
            );
            if (hiringIntent && ownsOperationalEnterprise) {
              return {
                id: `${createCanonicalActionId('enterprise', selectedSubtask)}-hiring-observe`,
                description: 'Recheck sales, capacity, and payroll reserves before hiring.',
                commandType: 'AgentObserveLocation',
                priority: selectedSubtask.score,
                payload: { focus: 'enterprise hiring eligibility' },
              };
            }
            const joinProposal = resolveEnterpriseJoinProposal({ context, selectedSubtask });
            if (joinProposal !== undefined) {
              return joinProposal;
            }
            if (hiringIntent) {
              return {
                id: `${createCanonicalActionId('enterprise', selectedSubtask)}-hiring-observe`,
                description: 'Recheck open enterprise positions and occupation qualifications.',
                commandType: 'AgentObserveLocation',
                priority: selectedSubtask.score,
                payload: { focus: 'enterprise employment eligibility' },
              };
            }
            const fundProposal = resolveEnterpriseFundProposal({
              context,
              selectedSubtask,
              fundingOwnerBalanceFloor,
            });
            if (fundProposal !== undefined) {
              return fundProposal;
            }
          }
          return {
            id: createCanonicalActionId('enterprise', selectedSubtask),
            description: `Observe the town's enterprises before ${selectedSubtask.description}.`,
            commandType: 'AgentObserveLocation',
            priority: selectedSubtask.score,
            payload: { focus: selectedSubtask.description },
          };
        },
      }),
    ],
  };
}

function hasEnterpriseIntent(
  input: {
    readonly context: WorkerDomainRuntimeFactoryInput;
    readonly selectedSubtask?: PrioritizedSubtask;
  },
  kind: 'found' | 'hire',
): boolean {
  const pattern =
    kind === 'found'
      ? /\b(?:found|start|create|launch)\b.*\b(?:enterprise|business|firm)\b|\benterprise-founder\b/u
      : /\b(?:hire|hiring|recruit|job posting|open position)\b|\benterprise-hiring\b/u;
  return collectContextualTargetTexts(input).some((text) => pattern.test(text.toLowerCase()));
}

function createAgentEnterpriseId(agentId: AgentId): string {
  const safeAgentId = agentId.replace(/[^A-Za-z0-9._:-]/g, '-').slice(0, 80) || 'agent';
  let hash = 2_166_136_261;
  for (const character of agentId) {
    hash = Math.imul(hash ^ character.codePointAt(0)!, 16_777_619) >>> 0;
  }
  return `enterprise-${safeAgentId}-${hash.toString(16).padStart(8, '0')}`;
}

export function resolveEnterpriseFounderAgentId(input: {
  readonly projection: WorkerDomainRuntimeFactoryInput['projection'];
  readonly minimumFounderBalance: number;
}): AgentId | undefined {
  const operationalEnterprises = Object.values(input.projection.enterprises).filter(
    (enterprise) => enterprise.status === 'active' || enterprise.status === 'insolvent',
  );
  return Object.values(input.projection.agents)
    .filter((agent) => agent.balance >= input.minimumFounderBalance)
    .filter(
      (agent) =>
        !operationalEnterprises.some((enterprise) => enterprise.ownerAgentId === agent.agentId),
    )
    .sort(
      (left, right) => right.balance - left.balance || left.agentId.localeCompare(right.agentId),
    )[0]?.agentId;
}

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
  return (
    Object.values(resolveVisibleMarketPools(context))
      .map((pool) => pool.commodity)
      .sort((left, right) => left.localeCompare(right))[0] ?? DEFAULT_TRADE_COMMODITY
  );
}

function resolveContextualTradeSide(input: {
  readonly context: WorkerDomainRuntimeFactoryInput;
  readonly selectedSubtask?: PrioritizedSubtask;
}): 'buy' | 'sell' {
  for (const text of collectContextualTargetTexts(input)) {
    const tokens = new Set(tokenizeText(text));
    if (tokens.has('sell') || tokens.has('export')) {
      return 'sell';
    }
    if (tokens.has('buy') || tokens.has('purchase') || tokens.has('import')) {
      return 'buy';
    }
  }
  return DEFAULT_TRADE_SIDE;
}

function resolveContextualTradeCommodityName(input: {
  readonly context: WorkerDomainRuntimeFactoryInput;
  readonly selectedSubtask?: PrioritizedSubtask;
}): string | undefined {
  const visibleCommodities = new Set(
    Object.values(resolveVisibleMarketPools(input.context)).map((pool) => pool.commodity),
  );
  for (const text of collectContextualTargetTexts(input)) {
    const commodity = findMatchingTargetNamesInText(text, COMMODITY_TARGETS).find((candidate) =>
      visibleCommodities.has(candidate),
    );
    if (commodity !== undefined) {
      return commodity;
    }
  }
  return undefined;
}

function resolveVisibleMarketPools(
  context: WorkerDomainRuntimeFactoryInput,
): Readonly<Record<string, Parameters<typeof buyFromPool>[0]>> {
  return resolveAgentMarketPools({
    projection: context.projection,
    agent: context.agent,
    ...(context.marketOverride === undefined
      ? {}
      : { override: context.marketOverride.marketPools }),
  });
}

function resolveVisibleMarketPool(
  context: WorkerDomainRuntimeFactoryInput,
  commodityName: string,
): Parameters<typeof buyFromPool>[0] | undefined {
  return Object.entries(resolveVisibleMarketPools(context))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, pool]) => pool)
    .find((pool) => pool.commodity === commodityName);
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

  const pool = resolveVisibleMarketPool(input.context, input.commodityName);
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

function resolveHousingConstructionProposal(input: {
  readonly context: WorkerDomainRuntimeFactoryInput;
  readonly selectedSubtask: PrioritizedSubtask;
  readonly policy?: WorldCommandPolicies['housingConstruction'];
}): AtomicActionProposal<'AgentBuildHousing', AgentBuildHousingPayload> | undefined {
  const policy = input.policy;
  const locationId = resolveHousingConstructionLocationId(input.context, policy);
  const housing = input.context.worldDecisionContext?.society?.housing;
  if (
    policy === undefined ||
    housing === undefined ||
    locationId === undefined ||
    housing.occupancyRatio < policy.minimumOccupancyRatio
  ) {
    return undefined;
  }
  const hasRequiredInventory = (inventory: Readonly<Record<string, number>>) =>
    Object.entries(policy.inventoryCosts).every(
      ([itemName, quantity]) => (inventory[itemName] ?? 0) >= quantity,
    );
  const electedBuilder = Object.values(input.context.projection.agents)
    .filter((candidate) => hasRequiredInventory(candidate.inventory))
    .sort((left, right) => left.agentId.localeCompare(right.agentId))[0];
  if (electedBuilder?.agentId !== input.context.agent.agentId) {
    return undefined;
  }
  return {
    id: `${createCanonicalActionId('residential', input.selectedSubtask)}-build`,
    description: `Expand housing at ${locationId} while occupancy is ${Math.round(housing.occupancyRatio * 100)}%.`,
    commandType: 'AgentBuildHousing',
    priority: input.selectedSubtask.score,
    payload: { locationId },
    resourceEstimate: { inventoryCosts: { ...policy.inventoryCosts } },
  };
}

function resolveHousingConstructionLocationId(
  context: WorkerDomainRuntimeFactoryInput,
  policy?: WorldCommandPolicies['housingConstruction'],
): LocationId | undefined {
  if (policy === undefined) {
    return undefined;
  }
  return context.worldDecisionContext?.society?.housing?.residences
    .filter((residence) => residence.capacity < policy.maximumLocationCapacity)
    .sort(
      (left, right) =>
        left.capacity - right.capacity || left.locationId.localeCompare(right.locationId),
    )
    .map((residence) => asLocationId(residence.locationId))[0];
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
  readonly inventory?: Readonly<Record<string, number>>;
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
  readonly inventory?: Readonly<Record<string, number>>;
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
    inventory: input.inventory ?? agent.inventory,
    educationScore: agent.educationScore,
    ...(educationLevel === undefined ? {} : { educationLevel }),
  };
}

function createProductionStepResourceEstimate(
  step: ProductionChainStep,
  enterpriseOwnedInventory = false,
): ActionResourceEstimate {
  return {
    actionSeconds: step.laborSeconds,
    energyCost: step.energyCost,
    satietyCost: step.satietyCost,
    ...(enterpriseOwnedInventory || Object.keys(step.consumedInputs).length === 0
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
  readonly inventory?: Readonly<Record<string, number>>;
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
      ...(input.inventory !== undefined || Object.keys(productionPlan.consumedInputs).length === 0
        ? {}
        : { inventoryCosts: productionPlan.consumedInputs }),
    },
  };
}

function resolveEnterpriseForOperationalAction(input: {
  readonly context: WorkerDomainRuntimeFactoryInput;
  readonly selectedSubtask?: PrioritizedSubtask;
}) {
  const hasEnterpriseIntent = collectContextualTargetTexts(input).some((text) =>
    tokenizeText(text).includes('enterprise'),
  );
  if (!hasEnterpriseIntent) {
    return undefined;
  }
  return Object.values(input.context.projection.enterprises)
    .filter((enterprise) => enterprise.status === 'active' || enterprise.status === 'insolvent')
    .filter(
      (enterprise) =>
        enterprise.ownerAgentId === input.context.agent.agentId ||
        enterprise.employeeAgentIds.includes(input.context.agent.agentId),
    )
    .sort((left, right) => left.enterpriseId.localeCompare(right.enterpriseId))[0];
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
