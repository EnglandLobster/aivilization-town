import type {
  LlmGatewayPricing,
  LlmSchemaParseResult,
  LlmStructuredFailure,
  LlmStructuredProvider,
  LlmStructuredSuccess,
} from '@aivilization/llm';
import { runStructuredLlmRequest, type LlmStructuredOutputSchema } from '@aivilization/llm';
import type { ActionResourceEstimate } from './actions';
import { createLlmCognitiveContextTrace } from './llmContextTrace';
import {
  applyActionSequenceProposal,
  createActionSequenceGenerationTraceActions,
  toActionSequenceTraceSubtask,
  type ActionSequenceGeneratedAction,
  type ActionSequenceGenerationResult,
  type ActionSequenceGenerationTrace,
  type ActionSequenceGenerator,
  type ActionSequenceGeneratorInput,
} from './actionSequenceGeneration';
import {
  createWorldDecisionContextTrace,
  type WorldDecisionContext,
} from './worldDecisionContext';

export type LlmActionSequenceProposal = {
  readonly actions: readonly ActionSequenceGeneratedAction[];
};

export type LlmActionSequenceGeneratorInput = ActionSequenceGeneratorInput & {
  readonly provider: LlmStructuredProvider;
  readonly model: string;
  readonly requestId: string;
  readonly maxAttempts?: number;
  readonly timeoutMs?: number;
  readonly pricing?: LlmGatewayPricing;
};

export type LlmActionSequenceAcceptedResult = ActionSequenceGenerationResult & {
  readonly status: 'accepted';
  readonly source: 'llm';
  readonly gateway: LlmStructuredSuccess<LlmActionSequenceProposal>;
};

export type LlmActionSequenceFallbackResult = ActionSequenceGenerationResult & {
  readonly status: 'fallback';
  readonly source: 'deterministic-fallback';
  readonly failure: LlmStructuredFailure | LlmStructuredSuccess<LlmActionSequenceProposal>;
};

export type LlmActionSequenceResult =
  | LlmActionSequenceAcceptedResult
  | LlmActionSequenceFallbackResult;

export const llmActionSequenceSchema: LlmStructuredOutputSchema<LlmActionSequenceProposal> = {
  name: 'aivilization_action_sequence_generation',
  parse: (value) => parseActionSequenceProposal(value),
};

