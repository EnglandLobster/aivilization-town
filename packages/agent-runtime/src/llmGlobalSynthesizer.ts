import type {
  LlmGatewayPricing,
  LlmSchemaParseResult,
  LlmStructuredFailure,
  LlmStructuredProvider,
  LlmStructuredSuccess,
} from '@aivilization/llm';
import { runStructuredLlmRequest, type LlmStructuredOutputSchema } from '@aivilization/llm';
import {
  applyGlobalSynthesisChoices,
  type GlobalActionSynthesizer,
  type GlobalSynthesisChoice,
  type GlobalSynthesisResult,
  type GlobalSynthesisTrace,
  type GlobalSynthesizerInput,
} from './globalSynthesis';
import { createLlmCognitiveContextTrace } from './llmContextTrace';
import {
  createWorldDecisionContextTrace,
  type WorldDecisionContext,
} from './worldDecisionContext';

export type LlmGlobalSynthesisProposal = {
  readonly rankedActions: readonly GlobalSynthesisChoice[];
};

export type LlmGlobalSynthesizerInput = GlobalSynthesizerInput & {
  readonly provider: LlmStructuredProvider;
  readonly model: string;
  readonly requestId: string;
  readonly maxAttempts?: number;
  readonly timeoutMs?: number;
  readonly pricing?: LlmGatewayPricing;
};

export type LlmGlobalSynthesisAcceptedResult = GlobalSynthesisResult & {
  readonly status: 'accepted';
  readonly source: 'llm';
  readonly gateway: LlmStructuredSuccess<LlmGlobalSynthesisProposal>;
};

export type LlmGlobalSynthesisFallbackResult = GlobalSynthesisResult & {
  readonly status: 'fallback';
  readonly source: 'deterministic-fallback';
  readonly failure: LlmStructuredFailure | LlmStructuredSuccess<LlmGlobalSynthesisProposal>;
};

export type LlmGlobalSynthesisResult =
  | LlmGlobalSynthesisAcceptedResult
  | LlmGlobalSynthesisFallbackResult;

export const llmGlobalSynthesisSchema: LlmStructuredOutputSchema<LlmGlobalSynthesisProposal> = {
  name: 'aivilization_global_synthesis',
  parse: (value) => parseGlobalSynthesisProposal(value),
};

export async function proposeGlobalSynthesisWithLlm(
  input: LlmGlobalSynthesizerInput,
): Promise<LlmGlobalSynthesisResult> {
  const gateway = await runStructuredLlmRequest({
    provider: input.provider,
    schema: llmGlobalSynthesisSchema,
    request: {
      requestId: input.requestId,
      model: input.model,
      messages: createGlobalSynthesisMessages(input),
      tools: [globalSynthesisToolContract],
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
    const actions = applyGlobalSynthesisChoices({
      candidateActions: input.candidateActions,
      choices: gateway.value.rankedActions,
    });
    return {
      status: 'accepted',
      source: 'llm',
      actions,
      trace: mapAcceptedTrace(input, gateway),
      gateway,
    };
  } catch (error) {
    return createFallbackResult({
      input,
      failure: gateway,
      failureReason: 'schema-invalid',
      message: `global synthesis invalid: ${
        error instanceof Error ? error.message : String(error)
      }`,
    });
  }
}

export function createTraceableLlmGlobalSynthesizer(input: {
  readonly provider: LlmStructuredProvider;
  readonly model: string;
  readonly requestId: (input: GlobalSynthesizerInput) => string;
  readonly maxAttempts?: number;
  readonly timeoutMs?: number;
  readonly pricing?: LlmGatewayPricing;
}): GlobalActionSynthesizer {
  return async (synthesizerInput) => {
    const result = await proposeGlobalSynthesisWithLlm({
      ...synthesizerInput,
      provider: input.provider,
      model: input.model,
      requestId: input.requestId(synthesizerInput),
      ...(input.maxAttempts === undefined ? {} : { maxAttempts: input.maxAttempts }),
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
      ...(input.pricing === undefined ? {} : { pricing: input.pricing }),
    });

    return {
      actions: result.actions,
      trace: result.trace,
    };
  };
}

const globalSynthesisToolContract = {
  name: 'submit_global_synthesis',
  description:
    'Submit a complete ranked list of existing AIvilization candidate action ids for global synthesis. Do not invent, delete, or mutate actions.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['rankedActions'],
    properties: {
      rankedActions: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['actionId', 'priorityScore', 'rationale'],
          properties: {
            actionId: { type: 'string', minLength: 1 },
            priorityScore: { type: 'number' },
            rationale: { type: 'string', minLength: 1 },
            strategicAlignment: { type: 'number' },
            branchUrgency: { type: 'number' },
          },
        },
      },
    },
  },
};

