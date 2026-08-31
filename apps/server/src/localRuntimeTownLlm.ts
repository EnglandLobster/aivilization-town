import {
  createTraceableLlmActionSequenceGenerator,
  createTraceableLlmGlobalSynthesizer,
  createTraceableLlmReactionEvaluator,
  createTraceableLlmReactiveCorrector,
  createTraceableLlmReplanningDecider,
  createTraceableLlmSocialDialogueGenerator,
  createTraceableLlmSocialSignalExtractor,
  createTraceableLlmStrategicPlanCompiler,
  createTraceableLlmSubtaskPrioritizer,
  type ActionSequenceGenerator,
  type GlobalActionSynthesizer,
  type ReactionEvaluator,
  type ReactiveCorrector,
  type ReplanningDecider,
  type SocialDialogueGenerator,
  type SocialSignalExtractor,
  type StrategicPlanCompiler,
  type SubtaskPrioritizer,
} from '@aivilization/agent-runtime';
import {
  createLlmStructuredProviderFromConfig,
  type LlmGatewayPricing,
  type LlmStructuredProvider,
  type LlmStructuredProviderConfig,
} from '@aivilization/llm';
import {
  createTraceableLlmReflectiveInsightSynthesizer,
  createTraceableLlmSocialModelSynthesizer,
  type ReflectiveInsightSynthesizer,
  type SocialModelSynthesizer,
} from '@aivilization/memory';
import {
  createEducationOpportunityCostAwareActionSequenceGenerator,
  type LocalSimulationLifecycleMemoryConsolidationSchedule,
  type WorkerTickAgentInput,
} from '@aivilization/worker';

export const LOCAL_RUNTIME_TOWN_LLM_POLICY_ID = 'structured-cognition-v1';

const DEFAULT_LLM_MAX_ATTEMPTS = 2;
const DEFAULT_LLM_TIMEOUT_MS = 30_000;

export const LOCAL_RUNTIME_TOWN_LLM_STAGE_NAMES = [
  'strategic-planning',
  'contextual-prioritization',
  'action-generation',
  'global-synthesis',
  'reactive-correction',
  'adaptive-replanning',
  'social-dialogue',
  'social-signal-extraction',
  'ambient-reaction',
  'memory-reflection',
  'social-model-synthesis',
] as const;

export type LocalRuntimeTownLlmStageName =
  | 'strategic-planning'
  | 'contextual-prioritization'
  | 'action-generation'
  | 'global-synthesis'
  | 'reactive-correction'
  | 'adaptive-replanning'
  | 'social-dialogue'
  | 'social-signal-extraction'
  | 'ambient-reaction'
  | 'memory-reflection'
  | 'social-model-synthesis';

export type LocalRuntimeTownLlmManifest = ReturnType<typeof createLocalRuntimeTownLlmManifest>;

export type LocalRuntimeTownLlmStageSettings = {
  readonly model?: string;
  readonly maxAttempts?: number;
  readonly timeoutMs?: number;
  readonly pricing?: LlmGatewayPricing;
};

type LocalRuntimeTownLlmProviderSource =
  | {
      readonly provider: LlmStructuredProvider;
      readonly providerConfig?: never;
    }
  | {
      readonly provider?: never;
      readonly providerConfig: LlmStructuredProviderConfig;
    };

export type LocalRuntimeTownLlmConfig = LocalRuntimeTownLlmProviderSource & {
  readonly model: string;
  readonly requestIdPrefix?: string;
  readonly maxAttempts?: number;
  readonly timeoutMs?: number;
  readonly pricing?: LlmGatewayPricing;
  readonly stages?: Partial<
    Readonly<Record<LocalRuntimeTownLlmStageName, false | LocalRuntimeTownLlmStageSettings>>
  >;
};

export type LocalRuntimeTownLlmRuntime = {
  readonly policyId: typeof LOCAL_RUNTIME_TOWN_LLM_POLICY_ID;
  readonly providerId: string;
  readonly strategicPlanCompiler?: StrategicPlanCompiler;
  readonly subtaskPrioritizer?: SubtaskPrioritizer;
  readonly actionSequenceGenerator?: ActionSequenceGenerator;
  readonly globalSynthesizer?: GlobalActionSynthesizer;
  readonly reactiveCorrector?: ReactiveCorrector;
  readonly replanningDecider?: ReplanningDecider;
  readonly socialDialogueGenerator?: SocialDialogueGenerator;
  readonly socialSignalExtractor?: SocialSignalExtractor;
  readonly reactionEvaluator?: ReactionEvaluator;
  readonly reflectiveInsightSynthesizer?: ReflectiveInsightSynthesizer;
  readonly socialModelSynthesizer?: SocialModelSynthesizer;
};

