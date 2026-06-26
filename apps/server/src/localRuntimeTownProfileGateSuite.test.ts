import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  RuntimeProfileAgentCycleLlmStageDiagnostics,
  RuntimeProfileAgentCycleLlmStageName,
  RuntimeProfileCognitionLlmStageDiagnostics,
  RuntimeProfileCognitionLlmStageName,
} from '@aivilization/observability';
import { afterEach, describe, expect, test } from 'vitest';
import { createLocalRuntimeTownProfileGateCriteria } from './localRuntimeTownProfileGate';
import {
  localRuntimeTownProfileGateSuiteDefaultProfileIds,
  runLocalRuntimeTownProfileGateSuite,
} from './localRuntimeTownProfileGateSuite';
import type {
  LocalRuntimeTownProfileRunnerInput,
  LocalRuntimeTownProfileRunnerSummary,
} from './localRuntimeTownProfileRunner';
import { createLocalRuntimeTownDaemonScenarioProfile } from './localRuntimeTownScenarioProfile';

const tmpRoots: string[] = [];

afterEach(() => {
  while (tmpRoots.length > 0) {
    const root = tmpRoots.pop();
    if (root !== undefined) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

describe('local runtime town profile gate suite', () => {
  test('runs profile gates sequentially with deterministic profile roots and report wiring', async () => {
    const inputs: LocalRuntimeTownProfileRunnerInput[] = [];
    const reportRootDir = createRootDir();

    const result = await runLocalRuntimeTownProfileGateSuite({
      rootDir: '/tmp/aivilization-suite',
      reportRootDir,
      requestedAt: 100,
      reportGeneratedAt: 200,
      cycleCount: 2,
      cycleIntervalMs: 25,
      profileIds: ['smoke-25', 'default-100'],
      runProfile: (input) => {
        inputs.push(input);
        return Promise.resolve(createPassingSummary(input));
      },
    });

    expect(result).toMatchObject({
      status: 'pass',
      requestedAt: 100,
      profileCount: 2,
      passedProfileCount: 2,
      failedProfileCount: 0,
    });
    expect(result.profiles.map((profile) => profile.profileId)).toEqual([
      'smoke-25',
      'default-100',
    ]);
    expect(result.profiles.map((profile) => profile.gate.status)).toEqual(['pass', 'pass']);
    expect(result.profiles[0]?.report).toMatchObject({
      profileId: 'smoke-25',
      generatedAt: 200,
      completedCycleCount: 2,
    });
    expect(inputs.map((input) => input.profileId)).toEqual(['smoke-25', 'default-100']);
    expect(inputs.map((input) => input.rootDir)).toEqual([
      '/tmp/aivilization-suite/smoke-25',
      '/tmp/aivilization-suite/default-100',
    ]);
    expect(inputs.map((input) => input.cycleCount)).toEqual([2, 2]);
    expect(inputs.map((input) => input.cycleIntervalMs)).toEqual([25, 25]);
    expect(inputs.map((input) => input.reportGeneratedAt)).toEqual([200, 200]);
    expect(inputs.every((input) => input.profileRunReportRepository !== undefined)).toBe(true);
  });

  test('passes experiment validation schedule to each profile runner when requested', async () => {
    const inputs: LocalRuntimeTownProfileRunnerInput[] = [];
    const reportRootDir = createRootDir();

    const result = await runLocalRuntimeTownProfileGateSuite({
      rootDir: '/tmp/aivilization-suite',
      reportRootDir,
      requestedAt: 100,
      reportGeneratedAt: 200,
      cycleCount: 2,
      profileIds: ['smoke-25', 'default-100'],
      experimentValidation: true,
      runProfile: (input) => {
        inputs.push(input);
        return Promise.resolve(createPassingSummary(input));
      },
    });

    expect(result.status).toBe('pass');
    expect(inputs).toHaveLength(2);
    for (const input of inputs) {
      expect(input.experimentValidationSchedule).toMatchObject({
        plannerRunSource: {
          profileId: input.profileId,
        },
        reportGate: {
          criteriaId: `${input.profileId}:profile-gate-suite:experiment-validation-gate`,
          defaultAllowedStatuses: ['pass', 'watch'],
        },
      });
      expect(input.experimentValidationSchedule?.plannerRunSource?.repository).toBeDefined();
    }
  });

  test('writes a consolidated bundle manifest for report-backed validation suites', async () => {
    const reportRootDir = createRootDir();

    const result = await runLocalRuntimeTownProfileGateSuite({
      rootDir: '/tmp/aivilization-suite',
      reportRootDir,
      requestedAt: 100,
      reportGeneratedAt: 200,
      cycleCount: 2,
      profileIds: ['smoke-25'],
      experimentValidation: true,
      runProfile: (input) =>
        Promise.resolve({
          ...createPassingSummary(input),
          experimentValidationReports: [
            {
              simulationId: 'aivilization-smoke-25',
              partitionKey: 'world-main',
              runId: 'aivilization-smoke-25:profile-run:100:world-main:experiment-validation',
              generatedAt: 200,
              source: 'local-runtime-profile-validation',
              gateStatus: 'pass',
              gateFailureCount: 0,
              metricStatusCounts: { pass: 4, watch: 2, fail: 0 },
              metrics: [
                {
                  id: 'market-stability',
                  label: 'Market stability',
                  status: 'pass',
                  value: 0.001,
                  unit: 'log-price-range',
                  evidence: {
                    maximumLogPriceRange: 0.001,
                    observationCount: 288,
                    representativeCommodity: 'Fish',
                  },
                },
                {
                  id: 'wealth-stratification',
                  label: 'Wealth stratification',
                  status: 'watch',
                  value: 0.42,
                  unit: 'gini',
                  evidence: {
                    giniCoefficient: 0.42,
                    educationWealthRatio: 2.7,
                    sampleSize: 25,
                  },
                },
              ],
              streamVersion: 3,
              fromSequence: 0,
              toSequence: 3,
              eventCount: 3,
              projectionSequence: 3,
            },
          ],
        }),
    });

    expect(result.bundleManifest).toMatchObject({
      manifestId: 'profile-gate-suite:100',
      generatedAt: 200,
      requestedAt: 100,
      status: 'pass',
      profileCount: 1,
      passedProfileCount: 1,
      failedProfileCount: 0,
      artifactPaths: {
        bundleManifest: 'profile-gate-suite-100-bundle-manifest.json',
        runtimeProfileRuns: 'runtime-profile-runs.jsonl',
      },
      validationReportCount: 1,
      validationGateStatusCounts: {
        pass: 1,
        watch: 0,
        fail: 0,
        missing: 0,
      },
      profiles: [
        {
          profileId: 'smoke-25',
          profileRunId: 'aivilization-smoke-25:profile-run:100',
          runtimeProfileReportRunId: 'aivilization-smoke-25:profile-run:100',
          gateStatus: 'pass',
          gateFailureCount: 0,
          validationReportCount: 1,
          validationReports: [
            {
              runId: 'aivilization-smoke-25:profile-run:100:world-main:experiment-validation',
              simulationId: 'aivilization-smoke-25',
              partitionKey: 'world-main',
              gateStatus: 'pass',
              gateFailureCount: 0,
              artifactPaths: {
                experimentValidationReports: 'experiment-validation-reports.jsonl',
              },
              evidenceWindow: {
                streamVersion: 3,
                fromSequence: 0,
                toSequence: 3,
                eventCount: 3,
                projectionSequence: 3,
              },
              metricStatusCounts: { pass: 4, watch: 2, fail: 0 },
              metrics: [
                {
                  id: 'market-stability',
                  label: 'Market stability',
                  status: 'pass',
                  value: 0.001,
                  unit: 'log-price-range',
                  evidence: {
                    maximumLogPriceRange: 0.001,
                    observationCount: 288,
                    representativeCommodity: 'Fish',
                  },
                },
                {
                  id: 'wealth-stratification',
                  label: 'Wealth stratification',
                  status: 'watch',
                  value: 0.42,
                  unit: 'gini',
                  evidence: {
                    giniCoefficient: 0.42,
                    educationWealthRatio: 2.7,
                    sampleSize: 25,
                  },
                },
              ],
            },
          ],
        },
      ],
    });
    const manifestPath = join(reportRootDir, 'profile-gate-suite-100-bundle-manifest.json');
    expect(JSON.parse(readFileSync(manifestPath, 'utf8'))).toEqual(result.bundleManifest);
  });

  test('requires report root when experiment validation is requested', async () => {
    await expect(
      runLocalRuntimeTownProfileGateSuite({
        rootDir: '/tmp/aivilization-suite',
        requestedAt: 100,
        cycleCount: 1,
        profileIds: ['smoke-25'],
        experimentValidation: true,
        runProfile: () => {
          throw new Error('runner should not be called');
        },
      }),
    ).rejects.toThrow('--experiment-validation requires --report-root-dir');
  });

  test('returns a failing suite when an injected profile summary violates its gate', async () => {
    const result = await runLocalRuntimeTownProfileGateSuite({
      rootDir: '/tmp/aivilization-suite',
      requestedAt: 100,
      reportGeneratedAt: 200,
      cycleCount: 2,
      profileIds: ['smoke-25'],
      runProfile: (input) => {
        const summary = createPassingSummary(input);
        return Promise.resolve({
          ...summary,
          daemonHealth: 'attention',
          totalAgentTraceCount: 0,
          agentCycleDiagnostics: createAgentCycleDiagnostics(0),
          run: {
            ...summary.run,
            completedCycleCount: 0,
          },
          partitions: summary.partitions.map((partition) => ({
            ...partition,
            agentTraceCount: 0,
          })),
        });
      },
    });

    expect(result).toMatchObject({
      status: 'fail',
      profileCount: 1,
      passedProfileCount: 0,
      failedProfileCount: 1,
    });
    expect(result.profiles[0]?.gate.status).toBe('fail');
    expect(result.profiles[0]?.gate.failures.map((failure) => failure.code)).toEqual(
      expect.arrayContaining([
        'daemon-health-mismatch',
        'completed-cycle-count-too-low',
        'total-agent-trace-count-too-low',
      ]),
    );
  });

  test('forwards full replan materialization requirements into each profile gate', async () => {
    const result = await runLocalRuntimeTownProfileGateSuite({
      rootDir: '/tmp/aivilization-suite',
      requestedAt: 100,
      reportGeneratedAt: 200,
      cycleCount: 2,
      minimumFullReplanMaterializationCount: 1,
      profileIds: ['smoke-25'],
      runProfile: (input) => Promise.resolve(createPassingSummary(input)),
    });

    expect(result.status).toBe('fail');
    expect(result.profiles[0]?.gate.failures.map((failure) => failure.code)).toContain(
      'full-replan-materialization-count-too-low',
    );
  });

  test('forwards simulator rollout coverage overrides into each profile gate', async () => {
    const result = await runLocalRuntimeTownProfileGateSuite({
      rootDir: '/tmp/aivilization-suite',
      requestedAt: 100,
      reportGeneratedAt: 200,
      cycleCount: 2,
      minimumSimulatorRolloutCoverageRatio: 0.5,
      profileIds: ['smoke-25'],
      runProfile: (input) => {
        const summary = createPassingSummary(input);
        return Promise.resolve({
          ...summary,
          agentCycleDiagnostics: {
            ...summary.agentCycleDiagnostics,
            simulatorEventCount: 4,
            simulatorRolloutEventCount: 3,
            simulatorRolloutCoverageRatio: 0.75,
          },
        });
      },
    });

    expect(result.status).toBe('pass');
    expect(result.profiles[0]?.gate.status).toBe('pass');
  });

  test('loads runtime config per profile and forwards replanning policy into profile runners', async () => {
    const inputs: LocalRuntimeTownProfileRunnerInput[] = [];
    const rootDir = createRootDir();
    const configPath = join(rootDir, 'profile-runtime-config.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        profiles: {
          'smoke-25': {
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

    const result = await runLocalRuntimeTownProfileGateSuite({
      rootDir,
      runtimeConfigPath: configPath,
      requestedAt: 100,
      reportGeneratedAt: 200,
      cycleCount: 1,
      minimumFullReplanMaterializationCount: 1,
      profileIds: ['smoke-25'],
      runProfile: (input) => {
        inputs.push(input);
        return Promise.resolve(createPassingSummary(input, { fullReplanMaterializationCount: 1 }));
      },
    });

    expect(result.status).toBe('pass');
    expect(inputs[0]?.replanningPolicy).toEqual({
      consecutiveFailureThreshold: 2,
      majorContextShift: {
        key: 'profile-recovery-drill',
        reason: 'profile recovery drill requires a replacement plan',
      },
    });
    expect(inputs[0]?.preseedMarketPriceIndex).toBeUndefined();
    expect(result.profiles[0]?.gate.status).toBe('pass');
  });

  test('forwards runtime context hooks from config into profile runners', async () => {
    const inputs: LocalRuntimeTownProfileRunnerInput[] = [];
    const rootDir = createRootDir();
    const configPath = join(rootDir, 'profile-runtime-context-config.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        domainConfig: {
          social: {
            targetAgentId: 'smoke-25-world-main-agent-008',
            topic: 'town plans',
          },
        },
        memoryConsolidationSchedule: {
          agentIds: ['smoke-25-world-main-agent-001'],
          retrievalLimit: 10,
          minPatternCount: 1,
        },
        actionSynthesis: {
          maxActions: 2,
          candidateSubtasks: {
            maxSubtasks: 2,
          },
        },
        steeringSimulator: {
          kind: 'reject-action-id-prefix-until-suffix',
          commandType: 'AgentStartConversation',
          actionIdPrefix: 'scripted-social-check-in:',
          repairedActionIdSuffix: ':repaired',
          reason: 'scripted rejection drill',
        },
      }),
    );

    await runLocalRuntimeTownProfileGateSuite({
      rootDir,
      runtimeConfigPath: configPath,
      requestedAt: 100,
      reportGeneratedAt: 200,
      cycleCount: 1,
      profileIds: ['smoke-25'],
      runProfile: (input) => {
        inputs.push(input);
        return Promise.resolve(createPassingSummary(input));
      },
    });

    expect(inputs[0]?.domainConfig).toMatchObject({
      social: {
        targetAgentId: 'smoke-25-world-main-agent-008',
        topic: 'town plans',
      },
    });
    expect(inputs[0]?.memoryConsolidationSchedule).toMatchObject({
      agentIds: ['smoke-25-world-main-agent-001'],
      retrievalLimit: 10,
      minPatternCount: 1,
    });
    expect(inputs[0]?.actionSynthesis).toEqual({
      maxActions: 2,
      candidateSubtasks: {
        maxSubtasks: 2,
      },
    });
    expect(inputs[0]?.steeringSimulator).toBeDefined();
    const rejected = inputs[0]?.steeringSimulator?.({
      action: {
        id: 'scripted-social-check-in:smoke-25-world-main-agent-001',
        description: 'initial scripted check-in',
        commandType: 'AgentStartConversation',
        payload: {},
      },
      command: { id: 'command-1', summary: 'social command' },
    });
    expect(rejected).toMatchObject({
      status: 'rejected',
      reason: 'scripted rejection drill',
    });
  });

  test('preseeds market price index for LLM runtime configs', async () => {
    const inputs: LocalRuntimeTownProfileRunnerInput[] = [];
    const rootDir = createRootDir();
    const configPath = join(rootDir, 'llm-profile-runtime-config.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        subtaskPrioritization: createLlmStageNode({
          kind: 'traceable-llm-subtask-prioritizer',
          model: 'priority-model',
          providerId: 'priority-provider',
        }),
      }),
    );

    await runLocalRuntimeTownProfileGateSuite({
      rootDir,
      runtimeConfigPath: configPath,
      requestedAt: 100,
      cycleCount: 1,
      profileIds: ['smoke-25'],
      runProfile: (input) => {
        inputs.push(input);
        return Promise.resolve(createPassingSummary(input));
      },
    });

    expect(inputs[0]?.preseedMarketPriceIndex).toBe(true);
  });

  test('forwards every profile LLM cognition stage from runtime config into profile runners', async () => {
    const inputs: LocalRuntimeTownProfileRunnerInput[] = [];
    const rootDir = createRootDir();
    const configPath = join(rootDir, 'full-llm-profile-runtime-config.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        profiles: {
          'default-100': {
            llmPlanning: createLlmStageNode({
              kind: 'traceable-llm-strategic-planner',
              model: 'strategic-model',
              providerId: 'strategic-provider',
            }),
            dailyPlanning: createLlmStageNode({
              kind: 'traceable-llm-daily-planner',
              model: 'daily-model',
              providerId: 'daily-provider',
            }),
            reactionPlanning: createLlmStageNode({
              kind: 'traceable-llm-reaction-evaluator',
              model: 'reaction-model',
              providerId: 'reaction-provider',
            }),
            subtaskPrioritization: createLlmStageNode({
              kind: 'traceable-llm-subtask-prioritizer',
              model: 'priority-model',
              providerId: 'priority-provider',
            }),
            actionSequenceGeneration: createLlmStageNode({
              kind: 'traceable-llm-action-sequence-generator',
              model: 'action-model',
              providerId: 'action-provider',
            }),
            socialDialogue: createLlmStageNode({
              kind: 'traceable-llm-social-dialogue-generator',
              model: 'dialogue-model',
              providerId: 'dialogue-provider',
            }),
            globalSynthesis: createLlmStageNode({
              kind: 'traceable-llm-global-synthesizer',
              model: 'global-model',
              providerId: 'global-provider',
            }),
            reactiveCorrection: createLlmStageNode({
              kind: 'traceable-llm-reactive-corrector',
              model: 'reactive-model',
              providerId: 'reactive-provider',
            }),
            replanningDecision: createLlmStageNode({
              kind: 'traceable-llm-replanning-decider',
              model: 'replanning-model',
              providerId: 'replanning-provider',
            }),
            reflectionSynthesis: createLlmStageNode({
              kind: 'traceable-llm-reflective-insight-synthesizer',
              model: 'reflection-model',
              providerId: 'reflection-provider',
            }),
            socialModelSynthesis: createLlmStageNode({
              kind: 'traceable-llm-social-model-synthesizer',
              model: 'social-model',
              providerId: 'social-model-provider',
            }),
          },
        },
      }),
    );

    const result = await runLocalRuntimeTownProfileGateSuite({
      rootDir,
      runtimeConfigPath: configPath,
      requestedAt: 100,
      reportGeneratedAt: 200,
      cycleCount: 1,
      profileIds: ['default-100'],
      runProfile: (input) => {
        inputs.push(input);
        return Promise.resolve(
          createPassingSummary(input, {
            llmStageDiagnostics: createAcceptedAgentCycleLlmStageDiagnostics([
              'contextualPrioritization',
              'actionSequenceGeneration',
              'socialDialogueGeneration',
              'globalSynthesis',
              'reactiveCorrection',
              'replanningDecision',
            ]),
            cognitionLlmStageDiagnostics: createAcceptedCognitionLlmStageDiagnostics([
              'strategicPlanning',
              'dailyPlanning',
              'reactionEvaluation',
              'reflectionSynthesis',
              'socialModelSynthesis',
            ]),
          }),
        );
      },
    });

    expect(result.status).toBe('pass');
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toMatchObject({
      llmPlanning: {
        kind: 'traceable-llm-strategic-planner',
        model: 'strategic-model',
        provider: { providerId: 'strategic-provider' },
      },
      dailyPlanning: {
        kind: 'traceable-llm-daily-planner',
        model: 'daily-model',
        provider: { providerId: 'daily-provider' },
      },
      reactionPlanning: {
        kind: 'traceable-llm-reaction-evaluator',
        model: 'reaction-model',
        provider: { providerId: 'reaction-provider' },
      },
      subtaskPrioritization: {
        kind: 'traceable-llm-subtask-prioritizer',
        model: 'priority-model',
        provider: { providerId: 'priority-provider' },
      },
      actionSequenceGeneration: {
        kind: 'traceable-llm-action-sequence-generator',
        model: 'action-model',
        provider: { providerId: 'action-provider' },
      },
      socialDialogue: {
        kind: 'traceable-llm-social-dialogue-generator',
        model: 'dialogue-model',
        provider: { providerId: 'dialogue-provider' },
      },
      globalSynthesis: {
        kind: 'traceable-llm-global-synthesizer',
        model: 'global-model',
        provider: { providerId: 'global-provider' },
      },
      reactiveCorrection: {
        kind: 'traceable-llm-reactive-corrector',
        model: 'reactive-model',
        provider: { providerId: 'reactive-provider' },
      },
      replanningDecision: {
        kind: 'traceable-llm-replanning-decider',
        model: 'replanning-model',
        provider: { providerId: 'replanning-provider' },
      },
      reflectionSynthesis: {
        kind: 'traceable-llm-reflective-insight-synthesizer',
        model: 'reflection-model',
        provider: { providerId: 'reflection-provider' },
      },
      socialModelSynthesis: {
        kind: 'traceable-llm-social-model-synthesizer',
        model: 'social-model',
        provider: { providerId: 'social-model-provider' },
      },
    });
  });

  test('writes paper-alignment coverage for full LLM runtime config into bundle manifests', async () => {
    const rootDir = createRootDir();
    const reportRootDir = createRootDir();
    const configPath = join(rootDir, 'full-llm-profile-runtime-config.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        profiles: {
          'default-100': {
            llmPlanning: createLlmStageNode({
              kind: 'traceable-llm-strategic-planner',
              model: 'strategic-model',
              providerId: 'strategic-provider',
            }),
            dailyPlanning: createLlmStageNode({
              kind: 'traceable-llm-daily-planner',
              model: 'daily-model',
              providerId: 'daily-provider',
            }),
            reactionPlanning: createLlmStageNode({
              kind: 'traceable-llm-reaction-evaluator',
              model: 'reaction-model',
              providerId: 'reaction-provider',
            }),
            subtaskPrioritization: createLlmStageNode({
              kind: 'traceable-llm-subtask-prioritizer',
              model: 'priority-model',
              providerId: 'priority-provider',
            }),
            actionSequenceGeneration: createLlmStageNode({
              kind: 'traceable-llm-action-sequence-generator',
              model: 'action-model',
              providerId: 'action-provider',
            }),
            socialDialogue: createLlmStageNode({
              kind: 'traceable-llm-social-dialogue-generator',
              model: 'dialogue-model',
              providerId: 'dialogue-provider',
            }),
            globalSynthesis: createLlmStageNode({
              kind: 'traceable-llm-global-synthesizer',
              model: 'global-model',
              providerId: 'global-provider',
            }),
            reactiveCorrection: createLlmStageNode({
              kind: 'traceable-llm-reactive-corrector',
              model: 'reactive-model',
              providerId: 'reactive-provider',
            }),
            replanningDecision: createLlmStageNode({
              kind: 'traceable-llm-replanning-decider',
              model: 'replanning-model',
              providerId: 'replanning-provider',
            }),
            reflectionSynthesis: createLlmStageNode({
              kind: 'traceable-llm-reflective-insight-synthesizer',
              model: 'reflection-model',
              providerId: 'reflection-provider',
            }),
            socialModelSynthesis: createLlmStageNode({
              kind: 'traceable-llm-social-model-synthesizer',
              model: 'social-model',
              providerId: 'social-model-provider',
            }),
          },
        },
      }),
    );

    const result = await runLocalRuntimeTownProfileGateSuite({
      rootDir,
      reportRootDir,
      runtimeConfigPath: configPath,
      requestedAt: 100,
      reportGeneratedAt: 200,
      cycleCount: 1,
      profileIds: ['default-100'],
      minimumLocalRepairAcceptedCount: 1,
      runProfile: (input) =>
        Promise.resolve(
          createPassingSummary(input, {
            localRepairAcceptedCount: 1,
            llmStageDiagnostics: createAcceptedAgentCycleLlmStageDiagnostics([
              'contextualPrioritization',
              'actionSequenceGeneration',
              'socialDialogueGeneration',
              'globalSynthesis',
              'reactiveCorrection',
              'replanningDecision',
            ]),
            cognitionLlmStageDiagnostics: createAcceptedCognitionLlmStageDiagnostics([
              'strategicPlanning',
              'dailyPlanning',
              'reactionEvaluation',
              'reflectionSynthesis',
              'socialModelSynthesis',
            ]),
          }),
        ),
    });

    expect(result.status).toBe('pass');
    expect(result.bundleManifest?.paperAlignment).toEqual({
      schemaVersion: 1,
      capabilityCount: 12,
      configuredCapabilityCount: 12,
      passedConfiguredCapabilityCount: 12,
      failedConfiguredCapabilityCount: 0,
      unconfiguredCapabilityCount: 0,
    });
    const profileCoverage = result.bundleManifest?.profiles[0]?.paperAlignment;
    expect(profileCoverage).toMatchObject({
      schemaVersion: 1,
      stageCount: 12,
      configuredStageCount: 12,
      passedConfiguredStageCount: 12,
      failedConfiguredStageCount: 0,
      unconfiguredStageCount: 0,
    });
    expect(profileCoverage?.stages.map((stage) => stage.paperCapabilityId).sort()).toEqual([
      'action-sequence-generation',
      'contextual-prioritization',
      'daily-planning',
      'global-synthesis',
      'local-repair',
      'memory-guided-replanning',
      'reaction-evaluation',
      'reactive-correction',
      'reflection-synthesis',
      'social-dialogue-generation',
      'social-model-synthesis',
      'strategic-branch-planning',
    ]);
    expect(profileCoverage?.stages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          paperCapabilityId: 'contextual-prioritization',
          paperSection: '2.1.1 Branch-Thinking Planner',
          stageFamily: 'agent-cycle',
          stageName: 'contextualPrioritization',
          runtimeConfigured: true,
          gateStatus: 'pass',
          requirements: {
            acceptedTrace: true,
            evidenceBackedTrace: false,
            noFallback: true,
            noDeterministic: true,
            observedState: true,
            worldDecisionContext: true,
            economicContext: true,
            rulesContext: true,
            shortTermMemoryContext: true,
            longTermProfileContext: true,
            outputArtifactCount: 0,
            localRepairAcceptedCount: 0,
          },
        }),
        expect.objectContaining({
          paperCapabilityId: 'reactive-correction',
          paperSection: '2.1.2 Action Simulator And Tiered Replanning',
          stageFamily: 'agent-cycle',
          stageName: 'reactiveCorrection',
          runtimeConfigured: true,
          gateStatus: 'pass',
          requirements: {
            acceptedTrace: true,
            evidenceBackedTrace: true,
            noFallback: true,
            noDeterministic: true,
            observedState: true,
            worldDecisionContext: true,
            economicContext: true,
            rulesContext: true,
            shortTermMemoryContext: true,
            longTermProfileContext: true,
            outputArtifactCount: 0,
            localRepairAcceptedCount: 0,
          },
        }),
        expect.objectContaining({
          paperCapabilityId: 'local-repair',
          paperSection: '2.1.2 Action Simulator And Tiered Replanning',
          stageFamily: 'agent-cycle',
          stageName: 'localRepair',
          runtimeConfigured: true,
          gateStatus: 'pass',
          requirements: {
            acceptedTrace: false,
            evidenceBackedTrace: false,
            noFallback: false,
            noDeterministic: false,
            observedState: false,
            worldDecisionContext: false,
            economicContext: false,
            rulesContext: false,
            shortTermMemoryContext: false,
            longTermProfileContext: false,
            outputArtifactCount: 0,
            localRepairAcceptedCount: 1,
          },
        }),
        expect.objectContaining({
          paperCapabilityId: 'reflection-synthesis',
          paperSection: '2.2 Adaptive Agent Profile',
          stageFamily: 'cognition',
          stageName: 'reflectionSynthesis',
          runtimeConfigured: true,
          gateStatus: 'pass',
          requirements: {
            acceptedTrace: true,
            evidenceBackedTrace: false,
            noFallback: true,
            noDeterministic: true,
            observedState: true,
            worldDecisionContext: true,
            economicContext: true,
            rulesContext: true,
            shortTermMemoryContext: true,
            longTermProfileContext: true,
            outputArtifactCount: 1,
            localRepairAcceptedCount: 0,
          },
        }),
      ]),
    );
    expect(
      JSON.parse(
        readFileSync(join(reportRootDir, 'profile-gate-suite-100-bundle-manifest.json'), 'utf8'),
      ),
    ).toMatchObject({
      paperAlignment: result.bundleManifest?.paperAlignment,
    });
  });

  test('passes paper-alignment coverage from the full scripted LLM runtime config through real suite execution', async () => {
    const rootDir = createRootDir();
    const reportRootDir = createRootDir();
    const configPath = fileURLToPath(
      new URL('../examples/full-scripted-llm-runtime-config.json', import.meta.url),
    );

    const result = await runLocalRuntimeTownProfileGateSuite({
      rootDir,
      reportRootDir,
      runtimeConfigPath: configPath,
      requestedAt: 175,
      reportGeneratedAt: 225,
      cycleCount: 1,
      profileIds: ['smoke-25'],
    });

    expect(result.profiles[0]?.gate.failures).toEqual([]);
    expect(result.status).toBe('pass');
    expect(result.bundleManifest?.paperAlignment).toMatchObject({
      schemaVersion: 1,
      capabilityCount: 12,
      configuredCapabilityCount: 12,
      passedConfiguredCapabilityCount: 12,
      failedConfiguredCapabilityCount: 0,
      unconfiguredCapabilityCount: 0,
    });
    expect(
      result.profiles[0]?.summary.agentCycleDiagnostics.localRepairAcceptedCount,
    ).toBeGreaterThan(0);
  });

  test('passes all paper-alignment capabilities from the full scripted LLM runtime config through real suite execution', async () => {
    const rootDir = createRootDir();
    const reportRootDir = createRootDir();
    const configPath = fileURLToPath(
      new URL('../examples/full-scripted-llm-runtime-config.json', import.meta.url),
    );

    const result = await runLocalRuntimeTownProfileGateSuite({
      rootDir,
      reportRootDir,
      runtimeConfigPath: configPath,
      requestedAt: 275,
      reportGeneratedAt: 325,
      cycleCount: 1,
      profileIds: ['smoke-25'],
      minimumLocalRepairAcceptedCount: 1,
    });

    expect(result.profiles[0]?.gate.failures).toEqual([]);
    expect(result.status).toBe('pass');
    expect(result.bundleManifest?.paperAlignment).toMatchObject({
      schemaVersion: 1,
      capabilityCount: 12,
      configuredCapabilityCount: 12,
      passedConfiguredCapabilityCount: 12,
      failedConfiguredCapabilityCount: 0,
      unconfiguredCapabilityCount: 0,
    });
    expect(
      result.profiles[0]?.summary.agentCycleDiagnostics.localRepairAcceptedCount,
    ).toBeGreaterThan(0);
  });

  test('requires accepted agent-cycle LLM traces for stages enabled by runtime config', async () => {
    const rootDir = createRootDir();
    const configPath = join(rootDir, 'agent-cycle-llm-profile-runtime-config.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        profiles: {
          'smoke-25': {
            subtaskPrioritization: createLlmStageNode({
              kind: 'traceable-llm-subtask-prioritizer',
              model: 'priority-model',
              providerId: 'priority-provider',
            }),
            globalSynthesis: createLlmStageNode({
              kind: 'traceable-llm-global-synthesizer',
              model: 'global-model',
              providerId: 'global-provider',
            }),
            replanningDecision: createLlmStageNode({
              kind: 'traceable-llm-replanning-decider',
              model: 'replanning-model',
              providerId: 'replanning-provider',
            }),
          },
        },
      }),
    );

    const result = await runLocalRuntimeTownProfileGateSuite({
      rootDir,
      runtimeConfigPath: configPath,
      requestedAt: 100,
      reportGeneratedAt: 200,
      cycleCount: 1,
      profileIds: ['smoke-25'],
      runProfile: (input) => Promise.resolve(createPassingSummary(input)),
    });

    expect(result.status).toBe('fail');
    expect(result.profiles[0]?.gate.failures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'agent-cycle-llm-stage-accepted-count-too-low',
          evidence: {
            stageName: 'contextualPrioritization',
            actual: 0,
            minimum: 1,
          },
        }),
        expect.objectContaining({
          code: 'agent-cycle-llm-stage-accepted-count-too-low',
          evidence: {
            stageName: 'globalSynthesis',
            actual: 0,
            minimum: 1,
          },
        }),
        expect.objectContaining({
          code: 'agent-cycle-llm-stage-accepted-count-too-low',
          evidence: {
            stageName: 'replanningDecision',
            actual: 0,
            minimum: 1,
          },
        }),
      ]),
    );
  });

  test('requires agent-cycle LLM world context coverage for stages enabled by runtime config', async () => {
    const rootDir = createRootDir();
    const configPath = join(rootDir, 'agent-cycle-llm-world-context-profile-runtime-config.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        profiles: {
          'smoke-25': {
            subtaskPrioritization: createLlmStageNode({
              kind: 'traceable-llm-subtask-prioritizer',
              model: 'priority-model',
              providerId: 'priority-provider',
            }),
            globalSynthesis: createLlmStageNode({
              kind: 'traceable-llm-global-synthesizer',
              model: 'global-model',
              providerId: 'global-provider',
            }),
            replanningDecision: createLlmStageNode({
              kind: 'traceable-llm-replanning-decider',
              model: 'replanning-model',
              providerId: 'replanning-provider',
            }),
          },
        },
      }),
    );

    const result = await runLocalRuntimeTownProfileGateSuite({
      rootDir,
      runtimeConfigPath: configPath,
      requestedAt: 100,
      reportGeneratedAt: 200,
      cycleCount: 1,
      profileIds: ['smoke-25'],
      runProfile: (input) =>
        Promise.resolve(
          createPassingSummary(input, {
            llmStageDiagnostics: [
              {
                stageName: 'contextualPrioritization',
                traceCount: 1,
                llmAcceptedCount: 1,
                deterministicFallbackCount: 0,
                deterministicCount: 0,
                missingCycleCount: 0,
                shortTermMemoryContextCount: 1,
                longTermProfileContextCount: 1,
                worldDecisionContextCount: 1,
                completeWorldDecisionContextCount: 1,
                economicContextCount: 1,
                completeEconomicContextCount: 1,
                rulesContextCount: 1,
                completeRulesContextCount: 1,
              },
              {
                stageName: 'globalSynthesis',
                traceCount: 1,
                llmAcceptedCount: 1,
                deterministicFallbackCount: 0,
                deterministicCount: 0,
                missingCycleCount: 0,
                shortTermMemoryContextCount: 1,
                longTermProfileContextCount: 1,
                worldDecisionContextCount: 0,
                completeWorldDecisionContextCount: 0,
                rulesContextCount: 0,
                completeRulesContextCount: 0,
              },
              {
                stageName: 'replanningDecision',
                traceCount: 1,
                llmAcceptedCount: 1,
                deterministicFallbackCount: 0,
                deterministicCount: 0,
                missingCycleCount: 0,
                shortTermMemoryContextCount: 1,
                longTermProfileContextCount: 1,
                worldDecisionContextCount: 0,
                completeWorldDecisionContextCount: 0,
                rulesContextCount: 0,
                completeRulesContextCount: 0,
              },
            ],
          }),
        ),
    });

    expect(result.status).toBe('fail');
    expect(result.profiles[0]?.gate.failures).toContainEqual(
      expect.objectContaining({
        code: 'agent-cycle-llm-stage-complete-world-context-count-too-low',
        evidence: {
          stageName: 'globalSynthesis',
          actual: 0,
          worldDecisionContextCount: 0,
          llmAcceptedCount: 1,
          minimum: 1,
        },
      }),
    );
    expect(result.profiles[0]?.gate.failures).toContainEqual(
      expect.objectContaining({
        code: 'agent-cycle-llm-stage-complete-world-context-count-too-low',
        evidence: {
          stageName: 'replanningDecision',
          actual: 0,
          worldDecisionContextCount: 0,
          llmAcceptedCount: 1,
          minimum: 1,
        },
      }),
    );
  });

  test('requires accepted cognition LLM traces for stages enabled by runtime config', async () => {
    const rootDir = createRootDir();
    const configPath = join(rootDir, 'cognition-llm-profile-runtime-config.json');
    writeFileSync(
      configPath,
      JSON.stringify({
        profiles: {
          'smoke-25': {
            llmPlanning: createLlmStageNode({
              kind: 'traceable-llm-strategic-planner',
              model: 'strategic-model',
              providerId: 'strategic-provider',
            }),
          },
        },
      }),
    );

    const result = await runLocalRuntimeTownProfileGateSuite({
      rootDir,
      runtimeConfigPath: configPath,
      requestedAt: 100,
      reportGeneratedAt: 200,
      cycleCount: 1,
      profileIds: ['smoke-25'],
      runProfile: (input) => Promise.resolve(createPassingSummary(input)),
    });

    expect(result.status).toBe('fail');
    expect(result.profiles[0]?.gate.failures).toContainEqual({
      code: 'cognition-llm-stage-accepted-count-too-low',
      message: 'cognition LLM stage strategicPlanning llmAcceptedCount must be at least 1',
      evidence: {
        stageName: 'strategicPlanning',
        actual: 0,
        minimum: 1,
      },
    });
  });

  test('includes the recovery drill profile in default suite runs', async () => {
    const inputs: LocalRuntimeTownProfileRunnerInput[] = [];

    const result = await runLocalRuntimeTownProfileGateSuite({
      rootDir: '/tmp/aivilization-suite',
      requestedAt: 100,
      reportGeneratedAt: 200,
      cycleCount: 1,
      runProfile: (input) => {
        inputs.push(input);
        return Promise.resolve(
          createPassingSummary(input, {
            fullReplanMaterializationCount: input.profileId === 'recovery-drill-25' ? 1 : 0,
          }),
        );
      },
    });

    expect(inputs.map((input) => input.profileId)).toEqual([
      'smoke-25',
      'default-100',
      'headless-stress-1000',
      'recovery-drill-25',
    ]);
    expect(result.status).toBe('pass');
    expect(result.profiles.map((profile) => profile.profileId)).toEqual([
      'smoke-25',
      'default-100',
      'headless-stress-1000',
      'recovery-drill-25',
    ]);
  });

  test('defaults to the canonical profile gate order', () => {
    expect(localRuntimeTownProfileGateSuiteDefaultProfileIds).toEqual([
      'smoke-25',
      'default-100',
      'headless-stress-1000',
      'recovery-drill-25',
    ]);
  });
});

