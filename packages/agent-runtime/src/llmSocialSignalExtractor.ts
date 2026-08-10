import type {
  LlmGatewayPricing,
  LlmSchemaParseResult,
  LlmStructuredProvider,
} from '@aivilization/llm';
import { runStructuredLlmRequest, type LlmStructuredOutputSchema } from '@aivilization/llm';
import { SOCIAL_SIGNAL_TAXONOMY } from '@aivilization/society';
import {
  createNoProposalSocialSignalExtractionResult,
  validateSocialSignalTurnExtractions,
  type SocialSignalExtractionInput,
  type SocialSignalExtractionResult,
  type SocialSignalExtractor,
  type SocialSignalSeverityProposal,
  SOCIAL_SIGNAL_EXTRACTION_POLICY_VERSION,
} from './socialSignalExtraction';

export type LlmSocialSignalExtractionProposal = {
  readonly turnSignals: readonly {
    readonly turnIndex: number;
    readonly signals: readonly SocialSignalSeverityProposal[];
  }[];
};

export type LlmSocialSignalExtractorInput = SocialSignalExtractionInput & {
  readonly provider: LlmStructuredProvider;
  readonly model: string;
  readonly requestId: string;
  readonly maxAttempts?: number;
  readonly timeoutMs?: number;
  readonly pricing?: LlmGatewayPricing;
};

export const llmSocialSignalExtractionSchema: LlmStructuredOutputSchema<LlmSocialSignalExtractionProposal> =
  {
    name: 'aivilization_social_signal_extraction',
    parse: (value) => parseSocialSignalExtractionProposal(value),
  };

/**
 * Asks the LLM to label each dialogue turn with canonical social signals. Any gateway failure or
 * invalid proposal yields "no proposal" so the world's deterministic keyword adjudicator remains
 * the fallback; the LLM never computes deltas itself.
 */
export async function proposeSocialSignalsWithLlm(
  input: LlmSocialSignalExtractorInput,
): Promise<SocialSignalExtractionResult> {
  const gateway = await runStructuredLlmRequest({
    provider: input.provider,
    schema: llmSocialSignalExtractionSchema,
    request: {
      requestId: input.requestId,
      model: input.model,
      messages: createSocialSignalExtractionMessages(input),
      tools: [socialSignalExtractionToolContract],
      ...(input.maxAttempts === undefined ? {} : { maxAttempts: input.maxAttempts }),
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
    },
    ...(input.pricing === undefined ? {} : { pricing: input.pricing }),
  });

  const lastAttempt = gateway.attempts.at(-1);
  const traceContext = {
    requestId: gateway.requestId,
    ...(lastAttempt === undefined ? {} : { providerId: lastAttempt.providerId }),
    ...(lastAttempt === undefined ? {} : { model: lastAttempt.model }),
    attempts: gateway.attempts.map((attempt) => ({
      attemptIndex: attempt.attemptIndex,
      status: attempt.status,
      providerId: attempt.providerId,
      model: attempt.model,
      message: attempt.message,
      usage: { ...attempt.usage },
    })),
    usage: { ...gateway.usage },
  } as const;

  if (gateway.status === 'failed') {
    const result = createNoProposalSocialSignalExtractionResult({
      extractorInput: input,
      source: 'deterministic-fallback',
      failureReason: gateway.reason,
      message: gateway.message,
    });
    return { trace: { ...result.trace, ...traceContext } };
  }

  const turnSignals = validateSocialSignalTurnExtractions({
    turnCount: input.turns.length,
    entries: gateway.value.turnSignals,
  });
  if (turnSignals === undefined) {
    const result = createNoProposalSocialSignalExtractionResult({
      extractorInput: input,
      source: 'deterministic-fallback',
      failureReason: 'proposal-invalid',
      message:
        'social signal proposal contained unknown signal names or no in-range turns; falling back to keyword adjudication',
    });
    return { trace: { ...result.trace, ...traceContext } };
  }

  return {
    turnSignals,
    trace: {
      status: 'accepted',
      source: 'llm',
      policyVersion: SOCIAL_SIGNAL_EXTRACTION_POLICY_VERSION,
      agentId: input.agentId,
      targetAgentId: input.targetAgentId,
      topic: input.topic,
      turnCount: input.turns.length,
      extractedSignalCount: turnSignals.reduce((count, entry) => count + entry.signals.length, 0),
      ...traceContext,
    },
  };
}