type ResolvedStageSettings = {
  readonly provider: LlmStructuredProvider;
  readonly model: string;
  readonly maxAttempts?: number;
  readonly timeoutMs?: number;
  readonly pricing?: LlmGatewayPricing;
};

export function createLocalRuntimeTownLlmRuntime(
  config: LocalRuntimeTownLlmConfig,
): LocalRuntimeTownLlmRuntime {
  assertNonEmpty(config.model, 'llm.model');
  assertOptionalPositiveInteger(config.maxAttempts, 'llm.maxAttempts');
  assertOptionalPositiveFinite(config.timeoutMs, 'llm.timeoutMs');
  assertOptionalPricing(config.pricing, 'llm.pricing');
  const provider = config.provider ?? createLlmStructuredProviderFromConfig(config.providerConfig);
  const requestIdPrefix = normalizeRequestIdSegment(
    config.requestIdPrefix ?? LOCAL_RUNTIME_TOWN_LLM_POLICY_ID,
  );
  const strategicPlanning = resolveStageSettings(config, provider, 'strategic-planning');
  const contextualPrioritization = resolveStageSettings(
    config,
    provider,
    'contextual-prioritization',
  );
  const actionGeneration = resolveStageSettings(config, provider, 'action-generation');
  const globalSynthesis = resolveStageSettings(config, provider, 'global-synthesis');
  const reactiveCorrection = resolveStageSettings(config, provider, 'reactive-correction');
  const adaptiveReplanning = resolveStageSettings(config, provider, 'adaptive-replanning');
  const socialDialogue = resolveStageSettings(config, provider, 'social-dialogue');
  const socialSignalExtraction = resolveStageSettings(config, provider, 'social-signal-extraction');
  const ambientReaction = resolveStageSettings(config, provider, 'ambient-reaction');
  const memoryReflection = resolveStageSettings(config, provider, 'memory-reflection');
  const socialModelSynthesis = resolveStageSettings(config, provider, 'social-model-synthesis');

  return {
    policyId: LOCAL_RUNTIME_TOWN_LLM_POLICY_ID,
    providerId: provider.providerId,
    ...(strategicPlanning === undefined
      ? {}
      : {
          strategicPlanCompiler: createTraceableLlmStrategicPlanCompiler({
            ...strategicPlanning,
            requestId: (input) =>
              createRequestId(requestIdPrefix, 'strategic-planning', [
                input.objective.agentId,
                input.objective.id,
                input.issuedAt,
              ]),
          }),
        }),
    ...(contextualPrioritization === undefined
      ? {}
      : {
          subtaskPrioritizer: createTraceableLlmSubtaskPrioritizer({
            ...contextualPrioritization,
            requestId: (input) =>
              createRequestId(requestIdPrefix, 'contextual-prioritization', [
                input.agentId,
                input.issuedAt,
              ]),
          }),
        }),
    ...(actionGeneration === undefined
      ? {}
      : {
          actionSequenceGenerator: createTraceableLlmActionSequenceGenerator({
            ...actionGeneration,
            requestId: (input) =>
              createRequestId(requestIdPrefix, 'action-generation', [
                input.agentId,
                input.selectedSubtask.branchId,
                input.selectedSubtask.subtaskId,
                input.issuedAt,
              ]),
          }),
        }),
    ...(globalSynthesis === undefined
      ? {}
      : {
          globalSynthesizer: createTraceableLlmGlobalSynthesizer({
            ...globalSynthesis,
            requestId: (input) =>
              createRequestId(requestIdPrefix, 'global-synthesis', [input.agentId, input.issuedAt]),
          }),
        }),
    ...(reactiveCorrection === undefined
      ? {}
      : {
          reactiveCorrector: createTraceableLlmReactiveCorrector({
            ...reactiveCorrection,
            requestId: (input) =>
              createRequestId(requestIdPrefix, 'reactive-correction', [
                input.agentId,
                input.rejectedAction.id,
                input.issuedAt,
              ]),
          }),
        }),
    ...(adaptiveReplanning === undefined
      ? {}
      : {
          replanningDecider: createTraceableLlmReplanningDecider({
            ...adaptiveReplanning,
            requestId: (input) =>
              createRequestId(requestIdPrefix, 'adaptive-replanning', [
                input.agentId,
                input.selectedSubtask.branchId,
                input.selectedSubtask.subtaskId,
                input.issuedAt,
              ]),
          }),
        }),
    ...(socialDialogue === undefined
      ? {}
      : {
          socialDialogueGenerator: createTraceableLlmSocialDialogueGenerator({
            ...socialDialogue,
            requestId: (input) =>
              createRequestId(requestIdPrefix, 'social-dialogue', [
                input.agentId,
                input.action.id,
                input.issuedAt,
              ]),
          }),
        }),
    ...(socialSignalExtraction === undefined
      ? {}
      : {
          socialSignalExtractor: createTraceableLlmSocialSignalExtractor({
            ...socialSignalExtraction,
            requestId: (input) =>
              createRequestId(requestIdPrefix, 'social-signal-extraction', [
                input.agentId,
                input.targetAgentId,
                input.issuedAt,
              ]),
          }),
        }),
    ...(ambientReaction === undefined
      ? {}
      : {
          reactionEvaluator: createTraceableLlmReactionEvaluator({
            ...ambientReaction,
            requestId: (input) =>
              createRequestId(requestIdPrefix, 'ambient-reaction', [
                input.agentId,
                input.memory.id,
                input.issuedAt,
              ]),
          }),
        }),
    ...(memoryReflection === undefined
      ? {}
      : {
          reflectiveInsightSynthesizer: createTraceableLlmReflectiveInsightSynthesizer({
            ...memoryReflection,
            requestId: (input) =>
              createRequestId(requestIdPrefix, 'memory-reflection', [
                input.agentId,
                input.generatedAt,
              ]),
          }),
        }),
    ...(socialModelSynthesis === undefined
      ? {}
      : {
          socialModelSynthesizer: createTraceableLlmSocialModelSynthesizer({
            ...socialModelSynthesis,
            requestId: (input) =>
              createRequestId(requestIdPrefix, 'social-model-synthesis', [
                input.agentId,
                input.generatedAt,
              ]),
          }),
        }),
  };
}

