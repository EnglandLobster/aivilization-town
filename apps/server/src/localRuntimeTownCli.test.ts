import { afterEach, describe, expect, test, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileLocalSimulationRuntimeResolvedRunManifestRepository } from '@aivilization/worker';
import { createTownStaticBearerCredentialDigest } from '@aivilization/api';
import { asAgentId } from '@aivilization/sim-core';
import { createWorldProjection } from '@aivilization/world';
import {
  createCanonicalLocalRuntimeTownServerInput,
  createCanonicalLocalRuntimeTownResolvedRunManifest,
  createLocalRuntimeTownApi,
  createLocalRuntimeTownCliHelp,
  installLocalRuntimeTownShutdownHandlers,
  LOCAL_RUNTIME_TOWN_DATA_COMPATIBILITY_FILENAME,
  resolveLocalRuntimeTownCliConfig,
  startLocalRuntimeTownCli,
  type LocalRuntimeTownCliApplication,
  type LocalRuntimeTownShutdownSignal,
  type LocalRuntimeTownSignalSource,
} from './index';

const roots: string[] = [];
const applications: LocalRuntimeTownCliApplication[] = [];
const sourceRevision = {
  commit: '0123456789abcdef0123456789abcdef01234567',
  dirty: false,
} as const;
const participantAccessToken = 'participant-token-0000000000000000000001';
const operatorAccessToken = 'operator-token-0000000000000000000000001';
const participantAccessCredentialRecords = [
  {
    keyId: 'participant-primary',
    subjectId: 'participant-7',
    token: participantAccessToken,
    roles: ['participant'],
  },
  {
    keyId: 'operator-primary',
    subjectId: 'operator-1',
    token: operatorAccessToken,
    roles: ['operator'],
  },
] as const;
const participantAccessCredentials = JSON.stringify(participantAccessCredentialRecords);

