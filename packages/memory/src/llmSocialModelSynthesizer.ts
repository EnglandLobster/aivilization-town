import type {
  LlmGatewayPricing,
  LlmSchemaParseResult,
  LlmStructuredFailure,
  LlmStructuredProvider,
  LlmStructuredSuccess,
} from '@aivilization/llm';
import { runStructuredLlmRequest, type LlmStructuredOutputSchema } from '@aivilization/llm';
import { asAgentId } from '@aivilization/sim-core';
import { createMemorySynthesisCognitiveContextTrace } from './cognitiveContextTrace';
import type { LongTermMemoryPatch } from './profile';
import type { MemoryRecordId, ShortTermMemoryRecord } from './records';
import {
  createDeterministicSocialModelSynthesisResult,
  type SocialModelSynthesisResult,
  type SocialModelSynthesisTrace,
  type SocialModelSynthesizer,
  type SocialModelSynthesizerInput,
} from './socialModelSynthesis';
import type { SocialInteractionReflectionRecord } from './socialReflection';
import {
  createMemorySynthesisWorldDecisionContextTrace,
  type MemorySynthesisWorldDecisionContext,
} from './worldContext';

export type LlmSocialModelRecordProposal = {
  readonly targetAgentId: string;
  readonly statement: string;
  readonly confidence: number;
  readonly evidenceRecordIds: readonly string[];
  readonly relationDelta?: number;
  readonly attitudeDelta?: number;
  readonly rationale: string;
};

export type LlmSocialModelReflectionProposal = {
  readonly targetAgentId: string;
  readonly statement: string;
  readonly confidence: number;
  readonly evidenceRecordIds: readonly string[];
  readonly relationDelta: number;
  readonly attitudeDelta: number;
  readonly tags?: readonly string[];
  readonly rationale: string;
};

export type LlmSocialModelSynthesisProposal = {
  readonly socialRecords: readonly LlmSocialModelRecordProposal[];
  readonly socialReflections: readonly LlmSocialModelReflectionProposal[];
};

export type LlmSocialModelSynthesizerInput = SocialModelSynthesizerInput & {
  readonly provider: LlmStructuredProvider;
  readonly model: string;
  readonly requestId: string;
  readonly maxAttempts?: number;
  readonly timeoutMs?: number;
  readonly pricing?: LlmGatewayPricing;
};

export type LlmSocialModelAcceptedResult = SocialModelSynthesisResult & {
  readonly status: 'accepted';
  readonly source: 'llm';
  readonly gateway: LlmStructuredSuccess<LlmSocialModelSynthesisProposal>;
};

export type LlmSocialModelFallbackResult = SocialModelSynthesisResult & {
  readonly status: 'fallback';
  readonly source: 'deterministic-fallback';
  readonly failure: LlmStructuredFailure | LlmStructuredSuccess<LlmSocialModelSynthesisProposal>;
};

export type LlmSocialModelResult = LlmSocialModelAcceptedResult | LlmSocialModelFallbackResult;

export const llmSocialModelSynthesisSchema: LlmStructuredOutputSchema<LlmSocialModelSynthesisProposal> =
  {
    name: 'aivilization_social_model_synthesis',
    parse: (value) => parseSocialModelSynthesisProposal(value),
  };

