import {
  createBranchPlanProgress,
  hasSelectableSubtasks,
  normalizeStrategicPlanCompilerOutput,
  type BranchPlanProgressRepository,
  type BranchPlanRepository,
  type StrategicPlanCompiler,
  type StrategicPlanContextSnapshot,
  type StrategicPlanEducationInvestmentRegime,
  type StrategicPlanPhysiologyRegime,
  type WorldDecisionContext,
} from '@aivilization/agent-runtime';
import type {
  AgentIntentionRepository,
  LongTermAgentProfile,
  LongTermProfileRepository,
  LongTermProfileSection,
  ShortTermMemoryRepository,
} from '@aivilization/memory';
import type { AgentId } from '@aivilization/sim-core';
import type { WorldProjection } from '@aivilization/world';
import { summarizeObservedAgentState } from './agentStateSummary';
import type { EducationOpportunityCostConfig } from './educationOpportunityCost';
import {
  resolveWorldCommandPolicies,
  type WorldCommandPolicySource,
} from './worldCommandPolicySource';
import { createWorldDecisionContextFromProjection } from './worldDecisionContext';

export const STRATEGIC_PLAN_RENEWAL_POLICY_VERSION = 'strategic-plan-renewal-v3';

const DEFAULT_MEMORY_RETRIEVAL_LIMIT = 8;

export type StrategicPlanRenewalPolicy = {
  readonly policyVersion: string;
  readonly physiologyThresholds: {
    readonly energy: number;
    readonly satiety: number;
    readonly health: number;
  };
  readonly marketPriceIndexRelativeShiftThreshold: number;
  readonly strategicProfileMinConfidence: number;
  readonly strategicProfileSections: readonly LongTermProfileSection[];
};

export const DEFAULT_STRATEGIC_PLAN_RENEWAL_POLICY: StrategicPlanRenewalPolicy = {
  policyVersion: STRATEGIC_PLAN_RENEWAL_POLICY_VERSION,
  physiologyThresholds: {
    energy: 20,
    satiety: 20,
    health: 20,
  },
  marketPriceIndexRelativeShiftThreshold: 0.25,
  strategicProfileMinConfidence: 0.7,
  strategicProfileSections: ['beliefs', 'values', 'personality'],
};

export type StrategicPlanRenewalResult =
  | {
      readonly status: 'baseline-recorded';
      readonly agentId: AgentId;
      readonly planId: string;
      readonly strategicContext: StrategicPlanContextSnapshot;
    }
  | {
      readonly status: 'replanned';
      readonly agentId: AgentId;
      readonly planId: string;
      readonly reasons: readonly string[];
      readonly progressReset: boolean;
      readonly strategicContext: StrategicPlanContextSnapshot;
    };

export type AutonomousObjectiveSupersessionResult = {
  readonly status: 'superseded';
  readonly agentId: AgentId;
  readonly objectiveId: string;
  readonly reasons: readonly ['occupation-changed'];
};

export async function supersedeActiveAutonomousObjectivesForMajorContextShifts(input: {
  readonly projection: WorldProjection;
  readonly policies: WorldCommandPolicySource;
  readonly intentionRepository: AgentIntentionRepository;
  readonly longTermProfileRepository: LongTermProfileRepository;
  readonly planRepository: BranchPlanRepository;
  readonly issuedAt: number;
  readonly educationOpportunityCost?: EducationOpportunityCostConfig;
  readonly policy?: StrategicPlanRenewalPolicy;
}): Promise<readonly AutonomousObjectiveSupersessionResult[]> {
  const policy = input.policy ?? DEFAULT_STRATEGIC_PLAN_RENEWAL_POLICY;
  validatePolicy(policy);
  const policies = resolveWorldCommandPolicies({
    policies: input.policies,
    projection: input.projection,
  });
  const results: AutonomousObjectiveSupersessionResult[] = [];

  for (const agentId of Object.keys(input.projection.agents).sort()) {
    const agent = input.projection.agents[agentId];
    if (agent === undefined) continue;
    const intentionState = await input.intentionRepository.getOrCreate(agent.agentId);
    const objective = intentionState.activeObjective;
    if (objective === undefined || objective.source !== 'agent') continue;
    const existing = await input.planRepository.get({
      planId: objective.id,
      agentId: agent.agentId,
    });
    if (existing?.strategicContext === undefined) continue;
    const longTermProfile = await input.longTermProfileRepository.getOrCreate(agent.agentId);
    const current = createStrategicPlanContextSnapshot({
      worldDecisionContext: createWorldDecisionContextFromProjection({
        projection: input.projection,
        agentId: agent.agentId,
        policies,
        ...(input.educationOpportunityCost === undefined
          ? {}
          : { educationOpportunityCost: input.educationOpportunityCost }),
      }),
      longTermProfile,
      capturedAt: input.issuedAt,
      policy,
    });
    const reasons = detectStrategicPlanContextShift({
      previous: existing.strategicContext,
      current,
      policy,
    });
    if (!reasons.includes('occupation-changed')) continue;

    await input.intentionRepository.completeObjective(agent.agentId, {
      objectiveId: objective.id,
      completedAt: input.issuedAt,
      reason: 'superseded-by-major-context-shift',
      planId: existing.planId,
    });
    results.push({
      status: 'superseded',
      agentId: agent.agentId,
      objectiveId: objective.id,
      reasons: ['occupation-changed'],
    });
  }
  return results;
}