afterEach(async () => {
  while (applications.length > 0) {
    await applications.pop()?.close();
  }
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

describe('local runtime town executable composition', () => {
  test('requires explicit provider configuration for the canonical LLM mode', () => {
    expect(() =>
      resolveLocalRuntimeTownCliConfig({
        argv: [],
        env: {},
        cwd: '/workspace',
        sourceRevision,
      }),
    ).toThrow(
      'AIVILIZATION_LLM_ENDPOINT is required in provider mode; use --llm-mode deterministic only for explicit fallback runs',
    );

    expect(() =>
      resolveLocalRuntimeTownCliConfig({
        argv: [],
        env: {
          AIVILIZATION_LLM_ENDPOINT: 'https://llm.example.test/v1/chat/completions',
          AIVILIZATION_LLM_MODEL: 'paper-town-model',
        },
        cwd: '/workspace',
        sourceRevision,
      }),
    ).toThrow('AIVILIZATION_LLM_INPUT_TOKEN_COST_MICROS is required in provider mode');

    expect(() =>
      resolveLocalRuntimeTownCliConfig({
        argv: [],
        env: {
          AIVILIZATION_LLM_ENDPOINT: 'https://llm.example.test/v1/chat/completions',
          AIVILIZATION_LLM_MODEL: 'paper-town-model',
          AIVILIZATION_LLM_INPUT_TOKEN_COST_MICROS: '0.003',
          AIVILIZATION_LLM_OUTPUT_TOKEN_COST_MICROS: '-0.001',
        },
        cwd: '/workspace',
        sourceRevision,
      }),
    ).toThrow('AIVILIZATION_LLM_OUTPUT_TOKEN_COST_MICROS must be a non-negative finite number');

    expect(
      resolveLocalRuntimeTownCliConfig({
        argv: ['--', '--llm-mode', 'deterministic'],
        env: {},
        cwd: '/workspace',
        sourceRevision,
      }),
    ).toEqual({
      compositionVersion: 'canonical-runtime-composition-v1',
      profileId: 'smoke-25',
      rootDir: '/workspace/.aivilization/runtime/smoke-25',
      host: '127.0.0.1',
      port: 3000,
      seed: 'canonical-runtime-composition-v1:smoke-25',
      plannerVariant: 'default',
      sourceRevision,
      llmMode: 'deterministic',
      simulationWideAuthorityEnabled: true,
      simulationWideAuthorityWorkerId: 'local-runtime-town:127.0.0.1:3000',
      simulationWideAuthorityLeaseDurationMs: 30_000,
      regionalMarketsEnabled: false,
      townWeatherEnabled: false,
      townConditionsEnabled: false,
      townBulletinEnabled: false,
      socialMattersEnabled: false,
      townConflictEnabled: false,
      townWellbeingEnabled: false,
      townCalendarEnabled: false,
      townLifecycleEnabled: false,
      townDiscourseEnabled: false,
      townCollectiveActionEnabled: false,
      townMigrationEnabled: false,
      townServiceQualityEnabled: false,
      townGovernanceEnabled: false,
      townSurvivalPressureEnabled: false,
      townCarryingCapacityEnabled: false,
    });
  });

  test('resolves CLI overrides and OpenAI-compatible provider settings without embedded secrets', () => {
    const config = resolveLocalRuntimeTownCliConfig({
      argv: [
        '--profile=default-100',
        '--root-dir',
        './runtime-data',
        '--host',
        '0.0.0.0',
        '--port',
        '4310',
      ],
      env: {
        AIVILIZATION_PROFILE: 'smoke-25',
        AIVILIZATION_LLM_ENDPOINT:
          'https://endpoint-user:endpoint-password@llm.example.test/v1/chat/completions?api_key=query-secret#fragment',
        AIVILIZATION_LLM_MODEL: 'paper-town-model',
        AIVILIZATION_LLM_INPUT_TOKEN_COST_MICROS: '0.003',
        AIVILIZATION_LLM_OUTPUT_TOKEN_COST_MICROS: '0.009',
        AIVILIZATION_LLM_API_KEY: 'runtime-secret',
        AIVILIZATION_LLM_PROVIDER_ID: 'paper-town-provider',
        AIVILIZATION_LLM_MAX_ATTEMPTS: '3',
        AIVILIZATION_LLM_TIMEOUT_MS: '45000',
        AIVILIZATION_ACCESS_MODE: 'authenticated',
        AIVILIZATION_ACCESS_CREDENTIALS_JSON: participantAccessCredentials,
        AIVILIZATION_MAX_AGENTS_PER_PARTICIPANT: '7',
      },
      cwd: '/workspace',
      sourceRevision,
    });

    expect(config).toEqual({
      compositionVersion: 'canonical-runtime-composition-v1',
      profileId: 'default-100',
      rootDir: '/workspace/runtime-data',
      host: '0.0.0.0',
      port: 4310,
      seed: 'canonical-runtime-composition-v1:default-100',
      plannerVariant: 'default',
      sourceRevision,
      llmMode: 'provider',
      llm: {
        model: 'paper-town-model',
        pricing: {
          inputTokenCostMicros: 0.003,
          outputTokenCostMicros: 0.009,
        },
        maxAttempts: 3,
        timeoutMs: 45_000,
        providerConfig: {
          kind: 'openai-compatible',
          providerId: 'paper-town-provider',
          endpoint:
            'https://endpoint-user:endpoint-password@llm.example.test/v1/chat/completions?api_key=query-secret#fragment',
          responseFormat: 'json-schema',
          apiKey: 'runtime-secret',
        },
      },
      participantAccess: {
        mode: 'authenticated',
        maxAgentsPerParticipant: 7,
        credentials: participantAccessCredentialRecords.map(createTownStaticBearerCredentialDigest),
      },
      simulationWideAuthorityEnabled: true,
      simulationWideAuthorityWorkerId: 'local-runtime-town:0.0.0.0:4310',
      simulationWideAuthorityLeaseDurationMs: 30_000,
      regionalMarketsEnabled: false,
      townWeatherEnabled: false,
      townConditionsEnabled: false,
      townBulletinEnabled: false,
      socialMattersEnabled: false,
      townConflictEnabled: false,
      townWellbeingEnabled: false,
      townCalendarEnabled: false,
      townLifecycleEnabled: false,
      townDiscourseEnabled: false,
      townCollectiveActionEnabled: false,
      townMigrationEnabled: false,
      townServiceQualityEnabled: false,
      townGovernanceEnabled: false,
      townSurvivalPressureEnabled: false,
      townCarryingCapacityEnabled: false,
    });
    expect(createLocalRuntimeTownCliHelp()).not.toContain('runtime-secret');
    const serializedManifest = JSON.stringify(
      createCanonicalLocalRuntimeTownResolvedRunManifest(config),
    );
    expect(serializedManifest).not.toContain('runtime-secret');
    expect(serializedManifest).not.toContain('endpoint-user');
    expect(serializedManifest).not.toContain('endpoint-password');
    expect(serializedManifest).not.toContain('query-secret');
    expect(serializedManifest).not.toContain(participantAccessToken);
    expect(serializedManifest).not.toContain(operatorAccessToken);
    expect(JSON.stringify(config)).not.toContain(participantAccessToken);
    expect(JSON.stringify(config)).not.toContain(operatorAccessToken);
    for (const credential of config.participantAccess?.mode === 'authenticated' &&
    config.participantAccess.oidc === undefined
      ? config.participantAccess.credentials
      : []) {
      expect(serializedManifest).not.toContain(credential.tokenSha256);
    }
    expect(serializedManifest).toContain('https://llm.example.test/v1/chat/completions');
    expect(serializedManifest).toContain('paper-town-provider');
    expect(serializedManifest).toContain('paper-town-model');
    expect(serializedManifest).toContain('participant-access-control-v2');
    expect(serializedManifest).toContain('participant-data-deletion-v1');
    expect(serializedManifest).toContain('participant-data-lifecycle-v1');
    expect(serializedManifest).toContain('runtime-agent-registration-v3');
    expect(serializedManifest).toContain('"maximumAgentsPerCreator":7');
  });

  test('enables the simulation-wide authority by default and honors an explicit opt-out', () => {
    const base = {
      argv: ['--', '--llm-mode', 'deterministic'] as readonly string[],
      cwd: '/workspace',
      sourceRevision,
    };

    // Default: the unified authority is the settlement path with no flag.
    expect(
      resolveLocalRuntimeTownCliConfig({ ...base, env: {} }).simulationWideAuthorityEnabled,
    ).toBe(true);

    // Explicit opt-out via env selects the legacy per-partition path.
    expect(
      resolveLocalRuntimeTownCliConfig({
        ...base,
        env: { AIVILIZATION_SIMULATION_WIDE_AUTHORITY: '0' },
      }).simulationWideAuthorityEnabled,
    ).toBe(false);

    // Explicit opt-out via CLI flag also wins over the default.
    expect(
      resolveLocalRuntimeTownCliConfig({
        argv: ['--', '--llm-mode', 'deterministic', '--simulation-wide-authority', 'off'],
        cwd: '/workspace',
        sourceRevision,
        env: {},
      }).simulationWideAuthorityEnabled,
    ).toBe(false);
  });

  test('regional markets are off by default and enabled by flag or env', () => {
    const base = {
      argv: ['--', '--llm-mode', 'deterministic'] as readonly string[],
      cwd: '/workspace',
      sourceRevision,
    };

    // Default: regional markets are disabled, preserving the legacy single pool.
    expect(resolveLocalRuntimeTownCliConfig({ ...base, env: {} }).regionalMarketsEnabled).toBe(
      false,
    );

    // Explicit opt-in via CLI flag.
    expect(
      resolveLocalRuntimeTownCliConfig({
        argv: ['--', '--llm-mode', 'deterministic', '--regional-markets', 'on'],
        cwd: '/workspace',
        sourceRevision,
        env: {},
      }).regionalMarketsEnabled,
    ).toBe(true);

    // Explicit opt-in via env.
    expect(
      resolveLocalRuntimeTownCliConfig({
        ...base,
        env: { AIVILIZATION_REGIONAL_MARKETS: '1' },
      }).regionalMarketsEnabled,
    ).toBe(true);
  });

  test('town weather is off by default and enabled by flag or env', () => {
    const base = {
      argv: ['--', '--llm-mode', 'deterministic'] as readonly string[],
      cwd: '/workspace',
      sourceRevision,
    };

    // Default: town weather is disabled, so runs stay byte-for-byte weather-free.
    expect(resolveLocalRuntimeTownCliConfig({ ...base, env: {} }).townWeatherEnabled).toBe(false);

    // Explicit opt-in via CLI flag.
    expect(
      resolveLocalRuntimeTownCliConfig({
        argv: ['--', '--llm-mode', 'deterministic', '--town-weather', 'on'],
        cwd: '/workspace',
        sourceRevision,
        env: {},
      }).townWeatherEnabled,
    ).toBe(true);

    // Explicit opt-in via env.
    expect(
      resolveLocalRuntimeTownCliConfig({
        ...base,
        env: { AIVILIZATION_TOWN_WEATHER: '1' },
      }).townWeatherEnabled,
    ).toBe(true);

    // The resolved run manifest only declares town-weather-v1 when enabled.
    const disabledManifest = JSON.stringify(
      createCanonicalLocalRuntimeTownResolvedRunManifest(
        resolveLocalRuntimeTownCliConfig({ ...base, env: {} }),
      ),
    );
    expect(disabledManifest).not.toContain('town-weather-v1');
    const enabledManifest = JSON.stringify(
      createCanonicalLocalRuntimeTownResolvedRunManifest(
        resolveLocalRuntimeTownCliConfig({
          ...base,
          env: { AIVILIZATION_TOWN_WEATHER: '1' },
        }),
      ),
    );
    expect(enabledManifest).toContain('town-weather-v1');
  });

  test('town conditions are off by default and enabled by flag or env', () => {
    const base = {
      argv: ['--', '--llm-mode', 'deterministic'] as readonly string[],
      cwd: '/workspace',
      sourceRevision,
    };

    // Default: town conditions are disabled, so runs stay condition-free.
    expect(resolveLocalRuntimeTownCliConfig({ ...base, env: {} }).townConditionsEnabled).toBe(
      false,
    );

    // Explicit opt-in via CLI flag.
    expect(
      resolveLocalRuntimeTownCliConfig({
        argv: ['--', '--llm-mode', 'deterministic', '--town-conditions', 'on'],
        cwd: '/workspace',
        sourceRevision,
        env: {},
      }).townConditionsEnabled,
    ).toBe(true);

    // Explicit opt-in via env.
    expect(
      resolveLocalRuntimeTownCliConfig({
        ...base,
        env: { AIVILIZATION_TOWN_CONDITIONS: '1' },
      }).townConditionsEnabled,
    ).toBe(true);

    // The resolved run manifest only declares town-conditions-v1 when enabled.
    const disabledManifest = JSON.stringify(
      createCanonicalLocalRuntimeTownResolvedRunManifest(
        resolveLocalRuntimeTownCliConfig({ ...base, env: {} }),
      ),
    );
    expect(disabledManifest).not.toContain('town-conditions-v1');
    const enabledManifest = JSON.stringify(
      createCanonicalLocalRuntimeTownResolvedRunManifest(
        resolveLocalRuntimeTownCliConfig({
          ...base,
          env: { AIVILIZATION_TOWN_CONDITIONS: '1' },
        }),
      ),
    );
    expect(enabledManifest).toContain('town-conditions-v1');
  });

  test('town bulletin is off by default and enabled by flag or env', () => {
    const base = {
      argv: ['--', '--llm-mode', 'deterministic'] as readonly string[],
      cwd: '/workspace',
      sourceRevision,
    };

    // Default: the bulletin board is disabled, so runs stay bulletin-free.
    expect(resolveLocalRuntimeTownCliConfig({ ...base, env: {} }).townBulletinEnabled).toBe(false);

    // Explicit opt-in via CLI flag.
    expect(
      resolveLocalRuntimeTownCliConfig({
        argv: ['--', '--llm-mode', 'deterministic', '--town-bulletin', 'on'],
        cwd: '/workspace',
        sourceRevision,
        env: {},
      }).townBulletinEnabled,
    ).toBe(true);

    // Explicit opt-in via env.
    expect(
      resolveLocalRuntimeTownCliConfig({
        ...base,
        env: { AIVILIZATION_TOWN_BULLETIN: '1' },
      }).townBulletinEnabled,
    ).toBe(true);

    // The resolved run manifest only declares town-bulletin-v1 when enabled.
    const disabledManifest = JSON.stringify(
      createCanonicalLocalRuntimeTownResolvedRunManifest(
        resolveLocalRuntimeTownCliConfig({ ...base, env: {} }),
      ),
    );
    expect(disabledManifest).not.toContain('town-bulletin-v1');
    const enabledManifest = JSON.stringify(
      createCanonicalLocalRuntimeTownResolvedRunManifest(
        resolveLocalRuntimeTownCliConfig({
          ...base,
          env: { AIVILIZATION_TOWN_BULLETIN: '1' },
        }),
      ),
    );
    expect(enabledManifest).toContain('town-bulletin-v1');
  });

  test('social matters are off by default and enabled by flag or env', () => {
    const base = {
      argv: ['--', '--llm-mode', 'deterministic'] as readonly string[],
      cwd: '/workspace',
      sourceRevision,
    };

    // Default: social matters are disabled, so runs stay matter-free.
    expect(resolveLocalRuntimeTownCliConfig({ ...base, env: {} }).socialMattersEnabled).toBe(false);

    // Explicit opt-in via CLI flag.
    expect(
      resolveLocalRuntimeTownCliConfig({
        argv: ['--', '--llm-mode', 'deterministic', '--social-matters', 'on'],
        cwd: '/workspace',
        sourceRevision,
        env: {},
      }).socialMattersEnabled,
    ).toBe(true);

    // Explicit opt-in via env.
    expect(
      resolveLocalRuntimeTownCliConfig({
        ...base,
        env: { AIVILIZATION_SOCIAL_MATTERS: '1' },
      }).socialMattersEnabled,
    ).toBe(true);

    // The resolved run manifest only declares social-matters-v1 when enabled.
    const disabledManifest = JSON.stringify(
      createCanonicalLocalRuntimeTownResolvedRunManifest(
        resolveLocalRuntimeTownCliConfig({ ...base, env: {} }),
      ),
    );
    expect(disabledManifest).not.toContain('social-matters-v1');
    const enabledManifest = JSON.stringify(
      createCanonicalLocalRuntimeTownResolvedRunManifest(
        resolveLocalRuntimeTownCliConfig({
          ...base,
          env: { AIVILIZATION_SOCIAL_MATTERS: '1' },
        }),
      ),
    );
    expect(enabledManifest).toContain('social-matters-v1');
  });

  test('town conflict is off by default and enabled by flag or env', () => {
    const base = {
      argv: ['--', '--llm-mode', 'deterministic'] as readonly string[],
      cwd: '/workspace',
      sourceRevision,
    };

    // Default: the conflict system is disabled, so runs stay conflict-free.
    expect(resolveLocalRuntimeTownCliConfig({ ...base, env: {} }).townConflictEnabled).toBe(false);

    // Explicit opt-in via CLI flag.
    expect(
      resolveLocalRuntimeTownCliConfig({
        argv: ['--', '--llm-mode', 'deterministic', '--town-conflict', 'on'],
        cwd: '/workspace',
        sourceRevision,
        env: {},
      }).townConflictEnabled,
    ).toBe(true);

    // Explicit opt-in via env.
    expect(
      resolveLocalRuntimeTownCliConfig({
        ...base,
        env: { AIVILIZATION_TOWN_CONFLICT: '1' },
      }).townConflictEnabled,
    ).toBe(true);

    // The resolved run manifest only declares town-conflict-v2 when enabled.
    const disabledManifest = JSON.stringify(
      createCanonicalLocalRuntimeTownResolvedRunManifest(
        resolveLocalRuntimeTownCliConfig({ ...base, env: {} }),
      ),
    );
    expect(disabledManifest).not.toContain('town-conflict-v2');
    const enabledManifest = JSON.stringify(
      createCanonicalLocalRuntimeTownResolvedRunManifest(
        resolveLocalRuntimeTownCliConfig({
          ...base,
          env: { AIVILIZATION_TOWN_CONFLICT: '1' },
        }),
      ),
    );
    expect(enabledManifest).toContain('town-conflict-v2');
  });

  test('town wellbeing is off by default and enabled by flag or env', () => {
    const base = {
      argv: ['--', '--llm-mode', 'deterministic'] as readonly string[],
      cwd: '/workspace',
      sourceRevision,
    };

    // Default: wellbeing settlement is disabled, so runs stay wellbeing-free.
    expect(resolveLocalRuntimeTownCliConfig({ ...base, env: {} }).townWellbeingEnabled).toBe(false);

    // Explicit opt-in via CLI flag.
    expect(
      resolveLocalRuntimeTownCliConfig({
        argv: ['--', '--llm-mode', 'deterministic', '--town-wellbeing', 'on'],
        cwd: '/workspace',
        sourceRevision,
        env: {},
      }).townWellbeingEnabled,
    ).toBe(true);

    // Explicit opt-in via env.
    expect(
      resolveLocalRuntimeTownCliConfig({
        ...base,
        env: { AIVILIZATION_TOWN_WELLBEING: '1' },
      }).townWellbeingEnabled,
    ).toBe(true);

    // The resolved run manifest only declares town-wellbeing-v1 when enabled.
    const disabledManifest = JSON.stringify(
      createCanonicalLocalRuntimeTownResolvedRunManifest(
        resolveLocalRuntimeTownCliConfig({ ...base, env: {} }),
      ),
    );
    expect(disabledManifest).not.toContain('town-wellbeing-v1');
    const enabledManifest = JSON.stringify(
      createCanonicalLocalRuntimeTownResolvedRunManifest(
        resolveLocalRuntimeTownCliConfig({
          ...base,
          env: { AIVILIZATION_TOWN_WELLBEING: '1' },
        }),
      ),
    );
    expect(enabledManifest).toContain('town-wellbeing-v1');
  });

  test('town calendar is off by default and enabled by flag or env', () => {
    const base = {
      argv: ['--', '--llm-mode', 'deterministic'] as readonly string[],
      cwd: '/workspace',
      sourceRevision,
    };

    // Default: the calendar is disabled, so runs stay calendar/decay-free.
    expect(resolveLocalRuntimeTownCliConfig({ ...base, env: {} }).townCalendarEnabled).toBe(false);

    // Explicit opt-in via CLI flag.
    expect(
      resolveLocalRuntimeTownCliConfig({
        argv: ['--', '--llm-mode', 'deterministic', '--town-calendar', 'on'],
        cwd: '/workspace',
        sourceRevision,
        env: {},
      }).townCalendarEnabled,
    ).toBe(true);

    // Explicit opt-in via env.
    expect(
      resolveLocalRuntimeTownCliConfig({
        ...base,
        env: { AIVILIZATION_TOWN_CALENDAR: '1' },
      }).townCalendarEnabled,
    ).toBe(true);

    // The resolved run manifest only declares town-calendar-v1 when enabled.
    const disabledManifest = JSON.stringify(
      createCanonicalLocalRuntimeTownResolvedRunManifest(
        resolveLocalRuntimeTownCliConfig({ ...base, env: {} }),
      ),
    );
    expect(disabledManifest).not.toContain('town-calendar-v1');
    const enabledManifest = JSON.stringify(
      createCanonicalLocalRuntimeTownResolvedRunManifest(
        resolveLocalRuntimeTownCliConfig({
          ...base,
          env: { AIVILIZATION_TOWN_CALENDAR: '1' },
        }),
      ),
    );
    expect(enabledManifest).toContain('town-calendar-v1');
  });

  test('town lifecycle is off by default and enabled by flag or env', () => {
    const base = {
      argv: ['--', '--llm-mode', 'deterministic'] as readonly string[],
      cwd: '/workspace',
      sourceRevision,
    };

    // Default: the lifecycle is disabled, so the population stays static.
    expect(resolveLocalRuntimeTownCliConfig({ ...base, env: {} }).townLifecycleEnabled).toBe(false);

    // Explicit opt-in via CLI flag.
    expect(
      resolveLocalRuntimeTownCliConfig({
        argv: ['--', '--llm-mode', 'deterministic', '--town-lifecycle', 'on'],
        cwd: '/workspace',
        sourceRevision,
        env: {},
      }).townLifecycleEnabled,
    ).toBe(true);

    // Explicit opt-in via env.
    expect(
      resolveLocalRuntimeTownCliConfig({
        ...base,
        env: { AIVILIZATION_TOWN_LIFECYCLE: '1' },
      }).townLifecycleEnabled,
    ).toBe(true);

    // The resolved run manifest only declares town-lifecycle-v1 when enabled.
    const disabledManifest = JSON.stringify(
      createCanonicalLocalRuntimeTownResolvedRunManifest(
        resolveLocalRuntimeTownCliConfig({ ...base, env: {} }),
      ),
    );
    expect(disabledManifest).not.toContain('town-lifecycle-v1');
    const enabledManifest = JSON.stringify(
      createCanonicalLocalRuntimeTownResolvedRunManifest(
        resolveLocalRuntimeTownCliConfig({
          ...base,
          env: { AIVILIZATION_TOWN_LIFECYCLE: '1' },
        }),
      ),
    );
    expect(enabledManifest).toContain('town-lifecycle-v1');
  });

  test('town discourse is off by default and enabled by flag or env', () => {
    const base = {
      argv: ['--', '--llm-mode', 'deterministic'] as readonly string[],
      cwd: '/workspace',
      sourceRevision,
    };

    expect(resolveLocalRuntimeTownCliConfig({ ...base, env: {} }).townDiscourseEnabled).toBe(false);
    expect(
      resolveLocalRuntimeTownCliConfig({
        argv: ['--', '--llm-mode', 'deterministic', '--town-discourse', 'on'],
        cwd: '/workspace',
        sourceRevision,
        env: {},
      }).townDiscourseEnabled,
    ).toBe(true);
    expect(
      resolveLocalRuntimeTownCliConfig({
        ...base,
        env: { AIVILIZATION_TOWN_DISCOURSE: '1' },
      }).townDiscourseEnabled,
    ).toBe(true);

    const disabledManifest = JSON.stringify(
      createCanonicalLocalRuntimeTownResolvedRunManifest(
        resolveLocalRuntimeTownCliConfig({ ...base, env: {} }),
      ),
    );
    expect(disabledManifest).not.toContain('town-discourse-v1');
    const enabledManifest = JSON.stringify(
      createCanonicalLocalRuntimeTownResolvedRunManifest(
        resolveLocalRuntimeTownCliConfig({
          ...base,
          env: { AIVILIZATION_TOWN_DISCOURSE: '1' },
        }),
      ),
    );
    expect(enabledManifest).toContain('town-discourse-v1');
  });

  test('town collective action is off by default and enabled by flag or env', () => {
    const base = {
      argv: ['--', '--llm-mode', 'deterministic'] as readonly string[],
      cwd: '/workspace',
      sourceRevision,
    };

    expect(resolveLocalRuntimeTownCliConfig({ ...base, env: {} }).townCollectiveActionEnabled).toBe(
      false,
    );
    expect(
      resolveLocalRuntimeTownCliConfig({
        argv: ['--', '--llm-mode', 'deterministic', '--town-collective-action', 'on'],
        cwd: '/workspace',
        sourceRevision,
        env: {},
      }).townCollectiveActionEnabled,
    ).toBe(true);
    expect(
      resolveLocalRuntimeTownCliConfig({
        ...base,
        env: { AIVILIZATION_TOWN_COLLECTIVE_ACTION: '1' },
      }).townCollectiveActionEnabled,
    ).toBe(true);

    const disabledManifest = JSON.stringify(
      createCanonicalLocalRuntimeTownResolvedRunManifest(
        resolveLocalRuntimeTownCliConfig({ ...base, env: {} }),
      ),
    );
    expect(disabledManifest).not.toContain('collective-action-v1');
    const enabledManifest = JSON.stringify(
      createCanonicalLocalRuntimeTownResolvedRunManifest(
        resolveLocalRuntimeTownCliConfig({
          ...base,
          env: { AIVILIZATION_TOWN_COLLECTIVE_ACTION: '1' },
        }),
      ),
    );
    expect(enabledManifest).toContain('collective-action-v1');
  });

  test('town migration is off by default and enabled by flag or env', () => {
    const base = {
      argv: ['--', '--llm-mode', 'deterministic'] as readonly string[],
      cwd: '/workspace',
      sourceRevision,
    };

    expect(resolveLocalRuntimeTownCliConfig({ ...base, env: {} }).townMigrationEnabled).toBe(false);
    expect(
      resolveLocalRuntimeTownCliConfig({
        argv: ['--', '--llm-mode', 'deterministic', '--town-migration', 'on'],
        cwd: '/workspace',
        sourceRevision,
        env: {},
      }).townMigrationEnabled,
    ).toBe(true);
    expect(
      resolveLocalRuntimeTownCliConfig({
        ...base,
        env: { AIVILIZATION_TOWN_MIGRATION: '1' },
      }).townMigrationEnabled,
    ).toBe(true);

    const disabledManifest = JSON.stringify(
      createCanonicalLocalRuntimeTownResolvedRunManifest(
        resolveLocalRuntimeTownCliConfig({ ...base, env: {} }),
      ),
    );
    expect(disabledManifest).not.toContain('town-migration-v1');
    const enabledManifest = JSON.stringify(
      createCanonicalLocalRuntimeTownResolvedRunManifest(
        resolveLocalRuntimeTownCliConfig({
          ...base,
          env: { AIVILIZATION_TOWN_MIGRATION: '1' },
        }),
      ),
    );
    expect(enabledManifest).toContain('town-migration-v1');
  });

  test('town service quality is off by default and enabled by flag or env', () => {
    const base = {
      argv: ['--', '--llm-mode', 'deterministic'] as readonly string[],
      cwd: '/workspace',
      sourceRevision,
    };
    expect(resolveLocalRuntimeTownCliConfig({ ...base, env: {} }).townServiceQualityEnabled).toBe(
      false,
    );
    expect(
      resolveLocalRuntimeTownCliConfig({
        argv: ['--', '--llm-mode', 'deterministic', '--town-service-quality', 'on'],
        cwd: '/workspace',
        sourceRevision,
        env: {},
      }).townServiceQualityEnabled,
    ).toBe(true);
    expect(
      resolveLocalRuntimeTownCliConfig({
        ...base,
        env: { AIVILIZATION_TOWN_SERVICE_QUALITY: '1' },
      }).townServiceQualityEnabled,
    ).toBe(true);

    const disabled = JSON.stringify(
      createCanonicalLocalRuntimeTownResolvedRunManifest(
        resolveLocalRuntimeTownCliConfig({ ...base, env: {} }),
      ),
    );
    expect(disabled).not.toContain('town-service-quality-v1');
    const enabled = JSON.stringify(
      createCanonicalLocalRuntimeTownResolvedRunManifest(
        resolveLocalRuntimeTownCliConfig({
          ...base,
          env: { AIVILIZATION_TOWN_SERVICE_QUALITY: '1' },
        }),
      ),
    );
    expect(enabled).toContain('town-service-quality-v1');
  });

  test('town governance is off by default and enabled by flag or env', () => {
    const base = {
      argv: ['--', '--llm-mode', 'deterministic'] as readonly string[],
      cwd: '/workspace',
      sourceRevision,
    };
    expect(resolveLocalRuntimeTownCliConfig({ ...base, env: {} }).townGovernanceEnabled).toBe(
      false,
    );
    expect(
      resolveLocalRuntimeTownCliConfig({
        argv: ['--', '--llm-mode', 'deterministic', '--town-governance', 'on'],
        cwd: '/workspace',
        sourceRevision,
        env: {},
      }).townGovernanceEnabled,
    ).toBe(true);
    expect(
      resolveLocalRuntimeTownCliConfig({
        ...base,
        env: { AIVILIZATION_TOWN_GOVERNANCE: '1' },
      }).townGovernanceEnabled,
    ).toBe(true);

    const disabled = JSON.stringify(
      createCanonicalLocalRuntimeTownResolvedRunManifest(
        resolveLocalRuntimeTownCliConfig({ ...base, env: {} }),
      ),
    );
    expect(disabled).not.toContain('town-governance-v1');
    const enabled = JSON.stringify(
      createCanonicalLocalRuntimeTownResolvedRunManifest(
        resolveLocalRuntimeTownCliConfig({
          ...base,
          env: { AIVILIZATION_TOWN_GOVERNANCE: '1' },
        }),
      ),
    );
    expect(enabled).toContain('town-governance-v1');
  });

  test('town survival pressure is off by default and enabled by flag or env', () => {
    const base = {
      argv: ['--', '--llm-mode', 'deterministic'] as readonly string[],
      cwd: '/workspace',
      sourceRevision,
    };
    expect(
      resolveLocalRuntimeTownCliConfig({ ...base, env: {} }).townSurvivalPressureEnabled,
    ).toBe(false);
    expect(
      resolveLocalRuntimeTownCliConfig({
        argv: ['--', '--llm-mode', 'deterministic', '--town-survival-pressure', 'on'],
        cwd: '/workspace',
        sourceRevision,
        env: {},
      }).townSurvivalPressureEnabled,
    ).toBe(true);
    expect(
      resolveLocalRuntimeTownCliConfig({
        ...base,
        env: { AIVILIZATION_TOWN_SURVIVAL_PRESSURE: '1' },
      }).townSurvivalPressureEnabled,
    ).toBe(true);

    const disabled = JSON.stringify(
      createCanonicalLocalRuntimeTownResolvedRunManifest(
        resolveLocalRuntimeTownCliConfig({ ...base, env: {} }),
      ),
    );
    expect(disabled).not.toContain('starvation-health-decay-v1');
    const enabled = JSON.stringify(
      createCanonicalLocalRuntimeTownResolvedRunManifest(
        resolveLocalRuntimeTownCliConfig({
          ...base,
          env: { AIVILIZATION_TOWN_SURVIVAL_PRESSURE: '1' },
        }),
      ),
    );
    expect(enabled).toContain('starvation-health-decay-v1');
  });

  test('town carrying capacity is opt-in, manifest-bound, and limited to one partition', () => {
    const base = {
      argv: ['--', '--llm-mode', 'deterministic'] as readonly string[],
      cwd: '/workspace',
      sourceRevision,
    };
    expect(
      resolveLocalRuntimeTownCliConfig({ ...base, env: {} }).townCarryingCapacityEnabled,
    ).toBe(false);
    const enabledByFlag = resolveLocalRuntimeTownCliConfig({
      argv: ['--', '--llm-mode', 'deterministic', '--town-carrying-capacity', 'on'],
      cwd: '/workspace',
      sourceRevision,
      env: {},
    });
    expect(enabledByFlag.townCarryingCapacityEnabled).toBe(true);
    expect(
      resolveLocalRuntimeTownCliConfig({
        ...base,
        env: { AIVILIZATION_TOWN_CARRYING_CAPACITY: '1' },
      }).townCarryingCapacityEnabled,
    ).toBe(true);

    const manifest = createCanonicalLocalRuntimeTownResolvedRunManifest(enabledByFlag);
    expect(manifest.payload.policies['policyVersions']).toMatchObject({
      townCarryingCapacity: 'renewable-resources-v1',
    });
    expect(manifest.payload.policies['policyVersions']).not.toHaveProperty(
      'physiologicalSafetyNet',
    );
    expect(manifest.payload.policies['parameters']).toMatchObject({
      townCarryingCapacity: {
        welfareInventoryRule: 'no-unfunded-inventory-grants',
        partitionScope: 'single-partition-v1',
      },
    });

    const survivalTown = resolveLocalRuntimeTownCliConfig({
      argv: [
        '--',
        '--profile',
        'survival-town-100',
        '--llm-mode',
        'deterministic',
      ],
      cwd: '/workspace',
      sourceRevision,
      env: {},
    });
    expect(survivalTown).toMatchObject({
      townCalendarEnabled: true,
      townConditionsEnabled: true,
      townWellbeingEnabled: true,
      townLifecycleEnabled: true,
      townMigrationEnabled: true,
      townSurvivalPressureEnabled: true,
      townCarryingCapacityEnabled: true,
    });
    expect(() => createCanonicalLocalRuntimeTownServerInput(survivalTown)).not.toThrow();

    const multiPartition = resolveLocalRuntimeTownCliConfig({
      argv: [
        '--',
        '--profile',
        'default-100',
        '--llm-mode',
        'deterministic',
        '--town-carrying-capacity',
        'on',
      ],
      cwd: '/workspace',
      sourceRevision,
      env: {},
    });
    expect(() => createCanonicalLocalRuntimeTownServerInput(multiPartition)).toThrow(
      'town carrying capacity currently requires a single-partition profile',
    );
  });

  test('LLM social signal extraction is on by default and disabled by env opt-out', () => {
    const base = {
      argv: [] as readonly string[],
      cwd: '/workspace',
      sourceRevision,
      env: {
        AIVILIZATION_LLM_ENDPOINT: 'https://llm.example.test/v1/chat/completions',
        AIVILIZATION_LLM_MODEL: 'paper-town-model',
        AIVILIZATION_LLM_INPUT_TOKEN_COST_MICROS: '0.003',
        AIVILIZATION_LLM_OUTPUT_TOKEN_COST_MICROS: '0.009',
      },
    };

    // Default: the extraction stage stays enabled with no extra stage config.
    expect(resolveLocalRuntimeTownCliConfig(base).llm?.stages).toBeUndefined();

    // Explicit opt-out disables only the social-signal-extraction stage.
    expect(
      resolveLocalRuntimeTownCliConfig({
        ...base,
        env: { ...base.env, AIVILIZATION_SOCIAL_SIGNAL_EXTRACTION: 'off' },
      }).llm?.stages,
    ).toEqual({ 'social-signal-extraction': false });

    expect(() =>
      resolveLocalRuntimeTownCliConfig({
        ...base,
        env: { ...base.env, AIVILIZATION_SOCIAL_SIGNAL_EXTRACTION: 'maybe' },
      }),
    ).toThrow('AIVILIZATION_SOCIAL_SIGNAL_EXTRACTION must be "on" or "off"');
  });

  test('fails closed for non-loopback open access and validates authenticated credentials', () => {
    expect(() =>
      resolveLocalRuntimeTownCliConfig({
        argv: ['--llm-mode', 'deterministic', '--host', '0.0.0.0'],
        env: {},
        cwd: '/workspace',
        sourceRevision,
      }),
    ).toThrow('open participant access is restricted to loopback');

    expect(() =>
      resolveLocalRuntimeTownCliConfig({
        argv: ['--llm-mode', 'deterministic', '--host', '0.0.0.0'],
        env: { AIVILIZATION_ACCESS_MODE: 'authenticated' },
        cwd: '/workspace',
        sourceRevision,
      }),
    ).toThrow('AIVILIZATION_ACCESS_CREDENTIALS_JSON is required');

    expect(
      resolveLocalRuntimeTownCliConfig({
        argv: ['--llm-mode', 'deterministic', '--host', '0.0.0.0'],
        env: {
          AIVILIZATION_ACCESS_MODE: 'authenticated',
          AIVILIZATION_ACCESS_CREDENTIALS_JSON: participantAccessCredentials,
        },
        cwd: '/workspace',
        sourceRevision,
      }).participantAccess,
    ).toMatchObject({
      mode: 'authenticated',
      maxAgentsPerParticipant: 16,
    });

    expect(
      resolveLocalRuntimeTownCliConfig({
        argv: ['--llm-mode', 'deterministic', '--host', '0.0.0.0'],
        env: {
          AIVILIZATION_ACCESS_MODE: 'authenticated',
          AIVILIZATION_OIDC_ISSUER: 'https://identity.example.test/',
          AIVILIZATION_OIDC_AUDIENCE: 'aivilization-town',
          AIVILIZATION_OIDC_JWKS_URL: 'https://identity.example.test/.well-known/jwks.json',
          AIVILIZATION_OIDC_ROLE_CLAIM: 'town_roles',
        },
        cwd: '/workspace',
        sourceRevision,
      }).participantAccess,
    ).toMatchObject({
      mode: 'authenticated',
      maxAgentsPerParticipant: 16,
      oidc: {
        policyVersion: 'oidc-jwks-authentication-v1',
        issuer: 'https://identity.example.test/',
        audience: 'aivilization-town',
        roleClaim: 'town_roles',
        allowedAlgorithms: ['RS256'],
      },
    });
  });

  test('resolves packaged source revision and explicit seed from environment metadata', () => {
    expect(
      resolveLocalRuntimeTownCliConfig({
        argv: ['--llm-mode', 'deterministic'],
        env: {
          AIVILIZATION_COMMIT: sourceRevision.commit.toUpperCase(),
          AIVILIZATION_SOURCE_DIRTY: 'true',
          AIVILIZATION_SOURCE_WORKSPACE_SHA256: 'a'.repeat(64),
          AIVILIZATION_SOURCE_WORKSPACE_PATH_COUNT: '17',
          AIVILIZATION_SEED: 'paper-experiment-seed-7',
        },
        cwd: '/workspace',
      }),
    ).toMatchObject({
      sourceRevision: {
        commit: sourceRevision.commit,
        dirty: true,
        workspaceFingerprint: {
          policyVersion: 'git-workspace-fingerprint-v1',
          sha256: `sha256:${'a'.repeat(64)}`,
          pathCount: 17,
        },
      },
      seed: 'paper-experiment-seed-7',
    });
  });

  test('resolves the controlled paper cohort and isolates non-default planner variants', () => {
    expect(
      resolveLocalRuntimeTownCliConfig({
        argv: [
          '--llm-mode',
          'deterministic',
          '--profile',
          'ablation-80',
          '--planner-variant',
          'without-branch',
        ],
        env: {},
        cwd: '/workspace',
        sourceRevision,
      }),
    ).toMatchObject({
      profileId: 'ablation-80',
      plannerVariant: 'without-branch',
      rootDir: '/workspace/.aivilization/runtime/ablation-80-without-branch',
      seed: 'canonical-runtime-composition-v1:ablation-80',
    });

    expect(() =>
      resolveLocalRuntimeTownCliConfig({
        argv: ['--llm-mode', 'deterministic', '--planner-variant', 'label-only'],
        env: {},
        cwd: '/workspace',
        sourceRevision,
      }),
    ).toThrow('unsupported paper planner variant label-only');
    expect(createLocalRuntimeTownCliHelp()).toContain('without-objective-decomposition');

    expect(
      resolveLocalRuntimeTownCliConfig({
        argv: [
          '--llm-mode',
          'deterministic',
          '--profile',
          'ablation-80',
          '--paper-ablation-task',
          'task-3',
        ],
        env: {},
        cwd: '/workspace',
        sourceRevision,
      }),
    ).toMatchObject({
      profileId: 'ablation-80',
      plannerVariant: 'default',
      paperAblationTaskId: 'task-3',
      rootDir: '/workspace/.aivilization/runtime/ablation-80-task-3-default',
      seed: 'canonical-runtime-composition-v1:ablation-80:task-3',
    });
    expect(() =>
      resolveLocalRuntimeTownCliConfig({
        argv: ['--llm-mode', 'deterministic', '--paper-ablation-task', 'task-1'],
        env: {},
        cwd: '/workspace',
        sourceRevision,
      }),
    ).toThrow('paper ablation tasks require --profile ablation-80');
    expect(() =>
      resolveLocalRuntimeTownCliConfig({
        argv: [
          '--llm-mode',
          'deterministic',
          '--profile',
          'ablation-80',
          '--paper-ablation-task',
          'task-9',
        ],
        env: {},
        cwd: '/workspace',
        sourceRevision,
      }),
    ).toThrow('unsupported paper planner ablation task task-9');
    expect(createLocalRuntimeTownCliHelp()).toContain('task-1 | task-2 | task-3 | task-4');
  });

  test('records the ablation education-system override in the resolved run manifest', () => {
    const ablationConfig = createDeterministicConfig(['--profile', 'ablation-80']);
    const ablationManifest = createCanonicalLocalRuntimeTownResolvedRunManifest(ablationConfig);
    expect(ablationManifest.payload.policies).toMatchObject({
      parameters: { educationSystem: { enabled: false } },
    });
    // The runtime command policies resolve the same override, keeping the
    // runtime policy, manifest parameters and registry in sync.
    const ablationInput = createCanonicalLocalRuntimeTownServerInput(ablationConfig, 100);
    const resolverProjection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 100, satiety: 80, health: 100 },
          educationScore: 10,
          balance: 100,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
      ],
    });
    const ablationPolicySource = ablationInput.policies;
    const ablationResolvedPolicies =
      typeof ablationPolicySource === 'function'
        ? ablationPolicySource(resolverProjection)
        : ablationPolicySource;
    expect(ablationResolvedPolicies).toMatchObject({
      educationSystem: { enabled: false },
    });

    const canonicalManifest = createCanonicalLocalRuntimeTownResolvedRunManifest(
      createDeterministicConfig(),
    );
    expect(canonicalManifest.payload.policies).toMatchObject({
      parameters: { educationSystem: { enabled: true } },
    });
  });

  test('builds one canonical object graph with autonomous agents and daemon services', async () => {
    const config = createDeterministicConfig();
    const input = createCanonicalLocalRuntimeTownServerInput(config, 100);

    expect(input).toMatchObject({
      bootstrappedAt: 100,
      manifest: { id: 'aivilization-smoke-25' },
      agents: [],
      canonicalAgents: true,
      marketObservations: {
        enabled: true,
        priceBinning: { intervalMs: 300_000, originAt: 0 },
      },
      runtimeRunQueue: { autoStart: true },
      runtimeScheduler: { autoStart: true },
      runtimeRecovery: { autoStart: true },
    });
    expect(input.policies).toBeTypeOf('function');
    expect(input.resolvedRunManifest?.runManifestId).toMatch(
      /^resolved-run-manifest:sha256:[a-f0-9]{64}$/u,
    );
    expect(input.resolvedRunManifest).toMatchObject({
      payload: {
        schemaVersion: 'local-simulation-resolved-run-manifest-v1',
        sourceRevision,
        seed: 'canonical-runtime-composition-v1:smoke-25',
        composition: { version: 'canonical-runtime-composition-v1' },
        scenario: { profileId: 'smoke-25', agentCount: 25 },
        policies: {
          schemaVersion: 'aivilization-world-policy-manifest-v2',
          parameters: {
            agentAllocation: {
              schemaVersion: 'canonical-agent-allocation-policy-v1',
              actionSynthesis: { maxActions: 1 },
              activityTime: {
                policyVersion: 'exclusive-agent-activity-time-v2',
                tradeDurationSeconds: 300,
              },
            },
          },
        },
        cognition: {
          mode: 'deterministic',
          policyId: 'structured-cognition-v1',
          planner: {
            policyVersion: 'paper-planner-ablation-v1',
            activeVariant: 'default',
            controlledBaseCompilerRule:
              'apply-structural-ablation-after-the-same-configured-strategic-compiler',
            variants: {
              default: {
                branchDecomposition: 'parallel-reasoning-branches',
                objectiveDecomposition: 'structured-objectives-and-subtasks',
              },
              'without-branch': {
                branchDecomposition: 'removed-single-reasoning-branch',
                objectiveDecomposition: 'preserved-structured-subtasks',
              },
              'without-objective-decomposition': {
                branchDecomposition: 'preserved-parallel-reasoning-branches',
                objectiveDecomposition: 'removed-direct-action-generation',
              },
            },
            verificationInvariants: {
              'without-branch': 'exactly-one-branch-with-all-source-subtasks',
              'without-objective-decomposition':
                'source-branch-count-preserved-and-each-branch-has-one-direct-action-subtask',
            },
          },
          planningStorage: {
            policyVersion: 'planning-storage-v3',
            provenance: 'repository-design',
            durableLayout: 'jsonl-current-state-journal-v3',
            branchPlans: {
              hotProjection: 'latest-unique-plan-keys-per-agent',
              hotRecordsPerAgent: 4,
              coldLookup: 'exact-complete-ledger-scan-on-hot-miss',
              latestStateQuery: 'transient-latest-per-key-complete-ledger-scan',
            },
            branchPlanProgress: {
              hotProjection: 'latest-unique-plan-keys-per-agent',
              hotRecordsPerAgent: 4,
              coldLookup: 'exact-complete-ledger-scan-on-hot-miss',
            },
            crossInstanceVisibility: 'incremental-complete-row-refresh-before-access',
            recovery: 'rebuild-bounded-projection-after-replacement-truncation-or-rewrite',
            incompleteTail: 'hidden-from-reads-and-rejected-before-local-append',
          },
          planningSessionPublication: {
            policyVersion: 'planning-session-publication-v1',
            commitMarker: 'active-objective-intention-write',
            dependencyOrder: 'plan-then-initial-progress-then-active-objective',
            initialProgressRule: 'materialize-with-new-durable-plan-when-repository-configured',
            crossFileAtomicityClaimed: false,
          },
        },
        memory: {
          shortTermStorage: {
            policyVersion: 'file-short-term-memory-storage-v2',
            writerFormat: 'uint32be-length-prefixed-deflate-raw-jsonl-batch-v1',
            compatibilityRule: 'ordered-union-read-of-legacy-jsonl-prefix-and-compact-frame-tail',
            appendRule: 'legacy-jsonl-must-not-grow-after-first-compact-frame',
            hotIndexRule: 'bounded-recent-records-per-agent-plus-bounded-sparse-checkpoints',
            coldReadRule: 'exact-ledger-scan-from-nearest-retained-cross-format-checkpoint',
            corruptionRule: 'fail-closed-on-incomplete-or-invalid-jsonl-or-deflate-frame',
          },
          agentIntentions: {
            policyVersion: 'agent-intention-ledger-v3',
            writerFormat: 'typed-incremental-operation-per-jsonl-row',
            legacyReadFormat: 'full-state-snapshots-and-v2-operation-rows',
            replayRule: 'ordered-union-replay-of-legacy-snapshots-v2-and-v3-operations',
            growthRule: 'standard-mutations-append-only-changed-payload',
            hotIndexRule: 'latest-bounded-state-per-agent-without-retaining-replayed-rows',
            completedObjectiveRetentionLimit: 32,
            completionOrdinalRule: 'durable-total-count-independent-of-retained-recent-window',
            explicitSaveRule: 'append-replace-state-operation',
            unknownFutureVersion: 'reject-read',
          },
        },
        observations: {
          ambientObservationMemory: {
            policyVersion: 'paper-local-ambient-observation-v1',
            enabled: true,
            visibleEventTypes: [
              'ConversationRecorded',
              'SocialInteractionCompleted',
              'CommodityProduced',
              'WagePaid',
              'EducationChanged',
              'AgentLocationChanged',
            ],
            maxObserversPerEvent: 4,
            observerSelectionRule: 'event-seeded-stable-ranking-among-co-located-non-actor-agents',
            marketTradeBystanderMemory: 'disabled-no-global-public-tape-fanout',
          },
          agentCycleTraces: {
            policyVersion: 'agent-cycle-trace-storage-v5',
            payload: 'lossless-full-agent-cycle-traces',
            writerFormat: 'legacy-gzip-prefix-plus-length-prefixed-brotli-jsonl-batches',
            repositoryBatchBoundary: 'one-brotli-frame-per-record-many-call',
            canonicalWorkerBatchBoundary: 'available-agent-traces-per-simulation-tick',
            compressionQuality: 6,
            sampling: 'none',
            legacyReadPath: 'agent-cycle-traces.jsonl',
            compressedWritePath: 'agent-cycle-traces.jsonl.gz',
            mixedCodecCompatibility: 'v1-v4-gzip-index-rows-plus-v5-brotli-index-rows',
            legacyBatchIndexPath: 'agent-cycle-trace-batches.jsonl',
            compactBatchIndexPath: 'agent-cycle-trace-batches.deflate',
            compactBatchIndexFormat: 'uint32be-length-prefixed-deflate-raw-json-v1',
            indexCompatibilityRule:
              'union-read-legacy-jsonl-and-compact-deflate-with-covered-range-deduplication',
            recentBatchLimit: 1024,
            deduplicationBloomBitCount: 1 << 24,
            deduplicationBloomHashCount: 7,
            runtimeIndexRule: 'bounded-recent-batches-plus-fixed-bloom-with-exact-cold-scan',
            queryRule: 'serve-provably-complete-latest-window-else-filter-complete-index',
            incompleteIndexRecovery:
              'hash-and-index-complete-gzip-or-framed-brotli-tail-or-fail-closed',
            rollbackBoundary:
              'pre-v2-runtime-starts-but-cannot-query-post-upgrade-compressed-traces',
          },
          planningLifecycleTraces: {
            policyVersion: 'bounded-trace-ledger-v1',
            durableLayout: 'unchanged-lossless-jsonl',
            recentRecordLimit: 4096,
            duplicateRule: 'recent-key-or-fixed-bloom-plus-exact-cold-scan',
            completeQueryRule: 'transient-committed-ledger-scan',
          },
          eventStoreRuntimeIndex: {
            policyVersion: 'file-event-store-runtime-index-v4',
            eventStreamRule: 'legacy-jsonl-plus-compact-deflate-frames-with-bounded-runtime-index',
            recentEventLimit: 1024,
            sparseCheckpointInterval: 1024,
            maxSparseCheckpointCount: 4096,
            idempotencyRule: 'bounded-recent-records-plus-fixed-bloom-with-exact-cold-scan',
            recentIdempotencyLimit: 1024,
            idempotencyBloomBitCount: 1 << 24,
            idempotencyBloomHashCount: 7,
            coldReadRule: 'union-read-legacy-jsonl-and-compact-frames-from-nearest-checkpoint',
            eventStreamWriterFormat: 'uint32be-length-prefixed-deflate-raw-jsonl-batch-v1',
            idempotencyPayloadRule: 'sha256-request-plus-event-sequence-reference',
            idempotencyWriterFormat: 'uint32be-length-prefixed-deflate-raw-json-v1',
            idempotencyCompactionRule:
              'single-writer-atomic-streaming-repack-into-batched-jsonl-frames',
            appendAtomicityRule:
              'single-writer-write-ahead-pending-append-with-startup-roll-forward',
            pendingAppendPath: 'append-transaction.pending.json',
            legacyIdempotencyReadPath: 'idempotency.jsonl',
            compactIdempotencyWritePath: 'idempotency.deflate',
            diskLayout: 'layout-v4-write-ahead-append-plus-v3-compact-readers',
          },
          marketTradeObservations: {
            policyVersion: 'paper-market-data-pipeline-v2',
            intervalMs: 300_000,
            intervalMinutes: 5,
            representativePrice: 'last-traded-close',
            persistenceRule: 'append-only-trades-with-latest-revision-per-ohlc-bar-id',
          },
        },
        runtime: {
          projectionSnapshots: {
            policyVersion: 'local-projection-snapshot-retention-v1',
            maximumSnapshotsPerPartition: 2,
            retentionRule: 'retain-latest-sequences-per-simulation-partition',
            recoveryRule: 'retain-current-checkpoint-predecessor-until-next-snapshot-save',
          },
          dataCompatibility: {
            policyVersion: 'local-runtime-data-compatibility-v2',
            currentDataLayoutVersion: 2,
            readableDataLayoutVersions: [2],
            writableDataLayoutVersions: [2],
            unknownFutureVersion: 'reject-startup',
          },
          productionSlo: {
            policyVersion: 'production-runtime-slo-v2',
            evaluationKind: 'point-in-time-operational-snapshot',
            queue: { maxReadyDepth: 1, maxOldestReadyAgeMs: 10_000 },
            checkpoint: { maxSequenceLag: 0, maxWallClockAgeMs: 10_000 },
            llm: {
              simulatedWindowMs: 3_600_000,
              maxFallbackOrFailureRatio: 0.05,
              maxEstimatedCostMicrosPerWindow: 5_000_000,
              providerTraceCollection: 'collect-only-when-provider-configured',
            },
            market: { maxObservationLagSimulatedMs: 600_000 },
            recovery: { maxCompletedCheckAgeMs: 10_000 },
            artifactIntegrity: { requiredVerifiedRatio: 1 },
          },
          simulationClock: {
            policyVersion: 'scenario-time-scale-v1',
            timeDeltaFormula: 'scenario.clock.tickDurationMs*scenario.timeScale',
          },
        },
        validation: {
          marketStylizedFacts: {
            policyVersion: 'market-stylized-facts-v1',
            autocorrelationLags: 10,
            significanceLevel: 0.01,
            aggregationRule: 'every-commodity-must-pass; no maximum-across-commodities shortcut',
          },
          paperMatureMarketDataset: {
            policyVersion: 'paper-mature-market-dataset-v2',
            minimumSourceTradeCountExclusive: 600_000,
            selectedTradeCount: 400_000,
            stabilityWindowDayCount: 7,
            dailyTradingVolumeRule: 'sum-currency-quantity-across-trades',
            participantCountRule: 'distinct-trading-agent-id',
            participantIdentityRule: 'required-fail-closed',
            stableWindowSelectionRule: 'earliest-complete-consecutive-window',
            selectedBlockRule: 'first-n-subsequent-trades-in-deterministic-cross-partition-order',
            timeBasis: 'simulated-time',
          },
          paperMarketAnalysis: {
            policyVersion: 'paper-market-analysis-v2',
            sourceDatasetPolicy: 'paper-mature-market-dataset-v2',
            representativeCommodities: [
              'Wood',
              'Apple',
              'Fish',
              'Copper Ore',
              'Silicon Ore',
              'Wheat',
              'Iron Ore',
              'Chicken',
              'Circuit Board',
              'Copper Ingot',
            ],
            intervalMs: 300_000,
            momentRule: 'population-central-moments',
            ljungBoxLagCount: 10,
            minimumReturnCount: 100,
            paperHeavyTailFloor: 6,
            volatilitySignificanceLevel: 0.01,
            evidenceRule: 'synthetic-contract-output-is-not-empirical-reproduction',
          },
          paperMarketFigures: {
            policyVersion: 'paper-market-figures-v1',
            intervalMs: 300_000,
            outputFormat: 'deterministic-svg-plus-source-bar-manifest',
          },
          paperStratification: {
            policyVersion: 'paper-stratification-v2',
            educationRange: [0, 1_500],
            educationBinWidth: 50,
            occupationFilter: 'exclude-unemployed',
          },
          paperAgentTrajectories: {
            policyVersion: 'paper-agent-trajectory-analysis-v1',
            planningHorizonProxy: 'early-human-education-long-horizon-objective',
            earlyWindowFraction: 0.25,
            highStatusMinimumOccupationTier: 5,
            causalInterpretation: 'observational-correlation-only',
            causalClaimPermitted: false,
          },
          runtimeSoakEvidence: {
            policyVersion: 'runtime-soak-evidence-v1',
            requiredProfiles: [
              { profileId: 'smoke-25', agentCount: 25 },
              { profileId: 'default-100', agentCount: 100 },
              { profileId: 'headless-stress-1000', agentCount: 1_000 },
            ],
            minimumDurationMs: 1_800_000,
            maximumSampleGapMs: 10_000,
            maximumFailedAttemptRatio: 0.01,
            evidenceBoundary: {
              scope: 'single-process-backend-runtime',
              fullProviderCapacityClaim: false,
              paperScaleClaim: false,
              syntheticContractOutputIsEmpiricalEvidence: false,
            },
          },
          paperPlannerAblation: {
            policyVersion: 'paper-planner-ablation-experiment-v1',
            taskIds: ['task-1', 'task-2', 'task-3', 'task-4'],
            experimentDurationRule:
              'explicit-runtime-input-required-because-section-5-does-not-report-duration',
            comparisonMatrix: 'four-tasks-times-three-variants-exactly-once',
            activeTask: null,
          },
        },
      },
    });

    const runtime = await createLocalRuntimeTownApi(input);
    const backend = runtime.host.registry.getBackend({
      simulationId: 'aivilization-smoke-25',
      partitionKey: 'world-main',
    });
    const result = await backend.lifecycle.start({
      simulationId: 'aivilization-smoke-25',
      partitionKey: 'world-main',
      requestedAt: 200,
    });

    expect(result).toMatchObject({
      status: 'completed',
      state: {
        lastMemoryConsolidationStatus: 'succeeded',
      },
    });
    const agentCycleTraces = await backend.storage.agentCycleTraceRepository.query({
      simulationId: 'aivilization-smoke-25',
      limit: 25,
    });
    expect(agentCycleTraces).not.toEqual([]);
    expect(
      agentCycleTraces.every((trace) => trace.actionSynthesis.acceptedActions.length <= 1),
    ).toBe(true);
    expect(
      agentCycleTraces.some((trace) => trace.actionSynthesis.acceptedActions.length === 1),
    ).toBe(true);
    const run = await runtime.supervisor.runCycles({
      operationId: 'canonical-run-300',
      requestedAt: 300,
      cycleCount: 1,
    });
    expect(run.runManifestId).toBe(input.resolvedRunManifest?.runManifestId);
    await expect(runtime.supervisor.getRunSession('canonical-run-300')).resolves.toMatchObject({
      traceId: 'canonical-run-300',
      runManifestId: input.resolvedRunManifest?.runManifestId,
      status: 'completed',
    });
    await expect(runtime.supervisor.getOperationTrace('canonical-run-300')).resolves.toMatchObject({
      traceId: 'canonical-run-300',
      runManifestId: input.resolvedRunManifest?.runManifestId,
      command: 'run-cycles',
    });
    await expect(
      runtime.supervisor.getResolvedRunManifest(requireRunManifestId(input.resolvedRunManifest)),
    ).resolves.toEqual(input.resolvedRunManifest);
    const restartedManifestRepository = new FileLocalSimulationRuntimeResolvedRunManifestRepository(
      {
        rootDir: join(config.rootDir, 'operations'),
      },
    );
    await expect(
      restartedManifestRepository.get(requireRunManifestId(input.resolvedRunManifest)),
    ).resolves.toEqual(input.resolvedRunManifest);
    expect(result.state?.lastValidationStatus).toBeUndefined();
  });

  test('injects one paper task as the top-level objective for the full 80-agent cohort', async () => {
    const config = createDeterministicConfig([
      '--profile',
      'ablation-80',
      '--paper-ablation-task',
      'task-1',
      '--planner-variant',
      'default',
    ]);
    const input = createCanonicalLocalRuntimeTownServerInput(config, 100);
    if (input.canonicalAgents === undefined || input.canonicalAgents === true) {
      throw new Error('expected configured canonical paper ablation agents');
    }
    expect(input.canonicalAgents.objectiveProposer).toBeTypeOf('function');
    expect(input.resolvedRunManifest).toMatchObject({
      payload: {
        seed: 'canonical-runtime-composition-v1:ablation-80:task-1',
        scenario: { profileId: 'ablation-80', agentCount: 80 },
        cognition: { planner: { activeVariant: 'default' } },
        validation: {
          paperPlannerAblation: {
            activeTask: {
              taskId: 'task-1',
              paperTable: 'Table 2',
              paperFigure: 'Figure 11',
            },
          },
        },
      },
    });

    const runtime = await createLocalRuntimeTownApi(input);
    const backend = runtime.host.registry.getBackend({
      simulationId: 'aivilization-ablation-80',
      partitionKey: 'world-main',
    });
    const result = await backend.lifecycle.start({
      simulationId: 'aivilization-ablation-80',
      partitionKey: 'world-main',
      requestedAt: 200,
    });
    const plans = await backend.storage.planRepository.query({ limit: 100 });
    const objectiveTraces = await backend.storage.objectiveRenewalTraceRepository.query({
      simulationId: 'aivilization-ablation-80',
      partitionKey: 'world-main',
      limit: 100,
    });

    expect(result.status).toBe('completed');
    expect(plans).toHaveLength(80);
    expect(
      plans.every(
        (record) =>
          record.plan.objective ===
            'Craft as much high value objectives as possible, earn as much money as possible, while maintaining an higher satiety/energy/health value' &&
          record.plan.branches.length > 1,
      ),
    ).toBe(true);
    expect(objectiveTraces).toHaveLength(80);
    expect(
      objectiveTraces.every((trace) => trace.selectedCandidateId === 'paper-ablation-task-1'),
    ).toBe(true);
  });

  test('listens on HTTP, exposes healthy auto-started components, and closes them together', async () => {
    const config = createDeterministicConfig(['--port', '0']);
    const application = await startLocalRuntimeTownCli(config);
    applications.push(application);

    expect(
      JSON.parse(
        readFileSync(join(config.rootDir, LOCAL_RUNTIME_TOWN_DATA_COMPATIBILITY_FILENAME), 'utf8'),
      ),
    ).toMatchObject({
      schemaVersion: 'local-runtime-data-compatibility-v2',
      dataLayoutVersion: 2,
      origin: 'initialized-empty-v2',
      registeredBySourceRevision: sourceRevision,
    });

    const daemonStatus = await fetchJson(`${application.baseUrl}/runtime/daemon/status`);
    expect(daemonStatus).toMatchObject({
      manifestId: 'aivilization-smoke-25',
      health: 'healthy',
      productionSlo: {
        status: 'pass',
        failedCheckIds: [],
        policy: { policyVersion: 'production-runtime-slo-v2' },
      },
      components: {
        worker: { configured: true, desiredRunning: true, status: { running: true } },
        scheduler: { configured: true, desiredRunning: true, status: { running: true } },
        recovery: { configured: true, desiredRunning: true, status: { running: true } },
      },
    });
    const partition = application.runtime.host.registry.listPartitions()[0]!;
    const objectiveTraceDiagnostics = (
      application.runtime.host.registry.getBackend(partition).storage
        .objectiveRenewalTraceRepository as {
        readonly getStorageDiagnostics: () => { readonly completeQueryScanCount: number };
      }
    ).getStorageDiagnostics();
    expect(objectiveTraceDiagnostics.completeQueryScanCount).toBe(0);
    const productionSlo = (
      daemonStatus as {
        readonly productionSlo: {
          readonly checks: readonly {
            readonly checkId: string;
            readonly status: string;
            readonly measurement: Readonly<Record<string, unknown>>;
          }[];
        };
      }
    ).productionSlo;
    const checksById = Object.fromEntries(
      productionSlo.checks.map((check) => [check.checkId, check]),
    );
    expect(checksById).toMatchObject({
      'daemon-health': { status: 'pass' },
      'run-queue-lag': { status: 'pass' },
      'projection-checkpoint-lag': { status: 'pass' },
      'llm-reliability-and-cost': { status: 'not-applicable' },
      'experiment-artifact-integrity': {
        status: 'pass',
        measurement: { registeredCount: 1, verifiedCount: 1 },
      },
    });
    await expect(
      fetchJson(
        `${application.baseUrl}/simulations/aivilization-smoke-25/partitions/world-main/projection`,
      ),
    ).resolves.toMatchObject({ projection: { clock: {} } });
    await expect(
      fetchJson(
        `${application.baseUrl}/simulations/aivilization-smoke-25/partitions/world-main/validation-reports`,
      ),
    ).resolves.toEqual([]);
    await vi.waitFor(async () => {
      await expect(
        application.runtime.supervisor.getResolvedRunManifest(application.runManifestId),
      ).resolves.toBeDefined();
    });
    await expect(
      fetchJson(
        `${application.baseUrl}/runtime/run-manifests/${encodeURIComponent(application.runManifestId)}`,
      ),
    ).resolves.toMatchObject({
      runManifestId: application.runManifestId,
      payload: {
        sourceRevision,
        seed: 'canonical-runtime-composition-v1:smoke-25',
      },
    });

    await application.close();
    expect(application.runtime.runQueueWorkerHost.getStatus()).toMatchObject({ running: false });
    expect(application.runtime.runQueueSchedulerHost?.getStatus()).toMatchObject({
      running: false,
    });
    expect(application.runtime.runQueueRecoveryHost?.getStatus()).toMatchObject({ running: false });
    applications.pop();
  });

  test('materializes and steers a participant-owned agent in the canonical daemon profile', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'aivilization-participant-runtime-'));
    roots.push(rootDir);
    const config = resolveLocalRuntimeTownCliConfig({
      argv: ['--llm-mode', 'deterministic', '--root-dir', rootDir, '--port', '0'],
      env: {
        AIVILIZATION_ACCESS_MODE: 'authenticated',
        AIVILIZATION_ACCESS_CREDENTIALS_JSON: participantAccessCredentials,
        AIVILIZATION_MAX_AGENTS_PER_PARTICIPANT: '2',
      },
      cwd: '/workspace',
      sourceRevision,
    });
    const application = await startLocalRuntimeTownCli(config);
    applications.push(application);
    application.runtime.runQueueSchedulerHost?.stop();
    application.runtime.runQueueWorkerHost.stop();

    const agentsUrl = `${application.baseUrl}/simulations/aivilization-smoke-25/partitions/world-main/agents`;
    const registration = await fetch(agentsUrl, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${participantAccessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        agentId: 'participant-agent',
        displayName: 'Participant Agent',
        issuedAt: 1_190_000,
        consentPolicyVersion: 'participant-data-consent-v1',
      }),
    });
    expect(registration.status).toBe(202);

    const backend = application.runtime.host.registry.getBackend({
      simulationId: 'aivilization-smoke-25',
      partitionKey: 'world-main',
    });
    const registrationCycle = await backend.lifecycle.start({
      simulationId: 'aivilization-smoke-25',
      partitionKey: 'world-main',
      requestedAt: 1_190_000,
    });
    if ('loop' in registrationCycle && registrationCycle.loop.status === 'command-drain-failed') {
      const failedDrain = registrationCycle.loop.failedStep.result.commandDrain;
      if (failedDrain.status === 'failed') throw failedDrain.error;
      throw new Error('command-drain-failed lifecycle must expose a failed command drain');
    }
    expect(registrationCycle.status).toBe('completed');

    const objective = await fetch(
      `${application.baseUrl}/simulations/aivilization-smoke-25/partitions/world-main/objectives`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${participantAccessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          agentId: 'participant-agent',
          objectiveId: 'participant-objective',
          statement: 'Build a durable cooperative learning network.',
          priority: 10,
          affinityTags: ['cooperation'],
          issuedAt: 1_197_000,
          consentPolicyVersion: 'participant-data-consent-v1',
        }),
      },
    );
    expect(objective.status).toBe(202);

    const objectiveCycle = await backend.lifecycle.start({
      simulationId: 'aivilization-smoke-25',
      partitionKey: 'world-main',
      requestedAt: 1_197_000,
    });
    if ('loop' in objectiveCycle && objectiveCycle.loop.status === 'command-drain-failed') {
      const failedDrain = objectiveCycle.loop.failedStep.result.commandDrain;
      if (failedDrain.status === 'failed') throw failedDrain.error;
      throw new Error('command-drain-failed lifecycle must expose a failed command drain');
    }
    expect(objectiveCycle.status).toBe('completed');
    await expect(
      backend.storage.steeringTraceRepository.query({
        simulationId: 'aivilization-smoke-25',
        agentId: 'participant-agent',
      }),
    ).resolves.toMatchObject([
      {
        resultKind: 'long-horizon-objective-set',
        agentId: 'participant-agent',
        objectiveId: 'participant-objective',
      },
    ]);
  });

  test('coalesces SIGINT and SIGTERM into one graceful close', async () => {
    const listeners = new Map<LocalRuntimeTownShutdownSignal, () => void>();
    const signalSource: LocalRuntimeTownSignalSource = {
      once: (signal, listener) => listeners.set(signal, listener),
      removeListener: (signal, listener) => {
        if (listeners.get(signal) === listener) {
          listeners.delete(signal);
        }
      },
    };
    const close = vi.fn(() => Promise.resolve());
    const dispose = installLocalRuntimeTownShutdownHandlers({
      application: { close },
      signalSource,
    });

    listeners.get('SIGINT')?.();
    listeners.get('SIGTERM')?.();
    await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(1));
    dispose();
    expect(listeners.size).toBe(0);
  });
});

function createDeterministicConfig(argv: readonly string[] = []) {
  const rootDir = mkdtempSync(join(tmpdir(), 'aivilization-canonical-runtime-'));
  roots.push(rootDir);
  return resolveLocalRuntimeTownCliConfig({
    argv: ['--llm-mode', 'deterministic', '--root-dir', rootDir, ...argv],
    env: {},
    cwd: '/workspace',
    sourceRevision,
  });
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`request failed with HTTP ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

function requireRunManifestId(
  manifest: ReturnType<typeof createCanonicalLocalRuntimeTownResolvedRunManifest> | undefined,
): string {
  if (manifest === undefined) {
    throw new Error('expected canonical resolved run manifest');
  }
  return manifest.runManifestId;
}
