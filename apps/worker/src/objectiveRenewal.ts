import {
  compileStrategicObjectiveToBranchPlan,
  normalizeStrategicPlanCompilerOutput,
  type BranchPlanRecord,
  type BranchPlanProgressRepository,
  type BranchPlanRepository,
  type StrategicPlanCompilationTrace,
  type StrategicPlanCompiler,
  type WorldDecisionContext,
} from '@aivilization/agent-runtime';
import {
  getCompletedObjectiveCount,
  listAssertableBeliefs,
  selectActiveScheduledIntentions,
} from '@aivilization/memory';
import type {
  AgentIntentionRepository,
  AgentIntentionState,
  LongHorizonObjective,
  LongTermAgentProfile,
  LongTermProfileRepository,
  ScheduledIntention,
  ShortTermMemoryRecord,
  ShortTermMemoryRepository,
} from '@aivilization/memory';
import type { AgentId } from '@aivilization/sim-core';
import type { WorldAgentState, WorldProjection } from '@aivilization/world';
import { summarizeObservedAgentState } from './agentStateSummary';
import {
  createAutonomousLifeCourseCandidates,
  createAutonomousLifeCoursePolicyManifest,
  type AutonomousLifeCourseCandidate,
} from './autonomousLifeCourse';
import type { EducationOpportunityCostConfig } from './educationOpportunityCost';
import {
  DEFAULT_EXTERNAL_TRADE_ACTION_PROPOSER_POLICY,
  resolveEnterpriseExternalTradeOpportunity,
} from './externalTradePlanning';
import {
  resolveWorldCommandPolicies,
  type WorldCommandPolicySource,
} from './worldCommandPolicySource';
import { createWorldDecisionContextFromProjection } from './worldDecisionContext';
import {
  DEFAULT_BANKING_ACTION_PROPOSER_POLICY,
  DEFAULT_ENTERPRISE_ACTION_PROPOSER_POLICY,
  resolveEnterpriseFounderAgentId,
} from './canonicalDomainRuntimes';
import { createStrategicPlanContextSnapshot } from './strategicPlanRenewal';
import { publishPlanningSession } from './planningSessionPublication';
import { resolveAgentMarketPools } from './worldDecisionContext';
import { DEFAULT_SOCIAL_MATTER_ACTION_PROPOSER_POLICY } from './socialMatterPlanning';
import {
  DEFAULT_CONFLICT_ACTION_PROPOSER_POLICY,
  resolveAutonomousConflictIntent,
} from './conflictPlanning';
import { isEnterpriseOccupationQualified } from './enterprisePlanning';

const DEFAULT_OBJECTIVE_MEMORY_RETRIEVAL_LIMIT = 8;
export const AUTONOMOUS_OBJECTIVE_SELECTION_POLICY_VERSION = 'autonomous-objective-selection-v10';

const MARKET_PARTICIPATION_SCORE = 12;
const MARKET_BUY_MINIMUM_SPOT_PRICE_MULTIPLIER = 2;
const SOCIAL_IDENTITY_SCORE = 59;
const EXTERNAL_TRADE_OPPORTUNITY_SCORE = 85;
const SOCIAL_MATTER_ASSIGNEE_SCORE = 96;
const SOCIAL_MATTER_ASSIGNMENT_SCORE = 88;
const SOCIAL_MATTER_RESPONSE_SCORE = 54;
const SOCIAL_CONFLICT_INTERVENTION_SCORE = 91;
const SOCIAL_CONFLICT_ATTACK_SCORE = 74;
const SOCIAL_CONFLICT_CONFRONT_SCORE = 70;
const ENTERPRISE_FOUNDING_SCORE = 89;
const ENTERPRISE_HIRING_SCORE = 87;
const ENTERPRISE_SALE_SCORE = 86;
const ENTERPRISE_PRODUCTION_SCORE = 84;
const ENTERPRISE_JOIN_SCORE = 85;

export function createAutonomousObjectiveSelectionPolicyManifest() {
  return {
    policyVersion: AUTONOMOUS_OBJECTIVE_SELECTION_POLICY_VERSION,
    source: 'repository-design' as const,
    paperDefinesObjectiveCandidateScores: false as const,
    objectiveIdentity: 'agent-id-plus-issued-at-plus-durable-completed-objective-ordinal' as const,
    precedence:
      'physiology-recovery-scheduled-life-course-profile-legacy-fallback-balanced' as const,
    lifeCourse: createAutonomousLifeCoursePolicyManifest(),
    legacyFallback: {
      enabledOnlyWithoutUsableLifeCourseCandidates: true as const,
      score: MARKET_PARTICIPATION_SCORE,
      quantity: 1,
      sellRule: 'sell-one-owned-market-listed-commodity-before-buying' as const,
      buyRule: 'buy-one-agent-stable-affordable-market-listed-commodity' as const,
      minimumBalanceToSpotPriceMultiplier: MARKET_BUY_MINIMUM_SPOT_PRICE_MULTIPLIER,
      commodityTieBreak: 'stable-agent-id-hash-modulo-sorted-candidates' as const,
    },
    socialIdentity: {
      score: SOCIAL_IDENTITY_SCORE,
      cooldownRule: 'skip-while-retrieved-stm-contains-a-social-interaction',
      adverseAction: 'observe-and-verify-before-engaging',
      constructiveAction: 'maintain-cooperative-relationship',
    },
    externalTradeOpportunity: {
      score: EXTERNAL_TRADE_OPPORTUNITY_SCORE,
      quantity: 1,
      actorEligibility: 'operational-enterprise-owner-only',
      selection:
        'largest-relative-advantage-over-current-visible-regional-amm-then-stable-tie-break',
      proposerPolicyVersion: DEFAULT_EXTERNAL_TRADE_ACTION_PROPOSER_POLICY.policyVersion,
    },
    endogenousEnterprise: {
      proposerPolicyVersion: DEFAULT_ENTERPRISE_ACTION_PROPOSER_POLICY.policyVersion,
      foundingScore: ENTERPRISE_FOUNDING_SCORE,
      hiringScore: ENTERPRISE_HIRING_SCORE,
      saleScore: ENTERPRISE_SALE_SCORE,
      productionScore: ENTERPRISE_PRODUCTION_SCORE,
      joinScore: ENTERPRISE_JOIN_SCORE,
      founderElection: 'highest-balance-eligible-agent-then-agent-id',
      lifecycle: 'found-produce-sell-hire-employer-payroll',
    },
    socialMatterObligation: {
      proposerPolicyVersion: DEFAULT_SOCIAL_MATTER_ACTION_PROPOSER_POLICY.policyVersion,
      assigneeScore: SOCIAL_MATTER_ASSIGNEE_SCORE,
      assignmentScore: SOCIAL_MATTER_ASSIGNMENT_SCORE,
      responseScore: SOCIAL_MATTER_RESPONSE_SCORE,
      precedence: 'assigned-delivery-then-pending-assignment-then-capable-response',
    },
    socialConflict: {
      proposerPolicyVersion: DEFAULT_CONFLICT_ACTION_PROPOSER_POLICY.policyVersion,
      interventionScore: SOCIAL_CONFLICT_INTERVENTION_SCORE,
      attackScore: SOCIAL_CONFLICT_ATTACK_SCORE,
      confrontationScore: SOCIAL_CONFLICT_CONFRONT_SCORE,
      escalation: 'strained-relation-then-confrontation-then-distress-gated-attack',
    },
  };
}