export async function renewActiveStrategicPlansForMajorContextShifts(input: {
  readonly projection: WorldProjection;
  readonly policies: WorldCommandPolicySource;
  readonly intentionRepository: AgentIntentionRepository;
  readonly longTermProfileRepository: LongTermProfileRepository;
  readonly shortTermMemoryRepository: ShortTermMemoryRepository;
  readonly planRepository: BranchPlanRepository;
  readonly planProgressRepository?: BranchPlanProgressRepository;
  readonly strategicPlanCompiler: StrategicPlanCompiler;
  readonly issuedAt: number;
  readonly memoryRetrievalLimit?: number;
  readonly educationOpportunityCost?: EducationOpportunityCostConfig;
  readonly policy?: StrategicPlanRenewalPolicy;
}): Promise<readonly StrategicPlanRenewalResult[]> {
  const policy = input.policy ?? DEFAULT_STRATEGIC_PLAN_RENEWAL_POLICY;
  validatePolicy(policy);
  const memoryRetrievalLimit = input.memoryRetrievalLimit ?? DEFAULT_MEMORY_RETRIEVAL_LIMIT;
  assertPositiveInteger(memoryRetrievalLimit, 'memoryRetrievalLimit');
  const policies = resolveWorldCommandPolicies({
    policies: input.policies,
    projection: input.projection,
  });
  const results: StrategicPlanRenewalResult[] = [];

  for (const agentId of Object.keys(input.projection.agents).sort()) {
    const agent = input.projection.agents[agentId];
    if (agent === undefined) {
      continue;
    }
    const intentionState = await input.intentionRepository.getOrCreate(agent.agentId);
    const objective = intentionState.activeObjective;
    if (objective === undefined) {
      continue;
    }
    const existing = await input.planRepository.get({
      planId: objective.id,
      agentId: agent.agentId,
    });
    if (existing === undefined) {
      continue;
    }
    const progress = await input.planProgressRepository?.get({
      planId: objective.id,
      agentId: agent.agentId,
    });
    if (progress !== undefined && !hasSelectableSubtasks({ plan: existing.plan, progress })) {
      // An accepted time-bearing action can finish its final subtask before its world effect lands.
      // Objective finalization owns this state; resetting progress here would replay the completed
      // action every time its pending effect changes a strategic context regime.
      continue;
    }

    const longTermProfile = await input.longTermProfileRepository.getOrCreate(agent.agentId);
    const worldDecisionContext = createWorldDecisionContextFromProjection({
      projection: input.projection,
      agentId: agent.agentId,
      policies,
      ...(input.educationOpportunityCost === undefined
        ? {}
        : { educationOpportunityCost: input.educationOpportunityCost }),
    });
    const strategicContext = createStrategicPlanContextSnapshot({
      worldDecisionContext,
      longTermProfile,
      capturedAt: input.issuedAt,
      policy,
    });
    if (existing.strategicContext === undefined) {
      await input.planRepository.save({
        ...existing,
        strategicContext,
        updatedAt: input.issuedAt,
      });
      results.push({
        status: 'baseline-recorded',
        agentId: agent.agentId,
        planId: objective.id,
        strategicContext,
      });
      continue;
    }

    const reasons = detectStrategicPlanContextShift({
      previous: existing.strategicContext,
      current: strategicContext,
      policy,
    });
    if (reasons.length === 0) {
      continue;
    }

    const shortTermMemoryContext = await input.shortTermMemoryRepository.retrieve({
      agentId: agent.agentId,
      limit: memoryRetrievalLimit,
      orderBy: 'provenance-importance',
    });
    const compiled = normalizeStrategicPlanCompilerOutput(
      await input.strategicPlanCompiler({
        objective,
        issuedAt: input.issuedAt,
        shortTermMemoryContext,
        longTermProfile,
        observedStateSummary: summarizeObservedAgentState(agent),
        worldDecisionContext,
      }),
    );
    await input.planRepository.save({
      planId: existing.planId,
      agentId: existing.agentId,
      plan: compiled.plan,
      ...(compiled.planningTrace === undefined ? {} : { planningTrace: compiled.planningTrace }),
      strategicContext,
      revision: {
        policyVersion: policy.policyVersion,
        trigger: 'major-context-shift',
        reasons,
        previousContext: existing.strategicContext,
        currentContext: strategicContext,
      },
      createdAt: existing.createdAt,
      updatedAt: input.issuedAt,
    });
    const progressReset = input.planProgressRepository !== undefined;
    if (input.planProgressRepository !== undefined) {
      await input.planProgressRepository.save(
        createBranchPlanProgress({
          planId: existing.planId,
          agentId: existing.agentId,
          createdAt: input.issuedAt,
        }),
      );
    }
    results.push({
      status: 'replanned',
      agentId: agent.agentId,
      planId: objective.id,
      reasons,
      progressReset,
      strategicContext,
    });
  }

  return results;
}

