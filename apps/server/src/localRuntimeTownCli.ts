import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import {
  DEFAULT_MAX_AGENTS_PER_PARTICIPANT,
  TOWN_OIDC_JWKS_AUTHENTICATION_POLICY_VERSION,
  createTownStaticBearerCredentialDigest,
  createTownStaticBearerAuthenticatorFromDigests,
  validateTownOidcJwksAuthenticatorConfig,
  type TownAccessRole,
  type TownStaticBearerCredential,
} from '@aivilization/api';
import { assertPaperPlannerVariant, type PaperPlannerVariant } from '@aivilization/agent-runtime';
import {
  assertPaperPlannerAblationTaskId,
  type PaperPlannerAblationTaskId,
} from '@aivilization/observability';
import {
  createAivilizationWorldCommandPolicies,
  createPaperMarketObservationRecordingConfig,
  createPaperPlannerAblationObjectiveProposer,
} from '@aivilization/worker';
import type { LocalRuntimeTownLlmConfig } from './localRuntimeTownLlm';
import { stopLocalRuntimeTownOrchestration } from './localRuntimeTownOrchestration';
import { createCanonicalLocalRuntimeTownResolvedRunManifest } from './localRuntimeTownResolvedRunManifest';
import {
  inspectLocalRuntimeTownDataCompatibility,
  registerLocalRuntimeTownDataCompatibility,
} from './localRuntimeTownDataCompatibility';
import {
  createLocalRuntimeTownDaemonScenarioProfile,
  type LocalRuntimeTownDaemonScenarioProfileId,
} from './localRuntimeTownScenarioProfile';
import {
  createLocalRuntimeTownNodeHttpServer,
  type LocalRuntimeTownNodeHttpServer,
  type LocalRuntimeTownServerInput,
} from './localRuntimeTownServer';
import type { LocalRuntimeTownParticipantAccessConfig } from './localRuntimeTownParticipantAccess';
import {
  normalizeLocalRuntimeTownSourceRevision,
  resolveLocalRuntimeTownSourceRevision,
  type LocalRuntimeTownSourceRevision,
} from './localRuntimeTownSourceRevision';

export type { LocalRuntimeTownSourceRevision } from './localRuntimeTownSourceRevision';

export const LOCAL_RUNTIME_TOWN_COMPOSITION_VERSION = 'canonical-runtime-composition-v1';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 3000;
const DEFAULT_PROFILE_ID: LocalRuntimeTownDaemonScenarioProfileId = 'smoke-25';
const DEFAULT_LLM_PROVIDER_ID = 'canonical-openai-compatible';
const DEFAULT_PLANNER_VARIANT: PaperPlannerVariant = 'default';
const DEFAULT_SHUTDOWN_FAILURE_EXIT_CODE = 1;

const supportedProfileIds = new Set<LocalRuntimeTownDaemonScenarioProfileId>([
  'smoke-25',
  'default-100',
  'headless-stress-1000',
  'recovery-drill-25',
  'ablation-80',
]);

export type LocalRuntimeTownLlmMode = 'provider' | 'deterministic';

export type LocalRuntimeTownCliConfig = {
  readonly compositionVersion: typeof LOCAL_RUNTIME_TOWN_COMPOSITION_VERSION;
  readonly profileId: LocalRuntimeTownDaemonScenarioProfileId;
  readonly rootDir: string;
  readonly host: string;
  readonly port: number;
  readonly seed: string;
  readonly plannerVariant: PaperPlannerVariant;
  readonly paperAblationTaskId?: PaperPlannerAblationTaskId;
  readonly sourceRevision: LocalRuntimeTownSourceRevision;
  readonly llmMode: LocalRuntimeTownLlmMode;
  readonly llm?: LocalRuntimeTownLlmConfig;
  readonly participantAccess?: LocalRuntimeTownParticipantAccessConfig;
};

export type LocalRuntimeTownCliConfigInput = {
  readonly argv?: readonly string[];
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly cwd?: string;
  readonly sourceRevision?: LocalRuntimeTownSourceRevision;
};

