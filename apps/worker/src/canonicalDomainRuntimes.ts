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
  type ProductionChainStep,
} from '@aivilization/economy';
import { asAgentId, type AgentId } from '@aivilization/sim-core';
import type {
  AgentApplyJobPayload,
  AgentProducePayload,
  AgentUpgradeResidentialTierPayload,
  AgentSleepPayload,
  AgentSocializePayload,
  AgentStudyPayload,
  AgentTradePayload,
  AgentWorkPayload,
  WorldCommandPolicies,
} from '@aivilization/world';
import type {
  WorkerDomainRuntimeFactoryInput,
  WorkerDomainRuntimeRegistration,
} from './domainRuntimeRegistry';

export type CanonicalDomainName =
  | 'study'
  | 'work'
  | 'trade'
  | 'sleep'
  | 'social'
  | 'production'
  | 'residential';

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

export type SocialDomainRuntimeConfig = {
  readonly targetAgentId?: AgentId;
  readonly summary?: string;
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
  readonly social?: SocialDomainRuntimeConfig;
  readonly production?: ProductionDomainRuntimeConfig;
  readonly residential?: ResidentialDomainRuntimeConfig;
};

const DEFAULT_STUDY_DURATION_SECONDS = 1800;
const DEFAULT_EDUCATION_RATE_PER_SECOND = 1;
const DEFAULT_WORK_LABOR_SECONDS = 3600;
const DEFAULT_OCCUPATION_NAME = 'Cleaner';
const DEFAULT_TRADE_SIDE = 'buy';
const DEFAULT_TRADE_QUANTITY = 1;
const DEFAULT_TRADE_COMMODITY = 'Apple';
const DEFAULT_SLEEP_DURATION_SECONDS = 28800;
const DEFAULT_SOCIAL_SUMMARY = 'Socialized during planned activity.';
const DEFAULT_SOCIAL_RELATION_DELTA = 1;
const DEFAULT_SOCIAL_ATTITUDE_DELTA = 1;
const DEFAULT_PRODUCTION_COMMODITY = 'Apple';
const DEFAULT_PRODUCTION_QUANTITY = 1;
const DEFAULT_PRODUCTION_AVAILABLE_LABOR_SECONDS = 3600;

export function createCanonicalDomainRuntimeRegistrations(
  config: CanonicalDomainRuntimeConfig = {},
  policies?: WorldCommandPolicies,
): readonly WorkerDomainRuntimeRegistration[] {
  return [
    createStudyDomainRuntimeRegistration(config.study),
    createWorkDomainRuntimeRegistration(config.work, policies?.laborCost),
    createTradeDomainRuntimeRegistration(config.trade),
    createSleepDomainRuntimeRegistration(config.sleep),
    createSocialDomainRuntimeRegistration(config.social),
    createProductionDomainRuntimeRegistration(config.production),
    createResidentialDomainRuntimeRegistration(
      config.residential,
      policies?.residentialTierUpgrade,
    ),
  ];
}