export function createStrategicPlanContextSnapshot(input: {
  readonly worldDecisionContext: WorldDecisionContext;
  readonly longTermProfile: LongTermAgentProfile;
  readonly capturedAt: number;
  readonly policy?: StrategicPlanRenewalPolicy;
}): StrategicPlanContextSnapshot {
  const policy = input.policy ?? DEFAULT_STRATEGIC_PLAN_RENEWAL_POLICY;
  validatePolicy(policy);
  assertFinite(input.capturedAt, 'capturedAt');
  return {
    policyVersion: policy.policyVersion,
    capturedAt: input.capturedAt,
    physiologyRegimes: resolvePhysiologyRegimes(input.worldDecisionContext, policy),
    job: input.worldDecisionContext.agent.job,
    residentialTier: input.worldDecisionContext.agent.residentialTier,
    eligibleOccupationNames: (input.worldDecisionContext.rules?.occupations ?? [])
      .filter((occupation) => occupation.eligible)
      .map((occupation) => occupation.occupationName)
      .sort(),
    educationInvestmentRegime: resolveEducationInvestmentRegime(input.worldDecisionContext),
    strategicProfileEntryVersions: createStrategicProfileEntryVersions(
      input.longTermProfile,
      policy,
    ),
    overallPriceIndex: input.worldDecisionContext.market.latestPriceIndex?.overall ?? null,
  };
}

export function detectStrategicPlanContextShift(input: {
  readonly previous: StrategicPlanContextSnapshot;
  readonly current: StrategicPlanContextSnapshot;
  readonly policy?: StrategicPlanRenewalPolicy;
}): readonly string[] {
  const policy = input.policy ?? DEFAULT_STRATEGIC_PLAN_RENEWAL_POLICY;
  validatePolicy(policy);
  const reasons: string[] = [];
  if (input.previous.policyVersion !== input.current.policyVersion) {
    reasons.push('policy-version-changed');
  }
  if (!sameStrings(input.previous.physiologyRegimes, input.current.physiologyRegimes)) {
    reasons.push('physiology-regime-changed');
  }
  if (input.previous.job !== input.current.job) {
    reasons.push('occupation-changed');
  }
  if (input.previous.residentialTier !== input.current.residentialTier) {
    reasons.push('residential-tier-changed');
  }
  if (!sameStrings(input.previous.eligibleOccupationNames, input.current.eligibleOccupationNames)) {
    reasons.push('occupation-eligibility-changed');
  }
  if (input.previous.educationInvestmentRegime !== input.current.educationInvestmentRegime) {
    reasons.push('education-investment-regime-changed');
  }
  if (
    !sameStrings(
      input.previous.strategicProfileEntryVersions,
      input.current.strategicProfileEntryVersions,
    )
  ) {
    reasons.push('strategic-profile-changed');
  }
  if (
    hasMarketRegimeShift(
      input.previous.overallPriceIndex,
      input.current.overallPriceIndex,
      policy.marketPriceIndexRelativeShiftThreshold,
    )
  ) {
    reasons.push('market-price-regime-changed');
  }
  return reasons;
}

