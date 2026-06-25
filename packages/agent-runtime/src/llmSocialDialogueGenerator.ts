import type {
  LlmGatewayPricing,
  LlmSchemaParseResult,
  LlmStructuredFailure,
  LlmStructuredProvider,
  LlmStructuredSuccess,
} from '@aivilization/llm';
import { runStructuredLlmRequest, type LlmStructuredOutputSchema } from '@aivilization/llm';
import { asAgentId } from '@aivilization/sim-core';
import { createLlmCognitiveContextTrace } from './llmContextTrace';
import {
  applySocialDialogueProposal,
  toSocialDialogueTraceSubtask,
  type SocialDialogueGenerationResult,
  type SocialDialogueGenerationTrace,
  type SocialDialogueGenerator,
  type SocialDialogueGeneratorInput,
  type SocialDialogueProposal,
  type SocialDialogueTurnProposal,
} from './socialDialogueGeneration';
import {
  createWorldDecisionContextTrace,
  type WorldDecisionContext,
} from './worldDecisionContext';

export type LlmSocialDialogueGenerationProposal = {
  readonly dialogue: SocialDialogueProposal;
};

export type LlmSocialDialogueGeneratorInput = SocialDialogueGeneratorInput & {
  readonly provider: LlmStructuredProvider;
  readonly model: string;
  readonly requestId: string;
  readonly maxAttempts?: number;
  readonly timeoutMs?: number;
  readonly pricing?: LlmGatewayPricing;
};

export type LlmSocialDialogueAcceptedResult = SocialDialogueGenerationResult & {
  readonly status: 'accepted';
  readonly source: 'llm';
  readonly gateway: LlmStructuredSuccess<LlmSocialDialogueGenerationProposal>;
};

export type LlmSocialDialogueFallbackResult = SocialDialogueGenerationResult & {
  readonly status: 'fallback';
  readonly source: 'deterministic-fallback';
  readonly failure:
    | LlmStructuredFailure
    | LlmStructuredSuccess<LlmSocialDialogueGenerationProposal>;
};

export type LlmSocialDialogueResult =
  | LlmSocialDialogueAcceptedResult
  | LlmSocialDialogueFallbackResult;

export const llmSocialDialogueGenerationSchema: LlmStructuredOutputSchema<LlmSocialDialogueGenerationProposal> =
  {
    name: 'aivilization_social_dialogue_generation',
    parse: (value) => parseSocialDialogueGenerationProposal(value),
  };

