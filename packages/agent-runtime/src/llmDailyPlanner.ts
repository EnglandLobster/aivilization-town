import type {
  LlmGatewayPricing,
  LlmSchemaParseResult,
  LlmStructuredFailure,
  LlmStructuredProvider,
  LlmStructuredResult,
  LlmStructuredSuccess,
} from '@aivilization/llm';
import { runStructuredLlmRequest, type LlmStructuredOutputSchema } from '@aivilization/llm';
import { asMemoryRecordId } from '@aivilization/memory';
import { asAgentId } from '@aivilization/sim-core';
import {
  compileDeterministicDailyPlan,
  createDailyPlan,
  normalizeDailyPlanCompilerOutput,
  type DailyPlan,
  type DailyPlanCompilationTrace,
  type DailyPlanCompiler,
  type DailyPlanCompilerInput,
  type DailyPlanItem,
  type DailyPlanItemSource,
} from './dailyPlanning';

export type LlmDailyPlanProposal = DailyPlan;

export type LlmDailyPlanCompilerInput = DailyPlanCompilerInput & {
  readonly provider: LlmStructuredProvider;
  readonly model: string;
  readonly requestId: string;
  readonly maxAttempts?: number;
  readonly timeoutMs?: number;
  readonly pricing?: LlmGatewayPricing;
  readonly fallbackCompiler?: DailyPlanCompiler;
};

export type LlmDailyPlanAcceptedResult = {
  readonly status: 'accepted';
  readonly source: 'llm';
  readonly plan: DailyPlan;
  readonly gateway: LlmStructuredSuccess<DailyPlan>;
};

export type LlmDailyPlanFallbackResult = {
  readonly status: 'fallback';
  readonly source: 'deterministic-fallback';
  readonly plan: DailyPlan;
  readonly failure: LlmStructuredFailure;
};

export type LlmDailyPlanResult = LlmDailyPlanAcceptedResult | LlmDailyPlanFallbackResult;

export const llmDailyPlanSchema: LlmStructuredOutputSchema<DailyPlan> = {
  name: 'aivilization_daily_plan',
  parse: (value) => parseDailyPlanProposal(value),
};

export async function proposeDailyPlanWithLlm(
  input: LlmDailyPlanCompilerInput,
): Promise<LlmDailyPlanResult> {
  const gateway = await runStructuredLlmRequest({
    provider: input.provider,
    schema: llmDailyPlanSchema,
    request: {
      requestId: input.requestId,
      model: input.model,
      messages: createDailyPlannerMessages(input),
      tools: [dailyPlanToolContract],
      ...(input.maxAttempts === undefined ? {} : { maxAttempts: input.maxAttempts }),
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
    },
    ...(input.pricing === undefined ? {} : { pricing: input.pricing }),
  });

  if (gateway.status === 'succeeded') {
    return {
      status: 'accepted',
      source: 'llm',
      plan: gateway.value,
      gateway,
    };
  }

  return {
    status: 'fallback',
    source: 'deterministic-fallback',
    plan: await compileFallbackPlan(input),
    failure: gateway,
  };
}

export function createLlmDailyPlanCompiler(input: {
  readonly provider: LlmStructuredProvider;
  readonly model: string;
  readonly requestId: (input: DailyPlanCompilerInput) => string;
  readonly maxAttempts?: number;
  readonly timeoutMs?: number;
  readonly pricing?: LlmGatewayPricing;
  readonly fallbackCompiler?: DailyPlanCompiler;
}): DailyPlanCompiler {
  return async (compilerInput) => {
    const result = await proposeDailyPlanWithLlm({
      ...compilerInput,
      provider: input.provider,
      model: input.model,
      requestId: input.requestId(compilerInput),
      ...(input.maxAttempts === undefined ? {} : { maxAttempts: input.maxAttempts }),
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
      ...(input.pricing === undefined ? {} : { pricing: input.pricing }),
      ...(input.fallbackCompiler === undefined ? {} : { fallbackCompiler: input.fallbackCompiler }),
    });

    return result.plan;
  };
}