export type AutonomousObjectiveProposerInput = {
  readonly agentId: AgentId;
  readonly agent: WorldAgentState;
  readonly projection: WorldProjection;
  readonly intentionState: AgentIntentionState;
  readonly longTermProfile: LongTermAgentProfile;
  readonly shortTermMemoryContext: readonly ShortTermMemoryRecord[];
  readonly issuedAt: number;
  readonly worldDecisionContext?: WorldDecisionContext;
};

export type ObjectiveRenewalDecisionTrace = {
  readonly agentId: AgentId;
  readonly objectiveId: string;
  readonly selectedCandidateId: string;
  readonly rationale: string;
  readonly score: number;
  readonly shortTermMemoryContextIds: readonly string[];
  readonly profileEntryKeys: readonly string[];
  readonly profileEvidenceRecordIds: readonly string[];
  readonly scheduledIntentionIds?: readonly string[];
  readonly strategicPlan?: StrategicPlanCompilationTrace;
  readonly issuedAt: number;
};

export type AutonomousObjectiveProposal = {
  readonly objective: LongHorizonObjective;
  readonly decisionTrace: ObjectiveRenewalDecisionTrace;
};

export type AutonomousObjectiveProposer = (
  input: AutonomousObjectiveProposerInput,
) =>
  | LongHorizonObjective
  | AutonomousObjectiveProposal
  | undefined
  | Promise<LongHorizonObjective | AutonomousObjectiveProposal | undefined>;

export type WorkerObjectiveRenewalTraceSink = {
  readonly record: (trace: ObjectiveRenewalDecisionTrace) => void | Promise<void>;
};

export type RenewedActiveObjectiveResult = {
  readonly agentId: AgentId;
  readonly objectiveId: string;
  readonly planId: string;
  readonly decisionTrace: ObjectiveRenewalDecisionTrace;
};

export function createDefaultAutonomousObjective(
  input: AutonomousObjectiveProposerInput,
): LongHorizonObjective {
  return createDefaultAutonomousObjectiveProposal(input).objective;
}

export function createDefaultAutonomousObjectiveProposal(
  input: AutonomousObjectiveProposerInput,
): AutonomousObjectiveProposal {
  const base = {
    id: createAutonomousObjectiveId(
      input.agentId,
      input.issuedAt,
      getCompletedObjectiveCount(input.intentionState) + 1,
    ),
    agentId: input.agentId,
    source: 'agent' as const,
    createdAt: input.issuedAt,
    updatedAt: input.issuedAt,
  };

  const candidates = scoreObjectiveCandidates(input);
  const selected = selectObjectiveCandidate({
    candidates,
    intentionState: input.intentionState,
  });

  const objective: LongHorizonObjective = {
    ...base,
    statement: selected.statement,
    priority: selected.priority,
    affinityTags: selected.affinityTags,
    ...(selected.planningDomains === undefined
      ? {}
      : { planningDomains: selected.planningDomains }),
  };

  return {
    objective,
    decisionTrace: {
      agentId: input.agentId,
      objectiveId: objective.id,
      selectedCandidateId: selected.id,
      rationale: selected.rationale,
      score: selected.score,
      shortTermMemoryContextIds: selected.shortTermMemoryContextIds,
      profileEntryKeys: selected.profileEntryKeys,
      profileEvidenceRecordIds: selected.profileEvidenceRecordIds,
      ...(selected.scheduledIntentionIds === undefined
        ? {}
        : { scheduledIntentionIds: selected.scheduledIntentionIds }),
      issuedAt: input.issuedAt,
    },
  };
}

export async function renewMissingActiveObjectives(input: {
  readonly projection: WorldProjection;
  readonly policies?: WorldCommandPolicySource;
  readonly intentionRepository: AgentIntentionRepository;
  readonly longTermProfileRepository: LongTermProfileRepository;
  readonly shortTermMemoryRepository: ShortTermMemoryRepository;
  readonly planRepository: BranchPlanRepository;
  readonly planProgressRepository?: BranchPlanProgressRepository;
  readonly issuedAt: number;
  readonly memoryRetrievalLimit?: number;
  readonly objectiveProposer?: AutonomousObjectiveProposer;
  readonly objectiveRenewalTraceSink?: WorkerObjectiveRenewalTraceSink;
  readonly strategicPlanCompiler?: StrategicPlanCompiler;
  readonly educationOpportunityCost?: EducationOpportunityCostConfig;
}): Promise<readonly RenewedActiveObjectiveResult[]> {
  const renewed: RenewedActiveObjectiveResult[] = [];
  const proposer = input.objectiveProposer ?? createDefaultAutonomousObjectiveProposal;
  const compile = input.strategicPlanCompiler ?? compileStrategicObjectiveToBranchPlan;
  const memoryRetrievalLimit =
    input.memoryRetrievalLimit ?? DEFAULT_OBJECTIVE_MEMORY_RETRIEVAL_LIMIT;
  assertPositiveInteger(memoryRetrievalLimit, 'memoryRetrievalLimit');
  const policies =
    input.policies === undefined
      ? undefined
      : resolveWorldCommandPolicies({
          policies: input.policies,
          projection: input.projection,
        });

  for (const agentId of Object.keys(input.projection.agents).sort()) {
    const agent = input.projection.agents[agentId];
    if (agent === undefined) {
      continue;
    }

    const intentionState = await input.intentionRepository.getOrCreate(agent.agentId);
    if (intentionState.activeObjective !== undefined) {
      continue;
    }

    const longTermProfile = await input.longTermProfileRepository.getOrCreate(agent.agentId);
    const shortTermMemoryContext = await input.shortTermMemoryRepository.retrieve({
      agentId: agent.agentId,
      limit: memoryRetrievalLimit,
      // Planning reads rank firsthand experience above hearsay (provenance slice).
      orderBy: 'provenance-importance',
    });
    const worldDecisionContext = createWorldDecisionContextFromProjection({
      projection: input.projection,
      agentId: agent.agentId,
      ...(policies === undefined ? {} : { policies }),
      ...(input.educationOpportunityCost === undefined
        ? {}
        : { educationOpportunityCost: input.educationOpportunityCost }),
    });
    const proposed = await proposer({
      agentId: agent.agentId,
      agent,
      projection: input.projection,
      intentionState,
      longTermProfile,
      shortTermMemoryContext,
      issuedAt: input.issuedAt,
      worldDecisionContext,
    });
    if (proposed === undefined) {
      continue;
    }
    const proposal = normalizeAutonomousObjectiveProposal({
      proposed,
      agentId: agent.agentId,
      shortTermMemoryContext,
      issuedAt: input.issuedAt,
    });
    const { objective, decisionTrace } = proposal;

    const strategicPlan = await createStrategicPlanRecord({
      objective,
      issuedAt: input.issuedAt,
      shortTermMemoryContext,
      longTermProfile,
      observedStateSummary: summarizeObservedAgentState(agent),
      worldDecisionContext,
      compile,
    });
    await publishPlanningSession({
      objective,
      publishedAt: input.issuedAt,
      intentionRepository: input.intentionRepository,
      planRecord: strategicPlan.record,
      planRepository: input.planRepository,
      ...(input.planProgressRepository === undefined
        ? {}
        : { planProgressRepository: input.planProgressRepository }),
    });
    const tracedDecision = addStrategicPlanTrace({
      decisionTrace,
      planningTrace: strategicPlan.planningTrace,
    });
    await input.objectiveRenewalTraceSink?.record(tracedDecision);
    renewed.push({
      agentId: agent.agentId,
      objectiveId: objective.id,
      planId: objective.id,
      decisionTrace: tracedDecision,
    });
  }

  return renewed;
}

