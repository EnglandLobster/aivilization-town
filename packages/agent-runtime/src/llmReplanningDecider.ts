import type {
  LlmGatewayPricing,
  LlmSchemaParseResult,
  LlmStructuredFailure,
  LlmStructuredProvider,
  LlmStructuredSuccess,
} from '@aivilization/llm';
import { runStructuredLlmRequest, type LlmStructuredOutputSchema } from '@aivilization/llm';
import type { MemoryRecordId } from '@aivilization/memory';
import { createLlmCognitiveContextTrace } from './llmContextTrace';
import {
  createDeterministicReplanningDecisionResult,
  type ReplanningDecider,
  type ReplanningDeciderInput,
  type ReplanningDecision,
  type ReplanningDecisionResult,
  type ReplanningDecisionTrace,
} from './replanning';
import {
  createWorldDecisionContextTrace,
  type WorldDecisionContext,
} from './worldDecisionContext';

export type LlmReplanningDecisionProposal = {
  readonly decision: ReplanningDecision;
};

export type LlmReplanningDeciderInput = ReplanningDeciderInput & {
  readonly provider: LlmStructuredProvider;
  readonly model: string;
  readonly requestId: string;
  readonly maxAttempts?: number;
  readonly timeoutMs?: number;
  readonly pricing?: LlmGatewayPricing;
};

export type LlmReplanningDecisionAcceptedResult = ReplanningDecisionResult & {
  readonly status: 'accepted';
  readonly source: 'llm';
  readonly gateway: LlmStructuredSuccess<LlmReplanningDecisionProposal>;
};

export type LlmReplanningDecisionFallbackResult = ReplanningDecisionResult & {
  readonly status: 'fallback';
  readonly source: 'deterministic-fallback';
  readonly failure: LlmStructuredFailure | LlmStructuredSuccess<LlmReplanningDecisionProposal>;
};

export type LlmReplanningDecisionResult =
  | LlmReplanningDecisionAcceptedResult
  | LlmReplanningDecisionFallbackResult;

export const llmReplanningDecisionSchema: LlmStructuredOutputSchema<LlmReplanningDecisionProposal> =
  {
    name: 'aivilization_replanning_decision',
    parse: (value) => parseReplanningDecisionProposal(value),
  };

export async function proposeReplanningDecisionWithLlm(
  input: LlmReplanningDeciderInput,
): Promise<LlmReplanningDecisionResult> {
  const fallback = createDeterministicReplanningDecisionResult(input);
  const gateway = await runStructuredLlmRequest({
    provider: input.provider,
    schema: llmReplanningDecisionSchema,
    request: {
      requestId: input.requestId,
      model: input.model,
      messages: createReplanningDecisionMessages({
        input,
        deterministicFallbackDecision: fallback.decision,
      }),
      tools: [replanningDecisionToolContract],
      ...(input.maxAttempts === undefined ? {} : { maxAttempts: input.maxAttempts }),
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
    },
    ...(input.pricing === undefined ? {} : { pricing: input.pricing }),
  });

  if (gateway.status === 'failed') {
    return createFallbackResult({
      input,
      fallback,
      failure: gateway,
      failureReason: gateway.reason,
      message: gateway.message,
    });
  }

  try {
    validateReplanningDecision({
      input,
      decision: gateway.value.decision,
    });
    return {
      status: 'accepted',
      source: 'llm',
      decision: gateway.value.decision,
      trace: mapAcceptedTrace({
        input,
        gateway,
        decision: gateway.value.decision,
      }),
      gateway,
    };
  } catch (error) {
    return createFallbackResult({
      input,
      fallback,
      failure: gateway,
      failureReason: 'schema-invalid',
      message: `replanning decision invalid: ${
        error instanceof Error ? error.message : String(error)
      }`,
    });
  }
}

