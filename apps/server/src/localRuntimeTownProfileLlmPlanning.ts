import {
  createTraceableLlmActionSequenceGenerator,
  createTraceableLlmDailyPlanCompiler,
  createTraceableLlmGlobalSynthesizer,
  createTraceableLlmReactionEvaluator,
  createTraceableLlmReactiveCorrector,
  createTraceableLlmReplanningDecider,
  createTraceableLlmSocialDialogueGenerator,
  createTraceableLlmStrategicPlanCompiler,
  createTraceableLlmSubtaskPrioritizer,
  type ActionSequenceGenerator,
  type DailyPlanCompiler,
  type GlobalActionSynthesizer,
  type ReactionEvaluator,
  type ReactiveCorrector,
  type ReplanningDecider,
  type SocialDialogueGenerator,
  type StrategicPlanCompiler,
  type SubtaskPrioritizer,
} from '@aivilization/agent-runtime';
import {
  createLlmStructuredProviderFromConfig,
  type LlmGatewayPricing,
  type LlmStructuredProviderConfig,
} from '@aivilization/llm';
import {
  createTraceableLlmReflectiveInsightSynthesizer,
  createTraceableLlmSocialModelSynthesizer,
  type ReflectiveInsightSynthesizer,
  type SocialModelSynthesizer,
} from '@aivilization/memory';

export type LocalRuntimeTownProfileLlmPlanningConfig = {
  readonly kind: 'traceable-llm-strategic-planner';
  readonly profileId: string;
  readonly model: string;
  readonly provider: LlmStructuredProviderConfig;
  readonly maxAttempts?: number;
  readonly timeoutMs?: number;
  readonly pricing?: LlmGatewayPricing;
};

export type LocalRuntimeTownProfileDailyPlanningConfig = {
  readonly kind: 'traceable-llm-daily-planner';
  readonly profileId: string;
  readonly model: string;
  readonly provider: LlmStructuredProviderConfig;
  readonly maxAttempts?: number;
  readonly timeoutMs?: number;
  readonly pricing?: LlmGatewayPricing;
};

export type LocalRuntimeTownProfileReactionPlanningConfig = {
  readonly kind: 'traceable-llm-reaction-evaluator';
  readonly profileId: string;
  readonly model: string;
  readonly provider: LlmStructuredProviderConfig;
  readonly maxAttempts?: number;
  readonly timeoutMs?: number;
  readonly pricing?: LlmGatewayPricing;
};

export type LocalRuntimeTownProfileSubtaskPrioritizationConfig = {
  readonly kind: 'traceable-llm-subtask-prioritizer';
  readonly profileId: string;
  readonly model: string;
  readonly provider: LlmStructuredProviderConfig;
  readonly maxAttempts?: number;
  readonly timeoutMs?: number;
  readonly pricing?: LlmGatewayPricing;
};

export type LocalRuntimeTownProfileActionSequenceGenerationConfig = {
  readonly kind: 'traceable-llm-action-sequence-generator';
  readonly profileId: string;
  readonly model: string;
  readonly provider: LlmStructuredProviderConfig;
  readonly maxAttempts?: number;
  readonly timeoutMs?: number;
  readonly pricing?: LlmGatewayPricing;
};

export type LocalRuntimeTownProfileGlobalSynthesisConfig = {
  readonly kind: 'traceable-llm-global-synthesizer';
  readonly profileId: string;
  readonly model: string;
  readonly provider: LlmStructuredProviderConfig;
  readonly maxAttempts?: number;
  readonly timeoutMs?: number;
  readonly pricing?: LlmGatewayPricing;
};

export type LocalRuntimeTownProfileReactiveCorrectionConfig = {
  readonly kind: 'traceable-llm-reactive-corrector';
  readonly profileId: string;
  readonly model: string;
  readonly provider: LlmStructuredProviderConfig;
  readonly maxAttempts?: number;
  readonly timeoutMs?: number;
  readonly pricing?: LlmGatewayPricing;
};

export type LocalRuntimeTownProfileReplanningDecisionConfig = {
  readonly kind: 'traceable-llm-replanning-decider';
  readonly profileId: string;
  readonly model: string;
  readonly provider: LlmStructuredProviderConfig;
  readonly maxAttempts?: number;
  readonly timeoutMs?: number;
  readonly pricing?: LlmGatewayPricing;
};

