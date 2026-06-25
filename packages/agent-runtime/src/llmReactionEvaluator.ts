import type {
  LlmGatewayPricing,
  LlmSchemaParseResult,
  LlmStructuredFailure,
  LlmStructuredProvider,
  LlmStructuredResult,
  LlmStructuredSuccess,
} from '@aivilization/llm';
import { runStructuredLlmRequest, type LlmStructuredOutputSchema } from '@aivilization/llm';
import {
  evaluateDeterministicSocialObservationReaction,
  normalizeReactionDecision,
  normalizeReactionEvaluatorOutput,
  type ReactionDecision,
  type ReactionEvaluationResult,
  type ReactionEvaluationTrace,
  type ReactionEvaluator,
  type ReactionEvaluatorInput,
} from './reactionEvaluation';

export type LlmReactionDecisionProposal = ReactionDecision;

export type LlmReactionEvaluatorInput = ReactionEvaluatorInput & {
  readonly provider: LlmStructuredProvider;
  readonly model: string;
  readonly requestId: string;
  readonly maxAttempts?: number;
  readonly timeoutMs?: number;
  readonly pricing?: LlmGatewayPricing;
  readonly fallbackEvaluator?: ReactionEvaluator;
};

export type LlmReactionAcceptedResult = {
  readonly status: 'accepted';
  readonly source: 'llm';
  readonly decision: ReactionDecision;
  readonly gateway: LlmStructuredSuccess<ReactionDecision>;
};

export type LlmReactionFallbackResult = {
  readonly status: 'fallback';
  readonly source: 'deterministic-fallback';
  readonly decision: ReactionDecision;
  readonly failure: LlmStructuredFailure;
};

export type LlmReactionResult = LlmReactionAcceptedResult | LlmReactionFallbackResult;

export const llmReactionDecisionSchema: LlmStructuredOutputSchema<ReactionDecision> = {
  name: 'aivilization_reaction_decision',
  parse: (value) => parseReactionDecisionProposal(value),
};

export async function proposeReactionWithLlm(
  input: LlmReactionEvaluatorInput,
): Promise<LlmReactionResult> {
  const gateway = await runStructuredLlmRequest({
    provider: input.provider,
    schema: llmReactionDecisionSchema,
    request: {
      requestId: input.requestId,
      model: input.model,
      messages: createReactionEvaluatorMessages(input),
      tools: [reactionDecisionToolContract],
      ...(input.maxAttempts === undefined ? {} : { maxAttempts: input.maxAttempts }),
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
    },
    ...(input.pricing === undefined ? {} : { pricing: input.pricing }),
  });

  if (gateway.status === 'succeeded') {
    return {
      status: 'accepted',
      source: 'llm',
      decision: gateway.value,
      gateway,
    };
  }

  return {
    status: 'fallback',
    source: 'deterministic-fallback',
    decision: await evaluateFallbackReaction(input),
    failure: gateway,
  };
}

export function createLlmReactionEvaluator(input: {
  readonly provider: LlmStructuredProvider;
  readonly model: string;
  readonly requestId: (input: ReactionEvaluatorInput) => string;
  readonly maxAttempts?: number;
  readonly timeoutMs?: number;
  readonly pricing?: LlmGatewayPricing;
  readonly fallbackEvaluator?: ReactionEvaluator;
}): ReactionEvaluator {
  return async (evaluatorInput) => {
    const result = await proposeReactionWithLlm({
      ...evaluatorInput,
      provider: input.provider,
      model: input.model,
      requestId: input.requestId(evaluatorInput),
      ...(input.maxAttempts === undefined ? {} : { maxAttempts: input.maxAttempts }),
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
      ...(input.pricing === undefined ? {} : { pricing: input.pricing }),
      ...(input.fallbackEvaluator === undefined
        ? {}
        : { fallbackEvaluator: input.fallbackEvaluator }),
    });

    return result.decision;
  };
}

export function createTraceableLlmReactionEvaluator(input: {
  readonly provider: LlmStructuredProvider;
  readonly model: string;
  readonly requestId: (input: ReactionEvaluatorInput) => string;
  readonly maxAttempts?: number;
  readonly timeoutMs?: number;
  readonly pricing?: LlmGatewayPricing;
  readonly fallbackEvaluator?: ReactionEvaluator;
}): ReactionEvaluator {
  return async (evaluatorInput) => {
    const result = await proposeReactionWithLlm({
      ...evaluatorInput,
      provider: input.provider,
      model: input.model,
      requestId: input.requestId(evaluatorInput),
      ...(input.maxAttempts === undefined ? {} : { maxAttempts: input.maxAttempts }),
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
      ...(input.pricing === undefined ? {} : { pricing: input.pricing }),
      ...(input.fallbackEvaluator === undefined
        ? {}
        : { fallbackEvaluator: input.fallbackEvaluator }),
    });

    return {
      decision: result.decision,
      reactionTrace: mapLlmReactionTrace(result),
    } satisfies ReactionEvaluationResult;
  };
}

const reactionDecisionToolContract = {
  name: 'submit_reaction_decision',
  description:
    'Submit a validated memory reaction decision. The proposal is untrusted until agent-runtime validates it.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['kind', 'confidence', 'rationale'],
    properties: {
      kind: { type: 'string', enum: ['ignore', 'follow-up'] },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      rationale: { type: 'string', minLength: 1 },
      description: { type: 'string', minLength: 1 },
      priority: { type: 'number' },
      reactionWindowMs: { type: 'number' },
      affinityTags: { type: 'array', items: { type: 'string' } },
    },
  },
};

