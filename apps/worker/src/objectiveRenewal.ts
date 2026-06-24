import {
  compileStrategicObjectiveToBranchPlan,
  type BranchPlanRecord,
  type BranchPlanRepository,
  type StrategicPlanCompiler,
} from '@aivilization/agent-runtime';
import type {
  AgentIntentionRepository,
  AgentIntentionState,
  LongHorizonObjective,
  LongTermAgentProfile,
  LongTermProfileRepository,
  ShortTermMemoryRecord,
  ShortTermMemoryRepository,
} from '@aivilization/memory';
import type { AgentId } from '@aivilization/sim-core';
import type { WorldAgentState, WorldProjection } from '@aivilization/world';

const DEFAULT_OBJECTIVE_MEMORY_RETRIEVAL_LIMIT = 8;

export type AutonomousObjectiveProposerInput = {
  readonly agentId: AgentId;
  readonly agent: WorldAgentState;
  readonly projection: WorldProjection;
  readonly intentionState: AgentIntentionState;
  readonly longTermProfile: LongTermAgentProfile;
  readonly shortTermMemoryContext: readonly ShortTermMemoryRecord[];
  readonly issuedAt: number;
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
    id: createAutonomousObjectiveId(input.agentId, input.issuedAt),
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
      issuedAt: input.issuedAt,
    },
  };
}

export async function renewMissingActiveObjectives(input: {
  readonly projection: WorldProjection;
  readonly intentionRepository: AgentIntentionRepository;
  readonly longTermProfileRepository: LongTermProfileRepository;
  readonly shortTermMemoryRepository: ShortTermMemoryRepository;
  readonly planRepository: BranchPlanRepository;
  readonly issuedAt: number;
  readonly memoryRetrievalLimit?: number;
  readonly objectiveProposer?: AutonomousObjectiveProposer;
  readonly objectiveRenewalTraceSink?: WorkerObjectiveRenewalTraceSink;
  readonly strategicPlanCompiler?: StrategicPlanCompiler;
}): Promise<readonly RenewedActiveObjectiveResult[]> {
  const renewed: RenewedActiveObjectiveResult[] = [];
  const proposer = input.objectiveProposer ?? createDefaultAutonomousObjectiveProposal;
  const compile = input.strategicPlanCompiler ?? compileStrategicObjectiveToBranchPlan;
  const memoryRetrievalLimit =
    input.memoryRetrievalLimit ?? DEFAULT_OBJECTIVE_MEMORY_RETRIEVAL_LIMIT;
  assertPositiveInteger(memoryRetrievalLimit, 'memoryRetrievalLimit');

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
    });
    const proposed = await proposer({
      agentId: agent.agentId,
      agent,
      projection: input.projection,
      intentionState,
      longTermProfile,
      shortTermMemoryContext,
      issuedAt: input.issuedAt,
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

    await input.intentionRepository.setObjective(agent.agentId, objective);
    await input.planRepository.save(
      await createStrategicPlanRecord({
        objective,
        issuedAt: input.issuedAt,
        compile,
      }),
    );
    await input.objectiveRenewalTraceSink?.record(decisionTrace);
    renewed.push({
      agentId: agent.agentId,
      objectiveId: objective.id,
      planId: objective.id,
      decisionTrace,
    });
  }

  return renewed;
}

async function createStrategicPlanRecord(input: {
  readonly objective: LongHorizonObjective;
  readonly issuedAt: number;
  readonly compile: StrategicPlanCompiler;
}): Promise<BranchPlanRecord> {
  return {
    planId: input.objective.id,
    agentId: input.objective.agentId,
    plan: await input.compile({ objective: input.objective, issuedAt: input.issuedAt }),
    createdAt: input.issuedAt,
    updatedAt: input.issuedAt,
  };
}

function createAutonomousObjectiveId(agentId: AgentId, issuedAt: number): string {
  return `auto-objective-${agentId}-${issuedAt}`;
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

type ObjectiveCandidate = {
  readonly id: string;
  readonly statement: string;
  readonly priority: number;
  readonly affinityTags: readonly string[];
  readonly score: number;
  readonly rationale: string;
  readonly shortTermMemoryContextIds: readonly string[];
  readonly profileEntryKeys: readonly string[];
  readonly profileEvidenceRecordIds: readonly string[];
};

function scoreObjectiveCandidates(input: AutonomousObjectiveProposerInput): readonly ObjectiveCandidate[] {
  const candidates: ObjectiveCandidate[] = [];
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

  if (input.agent.educationScore < 100) {
    candidates.push({
      id: 'education-growth',
      statement: 'Improve education to qualify for better town opportunities.',
      priority: 2,
      affinityTags: ['study', 'education'],
      score: 40 + (100 - input.agent.educationScore) / 100,
      rationale: 'Education score is below the threshold for better town opportunities.',
      shortTermMemoryContextIds: [],
      profileEntryKeys: [],
      profileEvidenceRecordIds: [],
    });
  }

  const incomePressureScore = input.agent.balance < 50 ? 35 + (50 - input.agent.balance) / 50 : 0;
  if (incomePressureScore > 0) {
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

  const profileCandidate = createProfileRoutineCandidate(input.longTermProfile);
  if (profileCandidate !== undefined) {
    candidates.push(profileCandidate);
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

function createPhysiologyMaintenanceAffinityTags(
  agent: WorldAgentState,
): readonly string[] {
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

function createProfileRoutineCandidate(
  profile: LongTermAgentProfile,
): ObjectiveCandidate | undefined {
  const profileEntries = [
    ...profile.values,
    ...profile.habits,
    ...profile.personality,
    ...profile.beliefs,
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

function containsAny(value: string, needles: readonly string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}

function stableUnique(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
}
