import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
    expect(result.profiles[0]?.gate.status).toBe('pass');
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
      ]),
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
    readonly llmStageDiagnostics?: ReturnType<typeof createAcceptedAgentCycleLlmStageDiagnostics>;
  } = {},
) {
  const fullReplanMaterializationCount = options.fullReplanMaterializationCount ?? 0;
  return {
    traceCount,
    acceptedSimulatorCount: traceCount,
    repairedSimulatorCount: 0,
    rejectedSimulatorCount: 0,
    replanningDecisionCount: 0,
    simulatorEventTraceCount: traceCount,
    simulatorEventCount: traceCount,
    commandEmittingCycleCount: traceCount,
    fullReplanMaterializationCount,
    commandEmittingCycleRatio: traceCount === 0 ? 0 : 1,
    fullReplanMaterializationRatio:
      traceCount === 0 ? 0 : fullReplanMaterializationCount / traceCount,
    repairedSimulatorRatio: 0,
    rejectedSimulatorRatio: 0,
    replanningDecisionRatio: 0,
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