async function createStrategicPlanRecord(input: {
  readonly objective: LongHorizonObjective;
  readonly issuedAt: number;
  readonly shortTermMemoryContext: readonly ShortTermMemoryRecord[];
  readonly longTermProfile: LongTermAgentProfile;
  readonly observedStateSummary: string;
  readonly worldDecisionContext: WorldDecisionContext;
  readonly compile: StrategicPlanCompiler;
}): Promise<{
  readonly record: BranchPlanRecord;
  readonly planningTrace?: StrategicPlanCompilationTrace;
}> {
  const compiled = normalizeStrategicPlanCompilerOutput(
    await input.compile({
      objective: input.objective,
      issuedAt: input.issuedAt,
      shortTermMemoryContext: input.shortTermMemoryContext,
      longTermProfile: input.longTermProfile,
      observedStateSummary: input.observedStateSummary,
      worldDecisionContext: input.worldDecisionContext,
    }),
  );
  return {
    record: {
      planId: input.objective.id,
      agentId: input.objective.agentId,
      plan: compiled.plan,
      ...(compiled.planningTrace === undefined ? {} : { planningTrace: compiled.planningTrace }),
      strategicContext: createStrategicPlanContextSnapshot({
        worldDecisionContext: input.worldDecisionContext,
        longTermProfile: input.longTermProfile,
        capturedAt: input.issuedAt,
      }),
      createdAt: input.issuedAt,
      updatedAt: input.issuedAt,
    },
    ...(compiled.planningTrace === undefined ? {} : { planningTrace: compiled.planningTrace }),
  };
}

function addStrategicPlanTrace(input: {
  readonly decisionTrace: ObjectiveRenewalDecisionTrace;
  readonly planningTrace: StrategicPlanCompilationTrace | undefined;
}): ObjectiveRenewalDecisionTrace {
  if (input.planningTrace === undefined) {
    return input.decisionTrace;
  }

  return {
    ...input.decisionTrace,
    strategicPlan: input.planningTrace,
  };
}

function createAutonomousObjectiveId(
  agentId: AgentId,
  issuedAt: number,
  objectiveOrdinal: number,
): string {
  assertPositiveInteger(objectiveOrdinal, 'objectiveOrdinal');
  return `auto-objective-${agentId}-${issuedAt}-${objectiveOrdinal}`;
}

function normalizeAutonomousObjectiveProposal(input: {
  readonly proposed: LongHorizonObjective | AutonomousObjectiveProposal;
  readonly agentId: AgentId;
  readonly shortTermMemoryContext: readonly ShortTermMemoryRecord[];
  readonly issuedAt: number;
}): AutonomousObjectiveProposal {
  if (isAutonomousObjectiveProposal(input.proposed)) {
    return input.proposed;
  }

  return {
    objective: input.proposed,
    decisionTrace: {
      agentId: input.agentId,
      objectiveId: input.proposed.id,
      selectedCandidateId: 'custom-proposer',
      rationale: 'Objective was produced by a custom proposer without decision metadata.',
      score: 0,
      shortTermMemoryContextIds: input.shortTermMemoryContext.map((record) => record.id),
      profileEntryKeys: [],
      profileEvidenceRecordIds: [],
      issuedAt: input.issuedAt,
    },
  };
}

function isAutonomousObjectiveProposal(
  value: LongHorizonObjective | AutonomousObjectiveProposal,
): value is AutonomousObjectiveProposal {
  return 'objective' in value && 'decisionTrace' in value;
}

type ObjectiveCandidate = AutonomousLifeCourseCandidate & {
  readonly scheduledIntentionIds?: readonly string[];
};

