import type {
  LlmGatewayPricing,
  LlmSchemaParseResult,
  LlmStructuredFailure,
  LlmStructuredProvider,
  LlmStructuredSuccess,
} from '@aivilization/llm';
import { runStructuredLlmRequest, type LlmStructuredOutputSchema } from '@aivilization/llm';
import type { ActionResourceEstimate } from './actions';
import {
  applyReactiveCorrectionDecision,
  type ReactiveCorrectionGeneratedAction,
  type ReactiveCorrectionGeneratedDecision,
  type ReactiveCorrectionResult,
  type ReactiveCorrectionTrace,
  type ReactiveCorrector,
  type ReactiveCorrectorInput,
} from './actionRepair';

export type LlmReactiveCorrectionProposal = {
  readonly decision: ReactiveCorrectionGeneratedDecision;
};

export type LlmReactiveCorrectorInput = ReactiveCorrectorInput & {
  readonly provider: LlmStructuredProvider;
  readonly model: string;
  readonly requestId: string;
  readonly maxAttempts?: number;
  readonly timeoutMs?: number;
  readonly pricing?: LlmGatewayPricing;
};

export type LlmReactiveCorrectionAcceptedResult = ReactiveCorrectionResult & {
  readonly status: 'accepted';
  readonly source: 'llm';
  readonly gateway: LlmStructuredSuccess<LlmReactiveCorrectionProposal>;
};

export type LlmReactiveCorrectionFallbackResult = ReactiveCorrectionResult & {
  readonly status: 'fallback';
  readonly source: 'deterministic-fallback';
  readonly failure: LlmStructuredFailure | LlmStructuredSuccess<LlmReactiveCorrectionProposal>;
};

export type LlmReactiveCorrectionResult =
  | LlmReactiveCorrectionAcceptedResult
  | LlmReactiveCorrectionFallbackResult;

export const llmReactiveCorrectionSchema: LlmStructuredOutputSchema<LlmReactiveCorrectionProposal> =
  {
    name: 'aivilization_reactive_correction',
    parse: (value) => parseReactiveCorrectionProposal(value),
  };

export async function proposeReactiveCorrectionWithLlm(
  input: LlmReactiveCorrectorInput,
): Promise<LlmReactiveCorrectionResult> {
  const gateway = await runStructuredLlmRequest({
    provider: input.provider,
    schema: llmReactiveCorrectionSchema,
    request: {
      requestId: input.requestId,
      model: input.model,
      messages: createReactiveCorrectionMessages(input),
      tools: [reactiveCorrectionToolContract],
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
    const correction = applyReactiveCorrectionDecision({
      decision: gateway.value.decision,
      allowedCommandTypes: input.allowedCommandTypes,
    });
    return {
      status: 'accepted',
      source: 'llm',
      action: correction.action,
      trace: mapAcceptedTrace({
        gateway,
        decision: correction.traceDecision,
      }),
      gateway,
    };
  } catch (error) {
    return createFallbackResult({
      input,
      failure: gateway,
      failureReason: 'schema-invalid',
      message: `reactive correction invalid: ${
        error instanceof Error ? error.message : String(error)
      }`,
    });
  }
}

export function createTraceableLlmReactiveCorrector(input: {
  readonly provider: LlmStructuredProvider;
  readonly model: string;
  readonly requestId: (input: ReactiveCorrectorInput) => string;
  readonly maxAttempts?: number;
  readonly timeoutMs?: number;
  readonly pricing?: LlmGatewayPricing;
}): ReactiveCorrector {
  return async (correctorInput) => {
    const result = await proposeReactiveCorrectionWithLlm({
      ...correctorInput,
      provider: input.provider,
      model: input.model,
      requestId: input.requestId(correctorInput),
      ...(input.maxAttempts === undefined ? {} : { maxAttempts: input.maxAttempts }),
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
      ...(input.pricing === undefined ? {} : { pricing: input.pricing }),
    });

    return {
      action: result.action,
      trace: result.trace,
    };
  };
}

const reactiveCorrectionToolContract = {
  name: 'submit_reactive_correction',
  description:
    'Submit a one-step AIvilization reactive correction after simulator rejection. Use cached experience and current world state. Do not assume execution success.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['decision'],
    properties: {
      decision: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'rationale'],
        properties: {
          kind: { type: 'string', enum: ['propose-action', 'no-correction'] },
          rationale: { type: 'string', minLength: 1 },
          evidenceRecordIds: {
            type: 'array',
            items: { type: 'string', minLength: 1 },
          },
          action: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'description', 'commandType', 'payload'],
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
            },
          },
        },
      },
    },
  },
};

