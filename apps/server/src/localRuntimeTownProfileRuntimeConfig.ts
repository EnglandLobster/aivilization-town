import { readFile } from 'node:fs/promises';
import type { LlmGatewayPricing, OpenAiCompatibleResponseFormatMode } from '@aivilization/llm';
import type {
  LocalRuntimeTownProfileLlmPlanningConfig,
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
  const profiles = readOptionalRecord(document.profiles, 'profiles');
  const profileNode = profiles?.[profileId];
  if (profileNode !== undefined) {
    const profile = requireRecord(profileNode, `profiles.${profileId}`);
    if (hasOwn(profile, 'llmPlanning')) {
      return profile.llmPlanning;
    }
  }

  return document.llmPlanning;
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
  const pricing = parseOptionalPricing(record.pricing);

  return {
    kind: 'traceable-llm-strategic-planner',
    profileId: input.profileId,
    model: readRequiredString(record.model, 'llmPlanning.model'),
    provider: parseOpenAiCompatibleProviderConfig(record.provider, input.env),
    ...(maxAttempts === undefined ? {} : { maxAttempts }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(pricing === undefined ? {} : { pricing }),
  };
}

function parseOpenAiCompatibleProviderConfig(
  value: unknown,
  env: Readonly<Record<string, string | undefined>>,
): LocalRuntimeTownProfileLlmPlanningConfig['provider'] {
  const record = requireRecord(value, 'llmPlanning.provider');
  const kind = readRequiredString(record.kind, 'llmPlanning.provider.kind');
  if (kind !== 'openai-compatible') {
    throw new Error(`llmPlanning.provider.kind must be openai-compatible`);
  }

  const apiKey = readOptionalSecretString(record.apiKey, 'llmPlanning.provider.apiKey', env);
  const defaultHeaders = parseOptionalDefaultHeaders(record.defaultHeaders, env);
  const responseFormat = readOptionalResponseFormat(
    record.responseFormat,
    'llmPlanning.provider.responseFormat',
  );

  return {
    kind: 'openai-compatible',
    providerId: readRequiredString(record.providerId, 'llmPlanning.provider.providerId'),
    endpoint: readRequiredString(record.endpoint, 'llmPlanning.provider.endpoint'),
    ...(apiKey === undefined ? {} : { apiKey }),
    ...(defaultHeaders === undefined ? {} : { defaultHeaders }),
    ...(responseFormat === undefined ? {} : { responseFormat }),
  };
}

function parseOptionalDefaultHeaders(
  value: unknown,
  env: Readonly<Record<string, string | undefined>>,
): Readonly<Record<string, string>> | undefined {
  const record = readOptionalRecord(value, 'llmPlanning.provider.defaultHeaders');
  if (record === undefined) {
    return undefined;
  }

  const headers: Record<string, string> = {};
  for (const [name, headerValue] of Object.entries(record)) {
    assertNonEmpty(name, 'llmPlanning.provider.defaultHeaders header name');
    headers[name] = resolveSecretValue(
      headerValue,
      `llmPlanning.provider.defaultHeaders.${name}`,
      env,
    );
  }
  return headers;
}

function parseOptionalPricing(value: unknown): LlmGatewayPricing | undefined {
  const record = readOptionalRecord(value, 'llmPlanning.pricing');
  if (record === undefined) {
    return undefined;
  }

  return {
    inputTokenCostMicros: readRequiredNonNegativeFinite(
      record.inputTokenCostMicros,
      'llmPlanning.pricing.inputTokenCostMicros',
    ),
    outputTokenCostMicros: readRequiredNonNegativeFinite(
      record.outputTokenCostMicros,
      'llmPlanning.pricing.outputTokenCostMicros',
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

function hasOwn(record: Readonly<Record<string, unknown>>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function assertNonEmpty(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${name} must not be empty`);
  }
}