function scoreObjectiveCandidates(
  input: AutonomousObjectiveProposerInput,
): readonly ObjectiveCandidate[] {
  const candidates: ObjectiveCandidate[] = [];
  const educationOpportunityCost = input.worldDecisionContext?.rules?.educationOpportunityCost;
  const decisionRules = input.worldDecisionContext?.rules;
  const lifeCourseContext =
    decisionRules !== undefined &&
    (decisionRules.occupations.length > 0 ||
      decisionRules.production.length > 0 ||
      decisionRules.residentialUpgrade !== undefined)
      ? input.worldDecisionContext
      : undefined;
  let lifeCourseCandidateCount = 0;
  const physiologyDanger =
    input.agent.physiology.energy < 30 ||
    input.agent.physiology.satiety < 30 ||
    input.agent.physiology.health < 50;

  if (physiologyDanger) {
    candidates.push({
      id: 'physiology-maintenance',
      statement: createPhysiologyMaintenanceStatement(input.agent),
      priority: 3,
      affinityTags: createPhysiologyMaintenanceAffinityTags(input.agent),
      score: 100,
      rationale: 'Physiology is below a safe operating threshold.',
      shortTermMemoryContextIds: [],
      profileEntryKeys: [],
      profileEvidenceRecordIds: [],
    });
  }

  // Banking candidate (AGENT_CONTEXT_DESIGN.md §7 step 4): fires only under
  // the same rigid gates as the banking domain proposer — physiological need
  // plus a balance gap the credit limit can cover. Never "borrow because
  // credit exists".
  const banking = input.worldDecisionContext?.agent.banking;
  const survivalGap =
    DEFAULT_BANKING_ACTION_PROPOSER_POLICY.survivalBalanceFloor - input.agent.balance;
  if (
    physiologyDanger &&
    banking !== undefined &&
    survivalGap > 0 &&
    banking.maxLoanAmount >= survivalGap
  ) {
    candidates.push({
      id: 'survival-bridge-loan',
      statement: 'Bridge the survival shortfall with a town-bank loan and repay it from wages.',
      priority: 3,
      affinityTags: ['banking', 'finance', 'survival'],
      score: 90,
      rationale:
        'Physiology is below a safe threshold and the balance cannot cover recovery; the town bank can bridge the gap within the credit limit.',
      shortTermMemoryContextIds: [],
      profileEntryKeys: [],
      profileEvidenceRecordIds: [],
    });
  }

  const socialMatterCandidate = createSocialMatterObjectiveCandidate(input);
  if (socialMatterCandidate !== undefined) {
    candidates.push(socialMatterCandidate);
  }

  // Enterprise candidate: an active enterprise is hiring and the position is
  // open to this agent — the cheapest ladder step on the work side.
  const hiringEnterprise = input.worldDecisionContext?.enterprises
    ?.filter(
      (enterprise) =>
        enterprise.status === 'active' &&
        isEnterpriseOccupationQualified(
          input.worldDecisionContext?.rules?.occupations.find(
            (rule) => rule.occupationName === enterprise.occupationName,
          ),
        ) &&
        (enterprise.jobPosting?.openSlots ?? 0) > 0 &&
        !enterprise.employeeAgentIds.includes(input.agent.agentId) &&
        enterprise.ownerAgentId !== input.agent.agentId,
    )
    .sort((left, right) => left.enterpriseId.localeCompare(right.enterpriseId))[0];
  if (hiringEnterprise !== undefined) {
    candidates.push({
      id: 'join-hiring-enterprise',
      statement: `Take the open position at ${hiringEnterprise.name}, which is hiring.`,
      priority: 2,
      affinityTags: ['enterprise', 'work', 'income'],
      planningDomains: ['enterprise'],
      score: ENTERPRISE_JOIN_SCORE,
      rationale:
        'An active town enterprise offers immediate qualified employment without waiting for the public recruitment cycle.',
      shortTermMemoryContextIds: [],
      profileEntryKeys: [],
      profileEvidenceRecordIds: [],
    });
  }

  candidates.push(...createEndogenousEnterpriseObjectiveCandidates(input));

  const externalTradeCandidate = createEnterpriseExternalTradeObjectiveCandidate(input);
  if (externalTradeCandidate !== undefined) {
    candidates.push(externalTradeCandidate);
  }

  const recentRecoveryNeed = scoreRecentRecoveryNeed(input.shortTermMemoryContext);
  if (recentRecoveryNeed.score > 0) {
    candidates.push({
      id: 'recent-setback-recovery',
      statement: 'Recover from recent setbacks before pursuing new growth.',
      priority: 3,
      affinityTags: recentRecoveryNeed.affinityTags,
      score: recentRecoveryNeed.score,
      rationale: 'Recent failed memory suggests recovery before new growth.',
      shortTermMemoryContextIds: recentRecoveryNeed.evidenceMemoryRecordIds,
      profileEntryKeys: [],
      profileEvidenceRecordIds: [],
    });
  }

  const scheduledRoutineCandidate = createScheduledRoutineCandidate({
    intentionState: input.intentionState,
    issuedAt: input.issuedAt,
  });

  if (lifeCourseContext !== undefined && scheduledRoutineCandidate === undefined) {
    const lifeCourseCandidates = createAutonomousLifeCourseCandidates({
      agent: input.agent,
      worldDecisionContext: lifeCourseContext,
    });
    lifeCourseCandidateCount = lifeCourseCandidates.length;
    candidates.push(...lifeCourseCandidates);
  }

  const useLegacyFallback =
    scheduledRoutineCandidate === undefined &&
    (lifeCourseContext === undefined || lifeCourseCandidateCount === 0);

  if (useLegacyFallback && input.agent.educationScore < 100) {
    const affordabilityPenalty =
      educationOpportunityCost === undefined
        ? 0
        : !educationOpportunityCost.directlyAffordable
          ? 40
          : !educationOpportunityCost.preservesMinimumBalanceReserve
            ? 10
            : 0;
    candidates.push({
      id: 'education-growth',
      statement:
        educationOpportunityCost === undefined
          ? 'Improve education to qualify for better town opportunities.'
          : 'Balance education investment with immediate income to qualify for better town opportunities.',
      priority: 2,
      affinityTags:
        educationOpportunityCost === undefined
          ? ['study', 'education']
          : ['study', 'education', 'work', 'income'],
      score: Math.max(0, 40 + (100 - input.agent.educationScore) / 100 - affordabilityPenalty),
      rationale:
        educationOpportunityCost === undefined
          ? 'Education score is below the threshold for better town opportunities.'
          : createEducationOpportunityCostRationale(educationOpportunityCost),
      shortTermMemoryContextIds: [],
      profileEntryKeys: [],
      profileEvidenceRecordIds: [],
    });
  }

  const incomeBalanceTarget =
    educationOpportunityCost === undefined
      ? 50
      : educationOpportunityCost.directCurrencyCost +
        educationOpportunityCost.minimumBalanceReserve;
  const incomePressureScore =
    input.agent.balance < incomeBalanceTarget
      ? (educationOpportunityCost === undefined ? 35 : 45) +
        (incomeBalanceTarget - input.agent.balance) / Math.max(1, incomeBalanceTarget)
      : 0;
  if (useLegacyFallback && incomePressureScore > 0) {
    candidates.push({
      id: 'income-stability',
      statement: 'Earn enough money to stay economically stable.',
      priority: 2,
      affinityTags: ['work', 'income'],
      score: incomePressureScore,
      rationale: 'Currency balance is below the economic stability threshold.',
      shortTermMemoryContextIds: [],
      profileEntryKeys: [],
      profileEvidenceRecordIds: [],
    });
  }

  if (scheduledRoutineCandidate !== undefined) {
    candidates.push(scheduledRoutineCandidate);
  }

  const socialIdentityCandidate = createSocialIdentityCandidate(input);
  const socialConflictCandidate = createSocialConflictObjectiveCandidate(input);
  if (socialConflictCandidate !== undefined) {
    candidates.push(socialConflictCandidate);
  }
  if (socialIdentityCandidate !== undefined) {
    candidates.push(socialIdentityCandidate);
  }

  const profileCandidate = createProfileRoutineCandidate(input.longTermProfile);
  if (profileCandidate !== undefined) {
    candidates.push(profileCandidate);
  }

  if (useLegacyFallback) {
    const marketCandidate = createMarketParticipationCandidate(input);
    if (marketCandidate !== undefined) {
      candidates.push(marketCandidate);
    }
  }

  candidates.push({
    id: 'balanced-routine',
    statement: 'Maintain a balanced daily routine in the town.',
    priority: 1,
    affinityTags: ['maintain', 'routine'],
    score: 1,
    rationale: 'No stronger survival, growth, income, memory, or profile signal is active.',
    shortTermMemoryContextIds: [],
    profileEntryKeys: [],
    profileEvidenceRecordIds: [],
  });

  return candidates.sort(compareObjectiveCandidates);
}