function createReactiveCorrectionMessages(
  input: ReactiveCorrectorInput,
): readonly { readonly role: 'system' | 'user'; readonly content: string }[] {
  return [
    {
      role: 'system',
      content:
        'You are the AIvilization Reactive Correction module. After the Action Simulator rejects an action and cheap local repair is insufficient, use cached short-term experience and current world state to propose one minor executable alternative action, or decline correction. Return JSON matching the aivilization_reactive_correction schema.',
    },
    {
      role: 'user',
      content: JSON.stringify({
        agentId: input.agentId,
        issuedAt: input.issuedAt,
        selectedSubtask: input.selectedSubtask,
        rejectedAction: input.rejectedAction,
        rejectionReason: input.rejectionReason,
        allowedCommandTypes: sortedUnique(input.allowedCommandTypes),
        plan: input.plan,
        signals: input.signals,
        ...(input.localRepairAttempt === undefined
          ? {}
          : { localRepairAttempt: input.localRepairAttempt }),
        ...(input.localRepairRejectionReason === undefined
          ? {}
          : { localRepairRejectionReason: input.localRepairRejectionReason }),
        ...(input.intentionState === undefined ? {} : { intentionState: input.intentionState }),
        ...(input.shortTermMemoryContext === undefined
          ? {}
          : { shortTermMemoryContext: input.shortTermMemoryContext }),
        ...(input.longTermProfile === undefined ? {} : { longTermProfile: input.longTermProfile }),
        ...(input.worldDecisionContext === undefined
          ? {}
          : { worldDecisionContext: input.worldDecisionContext }),
        constraints: [
          'Return kind propose-action only when one immediate action can plausibly repair the simulator rejection.',
          'Use only commandType values listed in allowedCommandTypes.',
          'Do not mutate the branch plan or long-term objective.',
          'Do not invent simulator results or assume execution success.',
          'Ground the correction in short-term memory, local repair outcome, physiology, inventory, balance, prices, profile, and selected subtask.',
          'Return kind no-correction when a safe one-step correction is not available.',
        ],
      }),
    },
  ];
}

function parseReactiveCorrectionProposal(
  value: unknown,
): LlmSchemaParseResult<LlmReactiveCorrectionProposal> {
  try {
    const record = readRecord(value, 'reactive correction proposal');
    return {
      status: 'valid',
      value: {
        decision: readDecision(record.decision),
      },
    };
  } catch (error) {
    return {
      status: 'invalid',
      reason: `reactive correction proposal invalid: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

function readDecision(value: unknown): ReactiveCorrectionGeneratedDecision {
  const record = readRecord(value, 'decision');
  const kind = readString(record.kind, 'decision.kind');
  const rationale = readString(record.rationale, 'decision.rationale');
  const evidenceRecordIds =
    record.evidenceRecordIds === undefined
      ? undefined
      : readArray(record.evidenceRecordIds, 'decision.evidenceRecordIds').map((entry, index) =>
          readString(entry, `decision.evidenceRecordIds[${index}]`),
        );

  if (kind === 'no-correction') {
    return {
      kind,
      rationale,
      ...(evidenceRecordIds === undefined ? {} : { evidenceRecordIds }),
    };
  }
  if (kind === 'propose-action') {
    return {
      kind,
      rationale,
      ...(evidenceRecordIds === undefined ? {} : { evidenceRecordIds }),
      action: readGeneratedAction(record.action),
    };
  }
  throw new Error(`decision.kind must be propose-action or no-correction`);
}

function readGeneratedAction(value: unknown): ReactiveCorrectionGeneratedAction {
  const record = readRecord(value, 'decision.action');
  return {
    id: readString(record.id, 'decision.action.id'),
    description: readString(record.description, 'decision.action.description'),
    commandType: readString(record.commandType, 'decision.action.commandType'),
    payload: record.payload,
    ...(record.priority === undefined
      ? {}
      : { priority: readNumber(record.priority, 'decision.action.priority') }),
    ...(record.resourceEstimate === undefined
      ? {}
      : {
          resourceEstimate: readResourceEstimate(
            record.resourceEstimate,
            'decision.action.resourceEstimate',
          ),
        }),
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
  readonly input: LlmReactiveCorrectorInput;
  readonly failure: LlmStructuredFailure | LlmStructuredSuccess<LlmReactiveCorrectionProposal>;
  readonly failureReason: string;
  readonly message: string;
}): LlmReactiveCorrectionFallbackResult {
  return {
    status: 'fallback',
    source: 'deterministic-fallback',
    action: undefined,
    trace: mapFallbackTrace({
      gateway: input.failure,
      failureReason: input.failureReason,
      message: input.message,
    }),
    failure: input.failure,
  };
}

function mapAcceptedTrace(input: {
  readonly gateway: LlmStructuredSuccess<LlmReactiveCorrectionProposal>;
  readonly decision: ReactiveCorrectionTrace['decision'];
}): ReactiveCorrectionTrace {
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
  };
}

function mapFallbackTrace(input: {
  readonly gateway: LlmStructuredFailure | LlmStructuredSuccess<LlmReactiveCorrectionProposal>;
  readonly failureReason: string;
  readonly message: string;
}): ReactiveCorrectionTrace {
  const lastAttempt = input.gateway.attempts.at(-1);
  return {
    status: 'fallback',
    source: 'deterministic-fallback',
    requestId: input.gateway.requestId,
    ...(lastAttempt === undefined ? {} : { providerId: lastAttempt.providerId }),
    ...(lastAttempt === undefined ? {} : { model: lastAttempt.model }),
    failureReason: input.failureReason,
    message: input.message,
    decision: {
      kind: 'no-correction',
      rationale: 'deterministic fallback after LLM reactive correction failure',
      evidenceRecordIds: [],
    },
    attempts: input.gateway.attempts.map((attempt) => ({
      attemptIndex: attempt.attemptIndex,
      status: attempt.status,
      providerId: attempt.providerId,
      model: attempt.model,
      message: attempt.message,
      usage: { ...attempt.usage },
    })),
    usage: { ...input.gateway.usage },
  };
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
