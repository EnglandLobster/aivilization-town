import { describe, expect, test } from 'vitest';
import { loadLocalRuntimeTownProfileLlmPlanningConfig } from './localRuntimeTownProfileRuntimeConfig';

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