export function createLocalRuntimeTownLlmManifest(config: LocalRuntimeTownLlmConfig) {
  const provider = resolveManifestProvider(config);
  return {
    mode: 'provider' as const,
    policyId: LOCAL_RUNTIME_TOWN_LLM_POLICY_ID,
    promptPolicyId: LOCAL_RUNTIME_TOWN_LLM_POLICY_ID,
    provider,
    defaultModel: config.model,
    defaultMaxAttempts: config.maxAttempts ?? DEFAULT_LLM_MAX_ATTEMPTS,
    defaultTimeoutMs: config.timeoutMs ?? DEFAULT_LLM_TIMEOUT_MS,
    ...(config.pricing === undefined ? {} : { defaultPricing: { ...config.pricing } }),
    stages: Object.fromEntries(
      LOCAL_RUNTIME_TOWN_LLM_STAGE_NAMES.map((stageName) => {
        const stage = config.stages?.[stageName];
        return [
          stageName,
          stage === false
            ? { enabled: false as const }
            : {
                enabled: true as const,
                model: stage?.model ?? config.model,
                maxAttempts: stage?.maxAttempts ?? config.maxAttempts ?? DEFAULT_LLM_MAX_ATTEMPTS,
                timeoutMs: stage?.timeoutMs ?? config.timeoutMs ?? DEFAULT_LLM_TIMEOUT_MS,
                ...(stage?.pricing === undefined && config.pricing === undefined
                  ? {}
                  : { pricing: { ...(stage?.pricing ?? config.pricing) } }),
              },
        ];
      }),
    ),
  } as const;
}

function resolveManifestProvider(config: LocalRuntimeTownLlmConfig) {
  if (config.provider !== undefined) {
    return {
      kind: 'injected' as const,
      providerId: config.provider.providerId,
      credentialConfigured: 'caller-owned' as const,
    };
  }
  if (config.providerConfig.kind === 'scripted') {
    return {
      kind: 'scripted' as const,
      providerId: config.providerConfig.providerId,
      credentialConfigured: false,
    };
  }
  return {
    kind: config.providerConfig.kind,
    providerId: config.providerConfig.providerId,
    endpoint: sanitizeProviderEndpoint(config.providerConfig.endpoint),
    responseFormat: config.providerConfig.responseFormat ?? 'json-schema',
    credentialConfigured: config.providerConfig.apiKey !== undefined,
  } as const;
}

function sanitizeProviderEndpoint(endpoint: string): string {
  const parsed = new URL(endpoint);
  parsed.username = '';
  parsed.password = '';
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
}