export type LocalRuntimeTownProfileSocialDialogueGenerationConfig = {
  readonly kind: 'traceable-llm-social-dialogue-generator';
  readonly profileId: string;
  readonly model: string;
  readonly provider: LlmStructuredProviderConfig;
  readonly maxAttempts?: number;
  readonly timeoutMs?: number;
  readonly pricing?: LlmGatewayPricing;
};

export type LocalRuntimeTownProfileReflectionSynthesisConfig = {
  readonly kind: 'traceable-llm-reflective-insight-synthesizer';
  readonly profileId: string;
  readonly model: string;
  readonly provider: LlmStructuredProviderConfig;
  readonly maxAttempts?: number;
  readonly timeoutMs?: number;
  readonly pricing?: LlmGatewayPricing;
};

export type LocalRuntimeTownProfileSocialModelSynthesisConfig = {
  readonly kind: 'traceable-llm-social-model-synthesizer';
  readonly profileId: string;
  readonly model: string;
  readonly provider: LlmStructuredProviderConfig;
  readonly maxAttempts?: number;
  readonly timeoutMs?: number;
  readonly pricing?: LlmGatewayPricing;
};

export type LocalRuntimeTownProfileStrategicCompilerConfig =
  | LocalRuntimeTownProfileLlmPlanningConfig
  | undefined;

export type LocalRuntimeTownProfileDailyCompilerConfig =
  | LocalRuntimeTownProfileDailyPlanningConfig
  | undefined;

export type LocalRuntimeTownProfileReactionEvaluatorConfig =
  | LocalRuntimeTownProfileReactionPlanningConfig
  | undefined;

export type LocalRuntimeTownProfileSubtaskPrioritizerConfig =
  | LocalRuntimeTownProfileSubtaskPrioritizationConfig
  | undefined;

export type LocalRuntimeTownProfileActionSequenceGeneratorConfig =
  | LocalRuntimeTownProfileActionSequenceGenerationConfig
  | undefined;

export type LocalRuntimeTownProfileGlobalSynthesizerConfig =
  | LocalRuntimeTownProfileGlobalSynthesisConfig
  | undefined;

export type LocalRuntimeTownProfileReactiveCorrectorConfig =
  | LocalRuntimeTownProfileReactiveCorrectionConfig
  | undefined;

export type LocalRuntimeTownProfileReplanningDeciderConfig =
  | LocalRuntimeTownProfileReplanningDecisionConfig
  | undefined;

export type LocalRuntimeTownProfileSocialDialogueGeneratorConfig =
  | LocalRuntimeTownProfileSocialDialogueGenerationConfig
  | undefined;

export type LocalRuntimeTownProfileReflectiveInsightSynthesizerConfig =
  | LocalRuntimeTownProfileReflectionSynthesisConfig
  | undefined;

export type LocalRuntimeTownProfileSocialModelSynthesizerConfig =
  | LocalRuntimeTownProfileSocialModelSynthesisConfig
  | undefined;

export function createLocalRuntimeTownProfileStrategicPlanCompiler(
  config: LocalRuntimeTownProfileStrategicCompilerConfig,
): StrategicPlanCompiler | undefined {
  if (config === undefined) {
    return undefined;
  }

  assertNonEmpty(config.profileId, 'profileId');
  const provider = createLlmStructuredProviderFromConfig(config.provider);
  return createTraceableLlmStrategicPlanCompiler({
    provider,
    model: config.model,
    requestId: ({ objective, issuedAt }) =>
      `profile-llm-plan:${config.profileId}:${objective.agentId}:${objective.id}:${issuedAt}`,
    ...(config.maxAttempts === undefined ? {} : { maxAttempts: config.maxAttempts }),
    ...(config.timeoutMs === undefined ? {} : { timeoutMs: config.timeoutMs }),
    ...(config.pricing === undefined ? {} : { pricing: config.pricing }),
  });
}

export function createLocalRuntimeTownProfileDailyPlanCompiler(
  config: LocalRuntimeTownProfileDailyCompilerConfig,
): DailyPlanCompiler | undefined {
  if (config === undefined) {
    return undefined;
  }

  assertNonEmpty(config.profileId, 'profileId');
  const provider = createLlmStructuredProviderFromConfig(config.provider);
  return createTraceableLlmDailyPlanCompiler({
    provider,
    model: config.model,
    requestId: ({ agentId, issuedAt }) =>
      `profile-llm-daily-plan:${config.profileId}:${agentId}:${issuedAt}`,
    ...(config.maxAttempts === undefined ? {} : { maxAttempts: config.maxAttempts }),
    ...(config.timeoutMs === undefined ? {} : { timeoutMs: config.timeoutMs }),
    ...(config.pricing === undefined ? {} : { pricing: config.pricing }),
  });
}

