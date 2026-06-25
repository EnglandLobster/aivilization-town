import type {
  LlmGatewayPricing,
  LlmSchemaParseResult,
  LlmStructuredFailure,
  LlmStructuredProvider,
  LlmStructuredResult,
  LlmStructuredSuccess,
} from '@aivilization/llm';
import { runStructuredLlmRequest, type LlmStructuredOutputSchema } from '@aivilization/llm';
import { asMemoryRecordId } from './records';
import { createMemorySynthesisCognitiveContextTrace } from './cognitiveContextTrace';
import {
  applyReflectiveInsightProposal,
  proposeReflectiveInsights,
  type ReflectiveInsightProposal,
  type ReflectiveInsightSynthesisTrace,
  type ReflectiveInsightSynthesizer,
  type ReflectiveInsightSynthesizerInput,
  type ReflectiveInsightSynthesisResult,
} from './reflection';
import {
  createMemorySynthesisWorldDecisionContextTrace,
  type MemorySynthesisWorldDecisionContext,
} from './worldContext';

export type LlmReflectiveInsightProposal = ReflectiveInsightProposal & {
  readonly rationale: string;
};

export type LlmReflectiveInsightSynthesisProposal = {
  readonly insights: readonly LlmReflectiveInsightProposal[];
};

export type LlmReflectiveInsightSynthesizerInput = ReflectiveInsightSynthesizerInput & {
  readonly provider: LlmStructuredProvider;
  readonly model: string;
  readonly requestId: string;
  readonly maxAttempts?: number;
  readonly timeoutMs?: number;
  readonly pricing?: LlmGatewayPricing;
};

export type LlmReflectiveInsightSynthesisAcceptedResult = ReflectiveInsightSynthesisResult & {
  readonly status: 'accepted';
  readonly source: 'llm';
  readonly gateway: LlmStructuredSuccess<LlmReflectiveInsightSynthesisProposal>;
};

export type LlmReflectiveInsightSynthesisFallbackResult = ReflectiveInsightSynthesisResult & {
  readonly status: 'fallback';
  readonly source: 'deterministic-fallback';
  readonly failure:
    | LlmStructuredFailure
    | LlmStructuredSuccess<LlmReflectiveInsightSynthesisProposal>;
};

export type LlmReflectiveInsightSynthesisResult =
  | LlmReflectiveInsightSynthesisAcceptedResult
  | LlmReflectiveInsightSynthesisFallbackResult;

export const llmReflectiveInsightSynthesisSchema: LlmStructuredOutputSchema<LlmReflectiveInsightSynthesisProposal> =
  {
    name: 'aivilization_reflective_insight_synthesis',
    parse: (value) => parseReflectiveInsightSynthesisProposal(value),
  };

