import type { AgentIntentionRepository, ScheduledIntention } from '@aivilization/memory';
import type { AgentId, SimulationTimestamp } from '@aivilization/sim-core';
import type { WorldProjection } from '@aivilization/world';

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

export async function renewDailyRoutineScheduledIntentions(input: {
  readonly projection: WorldProjection;
  readonly intentionRepository: AgentIntentionRepository;
  readonly issuedAt: SimulationTimestamp;
  readonly schedule?: DailyRoutineSchedule;
}): Promise<readonly DailyRoutineRenewalResult[]> {
  assertFiniteNonNegative(input.issuedAt, 'issuedAt');
  const results: DailyRoutineRenewalResult[] = [];

  for (const agentId of Object.keys(input.projection.agents).sort()) {
    const agent = input.projection.agents[agentId];
    if (agent === undefined) {
      continue;
    }

    const scheduledIntentions = createDailyRoutineScheduledIntentions({
      agentId: agent.agentId,
      at: input.issuedAt,
      createdAt: input.issuedAt,
      ...(input.schedule === undefined ? {} : { schedule: input.schedule }),
    });
    await input.intentionRepository.upsertScheduledIntentions(
      agent.agentId,
      scheduledIntentions,
    );
    results.push({
      agentId: agent.agentId,
      scheduledIntentionIds: scheduledIntentions.map((intention) => intention.id),
    });
  }

  return results;
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

function compareScheduledIntentions(
  left: ScheduledIntention,
  right: ScheduledIntention,
): number {
  if (left.startsAt !== right.startsAt) {
    return left.startsAt - right.startsAt;
  }
  if (left.priority !== right.priority) {
    return right.priority - left.priority;
  }
  return left.id.localeCompare(right.id);
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