export type LocalRuntimeTownCliApplication = {
  readonly config: LocalRuntimeTownCliConfig;
  readonly runtime: LocalRuntimeTownNodeHttpServer;
  readonly runManifestId: string;
  readonly address: AddressInfo;
  readonly baseUrl: string;
  readonly close: () => Promise<void>;
};

export type LocalRuntimeTownShutdownSignal = 'SIGINT' | 'SIGTERM';

export type LocalRuntimeTownSignalSource = {
  readonly once: (signal: LocalRuntimeTownShutdownSignal, listener: () => void) => unknown;
  readonly removeListener: (
    signal: LocalRuntimeTownShutdownSignal,
    listener: () => void,
  ) => unknown;
};

export function resolveLocalRuntimeTownCliConfig(
  input: LocalRuntimeTownCliConfigInput = {},
): LocalRuntimeTownCliConfig {
  const argv = input.argv ?? [];
  const env = input.env ?? process.env;
  const cwd = input.cwd ?? process.cwd();
  const options = parseOptions(argv);
  const profileId = parseProfileId(
    options.profile ?? env.AIVILIZATION_PROFILE ?? DEFAULT_PROFILE_ID,
  );
  const plannerVariant = parsePlannerVariant(
    options.plannerVariant ?? env.AIVILIZATION_PLANNER_VARIANT ?? DEFAULT_PLANNER_VARIANT,
  );
  const paperAblationTaskId = parseOptionalPaperAblationTaskId(
    options.paperAblationTask ?? env.AIVILIZATION_PAPER_ABLATION_TASK,
  );
  if (paperAblationTaskId !== undefined && profileId !== 'ablation-80') {
    throw new Error('paper ablation tasks require --profile ablation-80');
  }
  const llmMode = parseLlmMode(options.llmMode ?? env.AIVILIZATION_LLM_MODE ?? 'provider');
  const experimentSuffix =
    paperAblationTaskId === undefined
      ? plannerVariant === 'default'
        ? ''
        : `-${plannerVariant}`
      : `-${paperAblationTaskId}-${plannerVariant}`;
  const rootDir = resolve(
    cwd,
    options.rootDir ??
      env.AIVILIZATION_ROOT_DIR ??
      `.aivilization/runtime/${profileId}${experimentSuffix}`,
  );
  const host = requireNonEmpty(options.host ?? env.AIVILIZATION_HOST ?? DEFAULT_HOST, 'host');
  const port = parsePort(options.port ?? env.AIVILIZATION_PORT ?? String(DEFAULT_PORT));
  const seed = requireNonEmpty(
    options.seed ??
      env.AIVILIZATION_SEED ??
      `${LOCAL_RUNTIME_TOWN_COMPOSITION_VERSION}:${profileId}${
        paperAblationTaskId === undefined ? '' : `:${paperAblationTaskId}`
      }`,
    'seed',
  );
  const sourceRevision = normalizeLocalRuntimeTownSourceRevision(
    input.sourceRevision ?? resolveLocalRuntimeTownSourceRevision({ env, cwd }),
  );
  const llm = llmMode === 'provider' ? resolveProviderLlmConfig(env) : undefined;
  const participantAccess = resolveParticipantAccessConfig({ env, host });

  return {
    compositionVersion: LOCAL_RUNTIME_TOWN_COMPOSITION_VERSION,
    profileId,
    rootDir,
    host,
    port,
    seed,
    plannerVariant,
    ...(paperAblationTaskId === undefined ? {} : { paperAblationTaskId }),
    sourceRevision,
    llmMode,
    ...(llm === undefined ? {} : { llm }),
    ...(participantAccess.mode === 'open' ? {} : { participantAccess }),
  };
}

