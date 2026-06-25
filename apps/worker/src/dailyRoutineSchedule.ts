import {
  compileDeterministicDailyPlan,
  dailyPlanToScheduledIntentions,
  normalizeDailyPlanCompilerOutput,
  type DailyPlanCompilationTrace,
  type DailyPlanCompiler,
} from '@aivilization/agent-runtime';
import type {
  AgentIntentionRepository,
  LongTermAgentProfile,
  LongTermProfileEntry,
  LongTermProfileRepository,
  ScheduledIntention,
  ShortTermMemoryRepository,
} from '@aivilization/memory';
import type {
  DailyPlanRenewalPlanningTrace,
  DailyPlanRenewalTrace,
} from '@aivilization/observability';
import type { AgentId, SimulationTimestamp } from '@aivilization/sim-core';
import type { WorldAgentState, WorldProjection } from '@aivilization/world';
import { createWorldDecisionContextFromProjection } from './worldDecisionContext';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export type DailyRoutineSlot = {
  readonly slotId: string;
  readonly description: string;
  readonly priority: number;
  readonly startsAtOffsetMs: number;
  readonly endsAtOffsetMs: number;
  readonly affinityTags: readonly string[];
};

export type DailyRoutineSchedule = readonly DailyRoutineSlot[];

export type DailyRoutineScheduleResolverInput = {
  readonly agentId: AgentId;
  readonly agent: WorldAgentState;
  readonly longTermProfile?: LongTermAgentProfile;
  readonly baseSchedule?: DailyRoutineSchedule;
};

export type DailyRoutineScheduleResolver = (
  input: DailyRoutineScheduleResolverInput,
) => DailyRoutineSchedule;

export type DailyRoutineScheduledIntentionsInput = {
  readonly agentId: AgentId;
  readonly at: SimulationTimestamp;
  readonly createdAt?: SimulationTimestamp;
  readonly schedule?: DailyRoutineSchedule;
};

export type DailyRoutineRenewalResult = {
  readonly agentId: AgentId;
  readonly scheduledIntentionIds: readonly string[];
};

export type DailyPlanRenewalResult = DailyRoutineRenewalResult & {
  readonly dailyPlanId: string;
  readonly planningTrace?: DailyPlanCompilationTrace;
};

export type DailyPlanRenewalTraceScope = {
  readonly simulationId: string;
  readonly partitionKey: string;
};

export type DailyPlanRenewalTraceSink = {
  readonly record: (trace: DailyPlanRenewalTrace) => void | Promise<void>;
};

export const defaultDailyRoutineSchedule = [
  {
    slotId: 'early-rest',
    description: 'Rest during the early-morning routine at home.',
    priority: 2,
    startsAtOffsetMs: 0,
    endsAtOffsetMs: 6 * HOUR_MS,
    affinityTags: ['routine', 'sleep', 'energy', 'home'],
  },
  {
    slotId: 'morning-study',
    description: 'Attend the morning study routine at school.',
    priority: 2,
    startsAtOffsetMs: 8 * HOUR_MS,
    endsAtOffsetMs: 12 * HOUR_MS,
    affinityTags: ['routine', 'study', 'education', 'school'],
  },
  {
    slotId: 'midday-meal',
    description: 'Take a midday meal and social break at the restaurant.',
    priority: 2,
    startsAtOffsetMs: 12 * HOUR_MS,
    endsAtOffsetMs: 14 * HOUR_MS,
    affinityTags: ['routine', 'eat', 'satiety', 'social', 'restaurant'],
  },
  {
    slotId: 'afternoon-work',
    description: 'Work through the afternoon routine at the workshop.',
    priority: 2,
    startsAtOffsetMs: 14 * HOUR_MS,
    endsAtOffsetMs: 18 * HOUR_MS,
    affinityTags: ['routine', 'work', 'income', 'workshop'],
  },
  {
    slotId: 'evening-social',
    description: 'Socialize during the evening community routine at the town square.',
    priority: 2,
    startsAtOffsetMs: 18 * HOUR_MS,
    endsAtOffsetMs: 20 * HOUR_MS,
    affinityTags: ['routine', 'social', 'community', 'town-square'],
  },
  {
    slotId: 'night-rest',
    description: 'Sleep during the night routine at home.',
    priority: 2,
    startsAtOffsetMs: 22 * HOUR_MS,
    endsAtOffsetMs: DAY_MS,
    affinityTags: ['routine', 'sleep', 'energy', 'home'],
  },
] as const satisfies DailyRoutineSchedule;

