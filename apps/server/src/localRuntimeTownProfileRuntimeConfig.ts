import { readFile } from 'node:fs/promises';
import type { AdaptiveReplanningPolicy } from '@aivilization/agent-runtime';
import type { LlmGatewayPricing, OpenAiCompatibleResponseFormatMode } from '@aivilization/llm';
import type {
  LocalRuntimeTownProfileDailyCompilerConfig,
  LocalRuntimeTownProfileDailyPlanningConfig,
  LocalRuntimeTownProfileActionSequenceGenerationConfig,
  LocalRuntimeTownProfileActionSequenceGeneratorConfig,
  LocalRuntimeTownProfileGlobalSynthesisConfig,
  LocalRuntimeTownProfileGlobalSynthesizerConfig,
  LocalRuntimeTownProfileLlmPlanningConfig,
  LocalRuntimeTownProfileReactiveCorrectionConfig,
  LocalRuntimeTownProfileReactiveCorrectorConfig,
  LocalRuntimeTownProfileReactionEvaluatorConfig,
  LocalRuntimeTownProfileReactionPlanningConfig,
  LocalRuntimeTownProfileSubtaskPrioritizationConfig,
  LocalRuntimeTownProfileSubtaskPrioritizerConfig,
  LocalRuntimeTownProfileStrategicCompilerConfig,
} from './localRuntimeTownProfileLlmPlanning';
import type { LocalRuntimeTownDaemonScenarioProfileId } from './localRuntimeTownScenarioProfile';

export type LocalRuntimeTownProfileRuntimeConfigSecretReference = {
  readonly env: string;
};

export type LocalRuntimeTownProfileRuntimeConfigSecretValue =
  | string
  | LocalRuntimeTownProfileRuntimeConfigSecretReference;

export type LocalRuntimeTownProfileRuntimeConfigReadTextFile = (path: string) => Promise<string>;

export type LocalRuntimeTownProfileLlmPlanningConfigLoadInput = {
  readonly profileId: LocalRuntimeTownDaemonScenarioProfileId;
  readonly path: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly readTextFile?: LocalRuntimeTownProfileRuntimeConfigReadTextFile;
};

export type LocalRuntimeTownProfileRuntimeConfigLoadInput =
  LocalRuntimeTownProfileLlmPlanningConfigLoadInput;

export type LocalRuntimeTownProfileRuntimeConfig = {
  readonly strategicPlanning?: LocalRuntimeTownProfileLlmPlanningConfig;
  readonly dailyPlanning?: LocalRuntimeTownProfileDailyPlanningConfig;
  readonly reactionPlanning?: LocalRuntimeTownProfileReactionPlanningConfig;
  readonly subtaskPrioritization?: LocalRuntimeTownProfileSubtaskPrioritizationConfig;
  readonly actionSequenceGeneration?: LocalRuntimeTownProfileActionSequenceGenerationConfig;
  readonly globalSynthesis?: LocalRuntimeTownProfileGlobalSynthesisConfig;
  readonly reactiveCorrection?: LocalRuntimeTownProfileReactiveCorrectionConfig;
  readonly replanningPolicy?: AdaptiveReplanningPolicy;
};

export async function loadLocalRuntimeTownProfileLlmPlanningConfig(
  input: LocalRuntimeTownProfileLlmPlanningConfigLoadInput,
): Promise<LocalRuntimeTownProfileStrategicCompilerConfig> {
  assertNonEmpty(input.path, 'path');
  const readTextFile = input.readTextFile ?? readTextFileFromDisk;
  const text = await readTextFile(input.path);
  const document = parseJsonObject(text, input.path);

  return parseLocalRuntimeTownProfileLlmPlanningConfigDocument({
    profileId: input.profileId,
    document,
    env: input.env ?? {},
  });
}

export async function loadLocalRuntimeTownProfileRuntimeConfig(
  input: LocalRuntimeTownProfileRuntimeConfigLoadInput,
): Promise<LocalRuntimeTownProfileRuntimeConfig> {
  assertNonEmpty(input.path, 'path');
  const readTextFile = input.readTextFile ?? readTextFileFromDisk;
  const text = await readTextFile(input.path);
  const document = parseJsonObject(text, input.path);

  return parseLocalRuntimeTownProfileRuntimeConfigDocument({
    profileId: input.profileId,
    document,
    env: input.env ?? {},
  });
}