export function createTraceableLlmDailyPlanCompiler(input: {
  readonly provider: LlmStructuredProvider;
  readonly model: string;
  readonly requestId: (input: DailyPlanCompilerInput) => string;
  readonly maxAttempts?: number;
  readonly timeoutMs?: number;
  readonly pricing?: LlmGatewayPricing;
  readonly fallbackCompiler?: DailyPlanCompiler;
}): DailyPlanCompiler {
  return async (compilerInput) => {
    const result = await proposeDailyPlanWithLlm({
      ...compilerInput,
      provider: input.provider,
      model: input.model,
      requestId: input.requestId(compilerInput),
      ...(input.maxAttempts === undefined ? {} : { maxAttempts: input.maxAttempts }),
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
      ...(input.pricing === undefined ? {} : { pricing: input.pricing }),
      ...(input.fallbackCompiler === undefined ? {} : { fallbackCompiler: input.fallbackCompiler }),
    });

    return {
      plan: result.plan,
      planningTrace: mapLlmDailyPlanTrace(result),
    };
  };
}

const dailyPlanToolContract = {
  name: 'submit_daily_plan',
  description:
    'Submit a validated high-level daily agenda. The proposal is untrusted until agent-runtime validates it.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['id', 'agentId', 'dayStart', 'generatedAt', 'summary', 'items'],
    properties: {
      id: { type: 'string', minLength: 1 },
      agentId: { type: 'string', minLength: 1 },
      dayStart: { type: 'number' },
      generatedAt: { type: 'number' },
      summary: { type: 'string', minLength: 1 },
      items: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'id',
            'description',
            'priority',
            'startsAtOffsetMs',
            'endsAtOffsetMs',
            'affinityTags',
            'source',
          ],
          properties: {
            id: { type: 'string', minLength: 1 },
            description: { type: 'string', minLength: 1 },
            priority: { type: 'number' },
            startsAtOffsetMs: { type: 'number' },
            endsAtOffsetMs: { type: 'number' },
            affinityTags: { type: 'array', minItems: 1, items: { type: 'string' } },
            source: {
              type: 'string',
              enum: ['baseline-routine', 'world-state', 'long-term-profile', 'memory-context'],
            },
            evidenceRecordIds: { type: 'array', items: { type: 'string' } },
          },
        },
      },
    },
  },
};

function createDailyPlannerMessages(
  input: DailyPlanCompilerInput,
): readonly { readonly role: 'system' | 'user'; readonly content: string }[] {
  return [
    {
      role: 'system',
      content:
        'You are the AIvilization daily planning module. Return only JSON matching the aivilization_daily_plan schema. Propose broad daily agenda chunks; never propose world commands, object mutations, dialogue, or 5-15 minute action decomposition.',
    },
    {
      role: 'user',
      content: JSON.stringify({
        agentId: input.agentId,
        issuedAt: input.issuedAt,
        dayStart: Math.floor(input.issuedAt / (24 * 60 * 60 * 1000)) * (24 * 60 * 60 * 1000),
        agent: input.agent ?? null,
        ...(input.worldDecisionContext === undefined
          ? {}
          : { worldDecisionContext: input.worldDecisionContext }),
        longTermProfile: input.longTermProfile ?? null,
        memoryContext: (input.memoryContext ?? []).map((record) => ({
          id: record.id,
          kind: record.kind,
          status: record.status,
          summary: record.summary,
          occurredAt: record.occurredAt,
          importanceScore: record.importanceScore,
          tags: record.tags,
        })),
        constraints: [
          'Output a DailyPlan proposal only.',
          'Use broad agenda chunks suitable for later recursive decomposition.',
          'Do not emit executable world commands.',
          'Set source to the strongest provenance for each item.',
          'Use evidenceRecordIds only for memory-backed items and only with ids present in memoryContext.',
          'Keep item offsets within one simulation day.',
        ],
      }),
    },
  ];
}