export function createDailyRoutineScheduledIntentions(
  input: DailyRoutineScheduledIntentionsInput,
): readonly ScheduledIntention[] {
  assertNonEmpty(input.agentId, 'agentId');
  assertFiniteNonNegative(input.at, 'at');
  const createdAt = input.createdAt ?? input.at;
  assertFiniteNonNegative(createdAt, 'createdAt');

  const schedule = input.schedule ?? defaultDailyRoutineSchedule;
  const dayStart = Math.floor(input.at / DAY_MS) * DAY_MS;

  return schedule
    .map((slot) => createScheduledIntention({ agentId: input.agentId, slot, dayStart, createdAt }))
    .sort(compareScheduledIntentions);
}

export function createProfileAwareDailyRoutineSchedule(
  input: DailyRoutineScheduleResolverInput,
): DailyRoutineSchedule {
  assertNonEmpty(input.agentId, 'agentId');
  const slotsById = new Map<string, DailyRoutineSlot>();
  for (const slot of input.baseSchedule ?? defaultDailyRoutineSchedule) {
    assertSlot(slot);
    slotsById.set(slot.slotId, cloneSlot(slot));
  }

  const jobShift = createJobRoutineSlot(input.agent);
  if (jobShift !== undefined) {
    slotsById.set(jobShift.slotId, jobShift);
  }

  if (hasStudyHabit(input.longTermProfile)) {
    slotsById.set('habit-evening-study', {
      slotId: 'habit-evening-study',
      description: 'Follow the learned evening self-study habit.',
      priority: 3,
      startsAtOffsetMs: 20 * HOUR_MS,
      endsAtOffsetMs: 22 * HOUR_MS,
      affinityTags: ['routine', 'study', 'education', 'profile', 'habit'],
    });
  }

  if (hasExtrovertedMbti(input.longTermProfile)) {
    slotsById.set('profile-evening-social', {
      slotId: 'profile-evening-social',
      description: 'Extend the evening social routine from extroverted profile preference.',
      priority: 2.5,
      startsAtOffsetMs: 20 * HOUR_MS,
      endsAtOffsetMs: 22 * HOUR_MS,
      affinityTags: ['routine', 'social', 'community', 'profile', 'mbti'],
    });
  }

  return [...slotsById.values()].sort(compareSlots);
}

export async function renewDailyRoutineScheduledIntentions(input: {
  readonly projection: WorldProjection;
  readonly intentionRepository: AgentIntentionRepository;
  readonly longTermProfileRepository?: LongTermProfileRepository;
  readonly issuedAt: SimulationTimestamp;
  readonly schedule?: DailyRoutineSchedule;
  readonly resolveSchedule?: DailyRoutineScheduleResolver;
}): Promise<readonly DailyRoutineRenewalResult[]> {
  assertFiniteNonNegative(input.issuedAt, 'issuedAt');
  const results: DailyRoutineRenewalResult[] = [];
  const resolveSchedule = input.resolveSchedule ?? createProfileAwareDailyRoutineSchedule;

  for (const agentId of Object.keys(input.projection.agents).sort()) {
    const agent = input.projection.agents[agentId];
    if (agent === undefined) {
      continue;
    }

    const longTermProfile =
      input.longTermProfileRepository === undefined
        ? undefined
        : await input.longTermProfileRepository.getOrCreate(agent.agentId);
    const schedule = resolveSchedule({
      agentId: agent.agentId,
      agent,
      ...(longTermProfile === undefined ? {} : { longTermProfile }),
      baseSchedule: input.schedule ?? defaultDailyRoutineSchedule,
    });
    const scheduledIntentions = createDailyRoutineScheduledIntentions({
      agentId: agent.agentId,
      at: input.issuedAt,
      createdAt: input.issuedAt,
      schedule,
    });
    await input.intentionRepository.upsertScheduledIntentions(agent.agentId, scheduledIntentions);
    results.push({
      agentId: agent.agentId,
      scheduledIntentionIds: scheduledIntentions.map((intention) => intention.id),
    });
  }

  return results;
}