export function createCanonicalLocalRuntimeTownServerInput(
  config: LocalRuntimeTownCliConfig,
  bootstrappedAt: number = Date.now(),
  options: {
    readonly daemonAutoStart?: boolean;
    readonly ownedPartitionKeys?: readonly string[];
  } = {},
): LocalRuntimeTownServerInput {
  assertFiniteTimestamp(bootstrappedAt, 'bootstrappedAt');
  const profile = createLocalRuntimeTownDaemonScenarioProfile(config.profileId);
  const resolvedRunManifest = createCanonicalLocalRuntimeTownResolvedRunManifest(config);
  const daemonAutoStart = options.daemonAutoStart ?? true;
  const ownedPartitionKeys = resolveOwnedPartitionKeys(
    profile.manifest.partitions.map((partition) => partition.partitionKey),
    options.ownedPartitionKeys,
  );
  const ownedKeySet = new Set(ownedPartitionKeys);
  const runtimeManifest = {
    ...profile.manifest,
    partitions: profile.manifest.partitions.filter((partition) =>
      ownedKeySet.has(partition.partitionKey),
    ),
  };
  const ownedPresetIds = new Set(
    runtimeManifest.partitions.map((partition) => partition.scenarioPresetId),
  );

  return {
    rootDir: config.rootDir,
    bootstrappedAt,
    manifest: runtimeManifest,
    scenarioPresets: profile.scenarioPresets.filter((preset) => ownedPresetIds.has(preset.id)),
    policies: createAivilizationWorldCommandPolicies(config.seed),
    localizedPlanners: [],
    steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
    agents: [],
    canonicalAgents:
      config.paperAblationTaskId === undefined
        ? true
        : {
            objectiveProposer: createPaperPlannerAblationObjectiveProposer(
              config.paperAblationTaskId,
            ),
          },
    plannerVariant: config.plannerVariant,
    marketObservations: createPaperMarketObservationRecordingConfig(),
    resolvedRunManifest,
    runtimeRunQueue: { ...profile.runtimeRunQueue, autoStart: daemonAutoStart },
    runtimeScheduler: { ...profile.runtimeScheduler, autoStart: daemonAutoStart },
    runtimeRecovery: { ...profile.runtimeRecovery, autoStart: daemonAutoStart },
    ...(config.participantAccess === undefined
      ? {}
      : { participantAccess: config.participantAccess }),
    ...(config.llm === undefined ? {} : { llm: config.llm }),
  };
}

export async function startLocalRuntimeTownCli(
  config: LocalRuntimeTownCliConfig,
  options: {
    readonly daemonAutoStart?: boolean;
    readonly ownedPartitionKeys?: readonly string[];
  } = {},
): Promise<LocalRuntimeTownCliApplication> {
  const dataCompatibility = inspectLocalRuntimeTownDataCompatibility({
    rootDir: config.rootDir,
  });
  const serverInput = createCanonicalLocalRuntimeTownServerInput(config, Date.now(), options);
  const resolvedRunManifest = serverInput.resolvedRunManifest;
  if (resolvedRunManifest === undefined) {
    throw new Error('canonical server input must include a resolved run manifest');
  }
  const runtime = await createLocalRuntimeTownNodeHttpServer(serverInput);
  try {
    registerLocalRuntimeTownDataCompatibility({
      rootDir: config.rootDir,
      sourceRevision: config.sourceRevision,
      registeredAt: Date.now(),
      hadUnversionedData: dataCompatibility.hadUnversionedData,
    });
  } catch (error) {
    stopLocalRuntimeTownOrchestration(runtime.runtimeOrchestration);
    throw error;
  }
  let address: AddressInfo;
  try {
    address = await listen(runtime, config.host, config.port);
  } catch (error) {
    stopLocalRuntimeTownOrchestration(runtime.runtimeOrchestration);
    throw error;
  }
  let closePromise: Promise<void> | undefined;

  return {
    config,
    runtime,
    runManifestId: resolvedRunManifest.runManifestId,
    address,
    baseUrl: createBaseUrl(config.host, address.port),
    close: () => {
      closePromise ??= close(runtime);
      return closePromise;
    },
  };
}