export async function proposeSocialModelWithLlm(
  input: LlmSocialModelSynthesizerInput,
): Promise<LlmSocialModelResult> {
  const deterministicSocialModel = createDeterministicSocialModelSynthesisResult(input);
  const gateway = await runStructuredLlmRequest({
    provider: input.provider,
    schema: llmSocialModelSynthesisSchema,
    request: {
      requestId: input.requestId,
      model: input.model,
      messages: createSocialModelMessages({ input, deterministicSocialModel }),
      tools: [socialModelSynthesisToolContract],
      ...(input.maxAttempts === undefined ? {} : { maxAttempts: input.maxAttempts }),
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
    },
    ...(input.pricing === undefined ? {} : { pricing: input.pricing }),
  });

  if (gateway.status === 'failed') {
    return createFallbackResult({
      input,
      deterministicSocialModel,
      failure: gateway,
      failureReason: gateway.reason,
      message: gateway.message,
      observedStateSummary: input.observedStateSummary,
      worldDecisionContext: input.worldDecisionContext,
    });
  }

  try {
    const accepted = applySocialModelProposal({
      input,
      proposal: gateway.value,
    });
    return {
      status: 'accepted',
      source: 'llm',
      ...accepted,
      trace: mapAcceptedTrace({
        gateway,
        result: accepted,
        records: input.records,
        longTermProfile: input.longTermProfile,
        observedStateSummary: input.observedStateSummary,
        worldDecisionContext: input.worldDecisionContext,
      }),
      gateway,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return createFallbackResult({
      input,
      deterministicSocialModel,
      failure: gateway,
      failureReason: classifyValidationFailure(message),
      message: `social model synthesis proposal invalid: ${message}`,
      observedStateSummary: input.observedStateSummary,
      worldDecisionContext: input.worldDecisionContext,
    });
  }
}

export function createTraceableLlmSocialModelSynthesizer(input: {
  readonly provider: LlmStructuredProvider;
  readonly model: string;
  readonly requestId: (input: SocialModelSynthesizerInput) => string;
  readonly maxAttempts?: number;
  readonly timeoutMs?: number;
  readonly pricing?: LlmGatewayPricing;
}): SocialModelSynthesizer {
  return async (synthesizerInput) => {
    const result = await proposeSocialModelWithLlm({
      ...synthesizerInput,
      provider: input.provider,
      model: input.model,
      requestId: input.requestId(synthesizerInput),
      ...(input.maxAttempts === undefined ? {} : { maxAttempts: input.maxAttempts }),
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
      ...(input.pricing === undefined ? {} : { pricing: input.pricing }),
    });

    return {
      patches: result.patches,
      socialReflections: result.socialReflections,
      trace: result.trace,
    };
  };
}

const socialModelSynthesisToolContract = {
  name: 'submit_social_model_synthesis',
  description:
    'Submit grounded AIvilization social model updates from the provided social memories. Do not cite memories or target agents outside the synthesis window.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['socialRecords', 'socialReflections'],
    properties: {
      socialRecords: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['targetAgentId', 'statement', 'confidence', 'evidenceRecordIds', 'rationale'],
          properties: {
            targetAgentId: { type: 'string', minLength: 1 },
            statement: { type: 'string', minLength: 1 },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
            evidenceRecordIds: {
              type: 'array',
              minItems: 1,
              items: { type: 'string', minLength: 1 },
            },
            relationDelta: { type: 'number' },
            attitudeDelta: { type: 'number' },
            rationale: { type: 'string', minLength: 1 },
          },
        },
      },
      socialReflections: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'targetAgentId',
            'statement',
            'confidence',
            'evidenceRecordIds',
            'relationDelta',
            'attitudeDelta',
            'rationale',
          ],
          properties: {
            targetAgentId: { type: 'string', minLength: 1 },
            statement: { type: 'string', minLength: 1 },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
            evidenceRecordIds: {
              type: 'array',
              minItems: 1,
              items: { type: 'string', minLength: 1 },
            },
            relationDelta: { type: 'number' },
            attitudeDelta: { type: 'number' },
            tags: { type: 'array', items: { type: 'string', minLength: 1 } },
            rationale: { type: 'string', minLength: 1 },
          },
        },
      },
    },
  },
};

function createSocialModelMessages(input: {
  readonly input: SocialModelSynthesizerInput;
  readonly deterministicSocialModel: SocialModelSynthesisResult;
}): readonly { readonly role: 'system' | 'user'; readonly content: string }[] {
  const socialRecords = selectSameAgentSocialRecords(input.input);
  return [
    {
      role: 'system',
      content:
        'You are the AIvilization Social Model Synthesis module. Update internal models of other agents after social interactions by producing grounded socialRecords and optional reflection artifacts. Return JSON matching the aivilization_social_model_synthesis schema.',
    },
    {
      role: 'user',
      content: JSON.stringify({
        agentId: input.input.agentId,
        generatedAt: input.input.generatedAt,
        records: socialRecords.map(serializeSocialRecord),
        deterministicSocialModel: {
          patches: input.deterministicSocialModel.patches,
          socialReflections: input.deterministicSocialModel.socialReflections,
        },
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
          'Every targetAgentId must appear in records.consolidationHint.targetAgentId.',
          'Every evidenceRecordIds value must be an id from records.',
          'Every social record patch must update only socialRecords for the matching target agent.',
          'Do not invent relationships, profile facts, events, inventory, balance, or prices outside records, longTermProfile, observedStateSummary, and worldDecisionContext.',
          'Return empty arrays only when the provided records do not support a social model update.',
        ],
      }),
    },
  ];
}

