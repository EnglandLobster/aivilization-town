import type {
  LongTermAgentProfile,
  MemoryRecordId,
  ScheduledIntention,
  ShortTermMemoryRecord,
} from '@aivilization/memory';
import type { AgentId, SimulationTimestamp } from '@aivilization/sim-core';
import type {
  LlmLongTermProfileContextTrace,
  LlmShortTermMemoryContextTrace,
} from './llmContextTrace';
import type { WorldDecisionContext, WorldDecisionContextTrace } from './worldDecisionContext';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export type DailyPlanItemSource =
  | 'baseline-routine'
  | 'world-state'
  | 'long-term-profile'
  | 'memory-context';

export type DailyPlanItem = {
  readonly id: string;
  readonly description: string;
  readonly priority: number;
  readonly startsAtOffsetMs: number;
  readonly endsAtOffsetMs: number;
  readonly affinityTags: readonly string[];
  readonly source: DailyPlanItemSource;
  readonly evidenceRecordIds?: readonly MemoryRecordId[];
};

export type DailyPlan = {
  readonly id: string;
  readonly agentId: AgentId;
  readonly dayStart: SimulationTimestamp;
  readonly generatedAt: SimulationTimestamp;
  readonly summary: string;
  readonly items: readonly DailyPlanItem[];
};

export type DailyPlanAgentPhysiologySnapshot = {
  readonly energy: number;
  readonly satiety: number;
  readonly health: number;
};

export type DailyPlanAgentSnapshot = {
  readonly job?: string | null;
  readonly locationId?: string | null;
  readonly physiology?: DailyPlanAgentPhysiologySnapshot;
};

export type DeterministicDailyPlanInput = {
  readonly agentId: AgentId;
  readonly issuedAt: SimulationTimestamp;
  readonly agent?: DailyPlanAgentSnapshot;
  readonly longTermProfile?: LongTermAgentProfile;
  readonly memoryContext?: readonly ShortTermMemoryRecord[];
  readonly observedStateSummary?: string;
  readonly worldDecisionContext?: WorldDecisionContext;
};

export type DailyPlanCompilerInput = DeterministicDailyPlanInput;

export type DailyPlanCompilationUsage = {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly estimatedCostMicros: number;
};

export type DailyPlanCompilationAttemptTrace = {
  readonly attemptIndex: number;
  readonly status: string;
  readonly providerId: string;
  readonly model: string;
  readonly message: string;
  readonly usage: DailyPlanCompilationUsage;
};

export type DailyPlanCompilationTrace = {
  readonly status: 'accepted' | 'fallback' | 'deterministic';
  readonly source: 'llm' | 'deterministic-fallback' | 'deterministic';
  readonly requestId?: string;
  readonly providerId?: string;
  readonly model?: string;
  readonly failureReason?: string;
  readonly message?: string;
  readonly attempts?: readonly DailyPlanCompilationAttemptTrace[];
  readonly usage?: DailyPlanCompilationUsage;
  readonly shortTermMemoryContext?: LlmShortTermMemoryContextTrace;
  readonly longTermProfileContext?: LlmLongTermProfileContextTrace;
  readonly worldDecisionContext?: WorldDecisionContextTrace;
};

export type DailyPlanCompilationResult = {
  readonly plan: DailyPlan;
  readonly planningTrace: DailyPlanCompilationTrace;
};

export type DailyPlanCompilerOutput = DailyPlan | DailyPlanCompilationResult;

export type DailyPlanCompiler = (
  input: DailyPlanCompilerInput,
) => DailyPlanCompilerOutput | Promise<DailyPlanCompilerOutput>;

export type NormalizedDailyPlanCompilation = {
  readonly plan: DailyPlan;
  readonly planningTrace?: DailyPlanCompilationTrace;
};

export type DailyPlanToScheduledIntentionsInput = {
  readonly plan: DailyPlan;
  readonly createdAt: SimulationTimestamp;
};