export async function renewDailyPlanScheduledIntentions(input: {
  readonly projection: WorldProjection;
  readonly intentionRepository: AgentIntentionRepository;
  readonly longTermProfileRepository?: LongTermProfileRepository;
  readonly shortTermMemoryRepository?: ShortTermMemoryRepository;
  readonly issuedAt: SimulationTimestamp;
  readonly memoryRetrievalLimit?: number;
  readonly compileDailyPlan?: DailyPlanCompiler;
  readonly dailyPlanRenewalTraceScope?: DailyPlanRenewalTraceScope;
  readonly dailyPlanRenewalTraceSink?: DailyPlanRenewalTraceSink;
}): Promise<readonly DailyPlanRenewalResult[]> {
  assertFiniteNonNegative(input.issuedAt, 'issuedAt');
  if (input.memoryRetrievalLimit !== undefined) {
    assertPositiveInteger(input.memoryRetrievalLimit, 'memoryRetrievalLimit');
  }
  if (input.dailyPlanRenewalTraceSink !== undefined) {
    if (input.dailyPlanRenewalTraceScope === undefined) {
      throw new Error(
        'dailyPlanRenewalTraceScope is required when dailyPlanRenewalTraceSink is provided',
      );
    }
    assertNonEmpty(
      input.dailyPlanRenewalTraceScope.simulationId,
      'dailyPlanRenewalTraceScope.simulationId',
    );
    assertNonEmpty(
      input.dailyPlanRenewalTraceScope.partitionKey,
      'dailyPlanRenewalTraceScope.partitionKey',
    );
  }

  const results: DailyPlanRenewalResult[] = [];
  const compileDailyPlan = input.compileDailyPlan ?? compileDeterministicDailyPlan;
  for (const agentId of Object.keys(input.projection.agents).sort()) {
    const agent = input.projection.agents[agentId];
    if (agent === undefined) {
      continue;
    }

    const [longTermProfile, memoryContext] = await Promise.all([
      input.longTermProfileRepository?.getOrCreate(agent.agentId),
      input.shortTermMemoryRepository === undefined
        ? Promise.resolve([])
        : input.shortTermMemoryRepository.retrieve({
            agentId: agent.agentId,
            limit: input.memoryRetrievalLimit ?? 12,
          }),
    ]);
    const compilation = normalizeDailyPlanCompilerOutput(
      await compileDailyPlan({
        agentId: agent.agentId,
        issuedAt: input.issuedAt,
        worldDecisionContext: createWorldDecisionContextFromProjection({
          projection: input.projection,
          agentId: agent.agentId,
        }),
        agent: {
          job: agent.job,
          locationId: agent.locationId,
          physiology: agent.physiology,
        },
        ...(longTermProfile === undefined ? {} : { longTermProfile }),
        memoryContext,
      }),
    );
    const dailyPlan = compilation.plan;
    const scheduledIntentions = dailyPlanToScheduledIntentions({
      plan: dailyPlan,
      createdAt: input.issuedAt,
    });
    await input.intentionRepository.upsertScheduledIntentions(agent.agentId, scheduledIntentions);
    if (
      input.dailyPlanRenewalTraceSink !== undefined &&
      input.dailyPlanRenewalTraceScope !== undefined
    ) {
      await input.dailyPlanRenewalTraceSink.record(
        createDailyPlanRenewalTrace({
          scope: input.dailyPlanRenewalTraceScope,
          agentId: agent.agentId,
          dailyPlanId: dailyPlan.id,
          scheduledIntentionIds: scheduledIntentions.map((intention) => intention.id),
          memoryContextIds: memoryContext.map((memory) => memory.id),
          ...(longTermProfile === undefined ? {} : { longTermProfile }),
          ...(compilation.planningTrace === undefined
            ? {}
            : { planningTrace: compilation.planningTrace }),
          issuedAt: input.issuedAt,
        }),
      );
    }
    results.push({
      agentId: agent.agentId,
      dailyPlanId: dailyPlan.id,
      scheduledIntentionIds: scheduledIntentions.map((intention) => intention.id),
      ...(compilation.planningTrace === undefined
        ? {}
        : { planningTrace: compilation.planningTrace }),
    });
  }

  return results;
}