export function createStudyDomainRuntimeRegistration(
  config: StudyDomainRuntimeConfig = {},
): WorkerDomainRuntimeRegistration {
  return {
    domain: 'study',
    createMicroPlanners: (context) => [
      createContextualDomainMicroPlanner({
        domain: 'study',
        planRecord: context.planRecord,
        propose: (selectedSubtask) => ({
          id: createCanonicalActionId('study', selectedSubtask),
          description: `Study for ${selectedSubtask.description}.`,
          commandType: 'AgentStudy',
          priority: selectedSubtask.score,
          payload: {
            durationSeconds: config.durationSeconds ?? DEFAULT_STUDY_DURATION_SECONDS,
            educationRatePerSecond:
              config.educationRatePerSecond ?? DEFAULT_EDUCATION_RATE_PER_SECOND,
          },
          resourceEstimate: {
            actionSeconds: config.durationSeconds ?? DEFAULT_STUDY_DURATION_SECONDS,
          },
        }),
      }),
    ],
  };
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

          const laborSeconds = config.laborSeconds ?? DEFAULT_WORK_LABOR_SECONDS;
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
    createMicroPlanners: (context) => {
      const commodityName = config.commodityName ?? resolveFirstMarketCommodity(context);
      return [
        createContextualDomainMicroPlanner({
          domain: 'trade',
          planRecord: context.planRecord,
          propose: (selectedSubtask) => ({
            id: createCanonicalActionId('trade', selectedSubtask),
            description: `${config.side ?? DEFAULT_TRADE_SIDE} ${commodityName}.`,
            commandType: 'AgentTrade',
            priority: selectedSubtask.score,
            payload: {
              side: config.side ?? DEFAULT_TRADE_SIDE,
              commodityName,
              quantity: config.quantity ?? DEFAULT_TRADE_QUANTITY,
            },
            ...createTradeResourceEstimate({
              side: config.side ?? DEFAULT_TRADE_SIDE,
              commodityName,
              quantity: config.quantity ?? DEFAULT_TRADE_QUANTITY,
              context,
            }),
          }),
        }),
      ];
    },
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

export function createSocialDomainRuntimeRegistration(
  config: SocialDomainRuntimeConfig = {},
): WorkerDomainRuntimeRegistration {
  return {
    domain: 'social',
    createMicroPlanners: (context) => {
      const targetAgentId = resolveSocialTargetAgentId(context, config.targetAgentId);
      return [
        createContextualDomainMicroPlanner({
          domain: 'social',
          planRecord: context.planRecord,
          propose: (selectedSubtask) => ({
            id: createCanonicalActionId('social', selectedSubtask),
            description: `Socialize for ${selectedSubtask.description}.`,
            commandType: 'AgentSocialize',
            priority: selectedSubtask.score,
            payload: {
              targetAgentId,
              summary: config.summary ?? DEFAULT_SOCIAL_SUMMARY,
              relationDelta: config.relationDelta ?? DEFAULT_SOCIAL_RELATION_DELTA,
              attitudeDelta: config.attitudeDelta ?? DEFAULT_SOCIAL_ATTITUDE_DELTA,
            },
          }),
        }),
      ];
    },
  };
}

export function createProductionDomainRuntimeRegistration(
  config: ProductionDomainRuntimeConfig = {},
): WorkerDomainRuntimeRegistration {
  return {
    domain: 'production',
    createMicroPlanners: (context) => [
      createContextualDomainMicroPlanner({
        domain: 'production',
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

type ContextualDomainMicroPlannerInput = {
  readonly domain: CanonicalDomainName;
  readonly planRecord: BranchPlanRecord;
  readonly propose: (selectedSubtask: PrioritizedSubtask) => CanonicalActionProposal;
};

type CanonicalActionProposal =
  | AtomicActionProposal<'AgentStudy', AgentStudyPayload>
  | AtomicActionProposal<'AgentSleep', AgentSleepPayload>
  | AtomicActionProposal<'AgentWork', AgentWorkPayload>
  | AtomicActionProposal<'AgentApplyJob', AgentApplyJobPayload>
  | AtomicActionProposal<'AgentTrade', AgentTradePayload>
  | AtomicActionProposal<'AgentSocialize', AgentSocializePayload>
  | AtomicActionProposal<'AgentProduce', AgentProducePayload>
  | AtomicActionProposal<'AgentUpgradeResidentialTier', AgentUpgradeResidentialTierPayload>;

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
    propose: ({ selectedSubtask }) => [input.propose(selectedSubtask)],
  };
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
}): ProductionChainStep | undefined {
  const productionChain = planProductionChain({
    commodityName: input.commodityName,
    quantity: input.quantity,
    agent: {
      residentialTier: input.context.agent.residentialTier,
      energy: input.context.agent.physiology.energy,
      satiety: input.context.agent.physiology.satiety,
      availableLaborSeconds: input.availableLaborSeconds,
      inventory: input.context.agent.inventory,
    },
  });
  if (productionChain.status === 'rejected') {
    return undefined;
  }

  return productionChain.steps[0];
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
}): { readonly resourceEstimate?: ActionResourceEstimate } {
  const productionPlan = planProduction({
    commodityName: input.commodityName,
    quantity: input.quantity,
    agent: {
      residentialTier: input.context.agent.residentialTier,
      energy: input.context.agent.physiology.energy,
      satiety: input.context.agent.physiology.satiety,
      availableLaborSeconds: input.availableLaborSeconds,
      inventory: input.context.agent.inventory,
    },
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

function resolveSocialTargetAgentId(
  context: WorkerDomainRuntimeFactoryInput,
  configuredTargetAgentId: AgentId | undefined,
): AgentId {
  if (configuredTargetAgentId !== undefined) {
    return configuredTargetAgentId;
  }

  const targetAgentId = Object.keys(context.projection.agents)
    .filter((candidate) => candidate !== context.agentId)
    .sort()[0];
  if (targetAgentId === undefined) {
    throw new Error('social domain requires targetAgentId or another projected agent');
  }

  return asAgentId(targetAgentId);
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
