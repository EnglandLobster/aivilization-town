import {
  createTraceableLlmStrategicPlanCompiler,
  type StrategicPlanCompiler,
} from '@aivilization/agent-runtime';
import {
  createLlmStructuredProviderFromConfig,
  type LlmGatewayPricing,
  type LlmStructuredProviderConfig,
} from '@aivilization/llm';

export type LocalRuntimeTownProfileLlmPlanningConfig = {
  readonly kind: 'traceable-llm-strategic-planner';
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

function assertNonEmpty(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${name} must not be empty`);
  }
}
