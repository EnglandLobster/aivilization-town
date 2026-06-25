import { describe, expect, test } from 'vitest';
import {
  loadLocalRuntimeTownProfileLlmPlanningConfig,
  loadLocalRuntimeTownProfileRuntimeConfig,
} from './localRuntimeTownProfileRuntimeConfig';

describe('local runtime town profile runtime config', () => {
  test('loads profile-specific OpenAI-compatible LLM planning config and resolves env secrets', async () => {
    const config = await loadLocalRuntimeTownProfileLlmPlanningConfig({
      profileId: 'default-100',
      path: '/runtime/config.json',
      env: {
        DEFAULT_KEY: 'secret-key',
        ORG_ID: 'org-1',
      },
      readTextFile: () =>
        Promise.resolve(
          JSON.stringify({
            llmPlanning: null,
            profiles: {
              'default-100': {
                llmPlanning: {
                  kind: 'traceable-llm-strategic-planner',
                  model: 'default-planner',
                  provider: {
                    kind: 'openai-compatible',
                    providerId: 'default-provider',
                    endpoint: 'https://llm.example.test/v1/chat/completions',
                    apiKey: { env: 'DEFAULT_KEY' },
                    defaultHeaders: {
                      'X-Org': { env: 'ORG_ID' },
                    },
                    responseFormat: 'json-object',
                  },
                  maxAttempts: 2,
                  timeoutMs: 30_000,
                  pricing: {
                    inputTokenCostMicros: 2,
                    outputTokenCostMicros: 8,
                  },
                },
              },
            },
          }),
        ),
    });

    expect(config).toEqual({
      kind: 'traceable-llm-strategic-planner',
      profileId: 'default-100',
      model: 'default-planner',
      provider: {
        kind: 'openai-compatible',
        providerId: 'default-provider',
        endpoint: 'https://llm.example.test/v1/chat/completions',
        apiKey: 'secret-key',
        defaultHeaders: {
          'X-Org': 'org-1',
        },
        responseFormat: 'json-object',
      },
      maxAttempts: 2,
      timeoutMs: 30_000,
      pricing: {
        inputTokenCostMicros: 2,
        outputTokenCostMicros: 8,
      },
    });
  });

  test('uses top-level LLM planning config unless a profile disables it', async () => {
    const document = JSON.stringify({
      llmPlanning: {
        kind: 'traceable-llm-strategic-planner',
        model: 'global-planner',
        provider: {
          kind: 'openai-compatible',
          providerId: 'global-provider',
          endpoint: 'https://llm.example.test/v1/chat/completions',
        },
      },
      profiles: {
        'smoke-25': {
          llmPlanning: null,
        },
      },
    });

    await expect(
      loadLocalRuntimeTownProfileLlmPlanningConfig({
        profileId: 'default-100',
        path: '/runtime/config.json',
        readTextFile: () => Promise.resolve(document),
      }),
    ).resolves.toEqual({
      kind: 'traceable-llm-strategic-planner',
      profileId: 'default-100',
      model: 'global-planner',
      provider: {
        kind: 'openai-compatible',
        providerId: 'global-provider',
        endpoint: 'https://llm.example.test/v1/chat/completions',
      },
    });

    await expect(
      loadLocalRuntimeTownProfileLlmPlanningConfig({
        profileId: 'smoke-25',
        path: '/runtime/config.json',
        readTextFile: () => Promise.resolve(document),
      }),
    ).resolves.toBeUndefined();
  });

  test('loads combined runtime config with profile-specific daily planning config', async () => {
    const config = await loadLocalRuntimeTownProfileRuntimeConfig({
      profileId: 'default-100',
      path: '/runtime/config.json',
      env: {
        DAILY_KEY: 'daily-secret',
      },
      readTextFile: () =>
        Promise.resolve(
          JSON.stringify({
            llmPlanning: {
              kind: 'traceable-llm-strategic-planner',
              model: 'global-strategic-planner',
              provider: {
                kind: 'openai-compatible',
                providerId: 'global-strategic-provider',
                endpoint: 'https://llm.example.test/v1/chat/completions',
              },
            },
            profiles: {
              'default-100': {
                dailyPlanning: {
                  kind: 'traceable-llm-daily-planner',
                  model: 'default-daily-planner',
                  provider: {
                    kind: 'openai-compatible',
                    providerId: 'default-daily-provider',
                    endpoint: 'https://daily.example.test/v1/chat/completions',
                    apiKey: { env: 'DAILY_KEY' },
                  },
                  maxAttempts: 3,
                  timeoutMs: 20_000,
                  pricing: {
                    inputTokenCostMicros: 1,
                    outputTokenCostMicros: 4,
                  },
                },
              },
            },
          }),
        ),
    });

    expect(config).toEqual({
      strategicPlanning: {
        kind: 'traceable-llm-strategic-planner',
        profileId: 'default-100',
        model: 'global-strategic-planner',
        provider: {
          kind: 'openai-compatible',
          providerId: 'global-strategic-provider',
          endpoint: 'https://llm.example.test/v1/chat/completions',
        },
      },
      dailyPlanning: {
        kind: 'traceable-llm-daily-planner',
        profileId: 'default-100',
        model: 'default-daily-planner',
        provider: {
          kind: 'openai-compatible',
          providerId: 'default-daily-provider',
          endpoint: 'https://daily.example.test/v1/chat/completions',
          apiKey: 'daily-secret',
        },
        maxAttempts: 3,
        timeoutMs: 20_000,
        pricing: {
          inputTokenCostMicros: 1,
          outputTokenCostMicros: 4,
        },
      },
    });
  });

  test('uses top-level daily planning config unless a profile disables it', async () => {
    const document = JSON.stringify({
      dailyPlanning: {
        kind: 'traceable-llm-daily-planner',
        model: 'global-daily-planner',
        provider: {
          kind: 'openai-compatible',
          providerId: 'global-daily-provider',
          endpoint: 'https://daily.example.test/v1/chat/completions',
        },
      },
      profiles: {
        'smoke-25': {
          dailyPlanning: null,
        },
      },
    });

    await expect(
      loadLocalRuntimeTownProfileRuntimeConfig({
        profileId: 'default-100',
        path: '/runtime/config.json',
        readTextFile: () => Promise.resolve(document),
      }),
    ).resolves.toEqual({
      dailyPlanning: {
        kind: 'traceable-llm-daily-planner',
        profileId: 'default-100',
        model: 'global-daily-planner',
        provider: {
          kind: 'openai-compatible',
          providerId: 'global-daily-provider',
          endpoint: 'https://daily.example.test/v1/chat/completions',
        },
      },
    });

    await expect(
      loadLocalRuntimeTownProfileRuntimeConfig({
        profileId: 'smoke-25',
        path: '/runtime/config.json',
        readTextFile: () => Promise.resolve(document),
      }),
    ).resolves.toEqual({});
  });

  test('rejects missing env secrets before provider construction', async () => {
    await expect(
      loadLocalRuntimeTownProfileLlmPlanningConfig({
        profileId: 'default-100',
        path: '/runtime/config.json',
        env: {},
        readTextFile: () =>
          Promise.resolve(
            JSON.stringify({
              llmPlanning: {
                kind: 'traceable-llm-strategic-planner',
                model: 'default-planner',
                provider: {
                  kind: 'openai-compatible',
                  providerId: 'default-provider',
                  endpoint: 'https://llm.example.test/v1/chat/completions',
                  apiKey: { env: 'MISSING_KEY' },
                },
              },
            }),
          ),
      }),
    ).rejects.toThrow(
      'environment variable MISSING_KEY is required by llmPlanning.provider.apiKey',
    );
  });

  test('rejects unsupported providers and invalid numeric settings', async () => {
    await expect(
      loadLocalRuntimeTownProfileLlmPlanningConfig({
        profileId: 'default-100',
        path: '/runtime/config.json',
        readTextFile: () =>
          Promise.resolve(
            JSON.stringify({
              llmPlanning: {
                kind: 'traceable-llm-strategic-planner',
                model: 'default-planner',
                maxAttempts: 0,
                provider: {
                  kind: 'scripted',
                  providerId: 'scripted-provider',
                },
              },
            }),
          ),
      }),
    ).rejects.toThrow('llmPlanning.maxAttempts must be a positive integer');

    await expect(
      loadLocalRuntimeTownProfileLlmPlanningConfig({
        profileId: 'default-100',
        path: '/runtime/config.json',
        readTextFile: () =>
          Promise.resolve(
            JSON.stringify({
              llmPlanning: {
                kind: 'traceable-llm-strategic-planner',
                model: 'default-planner',
                provider: {
                  kind: 'scripted',
                  providerId: 'scripted-provider',
                },
              },
            }),
          ),
      }),
    ).rejects.toThrow('llmPlanning.provider.kind must be openai-compatible');
  });
});