export function createTraceableLlmReplanningDecider(input: {
  readonly provider: LlmStructuredProvider;
  readonly model: string;
  readonly requestId: (input: ReplanningDeciderInput) => string;
  readonly maxAttempts?: number;
  readonly timeoutMs?: number;
  readonly pricing?: LlmGatewayPricing;
}): ReplanningDecider {
  return async (deciderInput) => {
    const result = await proposeReplanningDecisionWithLlm({
      ...deciderInput,
      provider: input.provider,
      model: input.model,
      requestId: input.requestId(deciderInput),
      ...(input.maxAttempts === undefined ? {} : { maxAttempts: input.maxAttempts }),
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
      ...(input.pricing === undefined ? {} : { pricing: input.pricing }),
    });

    return {
      decision: result.decision,
      trace: result.trace,
    };
  };
}

const replanningDecisionToolContract = {
  name: 'submit_replanning_decision',
  description:
    'Submit an AIvilization memory-guided replanning decision after action simulation. Use current world state and provided STM evidence only.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['decision'],
    properties: {
      decision: {
        type: 'object',
        additionalProperties: false,
        required: ['kind'],
        properties: {
          kind: {
            type: 'string',
            enum: ['none', 'memory-guided-correction', 'full-replan'],
          },
          trigger: {
            type: 'string',
            enum: ['simulator-rejection', 'major-context-shift', 'repeated-failure'],
          },
          reason: { type: 'string', minLength: 1 },
          failedActionIds: {
            type: 'array',
            items: { type: 'string', minLength: 1 },
          },
          evidenceRecordIds: {
            type: 'array',
            items: { type: 'string', minLength: 1 },
          },
          matchingFailureCount: { type: 'number' },
        },
      },
    },
  },
};

function createReplanningDecisionMessages(input: {
  readonly input: LlmReplanningDeciderInput;
  readonly deterministicFallbackDecision: ReplanningDecision;
}): readonly { readonly role: 'system' | 'user'; readonly content: string }[] {
  return [
    {
      role: 'system',
      content:
        'You are the AIvilization Memory-Guided Replanning module. After action simulation, decide whether to keep the plan, attempt memory-guided correction, or escalate to full replanning. Use only provided simulator results, short-term memory, profile, and current world state. Return JSON matching the aivilization_replanning_decision schema.',
    },
    {
      role: 'user',
      content: JSON.stringify({
        agentId: input.input.agentId,
        issuedAt: input.input.issuedAt,
        selectedSubtask: input.input.selectedSubtask,
        simulationResults: input.input.simulationResults,
        shortTermMemoryContext: input.input.shortTermMemoryContext,
        policy: input.input.policy,
        deterministicFallbackDecision: input.deterministicFallbackDecision,
        plan: input.input.plan,
        signals: input.input.signals,
        ...(input.input.observedStateSummary === undefined
          ? {}
          : { observedStateSummary: input.input.observedStateSummary }),
        ...(input.input.intentionState === undefined
          ? {}
          : { intentionState: input.input.intentionState }),
        ...(input.input.longTermProfile === undefined
          ? {}
          : { longTermProfile: input.input.longTermProfile }),
        ...(input.input.worldDecisionContext === undefined
          ? {}
          : { worldDecisionContext: input.input.worldDecisionContext }),
        constraints: [
          'Return kind none only when no current simulator rejection and no major context shift requires replanning.',
          'Return memory-guided-correction only for current simulator rejection and cite only evidenceRecordIds from shortTermMemoryContext.',
          'Return full-replan for repeated failures only when matching evidence supports policy.consecutiveFailureThreshold.',
          'Return full-replan for major context shift only when policy.majorContextShift is present.',
          'Do not invent failedActionIds; use only actions with status needs-replan in simulationResults.',
          'Do not invent memory evidence, prices, inventory, balance, physiology, or profile facts.',
        ],
      }),
    },
  ];
}