function serializeSocialRecord(record: ShortTermMemoryRecord): Readonly<Record<string, unknown>> {
  return {
    id: record.id,
    kind: record.kind,
    status: record.status,
    summary: record.summary,
    occurredAt: record.occurredAt,
    importanceScore: record.importanceScore,
    tags: record.tags,
    consolidationHint: record.consolidationHint,
  };
}

function applySocialModelProposal(input: {
  readonly input: SocialModelSynthesizerInput;
  readonly proposal: LlmSocialModelSynthesisProposal;
}): Pick<SocialModelSynthesisResult, 'patches' | 'socialReflections'> {
  const records = selectSameAgentSocialRecords(input.input);
  const evidenceById = new Map(records.map((record) => [record.id, record]));
  const patches = input.proposal.socialRecords.map((proposal) =>
    createPatchFromProposal({
      agentId: input.input.agentId,
      generatedAt: input.input.generatedAt,
      proposal,
      evidenceById,
    }),
  );
  const socialReflections = input.proposal.socialReflections.map((proposal, index) =>
    createReflectionFromProposal({
      agentId: input.input.agentId,
      generatedAt: input.input.generatedAt,
      proposal,
      evidenceById,
      index,
    }),
  );

  return {
    patches: patches.sort(comparePatches),
    socialReflections: socialReflections.sort(compareReflections),
  };
}

function createPatchFromProposal(input: {
  readonly agentId: ReturnType<typeof asAgentId>;
  readonly generatedAt: number;
  readonly proposal: LlmSocialModelRecordProposal;
  readonly evidenceById: ReadonlyMap<string, ShortTermMemoryRecord>;
}): LongTermMemoryPatch {
  const targetAgentId = asAgentId(input.proposal.targetAgentId);
  const evidenceRecordIds = validateEvidenceRecordIds({
    targetAgentId,
    evidenceRecordIds: input.proposal.evidenceRecordIds,
    evidenceById: input.evidenceById,
  });
  assertConfidence(input.proposal.confidence, 'social record confidence');

  return {
    id: `ltm-patch-${input.agentId}-social-${targetAgentId}-${input.generatedAt}`,
    agentId: input.agentId,
    section: 'socialRecords',
    key: targetAgentId,
    statement: input.proposal.statement,
    confidence: input.proposal.confidence,
    provenanceRecordIds: evidenceRecordIds,
    proposedAt: input.generatedAt,
    ...(input.proposal.relationDelta === undefined
      ? {}
      : { relationDelta: readFiniteNumber(input.proposal.relationDelta, 'relationDelta') }),
    ...(input.proposal.attitudeDelta === undefined
      ? {}
      : { attitudeDelta: readFiniteNumber(input.proposal.attitudeDelta, 'attitudeDelta') }),
  };
}

function createReflectionFromProposal(input: {
  readonly agentId: ReturnType<typeof asAgentId>;
  readonly generatedAt: number;
  readonly proposal: LlmSocialModelReflectionProposal;
  readonly evidenceById: ReadonlyMap<string, ShortTermMemoryRecord>;
  readonly index: number;
}): SocialInteractionReflectionRecord {
  const targetAgentId = asAgentId(input.proposal.targetAgentId);
  const evidenceRecordIds = validateEvidenceRecordIds({
    targetAgentId,
    evidenceRecordIds: input.proposal.evidenceRecordIds,
    evidenceById: input.evidenceById,
  });
  assertConfidence(input.proposal.confidence, 'social reflection confidence');

  return {
    id: `social-reflection-${input.agentId}-${targetAgentId}-llm-${input.index}-${input.generatedAt}`,
    agentId: input.agentId,
    targetAgentId,
    statement: input.proposal.statement,
    relationDelta: readFiniteNumber(input.proposal.relationDelta, 'relationDelta'),
    attitudeDelta: readFiniteNumber(input.proposal.attitudeDelta, 'attitudeDelta'),
    confidence: input.proposal.confidence,
    evidenceRecordIds,
    generatedAt: input.generatedAt,
    tags: stableUnique([
      'social',
      'post-interaction-reflection',
      targetAgentId,
      ...(input.proposal.tags ?? []),
    ]),
  };
}