export function createLocalRuntimeTownProfileReactionEvaluator(
  config: LocalRuntimeTownProfileReactionEvaluatorConfig,
): ReactionEvaluator | undefined {
  if (config === undefined) {
    return undefined;
  }

  assertNonEmpty(config.profileId, 'profileId');
  const provider = createLlmStructuredProviderFromConfig(config.provider);
  return createTraceableLlmReactionEvaluator({
    provider,
    model: config.model,
    requestId: ({ agentId, memory, issuedAt }) =>
      `profile-llm-reaction:${config.profileId}:${agentId}:${memory.id}:${issuedAt}`,
    ...(config.maxAttempts === undefined ? {} : { maxAttempts: config.maxAttempts }),
    ...(config.timeoutMs === undefined ? {} : { timeoutMs: config.timeoutMs }),
    ...(config.pricing === undefined ? {} : { pricing: config.pricing }),
  });
}

export function createLocalRuntimeTownProfileSubtaskPrioritizer(
  config: LocalRuntimeTownProfileSubtaskPrioritizerConfig,
): SubtaskPrioritizer | undefined {
  if (config === undefined) {
    return undefined;
  }

  assertNonEmpty(config.profileId, 'profileId');
  const provider = createLlmStructuredProviderFromConfig(config.provider);
  return createTraceableLlmSubtaskPrioritizer({
    provider,
    model: config.model,
    requestId: ({ agentId, issuedAt }) =>
      `profile-llm-subtask-priority:${config.profileId}:${agentId}:${issuedAt}`,
    ...(config.maxAttempts === undefined ? {} : { maxAttempts: config.maxAttempts }),
    ...(config.timeoutMs === undefined ? {} : { timeoutMs: config.timeoutMs }),
    ...(config.pricing === undefined ? {} : { pricing: config.pricing }),
  });
}

export function createLocalRuntimeTownProfileActionSequenceGenerator(
  config: LocalRuntimeTownProfileActionSequenceGeneratorConfig,
): ActionSequenceGenerator | undefined {
  if (config === undefined) {
    return undefined;
  }

  assertNonEmpty(config.profileId, 'profileId');
  const provider = createLlmStructuredProviderFromConfig(config.provider);
  return createTraceableLlmActionSequenceGenerator({
    provider,
    model: config.model,
    requestId: ({ agentId, issuedAt, selectedSubtask }) =>
      `profile-llm-action-sequence:${config.profileId}:${agentId}:${selectedSubtask.branchId}:${selectedSubtask.subtaskId}:${issuedAt}`,
    ...(config.maxAttempts === undefined ? {} : { maxAttempts: config.maxAttempts }),
    ...(config.timeoutMs === undefined ? {} : { timeoutMs: config.timeoutMs }),
    ...(config.pricing === undefined ? {} : { pricing: config.pricing }),
  });
}

export function createLocalRuntimeTownProfileGlobalSynthesizer(
  config: LocalRuntimeTownProfileGlobalSynthesizerConfig,
): GlobalActionSynthesizer | undefined {
  if (config === undefined) {
    return undefined;
  }

  assertNonEmpty(config.profileId, 'profileId');
  const provider = createLlmStructuredProviderFromConfig(config.provider);
  return createTraceableLlmGlobalSynthesizer({
    provider,
    model: config.model,
    requestId: ({ agentId, issuedAt }) =>
      `profile-llm-global-synthesis:${config.profileId}:${agentId}:${issuedAt}`,
    ...(config.maxAttempts === undefined ? {} : { maxAttempts: config.maxAttempts }),
    ...(config.timeoutMs === undefined ? {} : { timeoutMs: config.timeoutMs }),
    ...(config.pricing === undefined ? {} : { pricing: config.pricing }),
  });
}

