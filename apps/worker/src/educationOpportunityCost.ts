import type {
  ActionSequenceGenerator,
  AtomicActionProposal,
  WorldDecisionEducationOpportunityCostRule,
} from '@aivilization/agent-runtime';
import type { RuntimeProfileActivityAllocationKind } from '@aivilization/observability';
import { calculateEducationInvestmentRequirements } from '@aivilization/society';
import {
  EXCLUSIVE_AGENT_ACTIVITY_TIME_POLICY_VERSION,
  type WorldAgentState,
  type WorldCommandPolicies,
  type WorldEvent,
} from '@aivilization/world';

export const EDUCATION_OPPORTUNITY_COST_POLICY_VERSION = 'education-opportunity-cost-v2';
export const CANONICAL_EDUCATION_ACCUMULATION_POLICY_VERSION =
  'education-accumulation-v2';
export const CANONICAL_STUDY_DURATION_SECONDS = 1800;
export const CANONICAL_EDUCATION_RATE_PER_SECOND = 1 / 60;
export const CANONICAL_WORK_LABOR_SECONDS = 3600;
export const CANONICAL_TRADE_ACTIVITY_DURATION_SECONDS = 300;
export const CANONICAL_EDUCATION_MINIMUM_BALANCE_RESERVE = 50;
export const CANONICAL_ACTIONS_PER_DECISION = 1;
export const CANONICAL_CANDIDATE_SUBTASKS_PER_DECISION = 9;

export type EducationOpportunityCostConfig = {
  readonly studyDurationSeconds?: number;
  readonly educationRatePerSecond?: number;
  readonly workLaborSeconds?: number;
  readonly minimumBalanceReserve?: number;
};

export type ExecutedEducationOpportunityCostMetrics = {
  readonly metricVersion: 'executed-education-opportunity-cost-v1';
  readonly executedActivityAllocation: readonly {
    readonly activity: RuntimeProfileActivityAllocationKind;
    readonly actionCount: number;
    readonly activitySeconds: number;
  }[];
  readonly directStudyCurrencyCost: number;
  readonly activityTimeConflictRejectionCount: number;
};

export const CANONICAL_OPPORTUNITY_COST_ACTION_SYNTHESIS_CONFIG = {
  maxActions: CANONICAL_ACTIONS_PER_DECISION,
  candidateSubtasks: { maxSubtasks: CANONICAL_CANDIDATE_SUBTASKS_PER_DECISION },
} as const;

export function createEducationOpportunityCostRule(input: {
  readonly agent: WorldAgentState;
  readonly policies: WorldCommandPolicies;
  readonly config?: EducationOpportunityCostConfig;
}): WorldDecisionEducationOpportunityCostRule | undefined {
  const investmentPolicy = input.policies.educationInvestment;
  if (investmentPolicy === undefined) {
    return undefined;
  }
  const settings = resolveEducationOpportunityCostSettings(input.config);
  const requirements = calculateEducationInvestmentRequirements({
    studyDurationSeconds: settings.studyDurationSeconds,
    policy: investmentPolicy,
  });
  const currentOccupationName = input.agent.job;
  const currentOccupationWage =
    currentOccupationName === null ? 0 : input.policies.wageCalculator(currentOccupationName);
  assertNonNegativeFinite(currentOccupationWage, 'current occupation wage');
  const foregoneLaborIncome =
    currentOccupationWage * (settings.studyDurationSeconds / settings.workLaborSeconds);
  const balanceAfterDirectCost = input.agent.balance - requirements.currencyCost;
  const directlyAffordable =
    balanceAfterDirectCost >= 0 &&
    Object.entries(requirements.inventoryCosts).every(
      ([itemName, quantity]) => (input.agent.inventory[itemName] ?? 0) >= quantity,
    );

  return {
    policyVersion: EDUCATION_OPPORTUNITY_COST_POLICY_VERSION,
    studyDurationSeconds: settings.studyDurationSeconds,
    educationRatePerSecond: settings.educationRatePerSecond,
    expectedEducationGain: settings.studyDurationSeconds * settings.educationRatePerSecond,
    directCurrencyCost: requirements.currencyCost,
    directInventoryCosts: { ...requirements.inventoryCosts },
    workLaborSeconds: settings.workLaborSeconds,
    currentOccupationName,
    foregoneLaborIncome,
    totalCurrencyOpportunityCost: requirements.currencyCost + foregoneLaborIncome,
    minimumBalanceReserve: settings.minimumBalanceReserve,
    balanceAfterDirectCost,
    directlyAffordable,
    preservesMinimumBalanceReserve:
      directlyAffordable && balanceAfterDirectCost >= settings.minimumBalanceReserve,
  };
}