export async function proposeActionSequenceWithLlm(
  input: LlmActionSequenceGeneratorInput,
): Promise<LlmActionSequenceResult> {
  const gateway = await runStructuredLlmRequest({
    provider: input.provider,
    schema: llmActionSequenceSchema,
    request: {
      requestId: input.requestId,
      model: input.model,
      messages: createActionSequenceMessages(input),
      tools: [actionSequenceToolContract],
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
    const actions = applyActionSequenceProposal({
      selectedSubtask: input.selectedSubtask,
      deterministicActions: input.deterministicActions,
      actions: gateway.value.actions,
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
      message: `action sequence invalid: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

export function createTraceableLlmActionSequenceGenerator(input: {
  readonly provider: LlmStructuredProvider;
  readonly model: string;
  readonly requestId: (input: ActionSequenceGeneratorInput) => string;
  readonly maxAttempts?: number;
  readonly timeoutMs?: number;
  readonly pricing?: LlmGatewayPricing;
}): ActionSequenceGenerator {
  return async (generatorInput) => {
    const result = await proposeActionSequenceWithLlm({
      ...generatorInput,
      provider: input.provider,
      model: input.model,
      requestId: input.requestId(generatorInput),
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

const actionSequenceToolContract = {
  name: 'submit_action_sequence',
  description:
    'Submit a concrete atomic action sequence for the selected AIvilization subtask. Use only allowed command types and preserve simulator validation.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['actions'],
    properties: {
      actions: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'description', 'commandType', 'payload', 'rationale'],
          properties: {
            id: { type: 'string', minLength: 1 },
            description: { type: 'string', minLength: 1 },
            commandType: { type: 'string', minLength: 1 },
            payload: {},
            priority: { type: 'number' },
            resourceEstimate: {
              type: 'object',
              additionalProperties: false,
              properties: {
                actionSeconds: { type: 'number' },
                energyCost: { type: 'number' },
                satietyCost: { type: 'number' },
                currencyCost: { type: 'number' },
                inventoryCosts: {
                  type: 'object',
                  additionalProperties: { type: 'number' },
                },
              },
            },
            rationale: { type: 'string', minLength: 1 },
          },
        },
      },
    },
  },
};

function createActionSequenceMessages(
  input: ActionSequenceGeneratorInput,
): readonly { readonly role: 'system' | 'user'; readonly content: string }[] {
  return [
    {
      role: 'system',
      content:
        'You are the AIvilization Action Sequence Generation module. Translate the selected abstract subtask into a concrete sequence of atomic world actions. Use current state, memory, profile, prices, and deterministic fallback actions as guardrails. Return JSON matching the aivilization_action_sequence_generation schema.',
    },
    {
      role: 'user',
      content: JSON.stringify({
        agentId: input.agentId,
        issuedAt: input.issuedAt,
        selectedSubtask: input.selectedSubtask,
        plan: input.plan,
        signals: input.signals,
        deterministicActions: input.deterministicActions,
        allowedCommandTypes: sortedUnique(
          input.deterministicActions.map((action) => action.commandType),
        ),
        ...(input.observedStateSummary === undefined
          ? {}
          : { observedStateSummary: input.observedStateSummary }),
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
          'Generate at least one action.',
          'Use only commandType values listed in allowedCommandTypes.',
          'Do not select or reprioritize subtasks.',
          'Do not mutate the branch plan.',
          'Do not invent simulator results or assume execution success.',
          'Ground the sequence in immediate physiology, inventory, balance, prices, memory, profile, and the selected subtask.',
        ],
      }),
    },
  ];
}

function parseActionSequenceProposal(
  value: unknown,
): LlmSchemaParseResult<LlmActionSequenceProposal> {
  try {
    const record = readRecord(value, 'action sequence proposal');
    return {
      status: 'valid',
      value: {
        actions: readArray(record.actions, 'actions').map((action, index) =>
          readGeneratedAction(action, index),
        ),
      },
    };
  } catch (error) {
    return {
      status: 'invalid',
      reason: `action sequence proposal invalid: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

function readGeneratedAction(value: unknown, index: number): ActionSequenceGeneratedAction {
  const record = readRecord(value, `actions[${index}]`);
  return {
    id: readString(record.id, `actions[${index}].id`),
    description: readString(record.description, `actions[${index}].description`),
    commandType: readString(record.commandType, `actions[${index}].commandType`),
    payload: record.payload,
    ...(record.priority === undefined
      ? {}
      : { priority: readNumber(record.priority, `actions[${index}].priority`) }),
    ...(record.resourceEstimate === undefined
      ? {}
      : {
          resourceEstimate: readResourceEstimate(
            record.resourceEstimate,
            `actions[${index}].resourceEstimate`,
          ),
        }),
    rationale: readString(record.rationale, `actions[${index}].rationale`),
  };
}

function readResourceEstimate(value: unknown, label: string): ActionResourceEstimate {
  const record = readRecord(value, label);
  return {
    ...(record.actionSeconds === undefined
      ? {}
      : { actionSeconds: readNumber(record.actionSeconds, `${label}.actionSeconds`) }),
    ...(record.energyCost === undefined
      ? {}
      : { energyCost: readNumber(record.energyCost, `${label}.energyCost`) }),
    ...(record.satietyCost === undefined
      ? {}
      : { satietyCost: readNumber(record.satietyCost, `${label}.satietyCost`) }),
    ...(record.currencyCost === undefined
      ? {}
      : { currencyCost: readNumber(record.currencyCost, `${label}.currencyCost`) }),
    ...(record.inventoryCosts === undefined
      ? {}
      : { inventoryCosts: readInventoryCosts(record.inventoryCosts, `${label}.inventoryCosts`) }),
  };
}

function readInventoryCosts(value: unknown, label: string): Readonly<Record<string, number>> {
  const record = readRecord(value, label);
  return Object.fromEntries(
    Object.entries(record).map(([commodityName, quantity]) => [
      commodityName,
      readNumber(quantity, `${label}.${commodityName}`),
    ]),
  );
}

function createFallbackResult(input: {
  readonly input: LlmActionSequenceGeneratorInput;
  readonly failure: LlmStructuredFailure | LlmStructuredSuccess<LlmActionSequenceProposal>;
  readonly failureReason: string;
  readonly message: string;
}): LlmActionSequenceFallbackResult {
  return {
    status: 'fallback',
    source: 'deterministic-fallback',
    actions: input.input.deterministicActions,
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
  input: LlmActionSequenceGeneratorInput,
  gateway: LlmStructuredSuccess<LlmActionSequenceProposal>,
): ActionSequenceGenerationTrace {
  const lastAttempt = gateway.attempts.at(-1);
  return {
    status: 'accepted',
    source: 'llm',
    selectedSubtask: toActionSequenceTraceSubtask(input.selectedSubtask),
    requestId: gateway.requestId,
    ...(lastAttempt === undefined ? {} : { providerId: lastAttempt.providerId }),
    ...(lastAttempt === undefined ? {} : { model: lastAttempt.model }),
    actions: createActionSequenceGenerationTraceActions(gateway.value.actions),
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
  readonly input: LlmActionSequenceGeneratorInput;
  readonly gateway: LlmStructuredFailure | LlmStructuredSuccess<LlmActionSequenceProposal>;
  readonly failureReason: string;
  readonly message: string;
}): ActionSequenceGenerationTrace {
  const lastAttempt = input.gateway.attempts.at(-1);
  return {
    status: 'fallback',
    source: 'deterministic-fallback',
    selectedSubtask: toActionSequenceTraceSubtask(input.input.selectedSubtask),
    requestId: input.gateway.requestId,
    ...(lastAttempt === undefined ? {} : { providerId: lastAttempt.providerId }),
    ...(lastAttempt === undefined ? {} : { model: lastAttempt.model }),
    failureReason: input.failureReason,
    message: input.message,
    actions: input.input.deterministicActions.map((action) => ({
      id: action.id,
      commandType: action.commandType,
      rationale: 'deterministic fallback after LLM action sequence failure',
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
    ...mapWorldDecisionContextTrace(input.input.worldDecisionContext),
  };
}

function mapWorldDecisionContextTrace(
  context: WorldDecisionContext | undefined,
): Pick<ActionSequenceGenerationTrace, 'worldDecisionContext'> {
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

function sortedUnique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