function resolveOwnedPartitionKeys(
  available: readonly string[],
  requested: readonly string[] | undefined,
): string[] {
  if (requested === undefined) return [...available];
  const normalized = [...new Set(requested)].sort();
  if (normalized.length === 0) throw new Error('ownedPartitionKeys must not be empty');
  for (const partitionKey of normalized) {
    if (!available.includes(partitionKey)) {
      throw new Error(`owned partition ${partitionKey} is absent from the canonical profile`);
    }
  }
  return normalized;
}

export function installLocalRuntimeTownShutdownHandlers(input: {
  readonly application: Pick<LocalRuntimeTownCliApplication, 'close'>;
  readonly signalSource?: LocalRuntimeTownSignalSource;
  readonly onFailure?: (error: unknown) => void;
}): () => void {
  const signalSource = input.signalSource ?? process;
  let shuttingDown = false;
  const handleSignal = () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    void input.application.close().catch(
      input.onFailure ??
        ((error) => {
          console.error(describeError(error));
          process.exitCode = DEFAULT_SHUTDOWN_FAILURE_EXIT_CODE;
        }),
    );
  };

  signalSource.once('SIGINT', handleSignal);
  signalSource.once('SIGTERM', handleSignal);
  return () => {
    signalSource.removeListener('SIGINT', handleSignal);
    signalSource.removeListener('SIGTERM', handleSignal);
  };
}

export function createLocalRuntimeTownCliHelp(): string {
  return [
    'Usage: pnpm --filter @aivilization/server start -- [options]',
    '',
    'Options:',
    '  --profile <id>       smoke-25 | default-100 | headless-stress-1000 | recovery-drill-25 | ablation-80',
    '  --planner-variant <variant>  default | without-branch | without-objective-decomposition',
    '  --paper-ablation-task <id>   task-1 | task-2 | task-3 | task-4 (requires ablation-80)',
    '  --root-dir <path>    Durable runtime root (experiment variants/tasks are isolated)',
    '  --host <host>        HTTP bind host (default: 127.0.0.1)',
    '  --port <port>        HTTP bind port (default: 3000)',
    '  --seed <seed>        Reproducibility seed (default: composition version + profile)',
    '  --llm-mode <mode>    provider | deterministic (default: provider)',
    '  --help               Show this help',
    '',
    'Provider mode requires AIVILIZATION_LLM_ENDPOINT and AIVILIZATION_LLM_MODEL.',
    'Provider mode also requires AIVILIZATION_LLM_INPUT_TOKEN_COST_MICROS and',
    'AIVILIZATION_LLM_OUTPUT_TOKEN_COST_MICROS so cost accounting cannot silently report zero.',
    'Optional provider variables: AIVILIZATION_LLM_API_KEY, AIVILIZATION_LLM_PROVIDER_ID,',
    'AIVILIZATION_LLM_RESPONSE_FORMAT, AIVILIZATION_LLM_MAX_ATTEMPTS,',
    'AIVILIZATION_LLM_TIMEOUT_MS.',
    'Authenticated participant mode uses AIVILIZATION_ACCESS_MODE=authenticated plus',
    'AIVILIZATION_ACCESS_CREDENTIALS_JSON and optional AIVILIZATION_MAX_AGENTS_PER_PARTICIPANT.',
    'Open mode is restricted to loopback binds. Terminate TLS in the deployment proxy.',
    'Source revision is read from Git. Dirty worktrees are bound to a deterministic fingerprint.',
    'Packaged dirty deployments require AIVILIZATION_COMMIT, AIVILIZATION_SOURCE_DIRTY=true,',
    'AIVILIZATION_SOURCE_WORKSPACE_SHA256, and AIVILIZATION_SOURCE_WORKSPACE_PATH_COUNT.',
  ].join('\n');
}

export function hasLocalRuntimeTownCliHelpFlag(argv: readonly string[]): boolean {
  return argv.includes('--help') || argv.includes('-h');
}

type ParsedOptions = {
  readonly profile?: string;
  readonly rootDir?: string;
  readonly host?: string;
  readonly port?: string;
  readonly seed?: string;
  readonly llmMode?: string;
  readonly plannerVariant?: string;
  readonly paperAblationTask?: string;
};