function createEndogenousEnterpriseObjectiveCandidates(
  input: AutonomousObjectiveProposerInput,
): readonly ObjectiveCandidate[] {
  const enterpriseRule = input.worldDecisionContext?.rules?.enterprise;
  if (enterpriseRule === undefined) {
    return [];
  }
  const operationalEnterprises = Object.values(input.projection.enterprises).filter(
    (enterprise) => enterprise.status === 'active' || enterprise.status === 'insolvent',
  );
  const candidates: ObjectiveCandidate[] = [];
  const targetEnterpriseCount = Math.max(
    1,
    Math.ceil(
      Object.keys(input.projection.agents).length /
        DEFAULT_ENTERPRISE_ACTION_PROPOSER_POLICY.targetResidentsPerFirm,
    ),
  );
  const minimumFounderBalance =
    enterpriseRule.minimumInitialCapital +
    DEFAULT_ENTERPRISE_ACTION_PROPOSER_POLICY.ownerBalanceFloor;
  if (
    Object.keys(input.projection.agents).length >=
      DEFAULT_ENTERPRISE_ACTION_PROPOSER_POLICY.minimumResidentsForFounding &&
    operationalEnterprises.length < targetEnterpriseCount &&
    resolveEnterpriseFounderAgentId({
      projection: input.projection,
      minimumFounderBalance,
    }) === input.agentId
  ) {
    candidates.push({
      id: 'enterprise-founder',
      statement: 'Found an enterprise to produce goods, serve demand, and create town employment.',
      priority: 2,
      affinityTags: ['enterprise', 'enterprise-founder', 'found', 'business'],
      planningDomains: ['enterprise'],
      score: ENTERPRISE_FOUNDING_SCORE,
      rationale: `The town has ${operationalEnterprises.length} operational enterprise(s) against a density target of ${targetEnterpriseCount}; this Agent is the deterministic capital-eligible founder.`,
      shortTermMemoryContextIds: [],
      profileEntryKeys: [],
      profileEvidenceRecordIds: [],
    });
  }

  const ownedEnterprise = operationalEnterprises
    .filter((enterprise) => enterprise.ownerAgentId === input.agentId)
    .sort((left, right) => left.enterpriseId.localeCompare(right.enterpriseId))[0];
  if (ownedEnterprise === undefined || ownedEnterprise.status !== 'active') {
    return candidates;
  }

  const occupationRule = input.worldDecisionContext?.rules?.occupations.find(
    (occupation) => occupation.occupationName === ownedEnterprise.occupationName,
  );
  const wageOffer = occupationRule?.currentWage ?? occupationRule?.baseWage;
  const remainingCapacity = ownedEnterprise.maxEmployees - ownedEnterprise.employeeAgentIds.length;
  if (
    ownedEnterprise.cumulativeSales > 0 &&
    remainingCapacity > 0 &&
    (ownedEnterprise.jobPosting?.openSlots ?? 0) <= ownedEnterprise.employeeAgentIds.length &&
    wageOffer !== undefined &&
    ownedEnterprise.balance >=
      wageOffer * DEFAULT_ENTERPRISE_ACTION_PROPOSER_POLICY.payrollReserveCycles
  ) {
    candidates.push({
      id: `enterprise-hiring:${ownedEnterprise.enterpriseId}`,
      statement: `Hire for ${ownedEnterprise.name} after proven sales while preserving payroll reserves.`,
      priority: 2,
      affinityTags: ['enterprise', 'enterprise-hiring', 'hire', 'job'],
      planningDomains: ['enterprise'],
      score: ENTERPRISE_HIRING_SCORE,
      rationale: `The enterprise has realized sales, ${remainingCapacity} position(s) of capacity, and at least ${DEFAULT_ENTERPRISE_ACTION_PROPOSER_POLICY.payrollReserveCycles} wage cycles of cash.`,
      shortTermMemoryContextIds: [],
      profileEntryKeys: [],
      profileEvidenceRecordIds: [],
    });
  }

  const listedInventory = Object.entries(ownedEnterprise.inventory)
    .flatMap(([commodity, quantity]) => {
      const price = input.worldDecisionContext?.market.spotPrices.find(
        (candidate) => candidate.commodity === commodity,
      )?.spotPrice;
      return quantity >= 1 && price !== undefined ? [{ commodity, price }] : [];
    })
    .sort(
      (left, right) => right.price - left.price || left.commodity.localeCompare(right.commodity),
    )[0];
  if (listedInventory !== undefined) {
    candidates.push({
      id: `enterprise-sale:${ownedEnterprise.enterpriseId}:${listedInventory.commodity}`,
      statement: `Sell one ${listedInventory.commodity} for enterprise ${ownedEnterprise.name} through the town market.`,
      priority: 2,
      affinityTags: ['enterprise', 'trade', 'market', 'sell', listedInventory.commodity],
      planningDomains: ['trade'],
      score: ENTERPRISE_SALE_SCORE,
      rationale: `The enterprise owns market-listed ${listedInventory.commodity} inventory at spot price ${listedInventory.price}.`,
      shortTermMemoryContextIds: [],
      profileEntryKeys: [],
      profileEvidenceRecordIds: [],
    });
  } else {
    const production = input.worldDecisionContext?.rules?.production
      .filter((candidate) => candidate.producible && (candidate.grossMargin ?? 0) > 0)
      .sort(
        (left, right) =>
          (right.grossMarginPerSecond ?? right.grossMargin ?? 0) -
            (left.grossMarginPerSecond ?? left.grossMargin ?? 0) ||
          left.commodity.localeCompare(right.commodity),
      )[0];
    if (production !== undefined) {
      candidates.push({
        id: `enterprise-production:${ownedEnterprise.enterpriseId}:${production.commodity}`,
        statement: `Produce ${production.commodity} for enterprise ${ownedEnterprise.name} to supply the town market.`,
        priority: 2,
        affinityTags: ['enterprise', 'production', 'produce', 'market', production.commodity],
        planningDomains: ['production'],
        score: ENTERPRISE_PRODUCTION_SCORE,
        rationale: `The enterprise has no listed inventory; ${production.commodity} is currently producible with positive estimated gross margin.`,
        shortTermMemoryContextIds: [],
        profileEntryKeys: [],
        profileEvidenceRecordIds: [],
      });
    }
  }
  return candidates;
}

function createSocialConflictObjectiveCandidate(
  input: AutonomousObjectiveProposerInput,
): ObjectiveCandidate | undefined {
  if (input.worldDecisionContext === undefined) {
    return undefined;
  }
  const intent = resolveAutonomousConflictIntent({
    agentId: input.agentId,
    context: input.worldDecisionContext,
    now: input.issuedAt,
  });
  if (intent === undefined) {
    return undefined;
  }
  if (intent.kind === 'intervene') {
    return {
      id: `social-conflict-intervene:${intent.conflictId}`,
      statement: `Intervene between ${intent.attackerAgentId} and ${intent.targetAgentId} to stop the recent attack.`,
      priority: 3,
      affinityTags: ['social', 'conflict-intervene', 'deescalate', 'protect'],
      planningDomains: ['social'],
      score: SOCIAL_CONFLICT_INTERVENTION_SCORE,
      rationale:
        'A recent co-located attack creates an immediate opportunity for third-party intervention.',
      shortTermMemoryContextIds: [],
      profileEntryKeys: [],
      profileEvidenceRecordIds: [],
    };
  }
  const attack = intent.kind === 'attack';
  return {
    id: `social-conflict-${intent.kind}:${intent.targetAgentId}`,
    statement: attack
      ? `Attack ${intent.targetAgentId} after an unresolved confrontation and severe distress.`
      : `Confront ${intent.targetAgentId} about the damaged relationship.`,
    priority: 3,
    affinityTags: ['social', `conflict-${intent.kind}`, attack ? 'retaliate' : 'set-boundary'],
    planningDomains: ['social'],
    score: attack ? SOCIAL_CONFLICT_ATTACK_SCORE : SOCIAL_CONFLICT_CONFRONT_SCORE,
    rationale: attack
      ? 'Severe distress and a prior confrontation make retaliation salient, subject to world grievance adjudication.'
      : `The strongest outgoing relation is strained at ${intent.relationScore}; confrontation is salient but remains world-constrained.`,
    shortTermMemoryContextIds: [],
    profileEntryKeys: [],
    profileEvidenceRecordIds: [],
  };
}