function validateEvidenceRecordIds(input: {
  readonly targetAgentId: string;
  readonly evidenceRecordIds: readonly string[];
  readonly evidenceById: ReadonlyMap<string, ShortTermMemoryRecord>;
}): readonly MemoryRecordId[] {
  if (input.evidenceRecordIds.length === 0) {
    throw new Error('evidenceRecordIds must not be empty');
  }

  return input.evidenceRecordIds.map((evidenceRecordId) => {
    const record = input.evidenceById.get(evidenceRecordId);
    if (record === undefined) {
      throw new Error(`evidence record ${evidenceRecordId} is not in the social synthesis window`);
    }
    const hint = record.consolidationHint;
    if (hint === undefined || hint.kind !== 'social') {
      throw new Error(`evidence record ${evidenceRecordId} is not a social memory`);
    }
    if (hint.targetAgentId !== input.targetAgentId) {
      throw new Error(
        `evidence record ${evidenceRecordId} targets ${hint.targetAgentId}, not ${input.targetAgentId}`,
      );
    }
    return record.id;
  });
}

function selectSameAgentSocialRecords(
  input: Pick<SocialModelSynthesizerInput, 'agentId' | 'records'>,
): readonly ShortTermMemoryRecord[] {
  return [...input.records]
    .filter((record) => record.agentId === input.agentId)
    .filter((record) => record.kind === 'social-interaction')
    .filter((record) => record.status === 'succeeded')
    .filter((record) => record.consolidationHint?.kind === 'social')
    .sort(compareRecordsByOccurrence);
}