function parseOptions(argv: readonly string[]): ParsedOptions {
  const values = new Map<string, string>();
  const aliases: Readonly<Record<string, keyof ParsedOptions>> = {
    '--profile': 'profile',
    '--root-dir': 'rootDir',
    '--host': 'host',
    '--port': 'port',
    '--seed': 'seed',
    '--llm-mode': 'llmMode',
    '--planner-variant': 'plannerVariant',
    '--paper-ablation-task': 'paperAblationTask',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) {
      continue;
    }
    if (token === '--' || token === '--help' || token === '-h') {
      continue;
    }
    const equalsIndex = token.indexOf('=');
    const optionName = equalsIndex < 0 ? token : token.slice(0, equalsIndex);
    const key = aliases[optionName];
    if (key === undefined) {
      throw new Error(`unknown option ${token}`);
    }
    if (values.has(key)) {
      throw new Error(`option ${optionName} cannot be repeated`);
    }
    const inlineValue = equalsIndex < 0 ? undefined : token.slice(equalsIndex + 1);
    const value = inlineValue ?? argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`option ${optionName} requires a value`);
    }
    if (inlineValue === undefined) {
      index += 1;
    }
    values.set(key, requireNonEmpty(value, optionName));
  }

  return Object.fromEntries(values);
}