function createSocialMatterObjectiveCandidate(
  input: AutonomousObjectiveProposerInput,
): ObjectiveCandidate | undefined {
  const matters = input.worldDecisionContext?.matters ?? [];
  const assigned = matters.find(
    (matter) =>
      matter.role === 'assignee' &&
      (matter.status === 'assigned' || matter.status === 'executing') &&
      matter.requiredCommodity !== undefined &&
      (input.agent.inventory[matter.requiredCommodity.commodityName] ?? 0) > 0,
  );
  if (assigned?.requiredCommodity !== undefined) {
    const remaining = Math.max(
      0,
      assigned.requiredCommodity.quantity - (assigned.deliveredQuantity ?? 0),
    );
    if (remaining > 0) {
      return {
        id: `social-matter-delivery:${assigned.matterId}`,
        statement: `Deliver ${assigned.requiredCommodity.commodityName} for social matter ${assigned.matterId} before it expires.`,
        priority: 3,
        affinityTags: ['social', 'matter', 'obligation', 'deliver'],
        planningDomains: ['social'],
        score: SOCIAL_MATTER_ASSIGNEE_SCORE,
        rationale: 'An assigned commodity-backed matter is an active world-recorded obligation.',
        shortTermMemoryContextIds: [],
        profileEntryKeys: [],
        profileEvidenceRecordIds: [],
      };
    }
  }

  const assignable = matters.find(
    (matter) =>
      matter.role === 'initiator' &&
      (matter.status === 'open' || matter.status === 'collecting') &&
      matter.responses.some((response) => response.decision === 'accept'),
  );
  if (assignable !== undefined) {
    return {
      id: `social-matter-assignment:${assignable.matterId}`,
      statement: `Assign an accepted responder to social matter ${assignable.matterId}.`,
      priority: 3,
      affinityTags: ['social', 'matter', 'obligation', 'assign'],
      planningDomains: ['social'],
      score: SOCIAL_MATTER_ASSIGNMENT_SCORE,
      rationale: 'The help request has an accepted responder and awaits initiator assignment.',
      shortTermMemoryContextIds: [],
      profileEntryKeys: [],
      profileEvidenceRecordIds: [],
    };
  }

  const capable = matters.find(
    (matter) =>
      (matter.role === 'available' || matter.role === 'responder') &&
      matter.myResponse !== 'accept' &&
      (matter.status === 'open' || matter.status === 'collecting') &&
      matter.requiredCommodity !== undefined &&
      (input.agent.inventory[matter.requiredCommodity.commodityName] ?? 0) >=
        matter.requiredCommodity.quantity,
  );
  if (capable !== undefined) {
    return {
      id: `social-matter-response:${capable.matterId}`,
      statement: `Accept social matter ${capable.matterId} because the requested goods are available.`,
      priority: 2,
      affinityTags: ['social', 'matter', 'help', 'accept'],
      planningDomains: ['social'],
      score: SOCIAL_MATTER_RESPONSE_SCORE,
      rationale: 'An open commodity-backed help request matches current inventory capability.',
      shortTermMemoryContextIds: [],
      profileEntryKeys: [],
      profileEvidenceRecordIds: [],
    };
  }
  return undefined;
}

function createSocialIdentityCandidate(
  input: AutonomousObjectiveProposerInput,
): ObjectiveCandidate | undefined {
  if (input.shortTermMemoryContext.some((record) => record.kind === 'social-interaction')) {
    return undefined;
  }
  const identityEntries = [
    ...input.longTermProfile.mood,
    ...input.longTermProfile.values,
    ...input.longTermProfile.personality,
    ...input.longTermProfile.habits,
  ];
  const conflictEntry = identityEntries.find((entry) =>
    containsAny(`${entry.key} ${entry.statement}`.toLowerCase(), [
      'conflict-alert',
      'boundary-conscious',
      'constructive-disagreement',
      'de-escalation',
    ]),
  );
  const adverseEntry = identityEntries.find((entry) =>
    containsAny(`${entry.key} ${entry.statement}`.toLowerCase(), [
      'guarded',
      'wary',
      'verified-reciprocity',
      'reduced trust',
      'ambivalent',
    ]),
  );
  const constructiveEntry = identityEntries.find((entry) =>
    containsAny(`${entry.key} ${entry.statement}`.toLowerCase(), [
      'cooperative',
      'sociable',
      'community-cooperation',
      'social routine',
    ]),
  );
  const strongestConflictRelation = [...input.longTermProfile.socialRecords]
    .filter((entry) =>
      (entry.outcomeSignals ?? []).some(
        (signal) => signal === 'hostility' || signal === 'rejection',
      ),
    )
    .sort((left, right) => left.key.localeCompare(right.key))[0];
  const strongestAdverseRelation = [...input.longTermProfile.socialRecords]
    .filter(
      (entry) =>
        ((entry.relationDelta ?? 0) < 0 || (entry.attitudeDelta ?? 0) < 0) &&
        !(entry.outcomeSignals ?? []).some(
          (signal) => signal === 'hostility' || signal === 'rejection',
        ),
    )
    .sort(
      (left, right) =>
        Math.min(left.relationDelta ?? 0, left.attitudeDelta ?? 0) -
          Math.min(right.relationDelta ?? 0, right.attitudeDelta ?? 0) ||
        left.key.localeCompare(right.key),
    )[0];
  const strongestConstructiveRelation = [...input.longTermProfile.socialRecords]
    .filter((entry) => (entry.relationDelta ?? 0) > 0 || (entry.attitudeDelta ?? 0) > 0)
    .sort(
      (left, right) =>
        Math.max(right.relationDelta ?? 0, right.attitudeDelta ?? 0) -
          Math.max(left.relationDelta ?? 0, left.attitudeDelta ?? 0) ||
        left.key.localeCompare(right.key),
    )[0];
  const evidence =
    conflictEntry ??
    strongestConflictRelation ??
    adverseEntry ??
    strongestAdverseRelation ??
    constructiveEntry ??
    strongestConstructiveRelation;
  if (evidence === undefined) {
    return undefined;
  }
  const conflict = conflictEntry !== undefined || strongestConflictRelation !== undefined;
  const adverse =
    !conflict && (adverseEntry !== undefined || strongestAdverseRelation !== undefined);
  return {
    id: conflict
      ? 'social-identity-deescalation'
      : adverse
        ? 'social-identity-caution'
        : 'social-identity-cooperation',
    statement: conflict
      ? 'Hold a bounded conversation to clarify disagreement and reinforce social boundaries.'
      : adverse
        ? 'Observe the social setting and verify commitments before rebuilding trust.'
        : 'Strengthen a trusted relationship through cooperative social contact.',
    priority: 2,
    affinityTags: conflict
      ? ['social', 'deescalate', 'boundaries', 'constructive-disagreement']
      : adverse
        ? ['social', 'social-caution', 'observe', 'verify-commitment']
        : ['social', 'cooperate', 'relationship', 'community'],
    score: SOCIAL_IDENTITY_SCORE + evidence.confidence,
    rationale: conflict
      ? 'Outcome-grounded conflict evidence favors bounded de-escalation and clear boundaries.'
      : adverse
        ? 'Outcome-grounded adverse social evidence favors cautious verification before engagement.'
        : 'Outcome-grounded constructive social evidence favors maintaining cooperative ties.',
    shortTermMemoryContextIds: [],
    profileEntryKeys: [evidence.key],
    profileEvidenceRecordIds: evidence.provenanceRecordIds,
  };
}