function createPassingSummary(
  input: LocalRuntimeTownProfileRunnerInput,
  options: {
    readonly fullReplanMaterializationCount?: number;
    readonly localRepairAcceptedCount?: number;
    readonly llmStageDiagnostics?: ReturnType<typeof createAcceptedAgentCycleLlmStageDiagnostics>;
    readonly cognitionLlmStageDiagnostics?: ReturnType<
      typeof createAcceptedCognitionLlmStageDiagnostics
    >;
  } = {},
): LocalRuntimeTownProfileRunnerSummary {
  const profile = createLocalRuntimeTownDaemonScenarioProfile(input.profileId);
  const criteria = createLocalRuntimeTownProfileGateCriteria(input.profileId, {
    minimumCompletedCycleCount: input.cycleCount,
  });
  const partitions = profile.manifest.partitions.map((partition) => {
    const projectionAgentCount =
      criteria.expectedProjectionAgentCountByPartition[partition.partitionKey];
    if (projectionAgentCount === undefined) {
      throw new Error(`missing expected agent count for ${partition.partitionKey}`);
    }

    return {
      simulationId: partition.simulationId,
      partitionKey: partition.partitionKey,
      scenarioPresetId: partition.scenarioPresetId,
      status: 'completed',
      health: 'healthy',
      lastAppliedSequence: 3,
      streamVersion: 3,
      eventCount: 3,
      projectionAgentCount,
      agentTraceCount: 1,
    };
  });

  const totalAgentTraceCount = partitions.reduce(
    (total, partition) => total + partition.agentTraceCount,
    0,
  );

  return {
    profileId: input.profileId,
    manifestId: profile.manifest.id,
    rootDir: input.rootDir,
    requestedAt: input.requestedAt,
    daemonHealth: 'healthy',
    partitionCount: partitions.length,
    totalProjectionAgentCount: partitions.reduce(
      (total, partition) => total + partition.projectionAgentCount,
      0,
    ),
    totalEventCount: partitions.reduce((total, partition) => total + partition.eventCount, 0),
    totalAgentTraceCount,
    agentCycleDiagnostics: createAgentCycleDiagnostics(totalAgentTraceCount, {
      fullReplanMaterializationCount: options.fullReplanMaterializationCount ?? 0,
      localRepairAcceptedCount: options.localRepairAcceptedCount ?? 0,
      ...(options.llmStageDiagnostics === undefined
        ? {}
        : { llmStageDiagnostics: options.llmStageDiagnostics }),
    }),
    ...(options.cognitionLlmStageDiagnostics === undefined
      ? {}
      : { cognitionLlmStageDiagnostics: options.cognitionLlmStageDiagnostics }),
    run: {
      traceId: `${profile.manifest.id}:profile-run:${input.requestedAt}`,
      outcome: 'succeeded',
      requestedCycleCount: input.cycleCount,
      completedCycleCount: input.cycleCount,
      stopReason: 'cycle-count-completed',
    },
    partitions,
  };
}

