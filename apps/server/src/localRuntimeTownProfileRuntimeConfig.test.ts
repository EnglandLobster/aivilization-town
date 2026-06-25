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

  test('loads combined runtime config with profile-specific daily and reaction planning config', async () => {
    const config = await loadLocalRuntimeTownProfileRuntimeConfig({
      profileId: 'default-100',
      path: '/runtime/config.json',
      env: {
        DAILY_KEY: 'daily-secret',
        REACTION_KEY: 'reaction-secret',
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
                reactionPlanning: {
                  kind: 'traceable-llm-reaction-evaluator',
                  model: 'default-reaction-evaluator',
                  provider: {
                    kind: 'openai-compatible',
                    providerId: 'default-reaction-provider',
                    endpoint: 'https://reaction.example.test/v1/chat/completions',
                    apiKey: { env: 'REACTION_KEY' },
                  },
                  maxAttempts: 4,
                  timeoutMs: 10_000,
                  pricing: {
                    inputTokenCostMicros: 2,
                    outputTokenCostMicros: 5,
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
      reactionPlanning: {
        kind: 'traceable-llm-reaction-evaluator',
        profileId: 'default-100',
        model: 'default-reaction-evaluator',
        provider: {
          kind: 'openai-compatible',
          providerId: 'default-reaction-provider',
          endpoint: 'https://reaction.example.test/v1/chat/completions',
          apiKey: 'reaction-secret',
        },
        maxAttempts: 4,
        timeoutMs: 10_000,
        pricing: {
          inputTokenCostMicros: 2,
          outputTokenCostMicros: 5,
        },
      },
    });
  });

  test('uses top-level daily and reaction planning config unless a profile disables it', async () => {
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
      reactionPlanning: {
        kind: 'traceable-llm-reaction-evaluator',
        model: 'global-reaction-evaluator',
        provider: {
          kind: 'openai-compatible',
          providerId: 'global-reaction-provider',
          endpoint: 'https://reaction.example.test/v1/chat/completions',
        },
      },
      profiles: {
        'smoke-25': {
          dailyPlanning: null,
          reactionPlanning: null,
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
      reactionPlanning: {
        kind: 'traceable-llm-reaction-evaluator',
        profileId: 'default-100',
        model: 'global-reaction-evaluator',
        provider: {
          kind: 'openai-compatible',
          providerId: 'global-reaction-provider',
          endpoint: 'https://reaction.example.test/v1/chat/completions',
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

  test('loads profile-specific agent-cycle LLM stage config and resolves env secrets', async () => {
    const config = await loadLocalRuntimeTownProfileRuntimeConfig({
      profileId: 'default-100',
      path: '/runtime/config.json',
      env: {
        PRIORITY_KEY: 'priority-secret',
        ACTION_KEY: 'action-secret',
        SOCIAL_DIALOGUE_KEY: 'social-dialogue-secret',
        GLOBAL_KEY: 'global-secret',
        REACTIVE_KEY: 'reactive-secret',
      },
      readTextFile: () =>
        Promise.resolve(
          JSON.stringify({
            subtaskPrioritization: {
              kind: 'traceable-llm-subtask-prioritizer',
              model: 'global-prioritizer',
              provider: {
                kind: 'openai-compatible',
                providerId: 'global-prioritizer-provider',
                endpoint: 'https://priority.example.test/v1/chat/completions',
              },
            },
            profiles: {
              'default-100': {
                subtaskPrioritization: {
                  kind: 'traceable-llm-subtask-prioritizer',
                  model: 'profile-prioritizer',
                  provider: {
                    kind: 'openai-compatible',
                    providerId: 'profile-prioritizer-provider',
                    endpoint: 'https://priority-profile.example.test/v1/chat/completions',
                    apiKey: { env: 'PRIORITY_KEY' },
                  },
                  maxAttempts: 2,
                  timeoutMs: 15_000,
                  pricing: {
                    inputTokenCostMicros: 1,
                    outputTokenCostMicros: 4,
                  },
                },
                actionSequenceGeneration: {
                  kind: 'traceable-llm-action-sequence-generator',
                  model: 'profile-action-sequence',
                  provider: {
                    kind: 'openai-compatible',
                    providerId: 'profile-action-provider',
                    endpoint: 'https://action.example.test/v1/chat/completions',
                    apiKey: { env: 'ACTION_KEY' },
                  },
                },
                socialDialogue: {
                  kind: 'traceable-llm-social-dialogue-generator',
                  model: 'profile-social-dialogue',
                  provider: {
                    kind: 'openai-compatible',
                    providerId: 'profile-social-dialogue-provider',
                    endpoint: 'https://social-dialogue.example.test/v1/chat/completions',
                    apiKey: { env: 'SOCIAL_DIALOGUE_KEY' },
                  },
                },
                globalSynthesis: {
                  kind: 'traceable-llm-global-synthesizer',
                  model: 'profile-global-synthesizer',
                  provider: {
                    kind: 'openai-compatible',
                    providerId: 'profile-global-provider',
                    endpoint: 'https://global.example.test/v1/chat/completions',
                    apiKey: { env: 'GLOBAL_KEY' },
                  },
                },
                reactiveCorrection: {
                  kind: 'traceable-llm-reactive-corrector',
                  model: 'profile-reactive-corrector',
                  provider: {
                    kind: 'openai-compatible',
                    providerId: 'profile-reactive-provider',
                    endpoint: 'https://reactive.example.test/v1/chat/completions',
                    apiKey: { env: 'REACTIVE_KEY' },
                  },
                },
              },
            },
          }),
        ),
    });

    expect(config).toMatchObject({
      subtaskPrioritization: {
        kind: 'traceable-llm-subtask-prioritizer',
        profileId: 'default-100',
        model: 'profile-prioritizer',
        provider: {
          kind: 'openai-compatible',
          providerId: 'profile-prioritizer-provider',
          endpoint: 'https://priority-profile.example.test/v1/chat/completions',
          apiKey: 'priority-secret',
        },
        maxAttempts: 2,
        timeoutMs: 15_000,
        pricing: {
          inputTokenCostMicros: 1,
          outputTokenCostMicros: 4,
        },
      },
      actionSequenceGeneration: {
        kind: 'traceable-llm-action-sequence-generator',
        profileId: 'default-100',
        model: 'profile-action-sequence',
        provider: {
          kind: 'openai-compatible',
          providerId: 'profile-action-provider',
          endpoint: 'https://action.example.test/v1/chat/completions',
          apiKey: 'action-secret',
        },
      },
      socialDialogue: {
        kind: 'traceable-llm-social-dialogue-generator',
        profileId: 'default-100',
        model: 'profile-social-dialogue',
        provider: {
          kind: 'openai-compatible',
          providerId: 'profile-social-dialogue-provider',
          endpoint: 'https://social-dialogue.example.test/v1/chat/completions',
          apiKey: 'social-dialogue-secret',
        },
      },
      globalSynthesis: {
        kind: 'traceable-llm-global-synthesizer',
        profileId: 'default-100',
        model: 'profile-global-synthesizer',
        provider: {
          kind: 'openai-compatible',
          providerId: 'profile-global-provider',
          endpoint: 'https://global.example.test/v1/chat/completions',
          apiKey: 'global-secret',
        },
      },
      reactiveCorrection: {
        kind: 'traceable-llm-reactive-corrector',
        profileId: 'default-100',
        model: 'profile-reactive-corrector',
        provider: {
          kind: 'openai-compatible',
          providerId: 'profile-reactive-provider',
          endpoint: 'https://reactive.example.test/v1/chat/completions',
          apiKey: 'reactive-secret',
        },
      },
    });
  });

  test('uses top-level agent-cycle LLM stage config unless a profile disables it', async () => {
    const document = JSON.stringify({
      globalSynthesis: {
        kind: 'traceable-llm-global-synthesizer',
        model: 'global-synthesizer',
        provider: {
          kind: 'openai-compatible',
          providerId: 'global-synthesis-provider',
          endpoint: 'https://global.example.test/v1/chat/completions',
        },
      },
      reactiveCorrection: {
        kind: 'traceable-llm-reactive-corrector',
        model: 'global-reactive-corrector',
        provider: {
          kind: 'openai-compatible',
          providerId: 'global-reactive-provider',
          endpoint: 'https://reactive.example.test/v1/chat/completions',
        },
      },
      profiles: {
        'smoke-25': {
          globalSynthesis: null,
          reactiveCorrection: null,
        },
      },
    });

    await expect(
      loadLocalRuntimeTownProfileRuntimeConfig({
        profileId: 'default-100',
        path: '/runtime/config.json',
        readTextFile: () => Promise.resolve(document),
      }),
    ).resolves.toMatchObject({
      globalSynthesis: {
        kind: 'traceable-llm-global-synthesizer',
        profileId: 'default-100',
        model: 'global-synthesizer',
      },
      reactiveCorrection: {
        kind: 'traceable-llm-reactive-corrector',
        profileId: 'default-100',
        model: 'global-reactive-corrector',
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

  test('loads replanning decision config with profile overrides and env secrets', async () => {
    const document = JSON.stringify({
      replanningDecision: {
        kind: 'traceable-llm-replanning-decider',
        model: 'global-replanning',
        provider: {
          kind: 'openai-compatible',
          providerId: 'global-replanning-provider',
          endpoint: 'https://replanning.example.test/v1/chat/completions',
        },
      },
      profiles: {
        'default-100': {
          replanningDecision: {
            kind: 'traceable-llm-replanning-decider',
            model: 'profile-replanning',
            provider: {
              kind: 'openai-compatible',
              providerId: 'profile-replanning-provider',
              endpoint: 'https://replanning-profile.example.test/v1/chat/completions',
              apiKey: { env: 'REPLANNING_KEY' },
            },
            maxAttempts: 2,
            timeoutMs: 9_000,
            pricing: {
              inputTokenCostMicros: 3,
              outputTokenCostMicros: 6,
            },
          },
        },
        'smoke-25': {
          replanningDecision: null,
        },
      },
    });

    await expect(
      loadLocalRuntimeTownProfileRuntimeConfig({
        profileId: 'default-100',
        path: '/runtime/config.json',
        env: { REPLANNING_KEY: 'replanning-secret' },
        readTextFile: () => Promise.resolve(document),
      }),
    ).resolves.toEqual({
      replanningDecision: {
        kind: 'traceable-llm-replanning-decider',
        profileId: 'default-100',
        model: 'profile-replanning',
        provider: {
          kind: 'openai-compatible',
          providerId: 'profile-replanning-provider',
          endpoint: 'https://replanning-profile.example.test/v1/chat/completions',
          apiKey: 'replanning-secret',
        },
        maxAttempts: 2,
        timeoutMs: 9_000,
        pricing: {
          inputTokenCostMicros: 3,
          outputTokenCostMicros: 6,
        },
      },
    });

    await expect(
      loadLocalRuntimeTownProfileRuntimeConfig({
        profileId: 'headless-stress-1000',
        path: '/runtime/config.json',
        readTextFile: () => Promise.resolve(document),
      }),
    ).resolves.toEqual({
      replanningDecision: {
        kind: 'traceable-llm-replanning-decider',
        profileId: 'headless-stress-1000',
        model: 'global-replanning',
        provider: {
          kind: 'openai-compatible',
          providerId: 'global-replanning-provider',
          endpoint: 'https://replanning.example.test/v1/chat/completions',
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

  test('loads adaptive replanning policy with profile overrides and profile disabling', async () => {
    const document = JSON.stringify({
      replanningPolicy: {
        consecutiveFailureThreshold: 3,
        failureTags: ['eat', 'inventory'],
      },
      profiles: {
        'default-100': {
          replanningPolicy: {
            consecutiveFailureThreshold: 2,
            majorContextShift: {
              key: 'profile-recovery-drill',
              reason: 'profile recovery drill requires a replacement plan',
            },
          },
        },
        'smoke-25': {
          replanningPolicy: null,
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
      replanningPolicy: {
        consecutiveFailureThreshold: 2,
        majorContextShift: {
          key: 'profile-recovery-drill',
          reason: 'profile recovery drill requires a replacement plan',
        },
      },
    });

    await expect(
      loadLocalRuntimeTownProfileRuntimeConfig({
        profileId: 'headless-stress-1000',
        path: '/runtime/config.json',
        readTextFile: () => Promise.resolve(document),
      }),
    ).resolves.toEqual({
      replanningPolicy: {
        consecutiveFailureThreshold: 3,
        failureTags: ['eat', 'inventory'],
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

  test('loads reflection synthesis config with profile overrides and env secrets', async () => {
    const document = JSON.stringify({
      reflectionSynthesis: {
        kind: 'traceable-llm-reflective-insight-synthesizer',
        model: 'global-reflection',
        provider: {
          kind: 'openai-compatible',
          providerId: 'global-reflection-provider',
          endpoint: 'https://reflection.example.test/v1/chat/completions',
        },
      },
      profiles: {
        'default-100': {
          reflectionSynthesis: {
            kind: 'traceable-llm-reflective-insight-synthesizer',
            model: 'profile-reflection',
            provider: {
              kind: 'openai-compatible',
              providerId: 'profile-reflection-provider',
              endpoint: 'https://reflection-profile.example.test/v1/chat/completions',
              apiKey: { env: 'REFLECTION_KEY' },
            },
            maxAttempts: 2,
            timeoutMs: 12_000,
            pricing: {
              inputTokenCostMicros: 3,
              outputTokenCostMicros: 7,
            },
          },
        },
        'smoke-25': {
          reflectionSynthesis: null,
        },
      },
    });

    await expect(
      loadLocalRuntimeTownProfileRuntimeConfig({
        profileId: 'default-100',
        path: '/runtime/config.json',
        env: { REFLECTION_KEY: 'reflection-secret' },
        readTextFile: () => Promise.resolve(document),
      }),
    ).resolves.toEqual({
      reflectionSynthesis: {
        kind: 'traceable-llm-reflective-insight-synthesizer',
        profileId: 'default-100',
        model: 'profile-reflection',
        provider: {
          kind: 'openai-compatible',
          providerId: 'profile-reflection-provider',
          endpoint: 'https://reflection-profile.example.test/v1/chat/completions',
          apiKey: 'reflection-secret',
        },
        maxAttempts: 2,
        timeoutMs: 12_000,
        pricing: {
          inputTokenCostMicros: 3,
          outputTokenCostMicros: 7,
        },
      },
    });

    await expect(
      loadLocalRuntimeTownProfileRuntimeConfig({
        profileId: 'headless-stress-1000',
        path: '/runtime/config.json',
        readTextFile: () => Promise.resolve(document),
      }),
    ).resolves.toMatchObject({
      reflectionSynthesis: {
        kind: 'traceable-llm-reflective-insight-synthesizer',
        profileId: 'headless-stress-1000',
        model: 'global-reflection',
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

  test('loads social model synthesis config with profile overrides and env secrets', async () => {
    const document = JSON.stringify({
      socialModelSynthesis: {
        kind: 'traceable-llm-social-model-synthesizer',
        model: 'global-social-model',
        provider: {
          kind: 'openai-compatible',
          providerId: 'global-social-model-provider',
          endpoint: 'https://social-model.example.test/v1/chat/completions',
        },
      },
      profiles: {
        'default-100': {
          socialModelSynthesis: {
            kind: 'traceable-llm-social-model-synthesizer',
            model: 'profile-social-model',
            provider: {
              kind: 'openai-compatible',
              providerId: 'profile-social-model-provider',
              endpoint: 'https://social-model-profile.example.test/v1/chat/completions',
              apiKey: { env: 'SOCIAL_MODEL_KEY' },
            },
            maxAttempts: 2,
            timeoutMs: 12_000,
            pricing: {
              inputTokenCostMicros: 3,
              outputTokenCostMicros: 7,
            },
          },
        },
        'smoke-25': {
          socialModelSynthesis: null,
        },
      },
    });

    await expect(
      loadLocalRuntimeTownProfileRuntimeConfig({
        profileId: 'default-100',
        path: '/runtime/config.json',
        env: { SOCIAL_MODEL_KEY: 'social-model-secret' },
        readTextFile: () => Promise.resolve(document),
      }),
    ).resolves.toEqual({
      socialModelSynthesis: {
        kind: 'traceable-llm-social-model-synthesizer',
        profileId: 'default-100',
        model: 'profile-social-model',
        provider: {
          kind: 'openai-compatible',
          providerId: 'profile-social-model-provider',
          endpoint: 'https://social-model-profile.example.test/v1/chat/completions',
          apiKey: 'social-model-secret',
        },
        maxAttempts: 2,
        timeoutMs: 12_000,
        pricing: {
          inputTokenCostMicros: 3,
          outputTokenCostMicros: 7,
        },
      },
    });

    await expect(
      loadLocalRuntimeTownProfileRuntimeConfig({
        profileId: 'headless-stress-1000',
        path: '/runtime/config.json',
        readTextFile: () => Promise.resolve(document),
      }),
    ).resolves.toMatchObject({
      socialModelSynthesis: {
        kind: 'traceable-llm-social-model-synthesizer',
        profileId: 'headless-stress-1000',
        model: 'global-social-model',
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

    await expect(
      loadLocalRuntimeTownProfileRuntimeConfig({
        profileId: 'default-100',
        path: '/runtime/config.json',
        readTextFile: () =>
          Promise.resolve(
            JSON.stringify({
              reactionPlanning: {
                kind: 'traceable-llm-daily-planner',
                model: 'reaction-model',
                provider: {
                  kind: 'openai-compatible',
                  providerId: 'reaction-provider',
                  endpoint: 'https://reaction.example.test/v1/chat/completions',
                },
              },
            }),
          ),
      }),
    ).rejects.toThrow('reactionPlanning.kind must be traceable-llm-reaction-evaluator');

    await expect(
      loadLocalRuntimeTownProfileRuntimeConfig({
        profileId: 'default-100',
        path: '/runtime/config.json',
        readTextFile: () =>
          Promise.resolve(
            JSON.stringify({
              reactionPlanning: {
                kind: 'traceable-llm-reaction-evaluator',
                model: 'reaction-model',
                provider: {
                  kind: 'scripted',
                  providerId: 'scripted-reaction-provider',
                },
              },
            }),
          ),
      }),
    ).rejects.toThrow('reactionPlanning.provider.kind must be openai-compatible');

    await expect(
      loadLocalRuntimeTownProfileRuntimeConfig({
        profileId: 'default-100',
        path: '/runtime/config.json',
        readTextFile: () =>
          Promise.resolve(
            JSON.stringify({
              globalSynthesis: {
                kind: 'traceable-llm-reaction-evaluator',
                model: 'global-model',
                provider: {
                  kind: 'openai-compatible',
                  providerId: 'global-provider',
                  endpoint: 'https://global.example.test/v1/chat/completions',
                },
              },
            }),
          ),
      }),
    ).rejects.toThrow('globalSynthesis.kind must be traceable-llm-global-synthesizer');

    await expect(
      loadLocalRuntimeTownProfileRuntimeConfig({
        profileId: 'default-100',
        path: '/runtime/config.json',
        readTextFile: () =>
          Promise.resolve(
            JSON.stringify({
              reactiveCorrection: {
                kind: 'traceable-llm-reactive-corrector',
                model: 'reactive-model',
                provider: {
                  kind: 'scripted',
                  providerId: 'scripted-reactive-provider',
                },
              },
            }),
          ),
      }),
    ).rejects.toThrow('reactiveCorrection.provider.kind must be openai-compatible');

    await expect(
      loadLocalRuntimeTownProfileRuntimeConfig({
        profileId: 'default-100',
        path: '/runtime/config.json',
        readTextFile: () =>
          Promise.resolve(
            JSON.stringify({
              socialDialogue: {
                kind: 'traceable-llm-global-synthesizer',
                model: 'social-dialogue-model',
                provider: {
                  kind: 'openai-compatible',
                  providerId: 'social-dialogue-provider',
                  endpoint: 'https://social-dialogue.example.test/v1/chat/completions',
                },
              },
            }),
          ),
      }),
    ).rejects.toThrow('socialDialogue.kind must be traceable-llm-social-dialogue-generator');

    await expect(
      loadLocalRuntimeTownProfileRuntimeConfig({
        profileId: 'default-100',
        path: '/runtime/config.json',
        readTextFile: () =>
          Promise.resolve(
            JSON.stringify({
              reflectionSynthesis: {
                kind: 'traceable-llm-global-synthesizer',
                model: 'reflection-model',
                provider: {
                  kind: 'openai-compatible',
                  providerId: 'reflection-provider',
                  endpoint: 'https://reflection.example.test/v1/chat/completions',
                },
              },
            }),
          ),
      }),
    ).rejects.toThrow(
      'reflectionSynthesis.kind must be traceable-llm-reflective-insight-synthesizer',
    );

    await expect(
      loadLocalRuntimeTownProfileRuntimeConfig({
        profileId: 'default-100',
        path: '/runtime/config.json',
        readTextFile: () =>
          Promise.resolve(
            JSON.stringify({
              socialModelSynthesis: {
                kind: 'traceable-llm-reflective-insight-synthesizer',
                model: 'social-model',
                provider: {
                  kind: 'openai-compatible',
                  providerId: 'social-model-provider',
                  endpoint: 'https://social-model.example.test/v1/chat/completions',
                },
              },
            }),
          ),
      }),
    ).rejects.toThrow('socialModelSynthesis.kind must be traceable-llm-social-model-synthesizer');

    await expect(
      loadLocalRuntimeTownProfileRuntimeConfig({
        profileId: 'default-100',
        path: '/runtime/config.json',
        readTextFile: () =>
          Promise.resolve(
            JSON.stringify({
              replanningPolicy: {
                consecutiveFailureThreshold: 0,
              },
            }),
          ),
      }),
    ).rejects.toThrow('replanningPolicy.consecutiveFailureThreshold must be a positive integer');
  });
});