function createMarketParticipationCandidate(
  input: AutonomousObjectiveProposerInput,
): ObjectiveCandidate | undefined {
  const spotPrices = input.worldDecisionContext?.market.spotPrices;
  if (spotPrices === undefined || spotPrices.length === 0) {
    return undefined;
  }
  const listedCommodities = new Set(spotPrices.map((price) => price.commodity));
  const ownedCommodities = Object.entries(input.agent.inventory)
    .filter(([commodity, quantity]) => quantity >= 1 && listedCommodities.has(commodity))
    .map(([commodity]) => commodity)
    .sort();
  if (ownedCommodities.length > 0) {
    const commodity = selectStableAgentCommodity(input.agentId, ownedCommodities);
    return {
      id: 'market-participation-sell',
      statement: `Sell one ${commodity} through the town market while preserving economic stability.`,
      priority: 1,
      affinityTags: ['trade', 'market', 'sell', commodity],
      score: MARKET_PARTICIPATION_SCORE,
      rationale: `Inventory contains a market-listed ${commodity} that can be exchanged for currency.`,
      shortTermMemoryContextIds: [],
      profileEntryKeys: [],
      profileEvidenceRecordIds: [],
    };
  }

  const affordableCommodities = spotPrices
    .filter(
      (price) =>
        Number.isFinite(price.spotPrice) &&
        price.spotPrice > 0 &&
        input.agent.balance >= price.spotPrice * MARKET_BUY_MINIMUM_SPOT_PRICE_MULTIPLIER,
    )
    .map((price) => price.commodity)
    .sort();
  if (affordableCommodities.length === 0) {
    return undefined;
  }
  const commodity = selectStableAgentCommodity(input.agentId, affordableCommodities);
  return {
    id: 'market-participation-buy',
    statement: `Buy one ${commodity} through the town market while preserving economic stability.`,
    priority: 1,
    affinityTags: ['trade', 'market', 'buy', commodity],
    score: MARKET_PARTICIPATION_SCORE,
    rationale: `Balance covers at least ${MARKET_BUY_MINIMUM_SPOT_PRICE_MULTIPLIER} times the ${commodity} spot price.`,
    shortTermMemoryContextIds: [],
    profileEntryKeys: [],
    profileEvidenceRecordIds: [],
  };
}

function createEnterpriseExternalTradeObjectiveCandidate(
  input: AutonomousObjectiveProposerInput,
): ObjectiveCandidate | undefined {
  const externalTrade = input.worldDecisionContext?.externalTrade;
  if (externalTrade === undefined || externalTrade.length === 0) {
    return undefined;
  }
  const opportunity = resolveEnterpriseExternalTradeOpportunity({
    agentId: input.agentId,
    enterprises: input.projection.enterprises,
    marketPools: resolveAgentMarketPools({
      projection: input.projection,
      agent: input.agent,
    }),
    externalQuotes: externalTrade.map((quote) => ({
      commodityName: quote.commodityName,
      quantity: 1,
      exportTotal: quote.exportUnitPrice,
      importTotal: quote.importUnitPrice,
    })),
    quantity: 1,
    proposerPolicy: DEFAULT_EXTERNAL_TRADE_ACTION_PROPOSER_POLICY,
  });
  if (opportunity === undefined) {
    return undefined;
  }
  const enterprise = input.projection.enterprises[opportunity.enterpriseId];
  if (enterprise === undefined) {
    return undefined;
  }
  const directionVerb = opportunity.direction === 'export' ? 'Export' : 'Import';
  const sideTag = opportunity.direction === 'export' ? 'sell' : 'buy';
  return {
    id: `enterprise-external-${opportunity.direction}`,
    statement: `${directionVerb} one ${opportunity.commodityName} for ${enterprise.name} through the external market while its quote beats the town market.`,
    priority: 2,
    affinityTags: ['trade', 'market', sideTag, 'external', 'enterprise', opportunity.commodityName],
    planningDomains: ['trade'],
    score: EXTERNAL_TRADE_OPPORTUNITY_SCORE,
    rationale: `The external ${opportunity.direction} total ${opportunity.externalTotal} is better than the visible town AMM total ${opportunity.townMarketTotal} for enterprise ${enterprise.enterpriseId}.`,
    shortTermMemoryContextIds: [],
    profileEntryKeys: [],
    profileEvidenceRecordIds: [],
  };
}

function selectStableAgentCommodity(
  agentId: AgentId,
  sortedCommodities: readonly string[],
): string {
  if (sortedCommodities.length === 0) {
    throw new Error('market participation requires at least one commodity');
  }
  let hash = 2_166_136_261;
  for (const character of agentId) {
    hash = Math.imul(hash ^ character.codePointAt(0)!, 16_777_619) >>> 0;
  }
  return sortedCommodities[hash % sortedCommodities.length]!;
}

function createEducationOpportunityCostRationale(
  opportunityCost: NonNullable<
    NonNullable<WorldDecisionContext['rules']>['educationOpportunityCost']
  >,
): string {
  return [
    'Education is below the growth threshold.',
    `The next study action costs ${opportunityCost.directCurrencyCost} currency directly`,
    `and foregoes ${opportunityCost.foregoneLaborIncome} currency of current labor income.`,
    opportunityCost.preservesMinimumBalanceReserve
      ? `The post-study balance preserves the ${opportunityCost.minimumBalanceReserve} currency reserve.`
      : `The post-study balance does not preserve the ${opportunityCost.minimumBalanceReserve} currency reserve.`,
  ].join(' ');
}

function createPhysiologyMaintenanceAffinityTags(agent: WorldAgentState): readonly string[] {
  const lowAxes = new Set(collectLowPhysiologyAxes(agent));
  return stableUnique([
    'maintain',
    ...(lowAxes.has('satiety') ? ['eat', 'satiety'] : []),
    ...(lowAxes.has('energy') ? ['sleep', 'energy'] : []),
    ...(lowAxes.has('health') ? ['health'] : []),
  ]);
}

function createPhysiologyMaintenanceStatement(agent: WorldAgentState): string {
  const lowAxes = collectLowPhysiologyAxes(agent);
  if (lowAxes.length === 1) {
    return `Recover ${lowAxes[0]} before pursuing growth.`;
  }

  return 'Maintain energy, satiety, and health before pursuing growth.';
}

function collectLowPhysiologyAxes(agent: WorldAgentState): readonly string[] {
  return [
    ...(agent.physiology.energy < 30 ? ['energy'] : []),
    ...(agent.physiology.satiety < 30 ? ['satiety'] : []),
    ...(agent.physiology.health < 50 ? ['health'] : []),
  ];
}