function parseReplanningDecisionProposal(
  value: unknown,
): LlmSchemaParseResult<LlmReplanningDecisionProposal> {
  try {
    const record = readRecord(value, 'replanning decision proposal');
    return {
      status: 'valid',
      value: {
        decision: readDecision(record.decision),
      },
    };
  } catch (error) {
    return {
      status: 'invalid',
      reason: `replanning decision proposal invalid: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

function readDecision(value: unknown): ReplanningDecision {
  const record = readRecord(value, 'decision');
  const kind = readString(record.kind, 'decision.kind');

  if (kind === 'none') {
    return { kind };
  }

  if (kind === 'memory-guided-correction') {
    const trigger = readString(record.trigger, 'decision.trigger');
    if (trigger !== 'simulator-rejection') {
      throw new Error('decision.trigger must be simulator-rejection for memory-guided-correction');
    }
    return {
      kind,
      trigger,
      reason: readString(record.reason, 'decision.reason'),
      failedActionIds: readStringArray(record.failedActionIds, 'decision.failedActionIds'),
      evidenceRecordIds: readMemoryRecordIdArray(
        record.evidenceRecordIds,
        'decision.evidenceRecordIds',
      ),
    };
  }

  if (kind === 'full-replan') {
    const trigger = readString(record.trigger, 'decision.trigger');
    if (trigger !== 'major-context-shift' && trigger !== 'repeated-failure') {
      throw new Error('decision.trigger must be major-context-shift or repeated-failure');
    }
    return {
      kind,
      trigger,
      reason: readString(record.reason, 'decision.reason'),
      failedActionIds: readStringArray(record.failedActionIds, 'decision.failedActionIds'),
      evidenceRecordIds: readMemoryRecordIdArray(
        record.evidenceRecordIds,
        'decision.evidenceRecordIds',
      ),
      matchingFailureCount: readNonNegativeInteger(
        record.matchingFailureCount,
        'decision.matchingFailureCount',
      ),
    };
  }

  throw new Error('decision.kind must be none, memory-guided-correction, or full-replan');
}

function validateReplanningDecision(input: {
  readonly input: LlmReplanningDeciderInput;
  readonly decision: ReplanningDecision;
}): void {
  const failedActionIds = new Set(
    input.input.simulationResults
      .filter(
        (result): result is Extract<(typeof input.input.simulationResults)[number], { status: 'needs-replan' }> =>
          result.status === 'needs-replan',
      )
      .map((result) => result.action.id),
  );
  const evidenceRecordIds = new Set(input.input.shortTermMemoryContext.map((record) => record.id));

  if (input.decision.kind === 'none') {
    if (input.input.policy.majorContextShift !== undefined) {
      throw new Error('none decision cannot ignore a major context shift');
    }
    if (failedActionIds.size > 0) {
      throw new Error('none decision cannot ignore simulator rejections');
    }
    return;
  }

  assertAllKnownIds({
    ids: input.decision.failedActionIds,
    knownIds: failedActionIds,
    label: 'decision.failedActionIds',
  });
  assertAllKnownIds({
    ids: input.decision.evidenceRecordIds,
    knownIds: evidenceRecordIds,
    label: 'decision.evidenceRecordIds',
  });

  if (input.decision.kind === 'memory-guided-correction') {
    if (failedActionIds.size === 0 || input.decision.failedActionIds.length === 0) {
      throw new Error('memory-guided-correction requires a current simulator rejection');
    }
    return;
  }

  if (input.decision.trigger === 'major-context-shift') {
    if (input.input.policy.majorContextShift === undefined) {
      throw new Error('full-replan major-context-shift requires policy.majorContextShift');
    }
    return;
  }

  if (input.decision.matchingFailureCount !== input.decision.evidenceRecordIds.length) {
    throw new Error('full-replan repeated-failure matchingFailureCount must match evidence count');
  }
  if (input.decision.matchingFailureCount < input.input.policy.consecutiveFailureThreshold) {
    throw new Error(
      'full-replan repeated-failure does not satisfy policy.consecutiveFailureThreshold',
    );
  }
  if (failedActionIds.size === 0 || input.decision.failedActionIds.length === 0) {
    throw new Error('full-replan repeated-failure requires a current simulator rejection');
  }
}

function createFallbackResult(input: {
  readonly input: LlmReplanningDeciderInput;
  readonly fallback: ReplanningDecisionResult;
  readonly failure: LlmStructuredFailure | LlmStructuredSuccess<LlmReplanningDecisionProposal>;
  readonly failureReason: string;
  readonly message: string;
}): LlmReplanningDecisionFallbackResult {
  return {
    status: 'fallback',
    source: 'deterministic-fallback',
    decision: input.fallback.decision,
    trace: mapFallbackTrace(input),
    failure: input.failure,
  };
}

function mapAcceptedTrace(input: {
  readonly input: LlmReplanningDeciderInput;
  readonly gateway: LlmStructuredSuccess<LlmReplanningDecisionProposal>;
  readonly decision: ReplanningDecision;
}): ReplanningDecisionTrace {
  const lastAttempt = input.gateway.attempts.at(-1);
  return {
    status: 'accepted',
    source: 'llm',
    requestId: input.gateway.requestId,
    ...(lastAttempt === undefined ? {} : { providerId: lastAttempt.providerId }),
    ...(lastAttempt === undefined ? {} : { model: lastAttempt.model }),
    decision: input.decision,
    attempts: input.gateway.attempts.map((attempt) => ({
      attemptIndex: attempt.attemptIndex,
      status: attempt.status,
      providerId: attempt.providerId,
      model: attempt.model,
      message: attempt.message,
      usage: { ...attempt.usage },
    })),
    usage: { ...input.gateway.usage },
    ...createLlmCognitiveContextTrace(input.input),
    ...(input.input.observedStateSummary === undefined
      ? {}
      : { observedStateSummary: input.input.observedStateSummary }),
    ...mapWorldDecisionContextTrace(input.input.worldDecisionContext),
  };
}

function mapFallbackTrace(input: {
  readonly input: LlmReplanningDeciderInput;
  readonly fallback: ReplanningDecisionResult;
  readonly failure: LlmStructuredFailure | LlmStructuredSuccess<LlmReplanningDecisionProposal>;
  readonly failureReason: string;
  readonly message: string;
}): ReplanningDecisionTrace {
  const lastAttempt = input.failure.attempts.at(-1);
  return {
    status: 'fallback',
    source: 'deterministic-fallback',
    requestId: input.failure.requestId,
    ...(lastAttempt === undefined ? {} : { providerId: lastAttempt.providerId }),
    ...(lastAttempt === undefined ? {} : { model: lastAttempt.model }),
    failureReason: input.failureReason,
    message: input.message,
    decision: input.fallback.decision,
    attempts: input.failure.attempts.map((attempt) => ({
      attemptIndex: attempt.attemptIndex,
      status: attempt.status,
      providerId: attempt.providerId,
      model: attempt.model,
      message: attempt.message,
      usage: { ...attempt.usage },
    })),
    usage: { ...input.failure.usage },
    ...createLlmCognitiveContextTrace(input.input),
    ...(input.input.observedStateSummary === undefined
      ? {}
      : { observedStateSummary: input.input.observedStateSummary }),
    ...mapWorldDecisionContextTrace(input.input.worldDecisionContext),
  };
}

function mapWorldDecisionContextTrace(
  context: WorldDecisionContext | undefined,
): Pick<ReplanningDecisionTrace, 'worldDecisionContext'> {
  return context === undefined
    ? {}
    : { worldDecisionContext: createWorldDecisionContextTrace(context) };
}

function assertAllKnownIds(input: {
  readonly ids: readonly string[];
  readonly knownIds: ReadonlySet<string>;
  readonly label: string;
}): void {
  for (const id of input.ids) {
    if (!input.knownIds.has(id)) {
      throw new Error(`${input.label} referenced unknown id ${id}`);
    }
  }
}

function readRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function readArray(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value;
}

function readStringArray(value: unknown, label: string): readonly string[] {
  return readArray(value, label).map((entry, index) => readString(entry, `${label}[${index}]`));
}

function readMemoryRecordIdArray(value: unknown, label: string): readonly MemoryRecordId[] {
  return readStringArray(value, label).map((entry) => entry as MemoryRecordId);
}

function readString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function readNonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || typeof value !== 'number' || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return value;
}