export async function proposeReflectiveInsightsWithLlm(
  input: LlmReflectiveInsightSynthesizerInput,
): Promise<LlmReflectiveInsightSynthesisResult> {
  const deterministicInsights = proposeReflectiveInsights(input);
  const gateway = await runStructuredLlmRequest({
    provider: input.provider,
    schema: llmReflectiveInsightSynthesisSchema,
    request: {
      requestId: input.requestId,
      model: input.model,
      messages: createReflectiveInsightSynthesizerMessages({
        input,
        deterministicInsights,
      }),
      tools: [reflectiveInsightSynthesisToolContract],
      ...(input.maxAttempts === undefined ? {} : { maxAttempts: input.maxAttempts }),
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
    },
    ...(input.pricing === undefined ? {} : { pricing: input.pricing }),
  });

  if (gateway.status === 'failed') {
    return createFallbackResult({
      input,
      deterministicInsights,
      failure: gateway,
      failureReason: gateway.reason,
      message: gateway.message,
    });
  }

  try {
    const insights = applyReflectiveInsightProposal({
      agentId: input.agentId,
      records: input.records,
      generatedAt: input.generatedAt,
      insights: gateway.value.insights,
    });
    if (insights.length === 0 && deterministicInsights.length > 0) {
      return createFallbackResult({
        input,
        deterministicInsights,
        failure: gateway,
        failureReason: 'empty-insights',
        message:
          'reflective insight synthesis produced no accepted insights while deterministic evidence exists',
      });
    }

    return {
      status: 'accepted',
      source: 'llm',
      insights,
      trace: mapAcceptedTrace({
        records: input.records,
        longTermProfile: input.longTermProfile,
        gateway,
        observedStateSummary: input.observedStateSummary,
        worldDecisionContext: input.worldDecisionContext,
      }),
      gateway,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return createFallbackResult({
      input,
      deterministicInsights,
      failure: gateway,
      failureReason: classifyValidationFailure(message),
      message: `reflective insight synthesis proposal invalid: ${message}`,
    });
  }
}

export function createTraceableLlmReflectiveInsightSynthesizer(input: {
  readonly provider: LlmStructuredProvider;
  readonly model: string;
  readonly requestId: (input: ReflectiveInsightSynthesizerInput) => string;
  readonly maxAttempts?: number;
  readonly timeoutMs?: number;
  readonly pricing?: LlmGatewayPricing;
}): ReflectiveInsightSynthesizer {
  return async (synthesizerInput) => {
    const result = await proposeReflectiveInsightsWithLlm({
      ...synthesizerInput,
      provider: input.provider,
      model: input.model,
      requestId: input.requestId(synthesizerInput),
      ...(input.maxAttempts === undefined ? {} : { maxAttempts: input.maxAttempts }),
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
      ...(input.pricing === undefined ? {} : { pricing: input.pricing }),
    });

    return {
      insights: result.insights,
      trace: result.trace,
    };
  };
}

const allowedInsightKinds = ['habit', 'caution', 'mood', 'value', 'personality'] as const;

const reflectiveInsightSynthesisToolContract = {
  name: 'submit_reflective_insight_synthesis',
  description:
    'Submit reflective insights synthesized only from the provided short-term memory records. Do not cite records outside the synthesis window.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['insights'],
    properties: {
      insights: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'kind',
            'topicKey',
            'statement',
            'confidence',
            'evidenceRecordIds',
            'tags',
            'rationale',
          ],
          properties: {
            kind: { type: 'string', enum: allowedInsightKinds },
            topicKey: { type: 'string', minLength: 1 },
            statement: { type: 'string', minLength: 1 },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
            evidenceRecordIds: {
              type: 'array',
              minItems: 1,
              items: { type: 'string', minLength: 1 },
            },
            tags: {
              type: 'array',
              items: { type: 'string', minLength: 1 },
            },
            rationale: { type: 'string', minLength: 1 },
          },
        },
      },
    },
  },
};

function createReflectiveInsightSynthesizerMessages(input: {
  readonly input: ReflectiveInsightSynthesizerInput;
  readonly deterministicInsights: readonly unknown[];
}): readonly { readonly role: 'system' | 'user'; readonly content: string }[] {
  const sameAgentRecords = input.input.records
    .filter((record) => record.agentId === input.input.agentId)
    .map((record) => ({
      id: record.id,
      kind: record.kind,
      status: record.status,
      summary: record.summary,
      occurredAt: record.occurredAt,
      importanceScore: record.importanceScore,
      tags: record.tags,
      ...(record.consolidationHint === undefined
        ? {}
        : { consolidationHint: record.consolidationHint }),
    }));

  return [
    {
      role: 'system',
      content:
        'You are the AIvilization Reflection and Insight Synthesis module. Synthesize compact long-term memory insights from short-term memory evidence. Return JSON matching the aivilization_reflective_insight_synthesis schema.',
    },
    {
      role: 'user',
      content: JSON.stringify({
        agentId: input.input.agentId,
        generatedAt: input.input.generatedAt,
        minEvidenceCount: input.input.minEvidenceCount,
        allowedInsightKinds,
        records: sameAgentRecords,
        deterministicFallbackInsights: input.deterministicInsights,
        ...(input.input.longTermProfile === undefined
          ? {}
          : { longTermProfile: input.input.longTermProfile }),
        ...(input.input.observedStateSummary === undefined
          ? {}
          : { observedStateSummary: input.input.observedStateSummary }),
        ...(input.input.worldDecisionContext === undefined
          ? {}
          : { worldDecisionContext: input.input.worldDecisionContext }),
        constraints: [
          'Every evidenceRecordIds value must be an id from records.',
          'Do not invent events, profile facts, relationships, inventory, balance, or market prices outside records, observedStateSummary, and worldDecisionContext.',
          'Prefer insights that update habits, cautions, mood, values, or personality.',
          'Return an empty insights array only when the records do not support a durable insight.',
          'Do not emit long-term memory patches; only emit reflective insight proposals.',
        ],
      }),
    },
  ];
}

