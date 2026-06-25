import type {
  LlmGatewayPricing,
  LlmSchemaParseResult,
  LlmStructuredFailure,
  LlmStructuredResult,
  LlmStructuredProvider,
  LlmStructuredSuccess,
} from '@aivilization/llm';
import { runStructuredLlmRequest, type LlmStructuredOutputSchema } from '@aivilization/llm';
import {
  createBranchPlan,
  type BranchPlan,
  type PlannerBranch,
  type PlannerSubtask,
} from './planner';
import {
  compileStrategicObjectiveToBranchPlan,
  normalizeStrategicPlanCompilerOutput,
  type StrategicPlanCompilationTrace,
  type StrategicPlanCompiler,
  type StrategicPlanCompilerInput,
} from './strategicPlanning';
import {
  createWorldDecisionContextTrace,
  type WorldDecisionContext,
} from './worldDecisionContext';

export type LlmStrategicBranchPlanProposal = {
  readonly objective: string;
  readonly branches: readonly PlannerBranch[];
};

export type LlmStrategicPlanCompilerInput = StrategicPlanCompilerInput & {
  readonly provider: LlmStructuredProvider;
  readonly model: string;
  readonly requestId: string;
  readonly maxAttempts?: number;
  readonly timeoutMs?: number;
  readonly pricing?: LlmGatewayPricing;
  readonly fallbackCompiler?: StrategicPlanCompiler;
};

export type LlmStrategicPlanAcceptedResult = {
  readonly status: 'accepted';
  readonly source: 'llm';
  readonly plan: BranchPlan;
  readonly gateway: LlmStructuredSuccess<BranchPlan>;
};

export type LlmStrategicPlanFallbackResult = {
  readonly status: 'fallback';
  readonly source: 'deterministic-fallback';
  readonly plan: BranchPlan;
  readonly failure: LlmStructuredFailure;
};

export type LlmStrategicPlanResult =
  | LlmStrategicPlanAcceptedResult
  | LlmStrategicPlanFallbackResult;

export const llmStrategicBranchPlanSchema: LlmStructuredOutputSchema<BranchPlan> = {
  name: 'aivilization_branch_plan',
  parse: (value) => parseBranchPlanProposal(value),
};