function parseDailyPlanProposal(value: unknown): LlmSchemaParseResult<DailyPlan> {
  try {
    const proposal = readDailyPlanProposal(value);
    return {
      status: 'valid',
      value: createDailyPlan(proposal),
    };
  } catch (error) {
    return {
      status: 'invalid',
      reason: `daily plan candidate invalid: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function readDailyPlanProposal(value: unknown): LlmDailyPlanProposal {
  const record = readRecord(value, 'daily plan candidate');
  return {
    id: readString(record.id, 'daily plan id'),
    agentId: asAgentId(readString(record.agentId, 'daily plan agentId')),
    dayStart: readNumber(record.dayStart, 'daily plan dayStart'),
    generatedAt: readNumber(record.generatedAt, 'daily plan generatedAt'),
    summary: readString(record.summary, 'daily plan summary'),
    items: readArray(record.items, 'daily plan items').map((item, itemIndex) =>
      readDailyPlanItem(item, itemIndex),
    ),
  };
}

function readDailyPlanItem(value: unknown, itemIndex: number): DailyPlanItem {
  const label = `daily plan item ${itemIndex}`;
  const record = readRecord(value, label);
  const evidenceRecordIds = readOptionalStringArray(
    record.evidenceRecordIds,
    `${label} evidenceRecordIds`,
  )?.map(asMemoryRecordId);

  return {
    id: readString(record.id, `${label} id`),
    description: readString(record.description, `${label} description`),
    priority: readNumber(record.priority, `${label} priority`),
    startsAtOffsetMs: readNumber(record.startsAtOffsetMs, `${label} startsAtOffsetMs`),
    endsAtOffsetMs: readNumber(record.endsAtOffsetMs, `${label} endsAtOffsetMs`),
    affinityTags: readStringArray(record.affinityTags, `${label} affinityTags`),
    source: readDailyPlanItemSource(record.source, `${label} source`),
    ...(evidenceRecordIds === undefined ? {} : { evidenceRecordIds }),
  };
}

async function compileFallbackPlan(input: LlmDailyPlanCompilerInput): Promise<DailyPlan> {
  const fallbackOutput = await input.fallbackCompiler?.({
    agentId: input.agentId,
    issuedAt: input.issuedAt,
    ...(input.agent === undefined ? {} : { agent: input.agent }),
    ...(input.longTermProfile === undefined ? {} : { longTermProfile: input.longTermProfile }),
    ...(input.memoryContext === undefined ? {} : { memoryContext: input.memoryContext }),
    ...(input.worldDecisionContext === undefined
      ? {}
      : { worldDecisionContext: input.worldDecisionContext }),
  });
  if (fallbackOutput !== undefined) {
    return normalizeDailyPlanCompilerOutput(fallbackOutput).plan;
  }

  return compileDeterministicDailyPlan({
    agentId: input.agentId,
    issuedAt: input.issuedAt,
    ...(input.agent === undefined ? {} : { agent: input.agent }),
    ...(input.longTermProfile === undefined ? {} : { longTermProfile: input.longTermProfile }),
    ...(input.memoryContext === undefined ? {} : { memoryContext: input.memoryContext }),
    ...(input.worldDecisionContext === undefined
      ? {}
      : { worldDecisionContext: input.worldDecisionContext }),
  });
}

function mapLlmDailyPlanTrace(result: LlmDailyPlanResult): DailyPlanCompilationTrace {
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

function getGatewayResult(result: LlmDailyPlanResult): LlmStructuredResult<DailyPlan> {
  return result.status === 'accepted' ? result.gateway : result.failure;
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

function readOptionalStringArray(value: unknown, label: string): readonly string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  return readStringArray(value, label);
}

function readDailyPlanItemSource(value: unknown, label: string): DailyPlanItemSource {
  const source = readString(value, label);
  if (
    source !== 'baseline-routine' &&
    source !== 'world-state' &&
    source !== 'long-term-profile' &&
    source !== 'memory-context'
  ) {
    throw new Error(`${label} must be a valid daily plan item source`);
  }
  return source;
}