export function createLocalRuntimeTownProfileReactiveCorrector(
  config: LocalRuntimeTownProfileReactiveCorrectorConfig,
): ReactiveCorrector | undefined {
  if (config === undefined) {
    return undefined;
  }

  assertNonEmpty(config.profileId, 'profileId');
  const provider = createLlmStructuredProviderFromConfig(config.provider);
  return createTraceableLlmReactiveCorrector({
    provider,
    model: config.model,
    requestId: ({ agentId, issuedAt, rejectedAction }) =>
      `profile-llm-reactive-correction:${config.profileId}:${agentId}:${rejectedAction.id}:${issuedAt}`,
    ...(config.maxAttempts === undefined ? {} : { maxAttempts: config.maxAttempts }),
    ...(config.timeoutMs === undefined ? {} : { timeoutMs: config.timeoutMs }),
    ...(config.pricing === undefined ? {} : { pricing: config.pricing }),
  });
}

export function createLocalRuntimeTownProfileReplanningDecider(
  config: LocalRuntimeTownProfileReplanningDeciderConfig,
): ReplanningDecider | undefined {
  if (config === undefined) {
    return undefined;
  }

  assertNonEmpty(config.profileId, 'profileId');
  const provider = createLlmStructuredProviderFromConfig(config.provider);
  return createTraceableLlmReplanningDecider({
    provider,
    model: config.model,
    requestId: ({ agentId, issuedAt, selectedSubtask }) =>
      `profile-llm-replanning:${config.profileId}:${agentId}:${selectedSubtask.subtaskId}:${issuedAt}`,
    ...(config.maxAttempts === undefined ? {} : { maxAttempts: config.maxAttempts }),
    ...(config.timeoutMs === undefined ? {} : { timeoutMs: config.timeoutMs }),
    ...(config.pricing === undefined ? {} : { pricing: config.pricing }),
  });
}

export function createLocalRuntimeTownProfileSocialDialogueGenerator(
  config: LocalRuntimeTownProfileSocialDialogueGeneratorConfig,
): SocialDialogueGenerator | undefined {
  if (config === undefined) {
    return undefined;
  }

  assertNonEmpty(config.profileId, 'profileId');
  const provider = createLlmStructuredProviderFromConfig(config.provider);
  return createTraceableLlmSocialDialogueGenerator({
    provider,
    model: config.model,
    requestId: ({ agentId, issuedAt, action }) =>
      `profile-llm-social-dialogue:${config.profileId}:${agentId}:${action.id}:${issuedAt}`,
    ...(config.maxAttempts === undefined ? {} : { maxAttempts: config.maxAttempts }),
    ...(config.timeoutMs === undefined ? {} : { timeoutMs: config.timeoutMs }),
    ...(config.pricing === undefined ? {} : { pricing: config.pricing }),
  });
}

export function createLocalRuntimeTownProfileReflectiveInsightSynthesizer(
  config: LocalRuntimeTownProfileReflectiveInsightSynthesizerConfig,
): ReflectiveInsightSynthesizer | undefined {
  if (config === undefined) {
    return undefined;
  }

  assertNonEmpty(config.profileId, 'profileId');
  const provider = createLlmStructuredProviderFromConfig(config.provider);
  return createTraceableLlmReflectiveInsightSynthesizer({
    provider,
    model: config.model,
    requestId: ({ agentId, generatedAt }) =>
      `profile-llm-reflection-synthesis:${config.profileId}:${agentId}:${generatedAt}`,
    ...(config.maxAttempts === undefined ? {} : { maxAttempts: config.maxAttempts }),
    ...(config.timeoutMs === undefined ? {} : { timeoutMs: config.timeoutMs }),
    ...(config.pricing === undefined ? {} : { pricing: config.pricing }),
  });
}

export function createLocalRuntimeTownProfileSocialModelSynthesizer(
  config: LocalRuntimeTownProfileSocialModelSynthesizerConfig,
): SocialModelSynthesizer | undefined {
  if (config === undefined) {
    return undefined;
  }

  assertNonEmpty(config.profileId, 'profileId');
  const provider = createLlmStructuredProviderFromConfig(config.provider);
  return createTraceableLlmSocialModelSynthesizer({
    provider,
    model: config.model,
    requestId: ({ agentId, generatedAt }) =>
      `profile-llm-social-model-synthesis:${config.profileId}:${agentId}:${generatedAt}`,
    ...(config.maxAttempts === undefined ? {} : { maxAttempts: config.maxAttempts }),
    ...(config.timeoutMs === undefined ? {} : { timeoutMs: config.timeoutMs }),
    ...(config.pricing === undefined ? {} : { pricing: config.pricing }),
  });
}

function assertNonEmpty(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${name} must not be empty`);
  }
}