function resolveProviderLlmConfig(
  env: Readonly<Record<string, string | undefined>>,
): LocalRuntimeTownLlmConfig {
  const endpoint = requireConfiguredEnv(env, 'AIVILIZATION_LLM_ENDPOINT');
  const model = requireConfiguredEnv(env, 'AIVILIZATION_LLM_MODEL');
  const providerId = requireNonEmpty(
    env.AIVILIZATION_LLM_PROVIDER_ID ?? DEFAULT_LLM_PROVIDER_ID,
    'AIVILIZATION_LLM_PROVIDER_ID',
  );
  const responseFormat = parseResponseFormat(env.AIVILIZATION_LLM_RESPONSE_FORMAT ?? 'json-schema');
  const maxAttempts = parseOptionalPositiveInteger(
    env.AIVILIZATION_LLM_MAX_ATTEMPTS,
    'AIVILIZATION_LLM_MAX_ATTEMPTS',
  );
  const timeoutMs = parseOptionalPositiveInteger(
    env.AIVILIZATION_LLM_TIMEOUT_MS,
    'AIVILIZATION_LLM_TIMEOUT_MS',
  );
  const pricing = {
    inputTokenCostMicros: parseRequiredNonNegativeFinite(
      env,
      'AIVILIZATION_LLM_INPUT_TOKEN_COST_MICROS',
    ),
    outputTokenCostMicros: parseRequiredNonNegativeFinite(
      env,
      'AIVILIZATION_LLM_OUTPUT_TOKEN_COST_MICROS',
    ),
  };

  return {
    model,
    pricing,
    ...(maxAttempts === undefined ? {} : { maxAttempts }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    providerConfig: {
      kind: 'openai-compatible',
      providerId,
      endpoint,
      responseFormat,
      ...(env.AIVILIZATION_LLM_API_KEY === undefined
        ? {}
        : { apiKey: requireNonEmpty(env.AIVILIZATION_LLM_API_KEY, 'AIVILIZATION_LLM_API_KEY') }),
    },
  };
}

function resolveParticipantAccessConfig(input: {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly host: string;
}): LocalRuntimeTownParticipantAccessConfig {
  const mode = input.env.AIVILIZATION_ACCESS_MODE ?? 'open';
  const oidcConfigured = input.env.AIVILIZATION_OIDC_ISSUER !== undefined;
  if (mode === 'open') {
    if (input.env.AIVILIZATION_ACCESS_CREDENTIALS_JSON !== undefined || oidcConfigured) {
      throw new Error(
        'participant identity configuration requires AIVILIZATION_ACCESS_MODE=authenticated',
      );
    }
    if (!isLoopbackHost(input.host)) {
      throw new Error(
        'open participant access is restricted to loopback; configure AIVILIZATION_ACCESS_MODE=authenticated before binding a non-loopback host',
      );
    }
    return { mode: 'open' };
  }
  if (mode !== 'authenticated') {
    throw new Error(`unsupported participant access mode ${mode}`);
  }
  const maxAgentsPerParticipant =
    parseOptionalPositiveInteger(
      input.env.AIVILIZATION_MAX_AGENTS_PER_PARTICIPANT,
      'AIVILIZATION_MAX_AGENTS_PER_PARTICIPANT',
    ) ?? DEFAULT_MAX_AGENTS_PER_PARTICIPANT;
  if (oidcConfigured) {
    if (input.env.AIVILIZATION_ACCESS_CREDENTIALS_JSON !== undefined) {
      throw new Error('OIDC and static participant credentials cannot be configured together');
    }
    const oidc = validateTownOidcJwksAuthenticatorConfig({
      policyVersion: TOWN_OIDC_JWKS_AUTHENTICATION_POLICY_VERSION,
      issuer: requireConfiguredAccessEnv(input.env, 'AIVILIZATION_OIDC_ISSUER'),
      audience: requireConfiguredAccessEnv(input.env, 'AIVILIZATION_OIDC_AUDIENCE'),
      jwksUrl: requireConfiguredAccessEnv(input.env, 'AIVILIZATION_OIDC_JWKS_URL'),
      roleClaim: input.env.AIVILIZATION_OIDC_ROLE_CLAIM ?? 'roles',
      roleValues: {
        participant: [input.env.AIVILIZATION_OIDC_PARTICIPANT_ROLE ?? 'aivilization:participant'],
        operator: [input.env.AIVILIZATION_OIDC_OPERATOR_ROLE ?? 'aivilization:operator'],
      },
      allowedAlgorithms: parseCommaSeparatedValues(
        input.env.AIVILIZATION_OIDC_ALLOWED_ALGORITHMS ?? 'RS256',
        'AIVILIZATION_OIDC_ALLOWED_ALGORITHMS',
      ),
      clockToleranceSeconds:
        parseOptionalNonNegativeNumber(
          input.env.AIVILIZATION_OIDC_CLOCK_TOLERANCE_SECONDS,
          'AIVILIZATION_OIDC_CLOCK_TOLERANCE_SECONDS',
        ) ?? 5,
    });
    return { mode: 'authenticated', maxAgentsPerParticipant, oidc };
  }
  const credentials = parseParticipantAccessCredentials(
    requireConfiguredAccessEnv(input.env, 'AIVILIZATION_ACCESS_CREDENTIALS_JSON'),
  ).map(createTownStaticBearerCredentialDigest);
  const roles = new Set(credentials.flatMap((credential) => credential.roles));
  if (!roles.has('participant')) {
    throw new Error(
      'authenticated participant access requires at least one participant credential',
    );
  }
  if (!roles.has('operator')) {
    throw new Error('authenticated participant access requires at least one operator credential');
  }
  createTownStaticBearerAuthenticatorFromDigests({ credentials });
  return { mode: 'authenticated', maxAgentsPerParticipant, credentials };
}

function parseParticipantAccessCredentials(raw: string): readonly TownStaticBearerCredential[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error('AIVILIZATION_ACCESS_CREDENTIALS_JSON must be valid JSON');
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('AIVILIZATION_ACCESS_CREDENTIALS_JSON must be a non-empty array');
  }
  const records: readonly unknown[] = parsed;
  return records.map((value, index) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`access credential ${index} must be an object`);
    }
    const record = value as Readonly<Record<string, unknown>>;
    const roles = parseAccessRoles(record.roles, index);
    return {
      keyId: requireJsonString(record.keyId, `access credential ${index} keyId`),
      subjectId: requireJsonString(record.subjectId, `access credential ${index} subjectId`),
      token: requireJsonString(record.token, `access credential ${index} token`),
      roles,
    };
  });
}