const baselineDailyPlanItems = [
  {
    id: 'early-rest',
    description: 'Rest during the early-morning routine at home.',
    priority: 2,
    startsAtOffsetMs: 0,
    endsAtOffsetMs: 6 * HOUR_MS,
    affinityTags: ['routine', 'sleep', 'energy', 'home'],
    source: 'baseline-routine',
  },
  {
    id: 'morning-study',
    description: 'Attend the morning study routine at school.',
    priority: 2,
    startsAtOffsetMs: 8 * HOUR_MS,
    endsAtOffsetMs: 12 * HOUR_MS,
    affinityTags: ['routine', 'study', 'education', 'school'],
    source: 'baseline-routine',
  },
  {
    id: 'midday-meal',
    description: 'Take a midday meal and social break at the restaurant.',
    priority: 2,
    startsAtOffsetMs: 12 * HOUR_MS,
    endsAtOffsetMs: 14 * HOUR_MS,
    affinityTags: ['routine', 'eat', 'satiety', 'social', 'restaurant'],
    source: 'baseline-routine',
  },
  {
    id: 'afternoon-work',
    description: 'Work through the afternoon routine at the workshop.',
    priority: 2,
    startsAtOffsetMs: 14 * HOUR_MS,
    endsAtOffsetMs: 18 * HOUR_MS,
    affinityTags: ['routine', 'work', 'income', 'workshop'],
    source: 'baseline-routine',
  },
  {
    id: 'evening-social',
    description: 'Socialize during the evening community routine at the town square.',
    priority: 2,
    startsAtOffsetMs: 18 * HOUR_MS,
    endsAtOffsetMs: 20 * HOUR_MS,
    affinityTags: ['routine', 'social', 'community', 'town-square'],
    source: 'baseline-routine',
  },
  {
    id: 'night-rest',
    description: 'Sleep during the night routine at home.',
    priority: 2,
    startsAtOffsetMs: 22 * HOUR_MS,
    endsAtOffsetMs: DAY_MS,
    affinityTags: ['routine', 'sleep', 'energy', 'home'],
    source: 'baseline-routine',
  },
] as const satisfies readonly DailyPlanItem[];

export function createDailyPlan(input: DailyPlan): DailyPlan {
  assertNonEmpty(input.id, 'daily plan id');
  assertFiniteNonNegative(input.dayStart, `daily plan ${input.id} dayStart`);
  assertFiniteNonNegative(input.generatedAt, `daily plan ${input.id} generatedAt`);
  assertNonEmpty(input.summary, `daily plan ${input.id} summary`);
  if (input.items.length === 0) {
    throw new Error(`daily plan ${input.id} requires at least one item`);
  }

  const itemIds = new Set<string>();
  const items = input.items.map((item) => {
    assertDailyPlanItem(item);
    if (itemIds.has(item.id)) {
      throw new Error(`duplicate daily plan item id ${item.id}`);
    }
    itemIds.add(item.id);
    return cloneDailyPlanItem(item);
  });

  return {
    id: input.id,
    agentId: input.agentId,
    dayStart: input.dayStart,
    generatedAt: input.generatedAt,
    summary: input.summary,
    items: items.sort(compareDailyPlanItems),
  };
}

export function normalizeDailyPlanCompilerOutput(
  output: DailyPlanCompilerOutput,
): NormalizedDailyPlanCompilation {
  if (isDailyPlanCompilationResult(output)) {
    return {
      plan: output.plan,
      planningTrace: output.planningTrace,
    };
  }

  return { plan: output };
}

export function compileDeterministicDailyPlan(input: DeterministicDailyPlanInput): DailyPlan {
  assertNonEmpty(input.agentId, 'agentId');
  assertFiniteNonNegative(input.issuedAt, 'issuedAt');

  const dayStart = Math.floor(input.issuedAt / DAY_MS) * DAY_MS;
  const itemsById = new Map<string, DailyPlanItem>();
  for (const item of baselineDailyPlanItems) {
    itemsById.set(item.id, cloneDailyPlanItem(item));
  }

  const jobShift = createJobPlanItem(input.agent?.job);
  if (jobShift !== undefined) {
    itemsById.set(jobShift.id, jobShift);
  }

  for (const recoveryItem of createPhysiologyRecoveryItems(input.agent?.physiology)) {
    itemsById.set(recoveryItem.id, recoveryItem);
  }

  const profileStudyItem = createProfileStudyItem(input.longTermProfile);
  if (profileStudyItem !== undefined) {
    itemsById.set(profileStudyItem.id, profileStudyItem);
  }

  const profileSocialItem = createProfileSocialItem(input.longTermProfile);
  if (profileSocialItem !== undefined) {
    itemsById.set(profileSocialItem.id, profileSocialItem);
  }

  const memorySocialItem = createMemorySocialFollowUpItem(input.memoryContext ?? []);
  if (memorySocialItem !== undefined) {
    itemsById.set(memorySocialItem.id, memorySocialItem);
  }

  return createDailyPlan({
    id: `daily-plan:${input.agentId}:${dayStart}`,
    agentId: input.agentId,
    dayStart,
    generatedAt: input.issuedAt,
    summary:
      'Plan the day around baseline routines, current world state, long-term profile, and recent memories.',
    items: [...itemsById.values()],
  });
}

function isDailyPlanCompilationResult(
  output: DailyPlanCompilerOutput,
): output is DailyPlanCompilationResult {
  return (
    typeof output === 'object' && output !== null && 'plan' in output && 'planningTrace' in output
  );
}