export function parseLocalRuntimeTownProfileLlmPlanningConfigDocument(input: {
  readonly profileId: LocalRuntimeTownDaemonScenarioProfileId;
  readonly document: unknown;
  readonly env?: Readonly<Record<string, string | undefined>>;
}): LocalRuntimeTownProfileStrategicCompilerConfig {
  const document = requireRecord(input.document, 'runtime profile config document');
  const selectedNode = selectProfileLlmPlanningNode(document, input.profileId);
  return parseLlmPlanningNode({
    profileId: input.profileId,
    node: selectedNode,
    env: input.env ?? {},
  });
}

export function parseLocalRuntimeTownProfileRuntimeConfigDocument(input: {
  readonly profileId: LocalRuntimeTownDaemonScenarioProfileId;
  readonly document: unknown;
  readonly env?: Readonly<Record<string, string | undefined>>;
}): LocalRuntimeTownProfileRuntimeConfig {
  const document = requireRecord(input.document, 'runtime profile config document');
  const env = input.env ?? {};
  const strategicPlanning = parseLlmPlanningNode({
    profileId: input.profileId,
    node: selectProfilePlanningNode({
      document,
      profileId: input.profileId,
      nodeName: 'llmPlanning',
    }),
    env,
  });
  const dailyPlanning = parseDailyPlanningNode({
    profileId: input.profileId,
    node: selectProfilePlanningNode({
      document,
      profileId: input.profileId,
      nodeName: 'dailyPlanning',
    }),
    env,
  });
  const reactionPlanning = parseReactionPlanningNode({
    profileId: input.profileId,
    node: selectProfilePlanningNode({
      document,
      profileId: input.profileId,
      nodeName: 'reactionPlanning',
    }),
    env,
  });
  const replanningPolicy = parseReplanningPolicyNode({
    node: selectProfilePlanningNode({
      document,
      profileId: input.profileId,
      nodeName: 'replanningPolicy',
    }),
  });
  const subtaskPrioritization = parseSubtaskPrioritizationNode({
    profileId: input.profileId,
    node: selectProfilePlanningNode({
      document,
      profileId: input.profileId,
      nodeName: 'subtaskPrioritization',
    }),
    env,
  });
  const actionSequenceGeneration = parseActionSequenceGenerationNode({
    profileId: input.profileId,
    node: selectProfilePlanningNode({
      document,
      profileId: input.profileId,
      nodeName: 'actionSequenceGeneration',
    }),
    env,
  });
  const globalSynthesis = parseGlobalSynthesisNode({
    profileId: input.profileId,
    node: selectProfilePlanningNode({
      document,
      profileId: input.profileId,
      nodeName: 'globalSynthesis',
    }),
    env,
  });
  const reactiveCorrection = parseReactiveCorrectionNode({
    profileId: input.profileId,
    node: selectProfilePlanningNode({
      document,
      profileId: input.profileId,
      nodeName: 'reactiveCorrection',
    }),
    env,
  });

  return {
    ...(strategicPlanning === undefined ? {} : { strategicPlanning }),
    ...(dailyPlanning === undefined ? {} : { dailyPlanning }),
    ...(reactionPlanning === undefined ? {} : { reactionPlanning }),
    ...(subtaskPrioritization === undefined ? {} : { subtaskPrioritization }),
    ...(actionSequenceGeneration === undefined ? {} : { actionSequenceGeneration }),
    ...(globalSynthesis === undefined ? {} : { globalSynthesis }),
    ...(reactiveCorrection === undefined ? {} : { reactiveCorrection }),
    ...(replanningPolicy === undefined ? {} : { replanningPolicy }),
  };
}

async function readTextFileFromDisk(path: string): Promise<string> {
  return readFile(path, 'utf8');
}

function parseJsonObject(text: string, path: string): Readonly<Record<string, unknown>> {
  try {
    return requireRecord(JSON.parse(text) as unknown, `runtime profile config ${path}`);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`runtime profile config ${path} must be valid JSON: ${error.message}`);
    }
    throw error;
  }
}

function selectProfileLlmPlanningNode(
  document: Readonly<Record<string, unknown>>,
  profileId: LocalRuntimeTownDaemonScenarioProfileId,
): unknown {
  return selectProfilePlanningNode({ document, profileId, nodeName: 'llmPlanning' });
}