function parseReflectiveInsightSynthesisProposal(
  value: unknown,
): LlmSchemaParseResult<LlmReflectiveInsightSynthesisProposal> {
  try {
    const record = readRecord(value, 'reflective insight synthesis proposal');
    return {
      status: 'valid',
      value: {
        insights: readArray(record.insights, 'insights').map((insight, index) =>
          readInsightProposal(insight, index),
        ),
      },
    };
  } catch (error) {
    return {
      status: 'invalid',
      reason: `reflective insight synthesis proposal invalid: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

function readInsightProposal(value: unknown, index: number): LlmReflectiveInsightProposal {
  const record = readRecord(value, `insights[${index}]`);
  return {
    kind: readString(record.kind, `insights[${index}].kind`),
    topicKey: readString(record.topicKey, `insights[${index}].topicKey`),
    statement: readString(record.statement, `insights[${index}].statement`),
    confidence: readNumber(record.confidence, `insights[${index}].confidence`),
    evidenceRecordIds: readArray(
      record.evidenceRecordIds,
      `insights[${index}].evidenceRecordIds`,
    ).map((recordId, recordIndex) =>
      asMemoryRecordId(
        readString(recordId, `insights[${index}].evidenceRecordIds[${recordIndex}]`),
      ),
    ),
    tags: readArray(record.tags, `insights[${index}].tags`).map((tag, tagIndex) =>
      readString(tag, `insights[${index}].tags[${tagIndex}]`),
    ),
    rationale: readString(record.rationale, `insights[${index}].rationale`),
  };
}

function createFallbackResult(input: {
  readonly input: LlmReflectiveInsightSynthesizerInput;
  readonly deterministicInsights: ReturnType<typeof proposeReflectiveInsights>;
  readonly failure:
    | LlmStructuredFailure
    | LlmStructuredSuccess<LlmReflectiveInsightSynthesisProposal>;
  readonly failureReason: string;
  readonly message: string;
}): LlmReflectiveInsightSynthesisFallbackResult {
  return {
    status: 'fallback',
    source: 'deterministic-fallback',
    insights: input.deterministicInsights,
    trace: mapFallbackTrace({
      gateway: input.failure,
      failureReason: input.failureReason,
      message: input.message,
      records: input.input.records,
      longTermProfile: input.input.longTermProfile,
      observedStateSummary: input.input.observedStateSummary,
      worldDecisionContext: input.input.worldDecisionContext,
    }),
    failure: input.failure,
  };
}

function mapAcceptedTrace(input: {
  readonly records: LlmReflectiveInsightSynthesizerInput['records'];
  readonly longTermProfile: LlmReflectiveInsightSynthesizerInput['longTermProfile'];
  readonly gateway: LlmStructuredSuccess<LlmReflectiveInsightSynthesisProposal>;
  readonly observedStateSummary: string | undefined;
  readonly worldDecisionContext: MemorySynthesisWorldDecisionContext | undefined;
}): ReflectiveInsightSynthesisTrace {
  const gateway = input.gateway;
  const lastAttempt = gateway.attempts.at(-1);
  return {
    status: 'accepted',
    source: 'llm',
    requestId: gateway.requestId,
    ...(lastAttempt === undefined ? {} : { providerId: lastAttempt.providerId }),
    ...(lastAttempt === undefined ? {} : { model: lastAttempt.model }),
    choices: mapChoices(gateway.value.insights),
    attempts: mapAttempts(gateway),
    usage: { ...gateway.usage },
    ...createMemorySynthesisCognitiveContextTrace({
      records: input.records,
      longTermProfile: input.longTermProfile,
    }),
    ...(input.observedStateSummary === undefined
      ? {}
      : { observedStateSummary: input.observedStateSummary }),
    ...mapWorldDecisionContextTrace(input.worldDecisionContext),
  };
}

function mapFallbackTrace(input: {
  readonly gateway: LlmStructuredResult<LlmReflectiveInsightSynthesisProposal>;
  readonly failureReason: string;
  readonly message: string;
  readonly records: LlmReflectiveInsightSynthesizerInput['records'];
  readonly longTermProfile: LlmReflectiveInsightSynthesizerInput['longTermProfile'];
  readonly observedStateSummary: string | undefined;
  readonly worldDecisionContext: MemorySynthesisWorldDecisionContext | undefined;
}): ReflectiveInsightSynthesisTrace {
  const lastAttempt = input.gateway.attempts.at(-1);
  return {
    status: 'fallback',
    source: 'deterministic-fallback',
    requestId: input.gateway.requestId,
    ...(lastAttempt === undefined ? {} : { providerId: lastAttempt.providerId }),
    ...(lastAttempt === undefined ? {} : { model: lastAttempt.model }),
    failureReason: input.failureReason,
    message: input.message,
    ...(input.gateway.status === 'succeeded'
      ? { choices: mapChoices(input.gateway.value.insights) }
      : {}),
    attempts: mapAttempts(input.gateway),
    usage: { ...input.gateway.usage },
    ...createMemorySynthesisCognitiveContextTrace({
      records: input.records,
      longTermProfile: input.longTermProfile,
    }),
    ...(input.observedStateSummary === undefined
      ? {}
      : { observedStateSummary: input.observedStateSummary }),
    ...mapWorldDecisionContextTrace(input.worldDecisionContext),
  };
}

function mapWorldDecisionContextTrace(
  context: MemorySynthesisWorldDecisionContext | undefined,
): Pick<ReflectiveInsightSynthesisTrace, 'worldDecisionContext'> {
  return context === undefined
    ? {}
    : { worldDecisionContext: createMemorySynthesisWorldDecisionContextTrace(context) };
}

function mapChoices(
  insights: readonly LlmReflectiveInsightProposal[],
): NonNullable<ReflectiveInsightSynthesisTrace['choices']> {
  return insights.map((insight) => ({
    kind: insight.kind,
    topicKey: insight.topicKey,
    confidence: insight.confidence,
    evidenceRecordIds: [...insight.evidenceRecordIds],
    rationale: insight.rationale,
  }));
}

function mapAttempts(
  gateway: LlmStructuredResult<LlmReflectiveInsightSynthesisProposal>,
): NonNullable<ReflectiveInsightSynthesisTrace['attempts']> {
  return gateway.attempts.map((attempt) => ({
    attemptIndex: attempt.attemptIndex,
    status: attempt.status,
    providerId: attempt.providerId,
    model: attempt.model,
    message: attempt.message,
    usage: { ...attempt.usage },
  }));
}

function classifyValidationFailure(message: string): string {
  if (message.includes('is not in synthesis records')) {
    return 'evidence-invalid';
  }
  if (message.includes('produced no accepted insights')) {
    return 'empty-insights';
  }
  return 'schema-invalid';
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