function parseAccessRoles(value: unknown, index: number): readonly TownAccessRole[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`access credential ${index} roles must be a non-empty array`);
  }
  const roles: readonly unknown[] = value;
  return roles.map((role) => {
    if (role !== 'participant' && role !== 'operator') {
      throw new Error(`access credential ${index} contains unsupported role ${String(role)}`);
    }
    return role;
  });
}

function requireJsonString(value: unknown, name: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${name} must be a string`);
  }
  return requireNonEmpty(value, name);
}

function requireConfiguredAccessEnv(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
): string {
  const value = env[name];
  if (value === undefined) {
    throw new Error(`${name} is required in authenticated participant access mode`);
  }
  return requireNonEmpty(value, name);
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return normalized === '127.0.0.1' || normalized === 'localhost' || normalized === '::1';
}

function parseProfileId(value: string): LocalRuntimeTownDaemonScenarioProfileId {
  if (supportedProfileIds.has(value as LocalRuntimeTownDaemonScenarioProfileId)) {
    return value as LocalRuntimeTownDaemonScenarioProfileId;
  }
  throw new Error(`unsupported profile ${value}`);
}

function parseLlmMode(value: string): LocalRuntimeTownLlmMode {
  if (value === 'provider' || value === 'deterministic') {
    return value;
  }
  throw new Error(`unsupported LLM mode ${value}`);
}

function parsePlannerVariant(value: string): PaperPlannerVariant {
  assertPaperPlannerVariant(value);
  return value;
}

function parseOptionalPaperAblationTaskId(
  value: string | undefined,
): PaperPlannerAblationTaskId | undefined {
  if (value === undefined) {
    return undefined;
  }
  assertPaperPlannerAblationTaskId(value);
  return value;
}

function parseResponseFormat(value: string): 'json-schema' | 'json-object' | 'none' {
  if (value === 'json-schema' || value === 'json-object' || value === 'none') {
    return value;
  }
  throw new Error(`unsupported LLM response format ${value}`);
}

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error('port must be an integer between 0 and 65535');
  }
  return port;
}

function parseOptionalPositiveInteger(value: string | undefined, name: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function parseOptionalNonNegativeNumber(
  value: string | undefined,
  name: string,
): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative finite number`);
  }
  return parsed;
}

function parseCommaSeparatedValues(value: string, name: string): readonly string[] {
  const values = value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (values.length === 0) throw new Error(`${name} must contain at least one value`);
  return values;
}

function parseRequiredNonNegativeFinite(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
): number {
  const raw = requireConfiguredEnv(env, name);
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative finite number`);
  }
  return parsed;
}

function requireConfiguredEnv(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
): string {
  const value = env[name];
  if (value === undefined) {
    throw new Error(
      `${name} is required in provider mode; use --llm-mode deterministic only for explicit fallback runs`,
    );
  }
  return requireNonEmpty(value, name);
}

function requireNonEmpty(value: string, name: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`${name} must be non-empty`);
  }
  return normalized;
}

function assertFiniteTimestamp(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative finite number`);
  }
}

function listen(
  runtime: LocalRuntimeTownNodeHttpServer,
  host: string,
  port: number,
): Promise<AddressInfo> {
  return new Promise((resolveAddress, reject) => {
    const handleError = (error: Error) => reject(error);
    runtime.server.once('error', handleError);
    runtime.server.listen(port, host, () => {
      runtime.server.removeListener('error', handleError);
      const address = runtime.server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('local runtime town server did not expose an IP address'));
        return;
      }
      resolveAddress(address);
    });
  });
}

function close(runtime: LocalRuntimeTownNodeHttpServer): Promise<void> {
  return new Promise((resolveClose, reject) => {
    runtime.server.close((error) => {
      if (error === undefined) {
        resolveClose();
      } else {
        reject(error);
      }
    });
  });
}

function createBaseUrl(host: string, port: number): string {
  const normalizedHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  return `http://${normalizedHost}:${port}`;
}

function describeError(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}