function createAgentCycleDiagnostics(
  traceCount: number,
  options: {
    readonly fullReplanMaterializationCount?: number;
    readonly localRepairAcceptedCount?: number;
    readonly llmStageDiagnostics?: ReturnType<typeof createAcceptedAgentCycleLlmStageDiagnostics>;
  } = {},
) {
  const fullReplanMaterializationCount = options.fullReplanMaterializationCount ?? 0;
  const localRepairAcceptedCount = options.localRepairAcceptedCount ?? 0;
  return {
    traceCount,
    acceptedSimulatorCount: traceCount,
    repairedSimulatorCount: 0,
    rejectedSimulatorCount: 0,
    localRepairAttemptCount: localRepairAcceptedCount,
    localRepairAcceptedCount,
    localRepairRejectedCount: 0,
    localRepairSkippedCount: 0,
    replanningDecisionCount: 0,
    simulatorEventTraceCount: traceCount,
    simulatorEventCount: traceCount,
    simulatorRolloutEventCount: traceCount,
    commandEmittingCycleCount: traceCount,
    fullReplanMaterializationCount,
    commandEmittingCycleRatio: traceCount === 0 ? 0 : 1,
    fullReplanMaterializationRatio:
      traceCount === 0 ? 0 : fullReplanMaterializationCount / traceCount,
    repairedSimulatorRatio: 0,
    localRepairAcceptedRatio: localRepairAcceptedCount === 0 ? 0 : 1,
    rejectedSimulatorRatio: 0,
    replanningDecisionRatio: 0,
    simulatorRolloutCoverageRatio: traceCount === 0 ? 0 : 1,
    ...(options.llmStageDiagnostics === undefined
      ? {}
      : { llmStageDiagnostics: options.llmStageDiagnostics }),
  };
}