export function attachLocalRuntimeTownLlmAgentStages(input: {
  readonly agent: WorkerTickAgentInput;
  readonly runtime: LocalRuntimeTownLlmRuntime;
}): WorkerTickAgentInput {
  return {
    ...input.agent,
    ...(input.agent.refresh === undefined
      ? {}
      : {
          refresh: async (refreshInput) => {
            const refreshed = await input.agent.refresh?.(refreshInput);
            return refreshed === undefined
              ? undefined
              : attachLocalRuntimeTownLlmAgentStages({ agent: refreshed, runtime: input.runtime });
          },
        }),
    ...(input.agent.subtaskPrioritizer !== undefined ||
    input.runtime.subtaskPrioritizer === undefined
      ? {}
      : { subtaskPrioritizer: input.runtime.subtaskPrioritizer }),
    ...(input.agent.actionSequenceGenerator !== undefined ||
    input.runtime.actionSequenceGenerator === undefined
      ? {}
      : {
          actionSequenceGenerator: createEducationOpportunityCostAwareActionSequenceGenerator(
            input.runtime.actionSequenceGenerator,
          ),
        }),
    ...(input.agent.globalSynthesizer !== undefined || input.runtime.globalSynthesizer === undefined
      ? {}
      : { globalSynthesizer: input.runtime.globalSynthesizer }),
    ...(input.agent.reactiveCorrector !== undefined || input.runtime.reactiveCorrector === undefined
      ? {}
      : { reactiveCorrector: input.runtime.reactiveCorrector }),
    ...(input.agent.replanningDecider !== undefined || input.runtime.replanningDecider === undefined
      ? {}
      : { replanningDecider: input.runtime.replanningDecider }),
    ...(input.agent.socialDialogueGenerator !== undefined ||
    input.runtime.socialDialogueGenerator === undefined
      ? {}
      : { socialDialogueGenerator: input.runtime.socialDialogueGenerator }),
    ...(input.agent.socialSignalExtractor !== undefined ||
    input.runtime.socialSignalExtractor === undefined
      ? {}
      : { socialSignalExtractor: input.runtime.socialSignalExtractor }),
  };
}

export function attachLocalRuntimeTownLlmMemoryStages(input: {
  readonly schedule: LocalSimulationLifecycleMemoryConsolidationSchedule;
  readonly runtime: LocalRuntimeTownLlmRuntime;
}): LocalSimulationLifecycleMemoryConsolidationSchedule {
  return {
    ...input.schedule,
    ...(input.schedule.reflectiveInsightSynthesizer !== undefined ||
    input.runtime.reflectiveInsightSynthesizer === undefined
      ? {}
      : { reflectiveInsightSynthesizer: input.runtime.reflectiveInsightSynthesizer }),
    ...(input.schedule.socialModelSynthesizer !== undefined ||
    input.runtime.socialModelSynthesizer === undefined
      ? {}
      : { socialModelSynthesizer: input.runtime.socialModelSynthesizer }),
  };
}

function resolveStageSettings(
  config: LocalRuntimeTownLlmConfig,
  provider: LlmStructuredProvider,
  stageName: LocalRuntimeTownLlmStageName,
): ResolvedStageSettings | undefined {
  const stage = config.stages?.[stageName];
  if (stage === false) {
    return undefined;
  }
  const model = stage?.model ?? config.model;
  const maxAttempts = stage?.maxAttempts ?? config.maxAttempts ?? DEFAULT_LLM_MAX_ATTEMPTS;
  const timeoutMs = stage?.timeoutMs ?? config.timeoutMs ?? DEFAULT_LLM_TIMEOUT_MS;
  const pricing = stage?.pricing ?? config.pricing;
  assertNonEmpty(model, `llm.stages.${stageName}.model`);
  assertOptionalPositiveInteger(maxAttempts, `llm.stages.${stageName}.maxAttempts`);
  assertOptionalPositiveFinite(timeoutMs, `llm.stages.${stageName}.timeoutMs`);
  assertOptionalPricing(pricing, `llm.stages.${stageName}.pricing`);
  return {
    provider,
    model,
    ...(maxAttempts === undefined ? {} : { maxAttempts }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(pricing === undefined ? {} : { pricing }),
  };
}

function createRequestId(
  prefix: string,
  stageName: LocalRuntimeTownLlmStageName,
  segments: readonly (string | number)[],
): string {
  return [
    prefix,
    stageName,
    ...segments.map((segment) => normalizeRequestIdSegment(String(segment))),
  ].join(':');
}

function normalizeRequestIdSegment(value: string): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9._-]+/g, '_');
  if (normalized.length === 0) {
    throw new Error('LLM request id segment must not be empty');
  }
  return normalized;
}

function assertNonEmpty(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${name} must not be empty`);
  }
}

function assertOptionalPositiveInteger(value: number | undefined, name: string): void {
  if (value !== undefined && (!Number.isInteger(value) || value < 1)) {
    throw new Error(`${name} must be a positive integer`);
  }
}

function assertOptionalPositiveFinite(value: number | undefined, name: string): void {
  if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
    throw new Error(`${name} must be a positive finite number`);
  }
}

function assertOptionalPricing(value: LlmGatewayPricing | undefined, name: string): void {
  if (value === undefined) {
    return;
  }
  if (!Number.isFinite(value.inputTokenCostMicros) || value.inputTokenCostMicros < 0) {
    throw new Error(`${name}.inputTokenCostMicros must be a non-negative finite number`);
  }
  if (!Number.isFinite(value.outputTokenCostMicros) || value.outputTokenCostMicros < 0) {
    throw new Error(`${name}.outputTokenCostMicros must be a non-negative finite number`);
  }
}
