import type {
  LlmGatewayPricing,
  LlmSchemaParseResult,
  LlmStructuredFailure,
  LlmStructuredProvider,
  LlmStructuredResult,
  LlmStructuredSuccess,
} from '@aivilization/llm';
import { runStructuredLlmRequest, type LlmStructuredOutputSchema } from '@aivilization/llm';
import { createLlmCognitiveContextTrace } from './llmContextTrace';
import {
  createWorldDecisionContextTrace,
  type WorldDecisionContext,
} from './worldDecisionContext';
import {
  applySubtaskPrioritizationChoices,
  type SubtaskPrioritizationChoice,
  type SubtaskPrioritizationResult,
  type SubtaskPrioritizationTrace,
  type SubtaskPrioritizer,
  type SubtaskPrioritizerInput,
} from './subtaskPrioritization';

export type LlmSubtaskPrioritizationProposal = {
  readonly rankedSubtasks: readonly SubtaskPrioritizationChoice[];
};

export type LlmSubtaskPrioritizerInput = SubtaskPrioritizerInput & {
  readonly provider: LlmStructuredProvider;
  readonly model: string;
  readonly requestId: string;
  readonly maxAttempts?: number;
  readonly timeoutMs?: number;
  readonly pricing?: LlmGatewayPricing;
};

export type LlmSubtaskPrioritizationAcceptedResult = SubtaskPrioritizationResult & {
  readonly status: 'accepted';
  readonly source: 'llm';
  readonly gateway: LlmStructuredSuccess<LlmSubtaskPrioritizationProposal>;
};

export type LlmSubtaskPrioritizationFallbackResult = SubtaskPrioritizationResult & {
  readonly status: 'fallback';
  readonly source: 'deterministic-fallback';
  readonly failure: LlmStructuredFailure | LlmStructuredSuccess<LlmSubtaskPrioritizationProposal>;
};

export type LlmSubtaskPrioritizationResult =
  | LlmSubtaskPrioritizationAcceptedResult
  | LlmSubtaskPrioritizationFallbackResult;

export const llmSubtaskPrioritizationSchema: LlmStructuredOutputSchema<LlmSubtaskPrioritizationProposal> =
  {
    name: 'aivilization_subtask_prioritization',
    parse: (value) => parseSubtaskPrioritizationProposal(value),
  };

export async function proposeSubtaskPrioritizationWithLlm(
  input: LlmSubtaskPrioritizerInput,
): Promise<LlmSubtaskPrioritizationResult> {
  const gateway = await runStructuredLlmRequest({
    provider: input.provider,
    schema: llmSubtaskPrioritizationSchema,
    request: {
      requestId: input.requestId,
      model: input.model,
      messages: createSubtaskPrioritizerMessages(input),
      tools: [subtaskPrioritizationToolContract],
      ...(input.maxAttempts === undefined ? {} : { maxAttempts: input.maxAttempts }),
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
    },
    ...(input.pricing === undefined ? {} : { pricing: input.pricing }),
  });

  if (gateway.status === 'failed') {
    return createFallbackResult({
      input,
      failure: gateway,
      failureReason: gateway.reason,
      message: gateway.message,
    });
  }

  try {
    const candidates = applySubtaskPrioritizationChoices({
      candidates: input.candidates,
      choices: gateway.value.rankedSubtasks,
    });
    return {
      status: 'accepted',
      source: 'llm',
      candidates,
      trace: mapAcceptedTrace(input, gateway),
      gateway,
    };
  } catch (error) {
    return createFallbackResult({
      input,
      failure: gateway,
      failureReason: 'schema-invalid',
      message: `subtask prioritization candidate invalid: ${
        error instanceof Error ? error.message : String(error)
      }`,
    });
  }
}

export function createTraceableLlmSubtaskPrioritizer(input: {
  readonly provider: LlmStructuredProvider;
  readonly model: string;
  readonly requestId: (input: SubtaskPrioritizerInput) => string;
  readonly maxAttempts?: number;
  readonly timeoutMs?: number;
  readonly pricing?: LlmGatewayPricing;
}): SubtaskPrioritizer {
  return async (prioritizerInput) => {
    const result = await proposeSubtaskPrioritizationWithLlm({
      ...prioritizerInput,
      provider: input.provider,
      model: input.model,
      requestId: input.requestId(prioritizerInput),
      ...(input.maxAttempts === undefined ? {} : { maxAttempts: input.maxAttempts }),
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
      ...(input.pricing === undefined ? {} : { pricing: input.pricing }),
    });

    return {
      candidates: result.candidates,
      trace: result.trace,
    };
  };
}

const subtaskPrioritizationToolContract = {
  name: 'submit_subtask_prioritization',
  description:
    'Submit a complete ranked list of existing Branch-Thinking subtask candidates. Do not invent or remove subtasks.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['rankedSubtasks'],
    properties: {
      rankedSubtasks: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['branchId', 'subtaskId', 'priorityScore', 'rationale'],
          properties: {
            branchId: { type: 'string', minLength: 1 },
            subtaskId: { type: 'string', minLength: 1 },
            priorityScore: { type: 'number' },
            rationale: { type: 'string', minLength: 1 },
          },
        },
      },
    },
  },
};