function createDailyPlanRenewalTrace(input: {
  readonly scope: DailyPlanRenewalTraceScope;
  readonly agentId: AgentId;
  readonly dailyPlanId: string;
  readonly scheduledIntentionIds: readonly string[];
  readonly memoryContextIds: readonly string[];
  readonly longTermProfile?: LongTermAgentProfile;
  readonly planningTrace?: DailyPlanCompilationTrace;
  readonly issuedAt: SimulationTimestamp;
}): DailyPlanRenewalTrace {
  const profile = summarizeProfileTraceContext(input.longTermProfile);
  return {
    traceId: createDailyPlanRenewalTraceId({
      scope: input.scope,
      agentId: input.agentId,
      dailyPlanId: input.dailyPlanId,
      issuedAt: input.issuedAt,
    }),
    simulationId: input.scope.simulationId,
    partitionKey: input.scope.partitionKey,
    agentId: input.agentId,
    dailyPlanId: input.dailyPlanId,
    scheduledIntentionIds: [...input.scheduledIntentionIds],
    shortTermMemoryContextIds: [...input.memoryContextIds],
    profileEntryKeys: profile.profileEntryKeys,
    profileEvidenceRecordIds: profile.profileEvidenceRecordIds,
    ...(input.planningTrace === undefined
      ? {}
      : { planningTrace: cloneDailyPlanRenewalPlanningTrace(input.planningTrace) }),
    issuedAt: input.issuedAt,
  };
}

function createDailyPlanRenewalTraceId(input: {
  readonly scope: DailyPlanRenewalTraceScope;
  readonly agentId: AgentId;
  readonly dailyPlanId: string;
  readonly issuedAt: SimulationTimestamp;
}): string {
  return [
    'daily-plan-renewal',
    input.scope.simulationId,
    input.scope.partitionKey,
    input.agentId,
    input.dailyPlanId,
    String(input.issuedAt),
  ].join(':');
}

function summarizeProfileTraceContext(profile: LongTermAgentProfile | undefined): {
  readonly profileEntryKeys: readonly string[];
  readonly profileEvidenceRecordIds: readonly string[];
} {
  if (profile === undefined) {
    return { profileEntryKeys: [], profileEvidenceRecordIds: [] };
  }
  const profileEntryKeys: string[] = [];
  const profileEvidenceRecordIds = new Set<string>();
  for (const section of [
    'beliefs',
    'habits',
    'mood',
    'values',
    'personality',
    'socialRecords',
  ] as const) {
    for (const entry of profile[section]) {
      profileEntryKeys.push(formatProfileEntryKey(section, entry));
      for (const recordId of entry.provenanceRecordIds) {
        profileEvidenceRecordIds.add(recordId);
      }
    }
  }
  return {
    profileEntryKeys,
    profileEvidenceRecordIds: [...profileEvidenceRecordIds],
  };
}

function formatProfileEntryKey(
  section: keyof Pick<
    LongTermAgentProfile,
    'beliefs' | 'habits' | 'mood' | 'values' | 'personality' | 'socialRecords'
  >,
  entry: LongTermProfileEntry,
): string {
  return `${section}:${entry.key}`;
}