function createAcceptedAgentCycleLlmStageDiagnostics(
  stageNames: readonly RuntimeProfileAgentCycleLlmStageName[],
): readonly RuntimeProfileAgentCycleLlmStageDiagnostics[] {
  return stageNames.map((stageName) => ({
    stageName,
    traceCount: 1,
    llmAcceptedCount: 1,
    deterministicFallbackCount: 0,
    deterministicCount: 0,
    missingCycleCount: 0,
    evidenceBackedAcceptedCount: stageName === 'reactiveCorrection' ? 1 : 0,
    shortTermMemoryContextCount: 1,
    longTermProfileContextCount: 1,
    observedStateSummaryCount: 1,
    worldDecisionContextCount: 1,
    completeWorldDecisionContextCount: 1,
    economicContextCount: 1,
    completeEconomicContextCount: 1,
    rulesContextCount: 1,
    completeRulesContextCount: 1,
  }));
}

function createAcceptedCognitionLlmStageDiagnostics(
  stageNames: readonly RuntimeProfileCognitionLlmStageName[],
): readonly RuntimeProfileCognitionLlmStageDiagnostics[] {
  return stageNames.map((stageName) => ({
    stageName,
    traceCount: 1,
    llmAcceptedCount: 1,
    deterministicFallbackCount: 0,
    deterministicCount: 0,
    missingProviderTraceCount: 0,
    outputArtifactCount:
      stageName === 'reflectionSynthesis' || stageName === 'socialModelSynthesis' ? 1 : 0,
    shortTermMemoryContextCount: 1,
    longTermProfileContextCount: 1,
    observedStateSummaryCount: 1,
    worldDecisionContextCount: 1,
    completeWorldDecisionContextCount: 1,
    economicContextCount: 1,
    completeEconomicContextCount: 1,
    rulesContextCount: 1,
    completeRulesContextCount: 1,
  }));
}

function createRootDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'aivilization-profile-gate-suite-'));
  tmpRoots.push(root);
  return root;
}

function createLlmStageNode(input: {
  readonly kind: string;
  readonly model: string;
  readonly providerId: string;
}) {
  return {
    kind: input.kind,
    model: input.model,
    provider: {
      kind: 'openai-compatible',
      providerId: input.providerId,
      endpoint: `https://${input.providerId}.example.test/v1/chat/completions`,
    },
  };
}