export function createTraceableLlmSocialSignalExtractor(input: {
  readonly provider: LlmStructuredProvider;
  readonly model: string;
  readonly requestId: (input: SocialSignalExtractionInput) => string;
  readonly maxAttempts?: number;
  readonly timeoutMs?: number;
  readonly pricing?: LlmGatewayPricing;
}): SocialSignalExtractor {
  return (extractorInput) =>
    proposeSocialSignalsWithLlm({
      ...extractorInput,
      provider: input.provider,
      model: input.model,
      requestId: input.requestId(extractorInput),
      ...(input.maxAttempts === undefined ? {} : { maxAttempts: input.maxAttempts }),
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
      ...(input.pricing === undefined ? {} : { pricing: input.pricing }),
    });
}

const socialSignalExtractionToolContract = {
  name: 'submit_social_signal_extraction',
  description:
    'Submit the canonical social signals expressed by each turn of an existing two-party AIvilization conversation, each with a severity in [0, 1]. Use only signal names from the supplied taxonomy; numeric social effects are adjudicated elsewhere as rule-table base delta times severity.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['turnSignals'],
    properties: {
      turnSignals: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['turnIndex', 'signals'],
          properties: {
            turnIndex: { type: 'integer', minimum: 0 },
            signals: {
              type: 'array',
              minItems: 1,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['signal', 'severity'],
                properties: {
                  signal: {
                    type: 'string',
                    enum: SOCIAL_SIGNAL_TAXONOMY.map((entry) => entry.signal),
                  },
                  severity: { type: 'number', minimum: 0, maximum: 1 },
                },
              },
            },
          },
        },
      },
    },
  },
};

function createSocialSignalExtractionMessages(
  input: SocialSignalExtractionInput,
): readonly { readonly role: 'system' | 'user'; readonly content: string }[] {
  return [
    {
      role: 'system',
      content:
        'You are the AIvilization Social Signal Extraction module. Read a two-party conversation and identify which canonical social signals each turn expresses, across languages and paraphrases, together with a severity score. Return JSON matching the aivilization_social_signal_extraction schema. Only label a turn when a taxonomy signal is clearly expressed; omit neutral turns.',
    },
    {
      role: 'user',
      content: JSON.stringify({
        agentId: input.agentId,
        targetAgentId: input.targetAgentId,
        topic: input.topic,
        turns: input.turns.map((turn, turnIndex) => ({
          turnIndex,
          speakerAgentId: turn.speakerAgentId,
          utterance: turn.utterance,
          ...(turn.intent === undefined ? {} : { intent: turn.intent }),
        })),
        signalTaxonomy: SOCIAL_SIGNAL_TAXONOMY.map((entry) => ({ ...entry })),
        constraints: [
          'Use only signal names listed in signalTaxonomy.',
          'turnIndex must reference an existing turn.',
          'Judge each turn by the meaning of its utterance and intent, not by keywords.',
          'Do not invent signals for turns that express none.',
          'severity is a number in [0, 1]: 0 is the mildest imaginable expression of the signal, 1 is its most severe form (for example a minor slipped promise is a low-severity betrayal while a public betrayal is near 1).',
          'Signal-to-effect adjudication stays deterministic in the world: final deltas equal rule-table base deltas times severity.',
        ],
      }),
    },
  ];
}

function parseSocialSignalExtractionProposal(
  value: unknown,
): LlmSchemaParseResult<LlmSocialSignalExtractionProposal> {
  try {
    const record = readRecord(value, 'social signal extraction proposal');
    return {
      status: 'valid',
      value: {
        turnSignals: readArray(record.turnSignals, 'turnSignals').map((entry, index) =>
          readTurnSignalEntry(entry, index),
        ),
      },
    };
  } catch (error) {
    return {
      status: 'invalid',
      reason: `social signal extraction proposal invalid: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

function readTurnSignalEntry(
  value: unknown,
  index: number,
): LlmSocialSignalExtractionProposal['turnSignals'][number] {
  const record = readRecord(value, `turnSignals[${index}]`);
  const turnIndex = record.turnIndex;
  if (typeof turnIndex !== 'number' || !Number.isInteger(turnIndex) || turnIndex < 0) {
    throw new Error(`turnSignals[${index}].turnIndex must be a non-negative integer`);
  }
  return {
    turnIndex,
    signals: readArray(record.signals, `turnSignals[${index}].signals`).map((signal, signalIndex) =>
      readSignalSeverity(signal, index, signalIndex),
    ),
  };
}

function readSignalSeverity(
  value: unknown,
  index: number,
  signalIndex: number,
): SocialSignalSeverityProposal {
  const label = `turnSignals[${index}].signals[${signalIndex}]`;
  const record = readRecord(value, label);
  const severity = record.severity;
  if (severity !== undefined && (typeof severity !== 'number' || !Number.isFinite(severity))) {
    throw new Error(`${label}.severity must be a finite number`);
  }
  return {
    signal: readString(record.signal, `${label}.signal`),
    ...(severity === undefined ? {} : { severity }),
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