export async function proposeSocialDialogueWithLlm(
  input: LlmSocialDialogueGeneratorInput,
): Promise<LlmSocialDialogueResult> {
  const gateway = await runStructuredLlmRequest({
    provider: input.provider,
    schema: llmSocialDialogueGenerationSchema,
    request: {
      requestId: input.requestId,
      model: input.model,
      messages: createSocialDialogueMessages(input),
      tools: [socialDialogueToolContract],
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
    const payload = applySocialDialogueProposal({
      agentId: input.agentId,
      action: input.action,
      deterministicPayload: input.deterministicPayload,
      proposal: gateway.value.dialogue,
    });

    return {
      status: 'accepted',
      source: 'llm',
      payload,
      trace: mapAcceptedTrace({
        input,
        gateway,
        turnCount: payload.turns.length,
      }),
      gateway,
    };
  } catch (error) {
    return createFallbackResult({
      input,
      failure: gateway,
      failureReason: 'schema-invalid',
      message: `social dialogue invalid: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

export function createTraceableLlmSocialDialogueGenerator(input: {
  readonly provider: LlmStructuredProvider;
  readonly model: string;
  readonly requestId: (input: SocialDialogueGeneratorInput) => string;
  readonly maxAttempts?: number;
  readonly timeoutMs?: number;
  readonly pricing?: LlmGatewayPricing;
}): SocialDialogueGenerator {
  return async (generatorInput) => {
    const result = await proposeSocialDialogueWithLlm({
      ...generatorInput,
      provider: input.provider,
      model: input.model,
      requestId: input.requestId(generatorInput),
      ...(input.maxAttempts === undefined ? {} : { maxAttempts: input.maxAttempts }),
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
      ...(input.pricing === undefined ? {} : { pricing: input.pricing }),
    });

    return {
      payload: result.payload,
      trace: result.trace,
    };
  };
}

const socialDialogueToolContract = {
  name: 'submit_social_dialogue',
  description:
    'Submit a compact two-party AIvilization social dialogue for an existing AgentStartConversation action. Use only the acting agent and target agent as speakers.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['dialogue'],
    properties: {
      dialogue: {
        type: 'object',
        additionalProperties: false,
        required: ['topic', 'turns', 'rationale'],
        properties: {
          topic: { type: 'string', minLength: 1 },
          relationDelta: { type: 'number' },
          attitudeDelta: { type: 'number' },
          rationale: { type: 'string', minLength: 1 },
          turns: {
            type: 'array',
            minItems: 2,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['speakerAgentId', 'utterance'],
              properties: {
                speakerAgentId: { type: 'string', minLength: 1 },
                utterance: { type: 'string', minLength: 1 },
                intent: { type: 'string', minLength: 1 },
              },
            },
          },
        },
      },
    },
  },
};

function createSocialDialogueMessages(
  input: SocialDialogueGeneratorInput,
): readonly { readonly role: 'system' | 'user'; readonly content: string }[] {
  return [
    {
      role: 'system',
      content:
        'You are the AIvilization Social Dialogue Generation module. Write a compact natural-language two-party conversation for an existing AgentStartConversation action. Return JSON matching the aivilization_social_dialogue_generation schema.',
    },
    {
      role: 'user',
      content: JSON.stringify({
        agentId: input.agentId,
        targetAgentId: input.deterministicPayload.targetAgentId,
        issuedAt: input.issuedAt,
        selectedSubtask: input.selectedSubtask,
        plan: input.plan,
        signals: input.signals,
        action: input.action,
        deterministicPayload: input.deterministicPayload,
        allowedSpeakerAgentIds: [input.agentId, input.deterministicPayload.targetAgentId],
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
          'Use only speakerAgentId values listed in allowedSpeakerAgentIds.',
          'The first turn must be spoken by agentId.',
          'Both participants must speak at least once.',
          'Do not invent inventory, balance, market prices, relationships, jobs, or prior events outside supplied context.',
          'Keep the dialogue compact for frequent simulation ticks.',
          'Do not change the target agent or command type.',
          'World command validation and simulation remain authoritative.',
        ],
      }),
    },
  ];
}

function parseSocialDialogueGenerationProposal(
  value: unknown,
): LlmSchemaParseResult<LlmSocialDialogueGenerationProposal> {
  try {
    const record = readRecord(value, 'social dialogue generation proposal');
    return {
      status: 'valid',
      value: {
        dialogue: readDialogue(record.dialogue),
      },
    };
  } catch (error) {
    return {
      status: 'invalid',
      reason: `social dialogue generation proposal invalid: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

function readDialogue(value: unknown): SocialDialogueProposal {
  const record = readRecord(value, 'dialogue');
  return {
    topic: readString(record.topic, 'dialogue.topic'),
    turns: readArray(record.turns, 'dialogue.turns').map((turn, index) =>
      readDialogueTurn(turn, index),
    ),
    ...(record.relationDelta === undefined
      ? {}
      : { relationDelta: readNumber(record.relationDelta, 'dialogue.relationDelta') }),
    ...(record.attitudeDelta === undefined
      ? {}
      : { attitudeDelta: readNumber(record.attitudeDelta, 'dialogue.attitudeDelta') }),
    rationale: readString(record.rationale, 'dialogue.rationale'),
  };
}

function readDialogueTurn(value: unknown, index: number): SocialDialogueTurnProposal {
  const record = readRecord(value, `dialogue.turns[${index}]`);
  return {
    speakerAgentId: asAgentId(readString(record.speakerAgentId, `dialogue.turns[${index}].speakerAgentId`)),
    utterance: readString(record.utterance, `dialogue.turns[${index}].utterance`),
    ...(record.intent === undefined
      ? {}
      : { intent: readString(record.intent, `dialogue.turns[${index}].intent`) }),
  };
}

function createFallbackResult(input: {
  readonly input: LlmSocialDialogueGeneratorInput;
  readonly failure:
    | LlmStructuredFailure
    | LlmStructuredSuccess<LlmSocialDialogueGenerationProposal>;
  readonly failureReason: string;
  readonly message: string;
}): LlmSocialDialogueFallbackResult {
  return {
    status: 'fallback',
    source: 'deterministic-fallback',
    payload: input.input.deterministicPayload,
    trace: mapFallbackTrace({
      input: input.input,
      gateway: input.failure,
      failureReason: input.failureReason,
      message: input.message,
    }),
    failure: input.failure,
  };
}

function mapAcceptedTrace(input: {
  readonly input: LlmSocialDialogueGeneratorInput;
  readonly gateway: LlmStructuredSuccess<LlmSocialDialogueGenerationProposal>;
  readonly turnCount: number;
}): SocialDialogueGenerationTrace {
  const lastAttempt = input.gateway.attempts.at(-1);
  return {
    status: 'accepted',
    source: 'llm',
    selectedSubtask: toSocialDialogueTraceSubtask(input.input.selectedSubtask),
    actionId: input.input.action.id,
    targetAgentId: input.input.deterministicPayload.targetAgentId,
    requestId: input.gateway.requestId,
    ...(lastAttempt === undefined ? {} : { providerId: lastAttempt.providerId }),
    ...(lastAttempt === undefined ? {} : { model: lastAttempt.model }),
    turnCount: input.turnCount,
    rationale: input.gateway.value.dialogue.rationale,
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
  readonly input: LlmSocialDialogueGeneratorInput;
  readonly gateway:
    | LlmStructuredFailure
    | LlmStructuredSuccess<LlmSocialDialogueGenerationProposal>;
  readonly failureReason: string;
  readonly message: string;
}): SocialDialogueGenerationTrace {
  const lastAttempt = input.gateway.attempts.at(-1);
  return {
    status: 'fallback',
    source: 'deterministic-fallback',
    selectedSubtask: toSocialDialogueTraceSubtask(input.input.selectedSubtask),
    actionId: input.input.action.id,
    targetAgentId: input.input.deterministicPayload.targetAgentId,
    requestId: input.gateway.requestId,
    ...(lastAttempt === undefined ? {} : { providerId: lastAttempt.providerId }),
    ...(lastAttempt === undefined ? {} : { model: lastAttempt.model }),
    failureReason: input.failureReason,
    message: input.message,
    turnCount: input.input.deterministicPayload.turns.length,
    rationale: 'deterministic fallback after LLM social dialogue failure',
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
): Pick<SocialDialogueGenerationTrace, 'worldDecisionContext'> {
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