function createReactionEvaluatorMessages(
  input: ReactionEvaluatorInput,
): readonly { readonly role: 'system' | 'user'; readonly content: string }[] {
  return [
    {
      role: 'system',
      content:
        'You are the AIvilization reaction evaluator. Return only JSON matching the aivilization_reaction_decision schema. Decide whether the agent should ignore this memory or schedule a later follow-up; never propose executable world commands or mutate state.',
    },
    {
      role: 'user',
      content: JSON.stringify({
        agentId: input.agentId,
        issuedAt: input.issuedAt,
        memory: serializeMemory(input.memory),
        ...(input.worldDecisionContext === undefined
          ? {}
          : { worldDecisionContext: input.worldDecisionContext }),
        longTermProfile: input.longTermProfile ?? null,
        memoryContext: (input.memoryContext ?? []).map(serializeMemory),
        constraints: [
          'Output a reaction decision only.',
          'Use ignore when the memory is not actionable or not relevant to this agent.',
          'Use follow-up only when the memory should create a scheduled intention.',
          'For follow-up, include description, priority, reactionWindowMs, and affinityTags.',
          'Do not emit world commands, dialogue text to execute immediately, or object mutations.',
        ],
      }),
    },
  ];
}

function parseReactionDecisionProposal(value: unknown): LlmSchemaParseResult<ReactionDecision> {
  try {
    const proposal = readReactionDecisionProposal(value);
    return {
      status: 'valid',
      value: proposal,
    };
  } catch (error) {
    return {
      status: 'invalid',
      reason: `reaction decision candidate invalid: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

function readReactionDecisionProposal(value: unknown): LlmReactionDecisionProposal {
  const record = readRecord(value, 'reaction decision candidate');
  const kind = readReactionDecisionKind(record.kind, 'reaction kind');
  if (kind === 'ignore') {
    return normalizeReactionDecision({
      kind,
      confidence: readNumber(record.confidence, 'reaction confidence'),
      rationale: readString(record.rationale, 'reaction rationale'),
    });
  }

  return normalizeReactionDecision({
    kind,
    confidence: readNumber(record.confidence, 'reaction confidence'),
    rationale: readString(record.rationale, 'reaction rationale'),
    description: readString(record.description, 'follow-up reaction description'),
    priority: readNumber(record.priority, 'follow-up reaction priority'),
    reactionWindowMs: readNumber(record.reactionWindowMs, 'follow-up reaction window'),
    affinityTags: readStringArray(record.affinityTags, 'follow-up reaction affinityTags'),
  });
}

async function evaluateFallbackReaction(
  input: LlmReactionEvaluatorInput,
): Promise<ReactionDecision> {
  const fallbackOutput = await input.fallbackEvaluator?.({
    agentId: input.agentId,
    issuedAt: input.issuedAt,
    memory: input.memory,
    ...(input.longTermProfile === undefined ? {} : { longTermProfile: input.longTermProfile }),
    ...(input.memoryContext === undefined ? {} : { memoryContext: input.memoryContext }),
    ...(input.worldDecisionContext === undefined
      ? {}
      : { worldDecisionContext: input.worldDecisionContext }),
  });
  if (fallbackOutput !== undefined) {
    return normalizeReactionEvaluatorOutput(fallbackOutput).decision;
  }

  return evaluateDeterministicSocialObservationReaction({
    agentId: input.agentId,
    issuedAt: input.issuedAt,
    memory: input.memory,
    ...(input.longTermProfile === undefined ? {} : { longTermProfile: input.longTermProfile }),
    ...(input.memoryContext === undefined ? {} : { memoryContext: input.memoryContext }),
    ...(input.worldDecisionContext === undefined
      ? {}
      : { worldDecisionContext: input.worldDecisionContext }),
  }).decision;
}

function mapLlmReactionTrace(result: LlmReactionResult): ReactionEvaluationTrace {
  const gateway = getGatewayResult(result);
  const lastAttempt = gateway.attempts.at(-1);
  return {
    status: result.status === 'accepted' ? 'accepted' : 'fallback',
    source: result.source,
    requestId: gateway.requestId,
    ...(lastAttempt === undefined ? {} : { providerId: lastAttempt.providerId }),
    ...(lastAttempt === undefined ? {} : { model: lastAttempt.model }),
    ...(gateway.status === 'failed' ? { failureReason: gateway.reason } : {}),
    ...(gateway.status === 'failed' ? { message: gateway.message } : {}),
    attempts: gateway.attempts.map((attempt) => ({
      attemptIndex: attempt.attemptIndex,
      status: attempt.status,
      providerId: attempt.providerId,
      model: attempt.model,
      message: attempt.message,
      usage: { ...attempt.usage },
    })),
    usage: { ...gateway.usage },
  };
}

function getGatewayResult(result: LlmReactionResult): LlmStructuredResult<ReactionDecision> {
  return result.status === 'accepted' ? result.gateway : result.failure;
}

function serializeMemory(record: ReactionEvaluatorInput['memory']) {
  return {
    id: record.id,
    agentId: record.agentId,
    kind: record.kind,
    status: record.status,
    summary: record.summary,
    occurredAt: record.occurredAt,
    importanceScore: record.importanceScore,
    source: record.source,
    tags: record.tags,
  };
}

function readRecord(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function readString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function readNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  return value;
}

function readArray(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value;
}

function readStringArray(value: unknown, label: string): readonly string[] {
  return readArray(value, label).map((item, index) => readString(item, `${label} ${index}`));
}

function readReactionDecisionKind(value: unknown, label: string): ReactionDecision['kind'] {
  const kind = readString(value, label);
  if (kind !== 'ignore' && kind !== 'follow-up') {
    throw new Error(`${label} must be ignore or follow-up`);
  }
  return kind;
}