function parseSocialModelSynthesisProposal(
  value: unknown,
): LlmSchemaParseResult<LlmSocialModelSynthesisProposal> {
  try {
    const record = readRecord(value, 'social model synthesis proposal');
    return {
      status: 'valid',
      value: {
        socialRecords: readArray(record.socialRecords, 'socialRecords').map((entry, index) =>
          readSocialRecordProposal(entry, index),
        ),
        socialReflections: readArray(record.socialReflections, 'socialReflections').map(
          (entry, index) => readSocialReflectionProposal(entry, index),
        ),
      },
    };
  } catch (error) {
    return {
      status: 'invalid',
      reason: `social model synthesis proposal invalid: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

function readSocialRecordProposal(value: unknown, index: number): LlmSocialModelRecordProposal {
  const label = `socialRecords[${index}]`;
  const record = readRecord(value, label);
  return {
    targetAgentId: readString(record.targetAgentId, `${label}.targetAgentId`),
    statement: readString(record.statement, `${label}.statement`),
    confidence: readNumber(record.confidence, `${label}.confidence`),
    evidenceRecordIds: readStringArray(record.evidenceRecordIds, `${label}.evidenceRecordIds`),
    ...(record.relationDelta === undefined
      ? {}
      : { relationDelta: readNumber(record.relationDelta, `${label}.relationDelta`) }),
    ...(record.attitudeDelta === undefined
      ? {}
      : { attitudeDelta: readNumber(record.attitudeDelta, `${label}.attitudeDelta`) }),
    rationale: readString(record.rationale, `${label}.rationale`),
  };
}

function readSocialReflectionProposal(
  value: unknown,
  index: number,
): LlmSocialModelReflectionProposal {
  const label = `socialReflections[${index}]`;
  const record = readRecord(value, label);
  return {
    targetAgentId: readString(record.targetAgentId, `${label}.targetAgentId`),
    statement: readString(record.statement, `${label}.statement`),
    confidence: readNumber(record.confidence, `${label}.confidence`),
    evidenceRecordIds: readStringArray(record.evidenceRecordIds, `${label}.evidenceRecordIds`),
    relationDelta: readNumber(record.relationDelta, `${label}.relationDelta`),
    attitudeDelta: readNumber(record.attitudeDelta, `${label}.attitudeDelta`),
    ...(record.tags === undefined ? {} : { tags: readStringArray(record.tags, `${label}.tags`) }),
    rationale: readString(record.rationale, `${label}.rationale`),
  };
}

function createFallbackResult(input: {
  readonly input: LlmSocialModelSynthesizerInput;
  readonly deterministicSocialModel: SocialModelSynthesisResult;
  readonly failure: LlmStructuredFailure | LlmStructuredSuccess<LlmSocialModelSynthesisProposal>;
  readonly failureReason: string;
  readonly message: string;
  readonly observedStateSummary: string | undefined;
  readonly worldDecisionContext: MemorySynthesisWorldDecisionContext | undefined;
}): LlmSocialModelFallbackResult {
  return {
    status: 'fallback',
    source: 'deterministic-fallback',
    patches: input.deterministicSocialModel.patches,
    socialReflections: input.deterministicSocialModel.socialReflections,
    trace: mapFallbackTrace({
      gateway: input.failure,
      failureReason: input.failureReason,
      message: input.message,
      records: input.input.records,
      longTermProfile: input.input.longTermProfile,
      observedStateSummary: input.observedStateSummary,
      worldDecisionContext: input.worldDecisionContext,
    }),
    failure: input.failure,
  };
}

function mapAcceptedTrace(input: {
  readonly gateway: LlmStructuredSuccess<LlmSocialModelSynthesisProposal>;
  readonly result: Pick<SocialModelSynthesisResult, 'patches' | 'socialReflections'>;
  readonly records: LlmSocialModelSynthesizerInput['records'];
  readonly longTermProfile: LlmSocialModelSynthesizerInput['longTermProfile'];
  readonly observedStateSummary: string | undefined;
  readonly worldDecisionContext: MemorySynthesisWorldDecisionContext | undefined;
}): SocialModelSynthesisTrace {
  const lastAttempt = input.gateway.attempts.at(-1);
  return {
    status: 'accepted',
    source: 'llm',
    requestId: input.gateway.requestId,
    ...(lastAttempt === undefined ? {} : { providerId: lastAttempt.providerId }),
    ...(lastAttempt === undefined ? {} : { model: lastAttempt.model }),
    patches: input.result.patches.map(toPatchTrace),
    reflections: input.result.socialReflections.map(toReflectionTrace),
    attempts: input.gateway.attempts.map((attempt) => ({
      attemptIndex: attempt.attemptIndex,
      status: attempt.status,
      providerId: attempt.providerId,
      model: attempt.model,
      message: attempt.message,
      usage: { ...attempt.usage },
    })),
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

function mapFallbackTrace(input: {
  readonly gateway: LlmStructuredFailure | LlmStructuredSuccess<LlmSocialModelSynthesisProposal>;
  readonly failureReason: string;
  readonly message: string;
  readonly records: LlmSocialModelSynthesizerInput['records'];
  readonly longTermProfile: LlmSocialModelSynthesizerInput['longTermProfile'];
  readonly observedStateSummary: string | undefined;
  readonly worldDecisionContext: MemorySynthesisWorldDecisionContext | undefined;
}): SocialModelSynthesisTrace {
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
): Pick<SocialModelSynthesisTrace, 'worldDecisionContext'> {
  return context === undefined
    ? {}
    : { worldDecisionContext: createMemorySynthesisWorldDecisionContextTrace(context) };
}

function toPatchTrace(patch: LongTermMemoryPatch) {
  return {
    key: patch.key,
    confidence: patch.confidence,
    provenanceRecordIds: [...patch.provenanceRecordIds],
    ...(patch.relationDelta === undefined ? {} : { relationDelta: patch.relationDelta }),
    ...(patch.attitudeDelta === undefined ? {} : { attitudeDelta: patch.attitudeDelta }),
  };
}

function toReflectionTrace(reflection: SocialInteractionReflectionRecord) {
  return {
    targetAgentId: reflection.targetAgentId,
    confidence: reflection.confidence,
    evidenceRecordIds: [...reflection.evidenceRecordIds],
  };
}

function classifyValidationFailure(message: string): string {
  if (message.toLowerCase().includes('evidence')) {
    return 'evidence-invalid';
  }
  if (message.toLowerCase().includes('target')) {
    return 'target-invalid';
  }
  return 'schema-invalid';
}

function compareRecordsByOccurrence(
  left: ShortTermMemoryRecord,
  right: ShortTermMemoryRecord,
): number {
  if (left.occurredAt !== right.occurredAt) {
    return left.occurredAt - right.occurredAt;
  }
  return left.id.localeCompare(right.id);
}

function comparePatches(left: LongTermMemoryPatch, right: LongTermMemoryPatch): number {
  return left.key.localeCompare(right.key) || left.id.localeCompare(right.id);
}

function compareReflections(
  left: SocialInteractionReflectionRecord,
  right: SocialInteractionReflectionRecord,
): number {
  return left.targetAgentId.localeCompare(right.targetAgentId) || left.id.localeCompare(right.id);
}

function stableUnique(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

function assertConfidence(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${name} must be between 0 and 1`);
  }
}

function readFiniteNumber(value: number, name: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be finite`);
  }
  return value;
}

function readRecord(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Readonly<Record<string, unknown>>;
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

function readStringArray(value: unknown, label: string): readonly string[] {
  return readArray(value, label).map((entry, index) => readString(entry, `${label}[${index}]`));
}