function cloneDailyPlanRenewalPlanningTrace(
  trace: DailyPlanCompilationTrace,
): DailyPlanRenewalPlanningTrace {
  return {
    status: trace.status,
    source: trace.source,
    ...(trace.requestId === undefined ? {} : { requestId: trace.requestId }),
    ...(trace.providerId === undefined ? {} : { providerId: trace.providerId }),
    ...(trace.model === undefined ? {} : { model: trace.model }),
    ...(trace.failureReason === undefined ? {} : { failureReason: trace.failureReason }),
    ...(trace.message === undefined ? {} : { message: trace.message }),
    ...(trace.attempts === undefined
      ? {}
      : {
          attempts: trace.attempts.map((attempt) => ({
            attemptIndex: attempt.attemptIndex,
            status: attempt.status,
            providerId: attempt.providerId,
            model: attempt.model,
            message: attempt.message,
            usage: {
              inputTokens: attempt.usage.inputTokens,
              outputTokens: attempt.usage.outputTokens,
              totalTokens: attempt.usage.totalTokens,
              estimatedCostMicros: attempt.usage.estimatedCostMicros,
            },
          })),
        }),
    ...(trace.usage === undefined
      ? {}
      : {
          usage: {
            inputTokens: trace.usage.inputTokens,
            outputTokens: trace.usage.outputTokens,
            totalTokens: trace.usage.totalTokens,
            estimatedCostMicros: trace.usage.estimatedCostMicros,
          },
        }),
    ...(trace.worldDecisionContext === undefined
      ? {}
      : { worldDecisionContext: { ...trace.worldDecisionContext } }),
  };
}

function createJobRoutineSlot(agent: WorldAgentState): DailyRoutineSlot | undefined {
  if (agent.job === null || agent.job.trim().length === 0) {
    return undefined;
  }

  const jobTag = slugifyTag(agent.job);
  return {
    slotId: 'job-work-shift',
    description: `Work the scheduled ${agent.job} shift.`,
    priority: 3,
    startsAtOffsetMs: 9 * HOUR_MS,
    endsAtOffsetMs: 17 * HOUR_MS,
    affinityTags: ['routine', 'work', 'income', 'job', jobTag],
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

function createScheduledIntention(input: {
  readonly agentId: AgentId;
  readonly slot: DailyRoutineSlot;
  readonly dayStart: SimulationTimestamp;
  readonly createdAt: SimulationTimestamp;
}): ScheduledIntention {
  assertSlot(input.slot);
  return {
    id: `daily-routine:${input.agentId}:${input.dayStart}:${input.slot.slotId}`,
    agentId: input.agentId,
    description: input.slot.description,
    priority: input.slot.priority,
    startsAt: input.dayStart + input.slot.startsAtOffsetMs,
    endsAt: input.dayStart + input.slot.endsAtOffsetMs,
    status: 'planned',
    affinityTags: [...input.slot.affinityTags],
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  };
}

function cloneSlot(slot: DailyRoutineSlot): DailyRoutineSlot {
  return {
    slotId: slot.slotId,
    description: slot.description,
    priority: slot.priority,
    startsAtOffsetMs: slot.startsAtOffsetMs,
    endsAtOffsetMs: slot.endsAtOffsetMs,
    affinityTags: [...slot.affinityTags],
  };
}

function assertSlot(slot: DailyRoutineSlot): void {
  assertNonEmpty(slot.slotId, 'slotId');
  assertNonEmpty(slot.description, `slot ${slot.slotId} description`);
  assertFiniteNonNegative(slot.priority, `slot ${slot.slotId} priority`);
  assertFiniteNonNegative(slot.startsAtOffsetMs, `slot ${slot.slotId} startsAtOffsetMs`);
  assertFiniteNonNegative(slot.endsAtOffsetMs, `slot ${slot.slotId} endsAtOffsetMs`);
  if (slot.startsAtOffsetMs >= slot.endsAtOffsetMs) {
    throw new Error(`slot ${slot.slotId} end offset must be greater than start offset`);
  }
  if (slot.endsAtOffsetMs > DAY_MS) {
    throw new Error(`slot ${slot.slotId} end offset must stay within a simulation day`);
  }
  if (slot.affinityTags.length === 0) {
    throw new Error(`slot ${slot.slotId} affinityTags must not be empty`);
  }
  for (const tag of slot.affinityTags) {
    assertNonEmpty(tag, `slot ${slot.slotId} affinity tag`);
  }
}

function compareSlots(left: DailyRoutineSlot, right: DailyRoutineSlot): number {
  if (left.startsAtOffsetMs !== right.startsAtOffsetMs) {
    return left.startsAtOffsetMs - right.startsAtOffsetMs;
  }
  if (left.priority !== right.priority) {
    return right.priority - left.priority;
  }
  return left.slotId.localeCompare(right.slotId);
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

function containsAny(value: string, needles: readonly string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}

function slugifyTag(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  return slug.length === 0 ? 'job' : slug;
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

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
}