export function dailyPlanToScheduledIntentions(
  input: DailyPlanToScheduledIntentionsInput,
): readonly ScheduledIntention[] {
  const plan = createDailyPlan(input.plan);
  assertFiniteNonNegative(input.createdAt, 'createdAt');

  return plan.items
    .map((item): ScheduledIntention => {
      const provenanceRecordIds = item.evidenceRecordIds;
      return {
        id: `${plan.id}:${item.id}`,
        agentId: plan.agentId,
        sourcePlanId: plan.id,
        description: item.description,
        priority: item.priority,
        startsAt: plan.dayStart + item.startsAtOffsetMs,
        endsAt: plan.dayStart + item.endsAtOffsetMs,
        status: 'planned',
        affinityTags: uniqueTags(['daily-plan', ...item.affinityTags]),
        ...(provenanceRecordIds === undefined ? {} : { provenanceRecordIds }),
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
      };
    })
    .sort(compareScheduledIntentions);
}

function createJobPlanItem(job: string | null | undefined): DailyPlanItem | undefined {
  if (job === undefined || job === null || job.trim().length === 0) {
    return undefined;
  }

  const jobTag = slugifyTag(job);
  return {
    id: 'job-work-shift',
    description: `Work the scheduled ${job} shift.`,
    priority: 3,
    startsAtOffsetMs: 9 * HOUR_MS,
    endsAtOffsetMs: 17 * HOUR_MS,
    affinityTags: ['routine', 'work', 'income', 'job', jobTag],
    source: 'world-state',
  };
}

function createPhysiologyRecoveryItems(
  physiology: DailyPlanAgentPhysiologySnapshot | undefined,
): readonly DailyPlanItem[] {
  if (physiology === undefined) {
    return [];
  }

  const items: DailyPlanItem[] = [];
  if (physiology.health < 50) {
    items.push({
      id: 'health-recovery',
      description: 'Prioritize a doctor visit to recover health before routine obligations.',
      priority: 4,
      startsAtOffsetMs: 8 * HOUR_MS,
      endsAtOffsetMs: 10 * HOUR_MS,
      affinityTags: ['health', 'doctor', 'recovery', 'world-state'],
      source: 'world-state',
    });
  }
  if (physiology.satiety < 40) {
    items.push({
      id: 'satiety-recovery',
      description: 'Eat a meal early to recover satiety before longer activities.',
      priority: 4,
      startsAtOffsetMs: 7 * HOUR_MS,
      endsAtOffsetMs: 8 * HOUR_MS,
      affinityTags: ['eat', 'satiety', 'food', 'world-state'],
      source: 'world-state',
    });
  }
  if (physiology.energy < 35) {
    items.push({
      id: 'energy-recovery',
      description: 'Extend rest until energy is stable enough for the day.',
      priority: 4,
      startsAtOffsetMs: 6 * HOUR_MS,
      endsAtOffsetMs: 8 * HOUR_MS,
      affinityTags: ['sleep', 'rest', 'energy', 'world-state'],
      source: 'world-state',
    });
  }
  return items;
}

function createProfileStudyItem(
  profile: LongTermAgentProfile | undefined,
): DailyPlanItem | undefined {
  if (!hasStudyHabit(profile)) {
    return undefined;
  }

  return {
    id: 'profile-evening-study',
    description: 'Follow the learned evening self-study habit.',
    priority: 3,
    startsAtOffsetMs: 20 * HOUR_MS,
    endsAtOffsetMs: 22 * HOUR_MS,
    affinityTags: ['routine', 'study', 'education', 'profile', 'habit'],
    source: 'long-term-profile',
  };
}

function createProfileSocialItem(
  profile: LongTermAgentProfile | undefined,
): DailyPlanItem | undefined {
  if (!hasExtrovertedMbti(profile)) {
    return undefined;
  }

  return {
    id: 'profile-evening-social',
    description: 'Extend the evening social routine from extroverted profile preference.',
    priority: 2.5,
    startsAtOffsetMs: 20 * HOUR_MS,
    endsAtOffsetMs: 22 * HOUR_MS,
    affinityTags: ['routine', 'social', 'community', 'profile', 'mbti'],
    source: 'long-term-profile',
  };
}

function createMemorySocialFollowUpItem(
  records: readonly ShortTermMemoryRecord[],
): DailyPlanItem | undefined {
  const record = records.filter(isSocialPlanningMemory).sort(compareMemoryRecords)[0];
  if (record === undefined) {
    return undefined;
  }

  return {
    id: 'memory-social-follow-up',
    description: `Follow up on recent social plans from memory: ${summaryFragment(record.summary)}.`,
    priority: 3,
    startsAtOffsetMs: 18 * HOUR_MS,
    endsAtOffsetMs: 20 * HOUR_MS,
    affinityTags: uniqueTags([
      'social',
      'memory',
      ...record.tags.filter((tag) => normalizeText(tag) !== 'social'),
    ]),
    source: 'memory-context',
    evidenceRecordIds: [record.id],
  };
}

