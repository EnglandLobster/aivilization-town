import {
  evaluateDeterministicSocialObservationReaction,
  normalizeReactionEvaluatorOutput,
  type ReactionDecision,
  type ReactionEvaluationTrace,
  type ReactionEvaluator,
  type WorldDecisionContext,
} from '@aivilization/agent-runtime';
import type {
  LongTermAgentProfile,
  ScheduledIntention,
  ShortTermMemoryRecord,
} from '@aivilization/memory';
import { summarizeObservedAgentState } from './agentStateSummary';

const SOCIAL_OBSERVATION_EVENT_TAGS = new Set([
  'ConversationRecorded',
  'SocialInteractionCompleted',
]);

export type SocialObservationScheduledIntentionsInput = {
  readonly records: readonly ShortTermMemoryRecord[];
  readonly reactionWindowMs?: number;
  readonly priority?: number;
  readonly createdAt?: number;
  readonly worldDecisionContextByAgentId?: Readonly<Record<string, WorldDecisionContext>>;
  readonly longTermProfileByAgentId?: Readonly<Record<string, LongTermAgentProfile>>;
  readonly memoryContextByAgentId?: Readonly<Record<string, readonly ShortTermMemoryRecord[]>>;
  readonly reactionEvaluator?: ReactionEvaluator;
};

export type SocialObservationReactionEvaluation = {
  readonly memoryRecord: ShortTermMemoryRecord;
  readonly decision: ReactionDecision;
  readonly reactionTrace?: ReactionEvaluationTrace;
  readonly scheduledIntention?: ScheduledIntention;
};

export type TraceableSocialObservationScheduledIntentionsResult = {
  readonly intentions: readonly ScheduledIntention[];
  readonly evaluations: readonly SocialObservationReactionEvaluation[];
};

export async function createSocialObservationScheduledIntentions(
  input: SocialObservationScheduledIntentionsInput,
): Promise<readonly ScheduledIntention[]> {
  return (await createTraceableSocialObservationScheduledIntentions(input)).intentions;
}

export async function createTraceableSocialObservationScheduledIntentions(
  input: SocialObservationScheduledIntentionsInput,
): Promise<TraceableSocialObservationScheduledIntentionsResult> {
  if (input.reactionWindowMs !== undefined) {
    assertPositiveFinite(input.reactionWindowMs, 'reactionWindowMs');
  }
  if (input.priority !== undefined) {
    assertFinite(input.priority, 'priority');
  }
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
  const evaluations: SocialObservationReactionEvaluation[] = [];
  const reactionEvaluator =
    input.reactionEvaluator ?? evaluateDeterministicSocialObservationReaction;
  for (const record of recordsBySocialEventKey.values()) {
    const worldDecisionContext = input.worldDecisionContextByAgentId?.[record.agentId];
    const longTermProfile = input.longTermProfileByAgentId?.[record.agentId];
    const memoryContext = input.memoryContextByAgentId?.[record.agentId];
    const evaluation = normalizeReactionEvaluatorOutput(
      await reactionEvaluator({
        agentId: record.agentId,
        issuedAt: input.createdAt ?? record.occurredAt,
        memory: record,
        ...(worldDecisionContext === undefined
          ? {}
          : { observedStateSummary: summarizeObservedAgentState(worldDecisionContext.agent) }),
        ...(worldDecisionContext === undefined ? {} : { worldDecisionContext }),
        ...(longTermProfile === undefined ? {} : { longTermProfile }),
        ...(memoryContext === undefined ? {} : { memoryContext }),
      }),
    );
    if (evaluation.decision.kind === 'ignore') {
      evaluations.push({
        memoryRecord: record,
        decision: evaluation.decision,
        ...(evaluation.reactionTrace === undefined
          ? {}
          : { reactionTrace: evaluation.reactionTrace }),
      });
      continue;
    }
    const intention = createSocialObservationScheduledIntention({
      record,
      decision: evaluation.decision,
      reactionWindowMs: input.reactionWindowMs ?? evaluation.decision.reactionWindowMs,
      priority: input.priority ?? evaluation.decision.priority,
      createdAt: input.createdAt ?? record.occurredAt,
    });
    intentionsById.set(intention.id, intention);
    evaluations.push({
      memoryRecord: record,
      decision: evaluation.decision,
      ...(evaluation.reactionTrace === undefined
        ? {}
        : { reactionTrace: evaluation.reactionTrace }),
      scheduledIntention: intention,
    });
  }

  return {
    intentions: [...intentionsById.values()].sort(compareScheduledIntentions),
    evaluations,
  };
}

function createSocialObservationScheduledIntention(input: {
  readonly record: ShortTermMemoryRecord;
  readonly decision: Extract<ReactionDecision, { readonly kind: 'follow-up' }>;
  readonly reactionWindowMs: number;
  readonly priority: number;
  readonly createdAt: number;
}): ScheduledIntention {
  return {
    id: `social-observation:${input.record.agentId}:${input.record.id}`,
    agentId: input.record.agentId,
    description: input.decision.description,
    priority: input.priority,
    startsAt: input.record.occurredAt,
    endsAt: input.record.occurredAt + input.reactionWindowMs,
    status: 'planned',
    affinityTags: input.decision.affinityTags,
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