function scoreRecentRecoveryNeed(memories: readonly ShortTermMemoryRecord[]): {
  readonly score: number;
  readonly evidenceMemoryRecordIds: readonly string[];
  readonly affinityTags: readonly string[];
} {
  let score = 0;
  let evidenceMemoryRecordIds: readonly string[] = [];
  let affinityTags: readonly string[] = DEFAULT_RECOVERY_AFFINITY_TAGS;
  for (const memory of memories) {
    if (memory.status !== 'failed' && memory.status !== 'repaired') {
      continue;
    }

    const context = `${memory.summary} ${memory.tags.join(' ')}`.toLowerCase();
    if (
      containsAny(context, [
        'work',
        'energy',
        'satiety',
        'health',
        'tired',
        'hungry',
        'failed',
        'fatigue',
      ])
    ) {
      const candidateScore = 55 + memory.importanceScore * 30;
      if (candidateScore > score) {
        score = candidateScore;
        evidenceMemoryRecordIds = [memory.id];
        affinityTags = inferRecoveryAffinityTags(context);
      }
    }
  }

  return { score, evidenceMemoryRecordIds, affinityTags };
}

const DEFAULT_RECOVERY_AFFINITY_TAGS = ['recover', 'maintain', 'health', 'energy'] as const;

function inferRecoveryAffinityTags(context: string): readonly string[] {
  if (containsAny(context, ['hungry', 'hunger', 'satiety'])) {
    return ['recover', 'maintain', 'eat', 'satiety'];
  }
  if (containsAny(context, ['tired', 'fatigue', 'sleep', 'energy'])) {
    return ['recover', 'maintain', 'sleep', 'energy'];
  }
  if (containsAny(context, ['doctor', 'hospital', 'sick', 'ill', 'health'])) {
    return ['recover', 'maintain', 'health'];
  }

  return DEFAULT_RECOVERY_AFFINITY_TAGS;
}

function createScheduledRoutineCandidate(input: {
  readonly intentionState: AgentIntentionState;
  readonly issuedAt: number;
}): ObjectiveCandidate | undefined {
  const [active] = [...selectActiveScheduledIntentions(input.intentionState, input.issuedAt)].sort(
    compareScheduledIntentionsForRoutine,
  );
  if (active === undefined) {
    return undefined;
  }

  const signal = resolveScheduledRoutineSignal(active);
  return {
    id: `scheduled-routine-${signal}`,
    statement: `Follow the current ${signal} routine: ${ensureSentence(active.description)}`,
    priority: 1,
    affinityTags: stableUnique(['routine', ...active.affinityTags]),
    score: roundScore(20 + active.priority * 4),
    rationale: `Active scheduled intention ${active.id} is in window.`,
    shortTermMemoryContextIds: [],
    profileEntryKeys: [],
    profileEvidenceRecordIds: [],
    scheduledIntentionIds: [active.id],
  };
}

function resolveScheduledRoutineSignal(intention: ScheduledIntention): string {
  const context = `${intention.description} ${intention.affinityTags.join(' ')}`.toLowerCase();
  if (containsAny(context, ['study', 'education', 'school', 'learn'])) {
    return 'study';
  }
  if (containsAny(context, ['eat', 'meal', 'food', 'satiety', 'restaurant'])) {
    return 'eat';
  }
  if (containsAny(context, ['work', 'income', 'job', 'workshop'])) {
    return 'work';
  }
  if (containsAny(context, ['sleep', 'rest', 'energy', 'home'])) {
    return 'sleep';
  }
  if (containsAny(context, ['social', 'community', 'relationship', 'town-square'])) {
    return 'social';
  }
  if (containsAny(context, ['health', 'doctor', 'clinic'])) {
    return 'health';
  }

  return 'balanced';
}

function ensureSentence(value: string): string {
  const trimmed = value.trim();
  if (trimmed.endsWith('.') || trimmed.endsWith('!') || trimmed.endsWith('?')) {
    return trimmed;
  }
  return `${trimmed}.`;
}

function createProfileRoutineCandidate(
  profile: LongTermAgentProfile,
): ObjectiveCandidate | undefined {
  const profileEntries = [
    ...profile.values,
    ...profile.habits,
    ...profile.personality,
    // Corrected/aged-out beliefs stay durable for audit but no longer assert
    // into objective candidates (memory-provenance slice).
    ...listAssertableBeliefs(profile),
  ];
  let best: ObjectiveCandidate | undefined;

  for (const entry of profileEntries) {
    const context = `${entry.key} ${entry.statement}`.toLowerCase();
    const signal = resolveProfileSignal(context);
    if (signal === undefined) {
      continue;
    }

    const candidate: ObjectiveCandidate = {
      id: `profile-${signal}`,
      statement: createProfileRoutineStatement(signal),
      priority: 1,
      affinityTags: ['maintain', 'routine', 'profile', signal],
      score: 15 + entry.confidence * 10,
      rationale: `Long-term profile suggests maintaining a ${signal} routine.`,
      shortTermMemoryContextIds: [],
      profileEntryKeys: [entry.key],
      profileEvidenceRecordIds: entry.provenanceRecordIds,
    };
    if (best === undefined || compareObjectiveCandidates(candidate, best) < 0) {
      best = candidate;
    }
  }

  return best;
}

function resolveProfileSignal(context: string): string | undefined {
  if (containsAny(context, ['creative', 'studio', 'create', 'art'])) {
    return 'creative';
  }
  if (containsAny(context, ['study', 'education', 'learn', 'school'])) {
    return 'study';
  }
  if (containsAny(context, ['work', 'income', 'job', 'career'])) {
    return 'work';
  }
  if (containsAny(context, ['health', 'energy', 'satiety', 'sleep'])) {
    return 'health';
  }
  if (containsAny(context, ['social', 'friend', 'relationship', 'community'])) {
    return 'social';
  }
  if (context.includes('routine')) {
    return 'routine';
  }

  return undefined;
}

function createProfileRoutineStatement(signal: string): string {
  if (signal === 'routine') {
    return 'Maintain a routine aligned with long-term profile.';
  }

  return `Maintain a ${signal} routine aligned with long-term profile.`;
}

function selectObjectiveCandidate(input: {
  readonly candidates: readonly ObjectiveCandidate[];
  readonly intentionState: AgentIntentionState;
}): ObjectiveCandidate {
  const [best, ...alternatives] = input.candidates;
  if (best === undefined) {
    throw new Error('objective proposer must have at least one candidate');
  }

  const mostRecentCompleted = [...input.intentionState.completedObjectives].sort(
    (left, right) => right.completedAt - left.completedAt,
  )[0];
  if (mostRecentCompleted === undefined) {
    return best;
  }

  if (best.statement !== mostRecentCompleted.objective.statement) {
    return best;
  }

  return alternatives.find((candidate) => candidate.score > 0) ?? best;
}

function compareObjectiveCandidates(left: ObjectiveCandidate, right: ObjectiveCandidate): number {
  if (left.score !== right.score) {
    return right.score - left.score;
  }
  if (left.priority !== right.priority) {
    return right.priority - left.priority;
  }
  return left.id.localeCompare(right.id);
}

function compareScheduledIntentionsForRoutine(
  left: ScheduledIntention,
  right: ScheduledIntention,
): number {
  if (left.priority !== right.priority) {
    return right.priority - left.priority;
  }
  if (left.startsAt !== right.startsAt) {
    return left.startsAt - right.startsAt;
  }
  return left.id.localeCompare(right.id);
}

function containsAny(value: string, needles: readonly string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}

function stableUnique(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

function roundScore(value: number): number {
  return Number(value.toFixed(6));
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
}