function createSubtaskPrioritizerMessages(
  input: SubtaskPrioritizerInput,
): readonly { readonly role: 'system' | 'user'; readonly content: string }[] {
  return [
    {
      role: 'system',
      content:
        'You are the AIvilization Contextual Prioritization module. Rank only the provided active subtask candidates using agent state, memory, profile, prices, and world constraints. Return JSON matching the aivilization_subtask_prioritization schema.',
    },
    {
      role: 'user',
      content: JSON.stringify({
        agentId: input.agentId,
        issuedAt: input.issuedAt,
        plan: input.plan,
        candidates: input.candidates,
        signals: input.signals,
        ...(input.progress === undefined ? {} : { progress: input.progress }),
        ...(input.intentionState === undefined ? {} : { intentionState: input.intentionState }),
        ...(input.shortTermMemoryContext === undefined
          ? {}
          : { shortTermMemoryContext: input.shortTermMemoryContext }),
        ...(input.longTermProfile === undefined ? {} : { longTermProfile: input.longTermProfile }),
        ...(input.worldDecisionContext === undefined
          ? {}
          : { worldDecisionContext: input.worldDecisionContext }),
        constraints: [
          'Rank every candidate exactly once.',
          'Use only branchId/subtaskId pairs present in candidates.',
          'Do not propose world commands or mutate the branch plan.',
          'Ground the ranking in immediate survival constraints, market prices, inventory, long-term goals, profile, and memory.',
        ],
      }),
    },
  ];
}

function parseSubtaskPrioritizationProposal(
  value: unknown,
): LlmSchemaParseResult<LlmSubtaskPrioritizationProposal> {
  try {
    const record = readRecord(value, 'subtask prioritization candidate');
    return {
      status: 'valid',
      value: {
        rankedSubtasks: readArray(record.rankedSubtasks, 'rankedSubtasks').map((choice, index) =>
          readPrioritizationChoice(choice, index),
        ),
      },
    };
  } catch (error) {
    return {
      status: 'invalid',
      reason: `subtask prioritization candidate invalid: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

function readPrioritizationChoice(value: unknown, index: number): SubtaskPrioritizationChoice {
  const record = readRecord(value, `rankedSubtasks[${index}]`);
  return {
    branchId: readString(record.branchId, `rankedSubtasks[${index}].branchId`),
    subtaskId: readString(record.subtaskId, `rankedSubtasks[${index}].subtaskId`),
    priorityScore: readNumber(record.priorityScore, `rankedSubtasks[${index}].priorityScore`),
    rationale: readString(record.rationale, `rankedSubtasks[${index}].rationale`),
  };
}

function createFallbackResult(input: {
  readonly input: LlmSubtaskPrioritizerInput;
  readonly failure: LlmStructuredFailure | LlmStructuredSuccess<LlmSubtaskPrioritizationProposal>;
  readonly failureReason: string;
  readonly message: string;
}): LlmSubtaskPrioritizationFallbackResult {
  return {
    status: 'fallback',
    source: 'deterministic-fallback',
    candidates: input.input.candidates,
    trace: mapFallbackTrace({
      input: input.input,
      gateway: input.failure,
      failureReason: input.failureReason,
      message: input.message,
    }),
    failure: input.failure,
  };
}

function mapAcceptedTrace(
  input: LlmSubtaskPrioritizerInput,
  gateway: LlmStructuredSuccess<LlmSubtaskPrioritizationProposal>,
): SubtaskPrioritizationTrace {
  const lastAttempt = gateway.attempts.at(-1);
  return {
    status: 'accepted',
    source: 'llm',
    requestId: gateway.requestId,
    ...(lastAttempt === undefined ? {} : { providerId: lastAttempt.providerId }),
    ...(lastAttempt === undefined ? {} : { model: lastAttempt.model }),
    choices: gateway.value.rankedSubtasks.map((choice) => ({ ...choice })),
    attempts: gateway.attempts.map((attempt) => ({
      attemptIndex: attempt.attemptIndex,
      status: attempt.status,
      providerId: attempt.providerId,
      model: attempt.model,
      message: attempt.message,
      usage: { ...attempt.usage },
    })),
    usage: { ...gateway.usage },
    ...createLlmCognitiveContextTrace(input),
    ...mapWorldDecisionContextTrace(input.worldDecisionContext),
  };
}

function mapFallbackTrace(input: {
  readonly input: LlmSubtaskPrioritizerInput;
  readonly gateway: LlmStructuredResult<LlmSubtaskPrioritizationProposal>;
  readonly failureReason: string;
  readonly message: string;
}): SubtaskPrioritizationTrace {
  const lastAttempt = input.gateway.attempts.at(-1);
  return {
    status: 'fallback',
    source: 'deterministic-fallback',
    requestId: input.gateway.requestId,
    ...(lastAttempt === undefined ? {} : { providerId: lastAttempt.providerId }),
    ...(lastAttempt === undefined ? {} : { model: lastAttempt.model }),
    failureReason: input.failureReason,
    message: input.message,
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
    ...mapWorldDecisionContextTrace(input.input.worldDecisionContext),
  };
}

function mapWorldDecisionContextTrace(
  context: WorldDecisionContext | undefined,
): Pick<SubtaskPrioritizationTrace, 'worldDecisionContext'> {
  return context === undefined
    ? {}
    : { worldDecisionContext: createWorldDecisionContextTrace(context) };
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