function hasStudyHabit(profile: LongTermAgentProfile | undefined): boolean {
  if (profile === undefined) {
    return false;
  }

  return profile.habits.some((entry) => {
    const context = `${entry.key} ${entry.statement}`.toLowerCase();
    return containsAny(context, ['study', 'education', 'learn', 'self-study']);
  });
}

function hasExtrovertedMbti(profile: LongTermAgentProfile | undefined): boolean {
  if (profile === undefined) {
    return false;
  }

  return profile.personality.some((entry) => {
    const match = /mbti:\s*([a-z]{4})/i.exec(entry.statement);
    return match?.[1]?.toUpperCase().startsWith('E') ?? false;
  });
}

function isSocialPlanningMemory(record: ShortTermMemoryRecord): boolean {
  const context = normalizeText(`${record.summary} ${record.tags.join(' ')}`);
  return (
    containsAny(context, ['social', 'party', 'invite', 'invited', 'coordinate', 'community']) &&
    record.status !== 'failed'
  );
}

function assertDailyPlanItem(item: DailyPlanItem): void {
  assertNonEmpty(item.id, 'daily plan item id');
  assertNonEmpty(item.description, `daily plan item ${item.id} description`);
  assertFiniteNonNegative(item.priority, `daily plan item ${item.id} priority`);
  assertFiniteNonNegative(item.startsAtOffsetMs, `daily plan item ${item.id} startsAtOffsetMs`);
  assertFiniteNonNegative(item.endsAtOffsetMs, `daily plan item ${item.id} endsAtOffsetMs`);
  if (item.endsAtOffsetMs <= item.startsAtOffsetMs) {
    throw new Error(`daily plan item ${item.id} end offset must be greater than start offset`);
  }
  if (item.endsAtOffsetMs > DAY_MS) {
    throw new Error(`daily plan item ${item.id} end offset must stay within a simulation day`);
  }
  assertAffinityTags(item.affinityTags, `daily plan item ${item.id}`);
  for (const recordId of item.evidenceRecordIds ?? []) {
    assertNonEmpty(recordId, `daily plan item ${item.id} evidence record id`);
  }
}

function cloneDailyPlanItem(item: DailyPlanItem): DailyPlanItem {
  return {
    id: item.id,
    description: item.description,
    priority: item.priority,
    startsAtOffsetMs: item.startsAtOffsetMs,
    endsAtOffsetMs: item.endsAtOffsetMs,
    affinityTags: [...item.affinityTags],
    source: item.source,
    ...(item.evidenceRecordIds === undefined
      ? {}
      : { evidenceRecordIds: [...item.evidenceRecordIds] }),
  };
}

function compareDailyPlanItems(left: DailyPlanItem, right: DailyPlanItem): number {
  if (left.startsAtOffsetMs !== right.startsAtOffsetMs) {
    return left.startsAtOffsetMs - right.startsAtOffsetMs;
  }
  if (left.priority !== right.priority) {
    return right.priority - left.priority;
  }
  return left.id.localeCompare(right.id);
}

function compareScheduledIntentions(left: ScheduledIntention, right: ScheduledIntention): number {
  if (left.startsAt !== right.startsAt) {
    return left.startsAt - right.startsAt;
  }
  if (left.priority !== right.priority) {
    return right.priority - left.priority;
  }
  return left.id.localeCompare(right.id);
}

function compareMemoryRecords(left: ShortTermMemoryRecord, right: ShortTermMemoryRecord): number {
  if (left.importanceScore !== right.importanceScore) {
    return right.importanceScore - left.importanceScore;
  }
  if (left.occurredAt !== right.occurredAt) {
    return right.occurredAt - left.occurredAt;
  }
  return left.id.localeCompare(right.id);
}

function uniqueTags(tags: readonly string[]): readonly string[] {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const tag of tags) {
    const normalized = normalizeText(tag);
    if (normalized.length === 0 || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    unique.push(normalized);
  }
  return unique;
}

function assertAffinityTags(tags: readonly string[], name: string): void {
  if (tags.length === 0) {
    throw new Error(`${name} affinityTags must not be empty`);
  }
  for (const tag of tags) {
    assertNonEmpty(tag, `${name} affinity tag`);
  }
}

function summaryFragment(summary: string): string {
  return summary.trim().replace(/[.!?]+$/u, '');
}

function slugifyTag(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  return slug.length === 0 ? 'job' : slug;
}

function containsAny(value: string, needles: readonly string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function assertNonEmpty(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${name} must not be empty`);
  }
}

function assertFiniteNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative finite number`);
  }
}