export function createCanonicalAgentAllocationPolicyManifest(
  config?: EducationOpportunityCostConfig,
) {
  const settings = resolveEducationOpportunityCostSettings(config);
  return {
    schemaVersion: 'canonical-agent-allocation-policy-v1',
    educationOpportunityCost: {
      policyVersion: EDUCATION_OPPORTUNITY_COST_POLICY_VERSION,
      accumulationPolicyVersion: CANONICAL_EDUCATION_ACCUMULATION_POLICY_VERSION,
      ...settings,
      accumulationRateSource:
        'repository-defined-one-education-point-per-study-minute;paper-specifies-fixed-eta-but-not-its-value',
      foregoneIncomeFormula: 'currentOccupationWage*studyDurationSeconds/workLaborSeconds',
    },
    actionSynthesis: {
      ...CANONICAL_OPPORTUNITY_COST_ACTION_SYNTHESIS_CONFIG,
      rule: 'one accepted action per decision across competing branch subtasks',
    },
    activityTime: {
      policyVersion: EXCLUSIVE_AGENT_ACTIVITY_TIME_POLICY_VERSION,
      mode: 'exclusive-per-agent',
      clock: 'simulation-time',
      settlementTiming: 'effects-at-commit',
      availabilityRule: 'nextActionAllowedWhenSimulationTime>=availableAt',
      tradeDurationSeconds: CANONICAL_TRADE_ACTIVITY_DURATION_SECONDS,
      lifecycleRule: 'complete-objective-and-schedule-next-action-only-after-availability',
    },
  } as const;
}

export function createEducationOpportunityCostAwareActionSequenceGenerator(
  generator: ActionSequenceGenerator,
): ActionSequenceGenerator {
  return async (input) => {
    const result = await generator(input);
    const opportunityCost = input.worldDecisionContext?.rules?.educationOpportunityCost;
    if (opportunityCost === undefined) {
      return result;
    }
    return {
      ...result,
      actions: result.actions.map((action) =>
        applyAuthoritativeStudyResourceEstimate(action, opportunityCost),
      ),
    };
  };
}

export function createExecutedEducationOpportunityCostMetrics(
  events: readonly WorldEvent[],
): ExecutedEducationOpportunityCostMetrics {
  const allocations = new Map<
    RuntimeProfileActivityAllocationKind,
    { readonly actionCount: number; readonly activitySeconds: number }
  >(
    EXECUTED_ACTIVITY_ALLOCATION_ORDER.map((activity) => [
      activity,
      { actionCount: 0, activitySeconds: 0 },
    ]),
  );
  let directStudyCurrencyCost = 0;
  let activityTimeConflictRejectionCount = 0;

  for (const event of events) {
    if (event.type === 'AgentActivityTimeCommitted') {
      incrementExecutedAllocation(
        allocations,
        classifyCommittedActivity(event.payload.activity),
        event.payload.durationSeconds,
      );
    }
    if (event.type === 'InventoryChanged' && event.payload.reason === 'eat') {
      incrementExecutedAllocation(allocations, 'consumption', 0);
    }
    if (event.type === 'EducationInvestmentPaid') {
      directStudyCurrencyCost += event.payload.currencyCost;
    }
    if (event.type === 'ActionRejected' && event.payload.reason.startsWith('agent is busy with ')) {
      activityTimeConflictRejectionCount += 1;
    }
  }

  return {
    metricVersion: 'executed-education-opportunity-cost-v1',
    executedActivityAllocation: EXECUTED_ACTIVITY_ALLOCATION_ORDER.map((activity) => {
      const allocation = allocations.get(activity);
      if (allocation === undefined) {
        throw new Error(`missing executed activity allocation bucket ${activity}`);
      }
      return { activity, ...allocation };
    }),
    directStudyCurrencyCost,
    activityTimeConflictRejectionCount,
  };
}

