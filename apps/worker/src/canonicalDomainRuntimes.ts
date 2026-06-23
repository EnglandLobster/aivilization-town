import type {
  ActionResourceEstimate,
  AtomicActionProposal,
  BranchPlanRecord,
  DomainMicroPlanner,
  PrioritizedSubtask,
} from '@aivilization/agent-runtime';
import { buyFromPool } from '@aivilization/economy';
import { asAgentId, type AgentId } from '@aivilization/sim-core';
import type {
  AgentApplyJobPayload,
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

export type CanonicalDomainName = 'study' | 'work' | 'trade' | 'sleep' | 'social';

export type StudyDomainRuntimeConfig = {
  readonly durationSeconds?: number;
  readonly educationRatePerSecond?: number;
};

export type WorkDomainRuntimeConfig = {
  readonly laborSeconds?: number;
  readonly defaultOccupationName?: string;
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

export type CanonicalDomainRuntimeConfig = {
  readonly study?: StudyDomainRuntimeConfig;
  readonly work?: WorkDomainRuntimeConfig;
  readonly trade?: TradeDomainRuntimeConfig;
  readonly sleep?: SleepDomainRuntimeConfig;
  readonly social?: SocialDomainRuntimeConfig;
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
            context.agent.job ?? config.defaultOccupationName ?? DEFAULT_OCCUPATION_NAME;
          if (context.agent.job === null) {
            return {
              id: createCanonicalActionId('work', selectedSubtask),
              description: `Apply for ${occupationName}.`,
              commandType: 'AgentApplyJob',
              priority: selectedSubtask.score,
              payload: { occupationName },
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
  | AtomicActionProposal<'AgentSocialize', AgentSocializePayload>;

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
  addTextTokens(input.selectedSubtask.description, tokens);

  const branch = input.planRecord.plan.branches.find(
    (candidate) => candidate.id === input.selectedSubtask.branchId,
  );
  if (branch !== undefined) {
    addTextTokens(branch.id, tokens);
    addTextTokens(branch.objective, tokens);
    const subtask = branch.subtasks.find(
      (candidate) => candidate.id === input.selectedSubtask.subtaskId,
    );
    if (subtask !== undefined) {
      addTextTokens(subtask.id, tokens);
      addTextTokens(subtask.description, tokens);
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
  for (const token of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (token.length > 0) {
      tokens.add(token);
    }
  }
}