function selectProfilePlanningNode(input: {
  readonly document: Readonly<Record<string, unknown>>;
  readonly profileId: LocalRuntimeTownDaemonScenarioProfileId;
  readonly nodeName: LocalRuntimeTownProfileRuntimeConfigNodeName;
}): unknown {
  const profiles = readOptionalRecord(input.document.profiles, 'profiles');
  const profileNode = profiles?.[input.profileId];
  if (profileNode !== undefined) {
    const profile = requireRecord(profileNode, `profiles.${input.profileId}`);
    if (hasOwn(profile, input.nodeName)) {
      return profile[input.nodeName];
    }
  }

  return input.document[input.nodeName];
}

function parseLlmPlanningNode(input: {
  readonly profileId: LocalRuntimeTownDaemonScenarioProfileId;
  readonly node: unknown;
  readonly env: Readonly<Record<string, string | undefined>>;
}): LocalRuntimeTownProfileStrategicCompilerConfig {
  if (input.node === undefined || input.node === null) {
    return undefined;
  }

  const record = requireRecord(input.node, 'llmPlanning');
  const kind = readRequiredString(record.kind, 'llmPlanning.kind');
  if (kind !== 'traceable-llm-strategic-planner') {
    throw new Error(`llmPlanning.kind must be traceable-llm-strategic-planner`);
  }

  const maxAttempts = readOptionalPositiveInteger(record.maxAttempts, 'llmPlanning.maxAttempts');
  const timeoutMs = readOptionalNonNegativeFinite(record.timeoutMs, 'llmPlanning.timeoutMs');
  const pricing = parseOptionalPricing(record.pricing, 'llmPlanning');

  return {
    kind: 'traceable-llm-strategic-planner',
    profileId: input.profileId,
    model: readRequiredString(record.model, 'llmPlanning.model'),
    provider: parseOpenAiCompatibleProviderConfig(record.provider, input.env, 'llmPlanning'),
    ...(maxAttempts === undefined ? {} : { maxAttempts }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(pricing === undefined ? {} : { pricing }),
  };
}

function parseDailyPlanningNode(input: {
  readonly profileId: LocalRuntimeTownDaemonScenarioProfileId;
  readonly node: unknown;
  readonly env: Readonly<Record<string, string | undefined>>;
}): LocalRuntimeTownProfileDailyCompilerConfig {
  if (input.node === undefined || input.node === null) {
    return undefined;
  }

  const record = requireRecord(input.node, 'dailyPlanning');
  const kind = readRequiredString(record.kind, 'dailyPlanning.kind');
  if (kind !== 'traceable-llm-daily-planner') {
    throw new Error(`dailyPlanning.kind must be traceable-llm-daily-planner`);
  }

  const maxAttempts = readOptionalPositiveInteger(record.maxAttempts, 'dailyPlanning.maxAttempts');
  const timeoutMs = readOptionalNonNegativeFinite(record.timeoutMs, 'dailyPlanning.timeoutMs');
  const pricing = parseOptionalPricing(record.pricing, 'dailyPlanning');

  return {
    kind: 'traceable-llm-daily-planner',
    profileId: input.profileId,
    model: readRequiredString(record.model, 'dailyPlanning.model'),
    provider: parseOpenAiCompatibleProviderConfig(record.provider, input.env, 'dailyPlanning'),
    ...(maxAttempts === undefined ? {} : { maxAttempts }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(pricing === undefined ? {} : { pricing }),
  };
}

function parseReactionPlanningNode(input: {
  readonly profileId: LocalRuntimeTownDaemonScenarioProfileId;
  readonly node: unknown;
  readonly env: Readonly<Record<string, string | undefined>>;
}): LocalRuntimeTownProfileReactionEvaluatorConfig {
  if (input.node === undefined || input.node === null) {
    return undefined;
  }

  const record = requireRecord(input.node, 'reactionPlanning');
  const kind = readRequiredString(record.kind, 'reactionPlanning.kind');
  if (kind !== 'traceable-llm-reaction-evaluator') {
    throw new Error(`reactionPlanning.kind must be traceable-llm-reaction-evaluator`);
  }

  const maxAttempts = readOptionalPositiveInteger(
    record.maxAttempts,
    'reactionPlanning.maxAttempts',
  );
  const timeoutMs = readOptionalNonNegativeFinite(record.timeoutMs, 'reactionPlanning.timeoutMs');
  const pricing = parseOptionalPricing(record.pricing, 'reactionPlanning');

  return {
    kind: 'traceable-llm-reaction-evaluator',
    profileId: input.profileId,
    model: readRequiredString(record.model, 'reactionPlanning.model'),
    provider: parseOpenAiCompatibleProviderConfig(record.provider, input.env, 'reactionPlanning'),
    ...(maxAttempts === undefined ? {} : { maxAttempts }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(pricing === undefined ? {} : { pricing }),
  };
}

function parseSubtaskPrioritizationNode(input: {
  readonly profileId: LocalRuntimeTownDaemonScenarioProfileId;
  readonly node: unknown;
  readonly env: Readonly<Record<string, string | undefined>>;
}): LocalRuntimeTownProfileSubtaskPrioritizerConfig {
  if (input.node === undefined || input.node === null) {
    return undefined;
  }

  const record = requireRecord(input.node, 'subtaskPrioritization');
  const kind = readRequiredString(record.kind, 'subtaskPrioritization.kind');
  if (kind !== 'traceable-llm-subtask-prioritizer') {
    throw new Error(`subtaskPrioritization.kind must be traceable-llm-subtask-prioritizer`);
  }

  const maxAttempts = readOptionalPositiveInteger(
    record.maxAttempts,
    'subtaskPrioritization.maxAttempts',
  );
  const timeoutMs = readOptionalNonNegativeFinite(
    record.timeoutMs,
    'subtaskPrioritization.timeoutMs',
  );
  const pricing = parseOptionalPricing(record.pricing, 'subtaskPrioritization');

  return {
    kind: 'traceable-llm-subtask-prioritizer',
    profileId: input.profileId,
    model: readRequiredString(record.model, 'subtaskPrioritization.model'),
    provider: parseOpenAiCompatibleProviderConfig(
      record.provider,
      input.env,
      'subtaskPrioritization',
    ),
    ...(maxAttempts === undefined ? {} : { maxAttempts }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(pricing === undefined ? {} : { pricing }),
  };
}

function parseActionSequenceGenerationNode(input: {
  readonly profileId: LocalRuntimeTownDaemonScenarioProfileId;
  readonly node: unknown;
  readonly env: Readonly<Record<string, string | undefined>>;
}): LocalRuntimeTownProfileActionSequenceGeneratorConfig {
  if (input.node === undefined || input.node === null) {
    return undefined;
  }

  const record = requireRecord(input.node, 'actionSequenceGeneration');
  const kind = readRequiredString(record.kind, 'actionSequenceGeneration.kind');
  if (kind !== 'traceable-llm-action-sequence-generator') {
    throw new Error(
      `actionSequenceGeneration.kind must be traceable-llm-action-sequence-generator`,
    );
  }

  const maxAttempts = readOptionalPositiveInteger(
    record.maxAttempts,
    'actionSequenceGeneration.maxAttempts',
  );
  const timeoutMs = readOptionalNonNegativeFinite(
    record.timeoutMs,
    'actionSequenceGeneration.timeoutMs',
  );
  const pricing = parseOptionalPricing(record.pricing, 'actionSequenceGeneration');

  return {
    kind: 'traceable-llm-action-sequence-generator',
    profileId: input.profileId,
    model: readRequiredString(record.model, 'actionSequenceGeneration.model'),
    provider: parseOpenAiCompatibleProviderConfig(
      record.provider,
      input.env,
      'actionSequenceGeneration',
    ),
    ...(maxAttempts === undefined ? {} : { maxAttempts }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(pricing === undefined ? {} : { pricing }),
  };
}

function parseGlobalSynthesisNode(input: {
  readonly profileId: LocalRuntimeTownDaemonScenarioProfileId;
  readonly node: unknown;
  readonly env: Readonly<Record<string, string | undefined>>;
}): LocalRuntimeTownProfileGlobalSynthesizerConfig {
  if (input.node === undefined || input.node === null) {
    return undefined;
  }

  const record = requireRecord(input.node, 'globalSynthesis');
  const kind = readRequiredString(record.kind, 'globalSynthesis.kind');
  if (kind !== 'traceable-llm-global-synthesizer') {
    throw new Error(`globalSynthesis.kind must be traceable-llm-global-synthesizer`);
  }

  const maxAttempts = readOptionalPositiveInteger(
    record.maxAttempts,
    'globalSynthesis.maxAttempts',
  );
  const timeoutMs = readOptionalNonNegativeFinite(record.timeoutMs, 'globalSynthesis.timeoutMs');
  const pricing = parseOptionalPricing(record.pricing, 'globalSynthesis');

  return {
    kind: 'traceable-llm-global-synthesizer',
    profileId: input.profileId,
    model: readRequiredString(record.model, 'globalSynthesis.model'),
    provider: parseOpenAiCompatibleProviderConfig(record.provider, input.env, 'globalSynthesis'),
    ...(maxAttempts === undefined ? {} : { maxAttempts }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(pricing === undefined ? {} : { pricing }),
  };
}

function parseReactiveCorrectionNode(input: {
  readonly profileId: LocalRuntimeTownDaemonScenarioProfileId;
  readonly node: unknown;
  readonly env: Readonly<Record<string, string | undefined>>;
}): LocalRuntimeTownProfileReactiveCorrectorConfig {
  if (input.node === undefined || input.node === null) {
    return undefined;
  }

  const record = requireRecord(input.node, 'reactiveCorrection');
  const kind = readRequiredString(record.kind, 'reactiveCorrection.kind');
  if (kind !== 'traceable-llm-reactive-corrector') {
    throw new Error(`reactiveCorrection.kind must be traceable-llm-reactive-corrector`);
  }

  const maxAttempts = readOptionalPositiveInteger(
    record.maxAttempts,
    'reactiveCorrection.maxAttempts',
  );
  const timeoutMs = readOptionalNonNegativeFinite(record.timeoutMs, 'reactiveCorrection.timeoutMs');
  const pricing = parseOptionalPricing(record.pricing, 'reactiveCorrection');

  return {
    kind: 'traceable-llm-reactive-corrector',
    profileId: input.profileId,
    model: readRequiredString(record.model, 'reactiveCorrection.model'),
    provider: parseOpenAiCompatibleProviderConfig(record.provider, input.env, 'reactiveCorrection'),
    ...(maxAttempts === undefined ? {} : { maxAttempts }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(pricing === undefined ? {} : { pricing }),
  };
}

function parseReplanningPolicyNode(input: {
  readonly node: unknown;
}): AdaptiveReplanningPolicy | undefined {
  if (input.node === undefined || input.node === null) {
    return undefined;
  }

  const record = requireRecord(input.node, 'replanningPolicy');
  const failureTags = readOptionalStringArray(record.failureTags, 'replanningPolicy.failureTags');
  const majorContextShift = parseOptionalMajorContextShift(
    record.majorContextShift,
    'replanningPolicy.majorContextShift',
  );

  return {
    consecutiveFailureThreshold: readRequiredPositiveInteger(
      record.consecutiveFailureThreshold,
      'replanningPolicy.consecutiveFailureThreshold',
    ),
    ...(failureTags === undefined ? {} : { failureTags }),
    ...(majorContextShift === undefined ? {} : { majorContextShift }),
  };
}

type LocalRuntimeTownProfileRuntimeConfigNodeName =
  | 'llmPlanning'
  | 'dailyPlanning'
  | 'reactionPlanning'
  | 'subtaskPrioritization'
  | 'actionSequenceGeneration'
  | 'globalSynthesis'
  | 'reactiveCorrection'
  | 'replanningPolicy';

function parseOpenAiCompatibleProviderConfig(
  value: unknown,
  env: Readonly<Record<string, string | undefined>>,
  nodeName: LocalRuntimeTownProfileRuntimeConfigNodeName,
): LocalRuntimeTownProfileLlmPlanningConfig['provider'] {
  const record = requireRecord(value, `${nodeName}.provider`);
  const kind = readRequiredString(record.kind, `${nodeName}.provider.kind`);
  if (kind !== 'openai-compatible') {
    throw new Error(`${nodeName}.provider.kind must be openai-compatible`);
  }

  const apiKey = readOptionalSecretString(record.apiKey, `${nodeName}.provider.apiKey`, env);
  const defaultHeaders = parseOptionalDefaultHeaders(record.defaultHeaders, env, nodeName);
  const responseFormat = readOptionalResponseFormat(
    record.responseFormat,
    `${nodeName}.provider.responseFormat`,
  );

  return {
    kind: 'openai-compatible',
    providerId: readRequiredString(record.providerId, `${nodeName}.provider.providerId`),
    endpoint: readRequiredString(record.endpoint, `${nodeName}.provider.endpoint`),
    ...(apiKey === undefined ? {} : { apiKey }),
    ...(defaultHeaders === undefined ? {} : { defaultHeaders }),
    ...(responseFormat === undefined ? {} : { responseFormat }),
  };
}

function parseOptionalDefaultHeaders(
  value: unknown,
  env: Readonly<Record<string, string | undefined>>,
  nodeName: LocalRuntimeTownProfileRuntimeConfigNodeName,
): Readonly<Record<string, string>> | undefined {
  const record = readOptionalRecord(value, `${nodeName}.provider.defaultHeaders`);
  if (record === undefined) {
    return undefined;
  }

  const headers: Record<string, string> = {};
  for (const [name, headerValue] of Object.entries(record)) {
    assertNonEmpty(name, `${nodeName}.provider.defaultHeaders header name`);
    headers[name] = resolveSecretValue(
      headerValue,
      `${nodeName}.provider.defaultHeaders.${name}`,
      env,
    );
  }
  return headers;
}

function parseOptionalPricing(
  value: unknown,
  nodeName: LocalRuntimeTownProfileRuntimeConfigNodeName,
): LlmGatewayPricing | undefined {
  const record = readOptionalRecord(value, `${nodeName}.pricing`);
  if (record === undefined) {
    return undefined;
  }

  return {
    inputTokenCostMicros: readRequiredNonNegativeFinite(
      record.inputTokenCostMicros,
      `${nodeName}.pricing.inputTokenCostMicros`,
    ),
    outputTokenCostMicros: readRequiredNonNegativeFinite(
      record.outputTokenCostMicros,
      `${nodeName}.pricing.outputTokenCostMicros`,
    ),
  };
}

function readOptionalSecretString(
  value: unknown,
  name: string,
  env: Readonly<Record<string, string | undefined>>,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return resolveSecretValue(value, name, env);
}

function resolveSecretValue(
  value: unknown,
  name: string,
  env: Readonly<Record<string, string | undefined>>,
): string {
  if (typeof value === 'string') {
    assertNonEmpty(value, name);
    return value;
  }

  const reference = requireRecord(value, name);
  const envName = readRequiredString(reference.env, `${name}.env`);
  const resolved = env[envName];
  if (resolved === undefined || resolved.trim().length === 0) {
    throw new Error(`environment variable ${envName} is required by ${name}`);
  }
  return resolved;
}

function readOptionalResponseFormat(
  value: unknown,
  name: string,
): OpenAiCompatibleResponseFormatMode | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === 'json-schema' || value === 'json-object' || value === 'none') {
    return value;
  }
  throw new Error(`${name} must be json-schema, json-object, or none`);
}

function readRequiredString(value: unknown, name: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${name} must be a string`);
  }
  assertNonEmpty(value, name);
  return value;
}

function readOptionalPositiveInteger(value: unknown, name: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function readRequiredPositiveInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function readRequiredNonNegativeFinite(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative finite number`);
  }
  return value;
}

function readOptionalNonNegativeFinite(value: unknown, name: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  return readRequiredNonNegativeFinite(value, name);
}

function readOptionalRecord(
  value: unknown,
  name: string,
): Readonly<Record<string, unknown>> | undefined {
  if (value === undefined) {
    return undefined;
  }
  return requireRecord(value, name);
}

function requireRecord(value: unknown, name: string): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function readOptionalStringArray(value: unknown, name: string): readonly string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error(`${name} must be an array of strings`);
  }
  return value.map((entry, index) => readRequiredString(entry, `${name}[${index}]`));
}

function parseOptionalMajorContextShift(
  value: unknown,
  name: string,
): AdaptiveReplanningPolicy['majorContextShift'] {
  if (value === undefined) {
    return undefined;
  }
  const record = requireRecord(value, name);
  return {
    key: readRequiredString(record.key, `${name}.key`),
    reason: readRequiredString(record.reason, `${name}.reason`),
  };
}

function hasOwn(record: Readonly<Record<string, unknown>>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function assertNonEmpty(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${name} must not be empty`);
  }
}
