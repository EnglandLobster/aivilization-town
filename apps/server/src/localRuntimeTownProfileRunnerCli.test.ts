import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileRuntimeProfileRunReportRepository } from '@aivilization/observability';
import { afterEach, describe, expect, test } from 'vitest';
import type { LocalRuntimeTownProfileRunnerInput } from './localRuntimeTownProfileRunner';
import {
  parseLocalRuntimeTownProfileRunnerCliArgs,
  runLocalRuntimeTownProfileRunnerCli,
} from './localRuntimeTownProfileRunnerCli';

const tmpRoots: string[] = [];

afterEach(() => {
  while (tmpRoots.length > 0) {
    const root = tmpRoots.pop();
    if (root !== undefined) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

describe('local runtime town profile runner CLI', () => {
  test('parses profile runner arguments', () => {
    expect(
      parseLocalRuntimeTownProfileRunnerCliArgs([
        '--profile',
        'smoke-25',
        '--root-dir',
        '/tmp/town',
        '--cycles',
        '2',
        '--requested-at',
        '100',
        '--cycle-interval-ms',
        '50',
        '--report-root-dir',
        '/tmp/reports',
        '--runtime-config',
        '/runtime/profile-config.json',
        '--require-gate',
      ]),
    ).toEqual({
      profileId: 'smoke-25',
      rootDir: '/tmp/town',
      cycleCount: 2,
      requestedAt: 100,
      cycleIntervalMs: 50,
      reportRootDir: '/tmp/reports',
      runtimeConfigPath: '/runtime/profile-config.json',
      requireGate: true,
    });
  });

  test('parses recovery drill profile runner arguments', () => {
    expect(
      parseLocalRuntimeTownProfileRunnerCliArgs([
        '--profile',
        'recovery-drill-25',
        '--root-dir',
        '/tmp/town',
        '--cycles',
        '1',
        '--requested-at',
        '100',
      ]),
    ).toMatchObject({
      profileId: 'recovery-drill-25',
      rootDir: '/tmp/town',
      cycleCount: 1,
      requestedAt: 100,
    });
  });

  test('runs the injected profile runner and writes JSON to stdout', async () => {
    let output = '';
    const exitCode = await runLocalRuntimeTownProfileRunnerCli({
      argv: [
        '--profile',
        'smoke-25',
        '--root-dir',
        '/tmp/town',
        '--cycles',
        '1',
        '--requested-at',
        '100',
      ],
      stdout: {
        write: (chunk) => {
          output += chunk;
        },
      },
      runProfile: (input) =>
        Promise.resolve({
          profileId: input.profileId,
          manifestId: 'aivilization-smoke-25',
          rootDir: input.rootDir,
          requestedAt: input.requestedAt,
          daemonHealth: 'healthy',
          partitionCount: 1,
          totalProjectionAgentCount: 25,
          totalEventCount: 3,
          totalAgentTraceCount: 1,
          agentCycleDiagnostics: createCliAgentCycleDiagnostics(),
          run: {
            traceId: 'trace-1',
            outcome: 'succeeded',
            requestedCycleCount: input.cycleCount,
            completedCycleCount: input.cycleCount,
            stopReason: 'cycle-count-completed',
          },
          partitions: [],
        }),
    });

    expect(exitCode).toBe(0);
    expect(JSON.parse(output)).toMatchObject({
      profileId: 'smoke-25',
      manifestId: 'aivilization-smoke-25',
      totalProjectionAgentCount: 25,
      run: {
        traceId: 'trace-1',
        outcome: 'succeeded',
      },
    });
    expect(output.endsWith('\n')).toBe(true);
  });

  test('loads LLM planning config files and passes resolved provider config to the runner', async () => {
    let output = '';
    let receivedInput: LocalRuntimeTownProfileRunnerInput | undefined;
    const configRoot = createRootDir();
    const configPath = join(configRoot, 'profile-runtime-config.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        profiles: {
          'default-100': {
            llmPlanning: {
              kind: 'traceable-llm-strategic-planner',
              model: 'default-planner',
              provider: {
                kind: 'openai-compatible',
                providerId: 'default-provider',
                endpoint: 'https://llm.example.test/v1/chat/completions',
                apiKey: { env: 'AIVILIZATION_TEST_LLM_KEY' },
              },
            },
          },
        },
      }),
    );
    const previousKey = process.env.AIVILIZATION_TEST_LLM_KEY;
    process.env.AIVILIZATION_TEST_LLM_KEY = 'secret-key';

    try {
      const exitCode = await runLocalRuntimeTownProfileRunnerCli({
        argv: [
          '--profile',
          'default-100',
          '--root-dir',
          '/tmp/town',
          '--cycles',
          '1',
          '--requested-at',
          '100',
          '--llm-planning-config',
          configPath,
        ],
        stdout: {
          write: (chunk) => {
            output += chunk;
          },
        },
        runProfile: (input) => {
          receivedInput = input;
          return Promise.resolve({
            profileId: input.profileId,
            manifestId: 'aivilization-default-100',
            rootDir: input.rootDir,
            requestedAt: input.requestedAt,
            daemonHealth: 'healthy',
            partitionCount: 1,
            totalProjectionAgentCount: 100,
            totalEventCount: 3,
            totalAgentTraceCount: 1,
            agentCycleDiagnostics: createCliAgentCycleDiagnostics(),
            run: {
              traceId: 'trace-1',
              outcome: 'succeeded',
              requestedCycleCount: input.cycleCount,
              completedCycleCount: input.cycleCount,
              stopReason: 'cycle-count-completed',
            },
            partitions: [],
          });
        },
      });

      expect(exitCode).toBe(0);
      expect(JSON.parse(output)).toMatchObject({
        profileId: 'default-100',
      });
      expect(receivedInput?.llmPlanning).toEqual({
        kind: 'traceable-llm-strategic-planner',
        profileId: 'default-100',
        model: 'default-planner',
        provider: {
          kind: 'openai-compatible',
          providerId: 'default-provider',
          endpoint: 'https://llm.example.test/v1/chat/completions',
          apiKey: 'secret-key',
        },
      });
    } finally {
      if (previousKey === undefined) {
        delete process.env.AIVILIZATION_TEST_LLM_KEY;
      } else {
        process.env.AIVILIZATION_TEST_LLM_KEY = previousKey;
      }
    }
  });

  test('loads daily planning config files and passes resolved provider config to the runner', async () => {
    let output = '';
    let receivedInput: LocalRuntimeTownProfileRunnerInput | undefined;
    const configRoot = createRootDir();
    const configPath = join(configRoot, 'profile-runtime-config.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        profiles: {
          'default-100': {
            dailyPlanning: {
              kind: 'traceable-llm-daily-planner',
              model: 'default-daily-planner',
              provider: {
                kind: 'openai-compatible',
                providerId: 'default-daily-provider',
                endpoint: 'https://daily.example.test/v1/chat/completions',
                apiKey: { env: 'AIVILIZATION_TEST_DAILY_LLM_KEY' },
              },
            },
          },
        },
      }),
    );
    const previousKey = process.env.AIVILIZATION_TEST_DAILY_LLM_KEY;
    process.env.AIVILIZATION_TEST_DAILY_LLM_KEY = 'daily-secret-key';

    try {
      const exitCode = await runLocalRuntimeTownProfileRunnerCli({
        argv: [
          '--profile',
          'default-100',
          '--root-dir',
          '/tmp/town',
          '--cycles',
          '1',
          '--requested-at',
          '100',
          '--llm-planning-config',
          configPath,
        ],
        stdout: {
          write: (chunk) => {
            output += chunk;
          },
        },
        runProfile: (input) => {
          receivedInput = input;
          return Promise.resolve({
            profileId: input.profileId,
            manifestId: 'aivilization-default-100',
            rootDir: input.rootDir,
            requestedAt: input.requestedAt,
            daemonHealth: 'healthy',
            partitionCount: 1,
            totalProjectionAgentCount: 100,
            totalEventCount: 3,
            totalAgentTraceCount: 1,
            agentCycleDiagnostics: createCliAgentCycleDiagnostics(),
            run: {
              traceId: 'trace-1',
              outcome: 'succeeded',
              requestedCycleCount: input.cycleCount,
              completedCycleCount: input.cycleCount,
              stopReason: 'cycle-count-completed',
            },
            partitions: [],
          });
        },
      });

      expect(exitCode).toBe(0);
      expect(JSON.parse(output)).toMatchObject({
        profileId: 'default-100',
      });
      expect(receivedInput?.dailyPlanning).toEqual({
        kind: 'traceable-llm-daily-planner',
        profileId: 'default-100',
        model: 'default-daily-planner',
        provider: {
          kind: 'openai-compatible',
          providerId: 'default-daily-provider',
          endpoint: 'https://daily.example.test/v1/chat/completions',
          apiKey: 'daily-secret-key',
        },
      });
    } finally {
      if (previousKey === undefined) {
        delete process.env.AIVILIZATION_TEST_DAILY_LLM_KEY;
      } else {
        process.env.AIVILIZATION_TEST_DAILY_LLM_KEY = previousKey;
      }
    }
  });

  test('loads reaction planning config files and passes resolved provider config to the runner', async () => {
    let output = '';
    let receivedInput: LocalRuntimeTownProfileRunnerInput | undefined;
    const configRoot = createRootDir();
    const configPath = join(configRoot, 'profile-runtime-config.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        profiles: {
          'default-100': {
            reactionPlanning: {
              kind: 'traceable-llm-reaction-evaluator',
              model: 'default-reaction-evaluator',
              provider: {
                kind: 'openai-compatible',
                providerId: 'default-reaction-provider',
                endpoint: 'https://reaction.example.test/v1/chat/completions',
                apiKey: { env: 'AIVILIZATION_TEST_REACTION_LLM_KEY' },
              },
            },
          },
        },
      }),
    );
    const previousKey = process.env.AIVILIZATION_TEST_REACTION_LLM_KEY;
    process.env.AIVILIZATION_TEST_REACTION_LLM_KEY = 'reaction-secret-key';

    try {
      const exitCode = await runLocalRuntimeTownProfileRunnerCli({
        argv: [
          '--profile',
          'default-100',
          '--root-dir',
          '/tmp/town',
          '--cycles',
          '1',
          '--requested-at',
          '100',
          '--llm-planning-config',
          configPath,
        ],
        stdout: {
          write: (chunk) => {
            output += chunk;
          },
        },
        runProfile: (input) => {
          receivedInput = input;
          return Promise.resolve({
            profileId: input.profileId,
            manifestId: 'aivilization-default-100',
            rootDir: input.rootDir,
            requestedAt: input.requestedAt,
            daemonHealth: 'healthy',
            partitionCount: 1,
            totalProjectionAgentCount: 100,
            totalEventCount: 3,
            totalAgentTraceCount: 1,
            agentCycleDiagnostics: createCliAgentCycleDiagnostics(),
            run: {
              traceId: 'trace-1',
              outcome: 'succeeded',
              requestedCycleCount: input.cycleCount,
              completedCycleCount: input.cycleCount,
              stopReason: 'cycle-count-completed',
            },
            partitions: [],
          });
        },
      });

      expect(exitCode).toBe(0);
      expect(JSON.parse(output)).toMatchObject({
        profileId: 'default-100',
      });
      expect(receivedInput?.reactionPlanning).toEqual({
        kind: 'traceable-llm-reaction-evaluator',
        profileId: 'default-100',
        model: 'default-reaction-evaluator',
        provider: {
          kind: 'openai-compatible',
          providerId: 'default-reaction-provider',
          endpoint: 'https://reaction.example.test/v1/chat/completions',
          apiKey: 'reaction-secret-key',
        },
      });
    } finally {
      if (previousKey === undefined) {
        delete process.env.AIVILIZATION_TEST_REACTION_LLM_KEY;
      } else {
        process.env.AIVILIZATION_TEST_REACTION_LLM_KEY = previousKey;
      }
    }
  });

  test('loads agent-cycle LLM stage config files and passes resolved configs to the runner', async () => {
    let output = '';
    let receivedInput: LocalRuntimeTownProfileRunnerInput | undefined;
    const configRoot = createRootDir();
    const configPath = join(configRoot, 'profile-runtime-config.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        profiles: {
          'default-100': {
            subtaskPrioritization: {
              kind: 'traceable-llm-subtask-prioritizer',
              model: 'default-prioritizer',
              provider: {
                kind: 'openai-compatible',
                providerId: 'default-prioritizer-provider',
                endpoint: 'https://priority.example.test/v1/chat/completions',
              },
            },
            actionSequenceGeneration: {
              kind: 'traceable-llm-action-sequence-generator',
              model: 'default-action-sequence',
              provider: {
                kind: 'openai-compatible',
                providerId: 'default-action-provider',
                endpoint: 'https://action.example.test/v1/chat/completions',
              },
            },
            globalSynthesis: {
              kind: 'traceable-llm-global-synthesizer',
              model: 'default-global',
              provider: {
                kind: 'openai-compatible',
                providerId: 'default-global-provider',
                endpoint: 'https://global.example.test/v1/chat/completions',
              },
            },
            reactiveCorrection: {
              kind: 'traceable-llm-reactive-corrector',
              model: 'default-reactive',
              provider: {
                kind: 'openai-compatible',
                providerId: 'default-reactive-provider',
                endpoint: 'https://reactive.example.test/v1/chat/completions',
              },
            },
          },
        },
      }),
    );

    const exitCode = await runLocalRuntimeTownProfileRunnerCli({
      argv: [
        '--profile',
        'default-100',
        '--root-dir',
        '/tmp/town',
        '--cycles',
        '1',
        '--requested-at',
        '100',
        '--runtime-config',
        configPath,
      ],
      stdout: {
        write: (chunk) => {
          output += chunk;
        },
      },
      runProfile: (input) => {
        receivedInput = input;
        return Promise.resolve({
          profileId: input.profileId,
          manifestId: 'aivilization-default-100',
          rootDir: input.rootDir,
          requestedAt: input.requestedAt,
          daemonHealth: 'healthy',
          partitionCount: 1,
          totalProjectionAgentCount: 100,
          totalEventCount: 3,
          totalAgentTraceCount: 1,
          agentCycleDiagnostics: createCliAgentCycleDiagnostics(),
          run: {
            traceId: 'trace-1',
            outcome: 'succeeded',
            requestedCycleCount: input.cycleCount,
            completedCycleCount: input.cycleCount,
            stopReason: 'cycle-count-completed',
          },
          partitions: [],
        });
      },
    });

    expect(exitCode).toBe(0);
    expect(JSON.parse(output)).toMatchObject({
      profileId: 'default-100',
    });
    expect(receivedInput).toMatchObject({
      subtaskPrioritization: {
        kind: 'traceable-llm-subtask-prioritizer',
        profileId: 'default-100',
        model: 'default-prioritizer',
      },
      actionSequenceGeneration: {
        kind: 'traceable-llm-action-sequence-generator',
        profileId: 'default-100',
        model: 'default-action-sequence',
      },
      globalSynthesis: {
        kind: 'traceable-llm-global-synthesizer',
        profileId: 'default-100',
        model: 'default-global',
      },
      reactiveCorrection: {
        kind: 'traceable-llm-reactive-corrector',
        profileId: 'default-100',
        model: 'default-reactive',
      },
    });
  });

  test('loads replanning policy config files and passes resolved policy to the runner', async () => {
    let output = '';
    let receivedInput: LocalRuntimeTownProfileRunnerInput | undefined;
    const configRoot = createRootDir();
    const configPath = join(configRoot, 'profile-runtime-config.json');
    writeFileSync(
      configPath,
      JSON.stringify({
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
        },
      }),
    );

    const exitCode = await runLocalRuntimeTownProfileRunnerCli({
      argv: [
        '--profile',
        'default-100',
        '--root-dir',
        '/tmp/town',
        '--cycles',
        '1',
        '--requested-at',
        '100',
        '--runtime-config',
        configPath,
      ],
      stdout: {
        write: (chunk) => {
          output += chunk;
        },
      },
      runProfile: (input) => {
        receivedInput = input;
        return Promise.resolve({
          profileId: input.profileId,
          manifestId: 'aivilization-default-100',
          rootDir: input.rootDir,
          requestedAt: input.requestedAt,
          daemonHealth: 'healthy',
          partitionCount: 1,
          totalProjectionAgentCount: 100,
          totalEventCount: 3,
          totalAgentTraceCount: 1,
          agentCycleDiagnostics: createCliAgentCycleDiagnostics(),
          run: {
            traceId: 'trace-1',
            outcome: 'succeeded',
            requestedCycleCount: input.cycleCount,
            completedCycleCount: input.cycleCount,
            stopReason: 'cycle-count-completed',
          },
          partitions: [],
        });
      },
    });

    expect(exitCode).toBe(0);
    expect(JSON.parse(output)).toMatchObject({
      profileId: 'default-100',
    });
    expect(receivedInput?.replanningPolicy).toEqual({
      consecutiveFailureThreshold: 2,
      majorContextShift: {
        key: 'profile-recovery-drill',
        reason: 'profile recovery drill requires a replacement plan',
      },
    });
  });

  test('records profile run reports when report root is supplied', async () => {
    let output = '';
    const rootDir = createRootDir();
    const reportRootDir = createRootDir();

    const exitCode = await runLocalRuntimeTownProfileRunnerCli({
      argv: [
        '--profile',
        'smoke-25',
        '--root-dir',
        rootDir,
        '--cycles',
        '1',
        '--requested-at',
        '100',
        '--report-root-dir',
        reportRootDir,
        '--require-gate',
      ],
      stdout: {
        write: (chunk) => {
          output += chunk;
        },
      },
    });

    const reportRepository = new FileRuntimeProfileRunReportRepository({ rootDir: reportRootDir });

    expect(exitCode).toBe(0);
    expect(JSON.parse(output)).toMatchObject({
      profileId: 'smoke-25',
      run: {
        traceId: 'aivilization-smoke-25:profile-run:100',
      },
    });
    await expect(reportRepository.query({ profileId: 'smoke-25' })).resolves.toEqual([
      expect.objectContaining({
        runId: 'aivilization-smoke-25:profile-run:100',
        profileId: 'smoke-25',
        totalProjectionAgentCount: 25,
      }),
    ]);
  });

  test('returns a profile gate failure exit code when require gate is supplied', async () => {
    let output = '';
    let stderr = '';
    const exitCode = await runLocalRuntimeTownProfileRunnerCli({
      argv: [
        '--profile',
        'smoke-25',
        '--root-dir',
        '/tmp/town',
        '--cycles',
        '1',
        '--requested-at',
        '100',
        '--require-gate',
      ],
      stderr: {
        write: (chunk) => {
          stderr += chunk;
        },
      },
      stdout: {
        write: (chunk) => {
          output += chunk;
        },
      },
      runProfile: (input) =>
        Promise.resolve({
          profileId: input.profileId,
          manifestId: 'aivilization-smoke-25',
          rootDir: input.rootDir,
          requestedAt: input.requestedAt,
          daemonHealth: 'attention',
          partitionCount: 1,
          totalProjectionAgentCount: 25,
          totalEventCount: 1,
          totalAgentTraceCount: 0,
          agentCycleDiagnostics: createCliAgentCycleDiagnostics(0),
          run: {
            traceId: 'aivilization-smoke-25:profile-run:100',
            outcome: 'succeeded',
            requestedCycleCount: input.cycleCount,
            completedCycleCount: 0,
            stopReason: 'cycle-count-completed',
          },
          partitions: [
            {
              simulationId: 'aivilization-smoke-25',
              partitionKey: 'world-main',
              scenarioPresetId: 'aivilization-smoke-25-world-main',
              status: 'completed',
              health: 'healthy',
              lastAppliedSequence: 1,
              streamVersion: 1,
              eventCount: 1,
              projectionAgentCount: 25,
              agentTraceCount: 0,
            },
          ],
        }),
    });

    expect(exitCode).toBe(2);
    expect(JSON.parse(output)).toMatchObject({
      profileId: 'smoke-25',
      daemonHealth: 'attention',
    });
    expect(stderr).toContain('runtime profile run gate failed');
    expect(stderr).toContain('daemon-health-mismatch');
    expect(stderr).toContain('completed-cycle-count-too-low');
  });
});

function createRootDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'aivilization-profile-runner-cli-'));
  tmpRoots.push(root);
  return root;
}

function createCliAgentCycleDiagnostics(traceCount = 1) {
  return {
    traceCount,
    acceptedSimulatorCount: traceCount,
    repairedSimulatorCount: 0,
    rejectedSimulatorCount: 0,
    replanningDecisionCount: 0,
    simulatorEventTraceCount: traceCount,
    simulatorEventCount: traceCount,
    commandEmittingCycleCount: traceCount,
    fullReplanMaterializationCount: 0,
    commandEmittingCycleRatio: traceCount === 0 ? 0 : 1,
    fullReplanMaterializationRatio: 0,
    repairedSimulatorRatio: 0,
    rejectedSimulatorRatio: 0,
    replanningDecisionRatio: 0,
  };
}
