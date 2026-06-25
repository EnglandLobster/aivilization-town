import type { ScheduledIntention, ShortTermMemoryRecord } from '@aivilization/memory';

const DEFAULT_SOCIAL_OBSERVATION_REACTION_WINDOW_MS = 2 * 60 * 60 * 1000;
const DEFAULT_SOCIAL_OBSERVATION_PRIORITY = 4;
const SOCIAL_OBSERVATION_EVENT_TAGS = new Set([
  'ConversationRecorded',
  'SocialInteractionCompleted',
]);

export type SocialObservationScheduledIntentionsInput = {
  readonly records: readonly ShortTermMemoryRecord[];
  readonly reactionWindowMs?: number;
  readonly priority?: number;
  readonly createdAt?: number;
};

export function createSocialObservationScheduledIntentions(
  input: SocialObservationScheduledIntentionsInput,
): readonly ScheduledIntention[] {
  const reactionWindowMs = input.reactionWindowMs ?? DEFAULT_SOCIAL_OBSERVATION_REACTION_WINDOW_MS;
  const priority = input.priority ?? DEFAULT_SOCIAL_OBSERVATION_PRIORITY;
  assertPositiveFinite(reactionWindowMs, 'reactionWindowMs');
  assertFinite(priority, 'priority');
  if (input.createdAt !== undefined) {
    assertFinite(input.createdAt, 'createdAt');
  }

  const recordsBySocialEventKey = new Map<string, ShortTermMemoryRecord>();
  for (const record of input.records) {
    if (!isSocialObservationMemory(record)) {
      continue;
    }
    const key = createSocialEventKey(record);
    const existing = recordsBySocialEventKey.get(key);
    if (existing === undefined || compareSocialObservationMemoryPreference(record, existing) < 0) {
      recordsBySocialEventKey.set(key, record);
    }
  }

  const intentionsById = new Map<string, ScheduledIntention>();
  for (const record of recordsBySocialEventKey.values()) {
    const intention = createSocialObservationScheduledIntention({
      record,
      reactionWindowMs,
      priority,
      createdAt: input.createdAt ?? record.occurredAt,
    });
    intentionsById.set(intention.id, intention);
  }

  return [...intentionsById.values()].sort(compareScheduledIntentions);
}

function createSocialObservationScheduledIntention(input: {
  readonly record: ShortTermMemoryRecord;
  readonly reactionWindowMs: number;
  readonly priority: number;
  readonly createdAt: number;
}): ScheduledIntention {
  return {
    id: `social-observation:${input.record.agentId}:${input.record.id}`,
    agentId: input.record.agentId,
    description: `Follow up on observed social event: ${ensureSentence(input.record.summary)}`,
    priority: input.priority,
    startsAt: input.record.occurredAt,
    endsAt: input.record.occurredAt + input.reactionWindowMs,
    status: 'planned',
    affinityTags: createSocialObservationAffinityTags(input.record),
    provenanceRecordIds: [input.record.id],
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  };
}

function isSocialObservationMemory(record: ShortTermMemoryRecord): boolean {
  return (
    record.kind === 'observation' &&
    record.status === 'observed' &&
    record.tags.includes('ambient-observation') &&
    record.tags.some((tag) => SOCIAL_OBSERVATION_EVENT_TAGS.has(tag))
  );
}

function createSocialObservationAffinityTags(record: ShortTermMemoryRecord): readonly string[] {
  return stableUnique([
    'social',
    'community',
    'relationship',
    'observation-follow-up',
    ...record.tags.filter((tag) => tag !== 'ambient-observation'),
  ]);
}

function createSocialEventKey(record: ShortTermMemoryRecord): string {
  const commandId = record.source.commandId;
  return commandId === undefined
    ? `${record.agentId}:record:${record.id}`
    : `${record.agentId}:command:${commandId}`;
}

function compareSocialObservationMemoryPreference(
  left: ShortTermMemoryRecord,
  right: ShortTermMemoryRecord,
): number {
  const leftRank = socialObservationMemoryRank(left);
  const rightRank = socialObservationMemoryRank(right);
  if (leftRank !== rightRank) {
    return leftRank - rightRank;
  }
  if (left.occurredAt !== right.occurredAt) {
    return left.occurredAt - right.occurredAt;
  }
  return left.id.localeCompare(right.id);
}

function socialObservationMemoryRank(record: ShortTermMemoryRecord): number {
  return record.tags.includes('ConversationRecorded') ? 0 : 1;
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

function ensureSentence(value: string): string {
  const trimmed = value.trim();
  if (trimmed.endsWith('.') || trimmed.endsWith('!') || trimmed.endsWith('?')) {
    return trimmed;
  }
  return `${trimmed}.`;
}

function stableUnique(values: readonly string[]): readonly string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function assertPositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive finite number`);
  }
}

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be finite`);
  }
}