export async function proposeStrategicBranchPlanWithLlm(
  input: LlmStrategicPlanCompilerInput,
): Promise<LlmStrategicPlanResult> {
  const gateway = await runStructuredLlmRequest({
    provider: input.provider,
    schema: llmStrategicBranchPlanSchema,
    request: {
      requestId: input.requestId,
      model: input.model,
      messages: createStrategicPlannerMessages(input),
      tools: [branchPlanToolContract],
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

export function createLlmStrategicPlanCompiler(input: {
  readonly provider: LlmStructuredProvider;
  readonly model: string;
  readonly requestId: (input: StrategicPlanCompilerInput) => string;
  readonly maxAttempts?: number;
  readonly timeoutMs?: number;
  readonly pricing?: LlmGatewayPricing;
  readonly fallbackCompiler?: StrategicPlanCompiler;
}): StrategicPlanCompiler {
  return async (compilerInput) => {
    const result = await proposeStrategicBranchPlanWithLlm({
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

export function createTraceableLlmStrategicPlanCompiler(input: {
  readonly provider: LlmStructuredProvider;
  readonly model: string;
  readonly requestId: (input: StrategicPlanCompilerInput) => string;
  readonly maxAttempts?: number;
  readonly timeoutMs?: number;
  readonly pricing?: LlmGatewayPricing;
  readonly fallbackCompiler?: StrategicPlanCompiler;
}): StrategicPlanCompiler {
  return async (compilerInput) => {
    const result = await proposeStrategicBranchPlanWithLlm({
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
      planningTrace: mapLlmStrategicPlanTrace(result, compilerInput.worldDecisionContext),
    };
  };
}

const branchPlanToolContract = {
  name: 'submit_branch_plan',
  description:
    'Submit a validated Branch-Thinking plan proposal. The proposal is untrusted until agent-runtime validates it.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['objective', 'branches'],
    properties: {
      objective: { type: 'string', minLength: 1 },
      branches: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'objective', 'subtasks'],
          properties: {
            id: { type: 'string', minLength: 1 },
            objective: { type: 'string', minLength: 1 },
            subtasks: {
              type: 'array',
              minItems: 1,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['id', 'description', 'basePriority'],
                properties: {
                  id: { type: 'string', minLength: 1 },
                  description: { type: 'string', minLength: 1 },
                  basePriority: { type: 'number' },
                  dependsOnSubtaskIds: { type: 'array', items: { type: 'string' } },
                  signalKeys: { type: 'array', items: { type: 'string' } },
                  intentionAffinityTags: { type: 'array', items: { type: 'string' } },
                  memoryAffinityTags: { type: 'array', items: { type: 'string' } },
                  profileAffinityTags: { type: 'array', items: { type: 'string' } },
                },
              },
            },
          },
        },
      },
    },
  },
};

function createStrategicPlannerMessages(
  input: StrategicPlanCompilerInput,
): readonly { readonly role: 'system' | 'user'; readonly content: string }[] {
  return [
    {
      role: 'system',
      content:
        'You are the AIvilization strategic Branch-Thinking Planner. Return only JSON matching the aivilization_branch_plan schema. Propose branches and subtasks; never propose world commands or mutate state.',
    },
    {
      role: 'user',
      content: JSON.stringify({
        objective: {
          id: input.objective.id,
          agentId: input.objective.agentId,
          statement: input.objective.statement,
          priority: input.objective.priority,
          source: input.objective.source,
          affinityTags: input.objective.affinityTags,
          createdAt: input.objective.createdAt,
          updatedAt: input.objective.updatedAt,
        },
        issuedAt: input.issuedAt,
        ...(input.longTermProfile === undefined ? {} : { longTermProfile: input.longTermProfile }),
        ...(input.worldDecisionContext === undefined
          ? {}
          : { worldDecisionContext: input.worldDecisionContext }),
        constraints: [
          'Output branch-plan proposal data only.',
          'Subtask ids must be unique across the full plan.',
          'Dependencies must refer only to earlier subtasks in the same branch.',
          'Use affinity tags so deterministic memory, intention, and profile scoring can evaluate subtasks.',
        ],
      }),
    },
  ];
}

function parseBranchPlanProposal(value: unknown): LlmSchemaParseResult<BranchPlan> {
  try {
    const proposal = readBranchPlanProposal(value);
    return {
      status: 'valid',
      value: createBranchPlan(proposal),
    };
  } catch (error) {
    return {
      status: 'invalid',
      reason: `branch plan candidate invalid: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function readBranchPlanProposal(value: unknown): LlmStrategicBranchPlanProposal {
  const record = readRecord(value, 'branch plan candidate');
  return {
    objective: readString(record.objective, 'objective'),
    branches: readArray(record.branches, 'branches').map((branch, branchIndex) =>
      readBranch(branch, branchIndex),
    ),
  };
}

function readBranch(value: unknown, branchIndex: number): PlannerBranch {
  const record = readRecord(value, `branch ${branchIndex}`);
  return {
    id: readString(record.id, `branch ${branchIndex} id`),
    objective: readString(record.objective, `branch ${branchIndex} objective`),
    subtasks: readArray(record.subtasks, `branch ${branchIndex} subtasks`).map(
      (subtask, subtaskIndex) => readSubtask(subtask, branchIndex, subtaskIndex),
    ),
  };
}

function readSubtask(value: unknown, branchIndex: number, subtaskIndex: number): PlannerSubtask {
  const label = `branch ${branchIndex} subtask ${subtaskIndex}`;
  const record = readRecord(value, label);
  const dependsOnSubtaskIds = readOptionalStringArray(
    record.dependsOnSubtaskIds,
    `${label} dependsOnSubtaskIds`,
  );
  const signalKeys = readOptionalStringArray(record.signalKeys, `${label} signalKeys`);
  const intentionAffinityTags = readOptionalStringArray(
    record.intentionAffinityTags,
    `${label} intentionAffinityTags`,
  );
  const memoryAffinityTags = readOptionalStringArray(
    record.memoryAffinityTags,
    `${label} memoryAffinityTags`,
  );
  const profileAffinityTags = readOptionalStringArray(
    record.profileAffinityTags,
    `${label} profileAffinityTags`,
  );

  return {
    id: readString(record.id, `${label} id`),
    description: readString(record.description, `${label} description`),
    basePriority: readNumber(record.basePriority, `${label} basePriority`),
    ...(dependsOnSubtaskIds === undefined ? {} : { dependsOnSubtaskIds }),
    ...(signalKeys === undefined ? {} : { signalKeys }),
    ...(intentionAffinityTags === undefined ? {} : { intentionAffinityTags }),
    ...(memoryAffinityTags === undefined ? {} : { memoryAffinityTags }),
    ...(profileAffinityTags === undefined ? {} : { profileAffinityTags }),
  };
}

async function compileFallbackPlan(input: LlmStrategicPlanCompilerInput): Promise<BranchPlan> {
  const fallbackOutput = await input.fallbackCompiler?.({
    objective: input.objective,
    issuedAt: input.issuedAt,
    ...(input.longTermProfile === undefined ? {} : { longTermProfile: input.longTermProfile }),
    ...(input.worldDecisionContext === undefined
      ? {}
      : { worldDecisionContext: input.worldDecisionContext }),
  });
  if (fallbackOutput !== undefined) {
    return normalizeStrategicPlanCompilerOutput(fallbackOutput).plan;
  }

  return compileStrategicObjectiveToBranchPlan({
    objective: input.objective,
    issuedAt: input.issuedAt,
    ...(input.longTermProfile === undefined ? {} : { longTermProfile: input.longTermProfile }),
    ...(input.worldDecisionContext === undefined
      ? {}
      : { worldDecisionContext: input.worldDecisionContext }),
  });
}

function mapLlmStrategicPlanTrace(
  result: LlmStrategicPlanResult,
  worldDecisionContext: WorldDecisionContext | undefined,
): StrategicPlanCompilationTrace {
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
    ...mapWorldDecisionContextTrace(worldDecisionContext),
  };
}

function mapWorldDecisionContextTrace(
  context: WorldDecisionContext | undefined,
): Pick<StrategicPlanCompilationTrace, 'worldDecisionContext'> {
  return context === undefined ? {} : { worldDecisionContext: createWorldDecisionContextTrace(context) };
}

function getGatewayResult(result: LlmStrategicPlanResult): LlmStructuredResult<BranchPlan> {
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

function readOptionalStringArray(value: unknown, label: string): readonly string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value.map((item, index) => readString(item, `${label} ${index}`));
}