const EXECUTED_ACTIVITY_ALLOCATION_ORDER = [
  'study',
  'labor',
  'production',
  'consumption',
  'survival',
  'other',
] as const satisfies readonly RuntimeProfileActivityAllocationKind[];

function classifyCommittedActivity(
  activity: Extract<
    WorldEvent,
    { readonly type: 'AgentActivityTimeCommitted' }
  >['payload']['activity'],
): RuntimeProfileActivityAllocationKind {
  if (activity === 'education') {
    return 'study';
  }
  if (activity === 'labor') {
    return 'labor';
  }
  if (activity === 'production') {
    return 'production';
  }
  if (activity === 'trade') {
    return 'other';
  }
  return 'survival';
}

function incrementExecutedAllocation(
  allocations: Map<
    RuntimeProfileActivityAllocationKind,
    { readonly actionCount: number; readonly activitySeconds: number }
  >,
  activity: RuntimeProfileActivityAllocationKind,
  activitySeconds: number,
): void {
  const current = allocations.get(activity);
  if (current === undefined) {
    throw new Error(`missing executed activity allocation bucket ${activity}`);
  }
  allocations.set(activity, {
    actionCount: current.actionCount + 1,
    activitySeconds: current.activitySeconds + activitySeconds,
  });
}

function applyAuthoritativeStudyResourceEstimate(
  action: AtomicActionProposal,
  opportunityCost: WorldDecisionEducationOpportunityCostRule,
): AtomicActionProposal {
  if (action.commandType !== 'AgentStudy') {
    return action;
  }
  const durationSeconds = readStudyDurationSeconds(action.payload);
  if (durationSeconds === undefined) {
    return action;
  }
  const durationScale = durationSeconds / opportunityCost.studyDurationSeconds;
  return {
    ...action,
    resourceEstimate: {
      ...action.resourceEstimate,
      actionSeconds: durationSeconds,
      currencyCost: opportunityCost.directCurrencyCost * durationScale,
      inventoryCosts: Object.fromEntries(
        Object.entries(opportunityCost.directInventoryCosts).map(([itemName, quantity]) => [
          itemName,
          quantity * durationScale,
        ]),
      ),
    },
  };
}

function readStudyDurationSeconds(payload: unknown): number | undefined {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return undefined;
  }
  const durationSeconds = Reflect.get(payload, 'durationSeconds') as unknown;
  return typeof durationSeconds === 'number' &&
    Number.isFinite(durationSeconds) &&
    durationSeconds >= 0
    ? durationSeconds
    : undefined;
}

export function resolveEducationOpportunityCostSettings(
  config: EducationOpportunityCostConfig = {},
) {
  const settings = {
    studyDurationSeconds: config.studyDurationSeconds ?? CANONICAL_STUDY_DURATION_SECONDS,
    educationRatePerSecond: config.educationRatePerSecond ?? CANONICAL_EDUCATION_RATE_PER_SECOND,
    workLaborSeconds: config.workLaborSeconds ?? CANONICAL_WORK_LABOR_SECONDS,
    minimumBalanceReserve:
      config.minimumBalanceReserve ?? CANONICAL_EDUCATION_MINIMUM_BALANCE_RESERVE,
  };
  assertPositiveFinite(settings.studyDurationSeconds, 'studyDurationSeconds');
  assertNonNegativeFinite(settings.educationRatePerSecond, 'educationRatePerSecond');
  assertPositiveFinite(settings.workLaborSeconds, 'workLaborSeconds');
  assertNonNegativeFinite(settings.minimumBalanceReserve, 'minimumBalanceReserve');
  return settings;
}

function assertPositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be positive finite`);
  }
}

function assertNonNegativeFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be non-negative finite`);
  }
}