export function createStrategicPlanRenewalPolicyManifest(
  policy: StrategicPlanRenewalPolicy = DEFAULT_STRATEGIC_PLAN_RENEWAL_POLICY,
) {
  validatePolicy(policy);
  return {
    policyVersion: policy.policyVersion,
    physiologyThresholds: { ...policy.physiologyThresholds },
    marketPriceIndexRelativeShiftThreshold: policy.marketPriceIndexRelativeShiftThreshold,
    strategicProfileMinConfidence: policy.strategicProfileMinConfidence,
    strategicProfileSections: [...policy.strategicProfileSections],
    triggers: [
      'physiology-regime-changed',
      'occupation-changed',
      'residential-tier-changed',
      'occupation-eligibility-changed',
      'education-investment-regime-changed',
      'strategic-profile-changed',
      'market-price-regime-changed',
    ],
    nonTriggers: [
      'location-change',
      'ordinary-inventory-change',
      'ordinary-balance-change',
      'completed-plan-awaiting-objective-finalization',
    ],
    autonomousObjectiveSupersessionTriggers: ['occupation-changed'],
    supersessionReason: 'superseded-by-major-context-shift',
  } as const;
}

function resolvePhysiologyRegimes(
  context: WorldDecisionContext,
  policy: StrategicPlanRenewalPolicy,
): readonly StrategicPlanPhysiologyRegime[] {
  const regimes: StrategicPlanPhysiologyRegime[] = [];
  if (context.agent.physiology.energy <= policy.physiologyThresholds.energy) {
    regimes.push('low-energy');
  }
  if (context.agent.physiology.satiety <= policy.physiologyThresholds.satiety) {
    regimes.push('low-satiety');
  }
  if (context.agent.physiology.health <= policy.physiologyThresholds.health) {
    regimes.push('low-health');
  }
  return regimes.length === 0 ? ['stable'] : regimes;
}

function resolveEducationInvestmentRegime(
  context: WorldDecisionContext,
): StrategicPlanEducationInvestmentRegime {
  const education = context.rules?.educationOpportunityCost;
  if (education === undefined) {
    return 'unavailable';
  }
  if (!education.directlyAffordable) {
    return 'unaffordable';
  }
  return education.preservesMinimumBalanceReserve ? 'affordable' : 'reserve-breaking';
}

function createStrategicProfileEntryVersions(
  profile: LongTermAgentProfile,
  policy: StrategicPlanRenewalPolicy,
): readonly string[] {
  return policy.strategicProfileSections
    .flatMap((section) =>
      profile[section]
        .filter((entry) => entry.confidence >= policy.strategicProfileMinConfidence)
        .map(
          (entry) =>
            `${section}:${entry.key}:${entry.updatedAt}:${entry.confidence}:${entry.statement}`,
        ),
    )
    .sort();
}

function hasMarketRegimeShift(
  previous: number | null,
  current: number | null,
  threshold: number,
): boolean {
  if (previous === null || current === null) {
    return previous !== current;
  }
  if (previous === 0) {
    return current !== 0;
  }
  return Math.abs(current - previous) / Math.abs(previous) >= threshold;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function validatePolicy(policy: StrategicPlanRenewalPolicy): void {
  assertNonEmpty(policy.policyVersion, 'strategic plan renewal policyVersion');
  for (const threshold of Object.values(policy.physiologyThresholds)) {
    if (!Number.isFinite(threshold) || threshold < 0) {
      throw new Error('strategic plan renewal physiology thresholds must be non-negative finite');
    }
  }
  if (
    !Number.isFinite(policy.marketPriceIndexRelativeShiftThreshold) ||
    policy.marketPriceIndexRelativeShiftThreshold <= 0
  ) {
    throw new Error('strategic plan renewal market shift threshold must be positive finite');
  }
  if (
    !Number.isFinite(policy.strategicProfileMinConfidence) ||
    policy.strategicProfileMinConfidence < 0 ||
    policy.strategicProfileMinConfidence > 1
  ) {
    throw new Error('strategic plan renewal profile confidence must be between zero and one');
  }
  if (policy.strategicProfileSections.length === 0) {
    throw new Error('strategic plan renewal requires at least one strategic profile section');
  }
}

function assertNonEmpty(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${name} must be non-empty`);
  }
}

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be finite`);
  }
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
}