function createGlobalSynthesisMessages(
  input: GlobalSynthesizerInput,
): readonly { readonly role: 'system' | 'user'; readonly content: string }[] {
  return [
    {
      role: 'system',
      content:
        'You are the AIvilization Global Synthesis module. Rank existing candidate actions across active branches to preserve global coherence, long-term objective alignment, and shared resource constraints. Return JSON matching the aivilization_global_synthesis schema.',
    },
    {
      role: 'user',
      content: JSON.stringify({
        agentId: input.agentId,
        issuedAt: input.issuedAt,
        plan: input.plan,
        signals: input.signals,
        candidateActions: input.candidateActions,
        deterministicSynthesisResult: input.deterministicSynthesisResult,
        ...(input.actionSynthesisPolicy === undefined
          ? {}
          : { actionSynthesisPolicy: input.actionSynthesisPolicy }),
        ...(input.observedStateSummary === undefined
          ? {}
          : { observedStateSummary: input.observedStateSummary }),
        ...(input.intentionState === undefined ? {} : { intentionState: input.intentionState }),
        ...(input.shortTermMemoryContext === undefined
          ? {}
          : { shortTermMemoryContext: input.shortTermMemoryContext }),
        ...(input.longTermProfile === undefined ? {} : { longTermProfile: input.longTermProfile }),
        ...(input.worldDecisionContext === undefined
          ? {}
          : { worldDecisionContext: input.worldDecisionContext }),
        constraints: [
          'Rank every candidate action id exactly once.',
          'Use only actionId values present in candidateActions.',
          'Do not invent actions, delete actions, mutate payloads, or change command types.',
          'Do not assume simulator success; deterministic synthesis and simulation remain authoritative.',
          'Resolve inter-branch conflict using long-term objective alignment, branch urgency, physiology, memory, profile, prices, and shared resources.',
        ],
      }),
    },
  ];
}

function parseGlobalSynthesisProposal(
  value: unknown,
): LlmSchemaParseResult<LlmGlobalSynthesisProposal> {
  try {
    const record = readRecord(value, 'global synthesis proposal');
    return {
      status: 'valid',
      value: {
        rankedActions: readArray(record.rankedActions, 'rankedActions').map((choice, index) =>
          readGlobalSynthesisChoice(choice, index),
        ),
      },
    };
  } catch (error) {
    return {
      status: 'invalid',
      reason: `global synthesis proposal invalid: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

function readGlobalSynthesisChoice(value: unknown, index: number): GlobalSynthesisChoice {
  const record = readRecord(value, `rankedActions[${index}]`);
  return {
    actionId: readString(record.actionId, `rankedActions[${index}].actionId`),
    priorityScore: readNumber(record.priorityScore, `rankedActions[${index}].priorityScore`),
    rationale: readString(record.rationale, `rankedActions[${index}].rationale`),
    ...(record.strategicAlignment === undefined
      ? {}
      : {
          strategicAlignment: readNumber(
            record.strategicAlignment,
            `rankedActions[${index}].strategicAlignment`,
          ),
        }),
    ...(record.branchUrgency === undefined
      ? {}
      : {
          branchUrgency: readNumber(record.branchUrgency, `rankedActions[${index}].branchUrgency`),
        }),
  };
}

function createFallbackResult(input: {
  readonly input: LlmGlobalSynthesizerInput;
  readonly failure: LlmStructuredFailure | LlmStructuredSuccess<LlmGlobalSynthesisProposal>;
  readonly failureReason: string;
  readonly message: string;
}): LlmGlobalSynthesisFallbackResult {
  return {
    status: 'fallback',
    source: 'deterministic-fallback',
    actions: input.input.candidateActions,
    trace: mapFallbackTrace({
      input: input.input,
      gateway: input.failure,
      candidateActions: input.input.candidateActions,
      failureReason: input.failureReason,
      message: input.message,
    }),
    failure: input.failure,
  };
}

function mapAcceptedTrace(
  input: LlmGlobalSynthesizerInput,
  gateway: LlmStructuredSuccess<LlmGlobalSynthesisProposal>,
): GlobalSynthesisTrace {
  const lastAttempt = gateway.attempts.at(-1);
  return {
    status: 'accepted',
    source: 'llm',
    requestId: gateway.requestId,
    ...(lastAttempt === undefined ? {} : { providerId: lastAttempt.providerId }),
    ...(lastAttempt === undefined ? {} : { model: lastAttempt.model }),
    choices: gateway.value.rankedActions.map((choice) => ({ ...choice })),
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
    ...(input.observedStateSummary === undefined
      ? {}
      : { observedStateSummary: input.observedStateSummary }),
    ...mapWorldDecisionContextTrace(input.worldDecisionContext),
  };
}

function mapFallbackTrace(input: {
  readonly input: LlmGlobalSynthesizerInput;
  readonly gateway: LlmStructuredFailure | LlmStructuredSuccess<LlmGlobalSynthesisProposal>;
  readonly candidateActions: readonly { readonly id: string; readonly priority?: number }[];
  readonly failureReason: string;
  readonly message: string;
}): GlobalSynthesisTrace {
  const lastAttempt = input.gateway.attempts.at(-1);
  return {
    status: 'fallback',
    source: 'deterministic-fallback',
    requestId: input.gateway.requestId,
    ...(lastAttempt === undefined ? {} : { providerId: lastAttempt.providerId }),
    ...(lastAttempt === undefined ? {} : { model: lastAttempt.model }),
    failureReason: input.failureReason,
    message: input.message,
    choices: input.candidateActions.map((action) => ({
      actionId: action.id,
      priorityScore: action.priority ?? 0,
      rationale: 'deterministic fallback after LLM global synthesis failure',
    })),
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

function mapWorldDecisionContextTrace(
  context: WorldDecisionContext | undefined,
): Pick<GlobalSynthesisTrace, 'worldDecisionContext'> {
  return context === undefined
    ? {}
    : { worldDecisionContext: createWorldDecisionContextTrace(context) };
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
  if (value.length === 0) {
    throw new Error(`${label} must not be empty`);
  }
  return value;
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
