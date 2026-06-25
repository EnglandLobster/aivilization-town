import { describe, expect, test } from 'vitest';
import {
  createRuntimeProfileRunReport,
  evaluateRuntimeProfileRunReport,
  type RuntimeProfileRunGateCriteria,
  type RuntimeProfileRunReport,
} from './index';

describe('runtime profile run gate', () => {
  test('passes a healthy agent-driven profile run report', () => {
    const result = evaluateRuntimeProfileRunReport(createReport(), createCriteria());

    expect(result).toEqual({
      status: 'pass',
      criteriaId: 'smoke-25-gate',
      runId: 'run-1',
      profileId: 'smoke-25',
      failureCount: 0,
      failures: [],
    });
  });

  test('collects profile run gate failures with evidence', () => {
    const report = createRuntimeProfileRunReport({
      ...createReport(),
      daemonHealth: 'attention',
      completedCycleCount: 0,
      totalAgentTraceCount: 0,
      agentCycleDiagnostics: createAgentCycleDiagnostics(0),
      partitions: [
        {
          ...createReport().partitions[0]!,
          streamVersion: 9,
          agentTraceCount: 0,
        },
      ],
    });

    const result = evaluateRuntimeProfileRunReport(report, createCriteria());

    expect(result.status).toBe('fail');
    expect(result.failureCount).toBe(4);
    expect(result.failures.map((failure) => failure.code)).toEqual([
      'daemon-health-mismatch',
      'completed-cycle-count-too-low',
      'total-agent-trace-count-too-low',
      'partition-stream-version-event-count-mismatch',
    ]);
    expect(result.failures[0]).toMatchObject({
      code: 'daemon-health-mismatch',
      evidence: {
        actual: 'attention',
        expected: 'healthy',
      },
    });
  });

  test('requires full replan materialization when criteria asks for recovery evidence', () => {
    const result = evaluateRuntimeProfileRunReport(
      createRuntimeProfileRunReport({
        ...createReport(),
        agentCycleDiagnostics: {
          ...createAgentCycleDiagnostics(5),
          fullReplanMaterializationCount: 0,
          fullReplanMaterializationRatio: 0,
        },
      }),
      {
        ...createCriteria(),
        minimumFullReplanMaterializationCount: 1,
      },
    );

    expect(result.status).toBe('fail');
    expect(result.failures).toContainEqual({
      code: 'full-replan-materialization-count-too-low',
      message: 'fullReplanMaterializationCount must be at least 1',
      evidence: {
        actual: 0,
        minimum: 1,
      },
    });
  });

  test('requires simulator rollout coverage when criteria asks for counterfactual evidence', () => {
    const result = evaluateRuntimeProfileRunReport(
      createRuntimeProfileRunReport({
        ...createReport(),
        agentCycleDiagnostics: {
          ...createAgentCycleDiagnostics(5),
          simulatorEventCount: 5,
          simulatorRolloutEventCount: 2,
          simulatorRolloutCoverageRatio: 0.4,
        },
      }),
      {
        ...createCriteria(),
        minimumSimulatorRolloutCoverageRatio: 1,
      },
    );

    expect(result.status).toBe('fail');
    expect(result.failures).toContainEqual({
      code: 'simulator-rollout-coverage-ratio-too-low',
      message: 'simulatorRolloutCoverageRatio must be at least 1',
      evidence: {
        actual: 0.4,
        minimum: 1,
        simulatorRolloutEventCount: 2,
        simulatorEventCount: 5,
      },
    });
  });

  test('requires accepted LLM traces for configured agent-cycle stages', () => {
    const result = evaluateRuntimeProfileRunReport(
      createRuntimeProfileRunReport({
        ...createReport(),
        agentCycleDiagnostics: {
          ...createAgentCycleDiagnostics(5),
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
              rulesContextCount: 1,
              completeRulesContextCount: 1,
            },
            {
              stageName: 'globalSynthesis',
              traceCount: 1,
              llmAcceptedCount: 0,
              deterministicFallbackCount: 1,
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
        },
      }),
      {
        ...createCriteria(),
        requiredAgentCycleLlmAcceptedStages: ['contextualPrioritization', 'globalSynthesis'],
      },
    );

    expect(result.status).toBe('fail');
    expect(result.failures).toContainEqual({
      code: 'agent-cycle-llm-stage-accepted-count-too-low',
      message: 'agent-cycle LLM stage globalSynthesis llmAcceptedCount must be at least 1',
      evidence: {
        stageName: 'globalSynthesis',
        actual: 0,
        minimum: 1,
      },
    });
  });

  test('rejects deterministic fallback for configured agent-cycle LLM stages', () => {
    const result = evaluateRuntimeProfileRunReport(
      createRuntimeProfileRunReport({
        ...createReport(),
        agentCycleDiagnostics: {
          ...createAgentCycleDiagnostics(5),
          llmStageDiagnostics: [
            {
              stageName: 'contextualPrioritization',
              traceCount: 2,
              llmAcceptedCount: 1,
              deterministicFallbackCount: 1,
              deterministicCount: 0,
              missingCycleCount: 0,
              shortTermMemoryContextCount: 1,
              longTermProfileContextCount: 1,
              worldDecisionContextCount: 1,
              completeWorldDecisionContextCount: 1,
              rulesContextCount: 1,
              completeRulesContextCount: 1,
            },
          ],
        },
      }),
      {
        ...createCriteria(),
        requiredAgentCycleLlmNoFallbackStages: ['contextualPrioritization'],
      },
    );

    expect(result.status).toBe('fail');
    expect(result.failures).toContainEqual({
      code: 'agent-cycle-llm-stage-deterministic-fallback-present',
      message:
        'agent-cycle LLM stage contextualPrioritization deterministicFallbackCount must be 0',
      evidence: {
        stageName: 'contextualPrioritization',
        actual: 1,
        maximum: 0,
      },
    });
  });

  test('rejects deterministic traces for configured agent-cycle LLM stages', () => {
    const result = evaluateRuntimeProfileRunReport(
      createRuntimeProfileRunReport({
        ...createReport(),
        agentCycleDiagnostics: {
          ...createAgentCycleDiagnostics(5),
          llmStageDiagnostics: [
            {
              stageName: 'contextualPrioritization',
              traceCount: 2,
              llmAcceptedCount: 1,
              deterministicFallbackCount: 0,
              deterministicCount: 1,
              missingCycleCount: 0,
              shortTermMemoryContextCount: 1,
              longTermProfileContextCount: 1,
              worldDecisionContextCount: 1,
              completeWorldDecisionContextCount: 1,
              rulesContextCount: 1,
              completeRulesContextCount: 1,
            },
          ],
        },
      }),
      {
        ...createCriteria(),
        requiredAgentCycleLlmNoDeterministicStages: ['contextualPrioritization'],
      },
    );

    expect(result.status).toBe('fail');
    expect(result.failures).toContainEqual({
      code: 'agent-cycle-llm-stage-deterministic-trace-present',
      message: 'agent-cycle LLM stage contextualPrioritization deterministicCount must be 0',
      evidence: {
        stageName: 'contextualPrioritization',
        actual: 1,
        maximum: 0,
      },
    });
  });

  test('requires world decision context coverage for configured agent-cycle stages', () => {
    const result = evaluateRuntimeProfileRunReport(
      createRuntimeProfileRunReport({
        ...createReport(),
        agentCycleDiagnostics: {
          ...createAgentCycleDiagnostics(5),
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
          ],
        },
      }),
      {
        ...createCriteria(),
        requiredAgentCycleLlmWorldContextStages: ['contextualPrioritization', 'globalSynthesis'],
      },
    );

    expect(result.status).toBe('fail');
    expect(result.failures).toContainEqual({
      code: 'agent-cycle-llm-stage-complete-world-context-count-too-low',
      message:
        'agent-cycle LLM stage globalSynthesis completeWorldDecisionContextCount must be at least 1',
      evidence: {
        stageName: 'globalSynthesis',
        actual: 0,
        worldDecisionContextCount: 0,
        llmAcceptedCount: 1,
        minimum: 1,
      },
    });
  });

  test('requires complete world decision context for configured agent-cycle stages', () => {
    const result = evaluateRuntimeProfileRunReport(
      createRuntimeProfileRunReport({
        ...createReport(),
        agentCycleDiagnostics: {
          ...createAgentCycleDiagnostics(5),
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
              worldDecisionContextCount: 1,
              completeWorldDecisionContextCount: 0,
              rulesContextCount: 1,
              completeRulesContextCount: 1,
            },
          ],
        },
      }),
      {
        ...createCriteria(),
        requiredAgentCycleLlmWorldContextStages: ['contextualPrioritization', 'globalSynthesis'],
      },
    );

    expect(result.status).toBe('fail');
    expect(result.failures).toContainEqual({
      code: 'agent-cycle-llm-stage-complete-world-context-count-too-low',
      message:
        'agent-cycle LLM stage globalSynthesis completeWorldDecisionContextCount must be at least 1',
      evidence: {
        stageName: 'globalSynthesis',
        actual: 0,
        worldDecisionContextCount: 1,
        llmAcceptedCount: 1,
        minimum: 1,
      },
    });
  });

  test('requires complete world decision context for every accepted agent-cycle LLM trace', () => {
    const result = evaluateRuntimeProfileRunReport(
      createRuntimeProfileRunReport({
        ...createReport(),
        agentCycleDiagnostics: {
          ...createAgentCycleDiagnostics(5),
          llmStageDiagnostics: [
            {
              stageName: 'contextualPrioritization',
              traceCount: 2,
              llmAcceptedCount: 2,
              deterministicFallbackCount: 0,
              deterministicCount: 0,
              missingCycleCount: 0,
              shortTermMemoryContextCount: 2,
              longTermProfileContextCount: 2,
              worldDecisionContextCount: 2,
              completeWorldDecisionContextCount: 1,
              rulesContextCount: 2,
              completeRulesContextCount: 2,
            },
          ],
        },
      }),
      {
        ...createCriteria(),
        requiredAgentCycleLlmWorldContextStages: ['contextualPrioritization'],
      },
    );

    expect(result.status).toBe('fail');
    expect(result.failures).toContainEqual({
      code: 'agent-cycle-llm-stage-complete-world-context-count-too-low',
      message:
        'agent-cycle LLM stage contextualPrioritization completeWorldDecisionContextCount must be at least 2',
      evidence: {
        stageName: 'contextualPrioritization',
        actual: 1,
        worldDecisionContextCount: 2,
        llmAcceptedCount: 2,
        minimum: 2,
      },
    });
  });

  test('requires rules context coverage for configured agent-cycle stages', () => {
    const result = evaluateRuntimeProfileRunReport(
      createRuntimeProfileRunReport({
        ...createReport(),
        agentCycleDiagnostics: {
          ...createAgentCycleDiagnostics(5),
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
              worldDecisionContextCount: 1,
              completeWorldDecisionContextCount: 1,
              rulesContextCount: 1,
              completeRulesContextCount: 0,
            },
          ],
        },
      }),
      {
        ...createCriteria(),
        requiredAgentCycleLlmRulesContextStages: ['contextualPrioritization', 'globalSynthesis'],
      },
    );

    expect(result.status).toBe('fail');
    expect(result.failures).toContainEqual({
      code: 'agent-cycle-llm-stage-complete-rules-context-count-too-low',
      message: 'agent-cycle LLM stage globalSynthesis completeRulesContextCount must be at least 1',
      evidence: {
        stageName: 'globalSynthesis',
        actual: 0,
        rulesContextCount: 1,
        llmAcceptedCount: 1,
        minimum: 1,
      },
    });
  });

  test('requires complete rules context for every accepted agent-cycle LLM trace', () => {
    const result = evaluateRuntimeProfileRunReport(
      createRuntimeProfileRunReport({
        ...createReport(),
        agentCycleDiagnostics: {
          ...createAgentCycleDiagnostics(5),
          llmStageDiagnostics: [
            {
              stageName: 'globalSynthesis',
              traceCount: 2,
              llmAcceptedCount: 2,
              deterministicFallbackCount: 0,
              deterministicCount: 0,
              missingCycleCount: 0,
              shortTermMemoryContextCount: 2,
              longTermProfileContextCount: 2,
              worldDecisionContextCount: 2,
              completeWorldDecisionContextCount: 2,
              rulesContextCount: 2,
              completeRulesContextCount: 1,
            },
          ],
        },
      }),
      {
        ...createCriteria(),
        requiredAgentCycleLlmRulesContextStages: ['globalSynthesis'],
      },
    );

    expect(result.status).toBe('fail');
    expect(result.failures).toContainEqual({
      code: 'agent-cycle-llm-stage-complete-rules-context-count-too-low',
      message: 'agent-cycle LLM stage globalSynthesis completeRulesContextCount must be at least 2',
      evidence: {
        stageName: 'globalSynthesis',
        actual: 1,
        rulesContextCount: 2,
        llmAcceptedCount: 2,
        minimum: 2,
      },
    });
  });

  test('requires short-term memory context coverage for configured agent-cycle stages', () => {
    const result = evaluateRuntimeProfileRunReport(
      createRuntimeProfileRunReport({
        ...createReport(),
        agentCycleDiagnostics: {
          ...createAgentCycleDiagnostics(5),
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
              shortTermMemoryContextCount: 0,
              longTermProfileContextCount: 1,
              worldDecisionContextCount: 1,
              completeWorldDecisionContextCount: 1,
              rulesContextCount: 1,
              completeRulesContextCount: 1,
            },
          ],
        },
      }),
      {
        ...createCriteria(),
        requiredAgentCycleLlmMemoryContextStages: ['contextualPrioritization', 'globalSynthesis'],
      },
    );

    expect(result.status).toBe('fail');
    expect(result.failures).toContainEqual({
      code: 'agent-cycle-llm-stage-memory-context-count-too-low',
      message:
        'agent-cycle LLM stage globalSynthesis shortTermMemoryContextCount must be at least 1',
      evidence: {
        stageName: 'globalSynthesis',
        actual: 0,
        llmAcceptedCount: 1,
        minimum: 1,
      },
    });
  });

  test('requires short-term memory context for every accepted agent-cycle LLM trace', () => {
    const result = evaluateRuntimeProfileRunReport(
      createRuntimeProfileRunReport({
        ...createReport(),
        agentCycleDiagnostics: {
          ...createAgentCycleDiagnostics(5),
          llmStageDiagnostics: [
            {
              stageName: 'contextualPrioritization',
              traceCount: 2,
              llmAcceptedCount: 2,
              deterministicFallbackCount: 0,
              deterministicCount: 0,
              missingCycleCount: 0,
              shortTermMemoryContextCount: 1,
              longTermProfileContextCount: 2,
              worldDecisionContextCount: 2,
              completeWorldDecisionContextCount: 2,
              rulesContextCount: 2,
              completeRulesContextCount: 2,
            },
          ],
        },
      }),
      {
        ...createCriteria(),
        requiredAgentCycleLlmMemoryContextStages: ['contextualPrioritization'],
      },
    );

    expect(result.status).toBe('fail');
    expect(result.failures).toContainEqual({
      code: 'agent-cycle-llm-stage-memory-context-count-too-low',
      message:
        'agent-cycle LLM stage contextualPrioritization shortTermMemoryContextCount must be at least 2',
      evidence: {
        stageName: 'contextualPrioritization',
        actual: 1,
        llmAcceptedCount: 2,
        minimum: 2,
      },
    });
  });

  test('requires long-term profile context coverage for configured agent-cycle stages', () => {
    const result = evaluateRuntimeProfileRunReport(
      createRuntimeProfileRunReport({
        ...createReport(),
        agentCycleDiagnostics: {
          ...createAgentCycleDiagnostics(5),
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
              longTermProfileContextCount: 0,
              worldDecisionContextCount: 1,
              completeWorldDecisionContextCount: 1,
              rulesContextCount: 1,
              completeRulesContextCount: 1,
            },
          ],
        },
      }),
      {
        ...createCriteria(),
        requiredAgentCycleLlmProfileContextStages: ['contextualPrioritization', 'globalSynthesis'],
      },
    );

    expect(result.status).toBe('fail');
    expect(result.failures).toContainEqual({
      code: 'agent-cycle-llm-stage-profile-context-count-too-low',
      message:
        'agent-cycle LLM stage globalSynthesis longTermProfileContextCount must be at least 1',
      evidence: {
        stageName: 'globalSynthesis',
        actual: 0,
        llmAcceptedCount: 1,
        minimum: 1,
      },
    });
  });

  test('requires long-term profile context for every accepted agent-cycle LLM trace', () => {
    const result = evaluateRuntimeProfileRunReport(
      createRuntimeProfileRunReport({
        ...createReport(),
        agentCycleDiagnostics: {
          ...createAgentCycleDiagnostics(5),
          llmStageDiagnostics: [
            {
              stageName: 'contextualPrioritization',
              traceCount: 2,
              llmAcceptedCount: 2,
              deterministicFallbackCount: 0,
              deterministicCount: 0,
              missingCycleCount: 0,
              shortTermMemoryContextCount: 2,
              longTermProfileContextCount: 1,
              worldDecisionContextCount: 2,
              completeWorldDecisionContextCount: 2,
              rulesContextCount: 2,
              completeRulesContextCount: 2,
            },
          ],
        },
      }),
      {
        ...createCriteria(),
        requiredAgentCycleLlmProfileContextStages: ['contextualPrioritization'],
      },
    );

    expect(result.status).toBe('fail');
    expect(result.failures).toContainEqual({
      code: 'agent-cycle-llm-stage-profile-context-count-too-low',
      message:
        'agent-cycle LLM stage contextualPrioritization longTermProfileContextCount must be at least 2',
      evidence: {
        stageName: 'contextualPrioritization',
        actual: 1,
        llmAcceptedCount: 2,
        minimum: 2,
      },
    });
  });

  test('requires observed state summary for every accepted agent-cycle LLM trace', () => {
    const result = evaluateRuntimeProfileRunReport(
      createRuntimeProfileRunReport({
        ...createReport(),
        agentCycleDiagnostics: {
          ...createAgentCycleDiagnostics(5),
          llmStageDiagnostics: [
            {
              stageName: 'contextualPrioritization',
              traceCount: 2,
              llmAcceptedCount: 2,
              deterministicFallbackCount: 0,
              deterministicCount: 0,
              missingCycleCount: 0,
              observedStateSummaryCount: 1,
              shortTermMemoryContextCount: 2,
              longTermProfileContextCount: 2,
              worldDecisionContextCount: 2,
              completeWorldDecisionContextCount: 2,
              rulesContextCount: 2,
              completeRulesContextCount: 2,
            },
          ],
        },
      }),
      {
        ...createCriteria(),
        requiredAgentCycleLlmObservedStateStages: ['contextualPrioritization'],
      },
    );

    expect(result.status).toBe('fail');
    expect(result.failures).toContainEqual({
      code: 'agent-cycle-llm-stage-observed-state-count-too-low',
      message:
        'agent-cycle LLM stage contextualPrioritization observedStateSummaryCount must be at least 2',
      evidence: {
        stageName: 'contextualPrioritization',
        actual: 1,
        llmAcceptedCount: 2,
        minimum: 2,
      },
    });
  });

  test('requires accepted LLM traces for configured cognition stages', () => {
    const result = evaluateRuntimeProfileRunReport(
      createRuntimeProfileRunReport({
        ...createReport(),
        cognitionLlmStageDiagnostics: [
          {
            stageName: 'strategicPlanning',
            traceCount: 1,
            llmAcceptedCount: 1,
            deterministicFallbackCount: 0,
            deterministicCount: 0,
            missingProviderTraceCount: 0,
            worldDecisionContextCount: 0,
            completeWorldDecisionContextCount: 0,
            rulesContextCount: 0,
            completeRulesContextCount: 0,
          },
          {
            stageName: 'dailyPlanning',
            traceCount: 1,
            llmAcceptedCount: 0,
            deterministicFallbackCount: 1,
            deterministicCount: 0,
            missingProviderTraceCount: 0,
            worldDecisionContextCount: 0,
            completeWorldDecisionContextCount: 0,
            rulesContextCount: 0,
            completeRulesContextCount: 0,
          },
        ],
      }),
      {
        ...createCriteria(),
        requiredCognitionLlmAcceptedStages: ['strategicPlanning', 'dailyPlanning'],
      },
    );

    expect(result.status).toBe('fail');
    expect(result.failures).toContainEqual({
      code: 'cognition-llm-stage-accepted-count-too-low',
      message: 'cognition LLM stage dailyPlanning llmAcceptedCount must be at least 1',
      evidence: {
        stageName: 'dailyPlanning',
        actual: 0,
        minimum: 1,
      },
    });
  });

  test('rejects deterministic fallback for configured cognition LLM stages', () => {
    const result = evaluateRuntimeProfileRunReport(
      createRuntimeProfileRunReport({
        ...createReport(),
        cognitionLlmStageDiagnostics: [
          {
            stageName: 'strategicPlanning',
            traceCount: 2,
            llmAcceptedCount: 1,
            deterministicFallbackCount: 1,
            deterministicCount: 0,
            missingProviderTraceCount: 0,
            worldDecisionContextCount: 1,
            completeWorldDecisionContextCount: 1,
            rulesContextCount: 1,
            completeRulesContextCount: 1,
          },
        ],
      }),
      {
        ...createCriteria(),
        requiredCognitionLlmNoFallbackStages: ['strategicPlanning'],
      },
    );

    expect(result.status).toBe('fail');
    expect(result.failures).toContainEqual({
      code: 'cognition-llm-stage-deterministic-fallback-present',
      message: 'cognition LLM stage strategicPlanning deterministicFallbackCount must be 0',
      evidence: {
        stageName: 'strategicPlanning',
        actual: 1,
        maximum: 0,
      },
    });
  });

  test('rejects deterministic traces for configured cognition LLM stages', () => {
    const result = evaluateRuntimeProfileRunReport(
      createRuntimeProfileRunReport({
        ...createReport(),
        cognitionLlmStageDiagnostics: [
          {
            stageName: 'strategicPlanning',
            traceCount: 2,
            llmAcceptedCount: 1,
            deterministicFallbackCount: 0,
            deterministicCount: 1,
            missingProviderTraceCount: 0,
            worldDecisionContextCount: 1,
            completeWorldDecisionContextCount: 1,
            rulesContextCount: 1,
            completeRulesContextCount: 1,
          },
        ],
      }),
      {
        ...createCriteria(),
        requiredCognitionLlmNoDeterministicStages: ['strategicPlanning'],
      },
    );

    expect(result.status).toBe('fail');
    expect(result.failures).toContainEqual({
      code: 'cognition-llm-stage-deterministic-trace-present',
      message: 'cognition LLM stage strategicPlanning deterministicCount must be 0',
      evidence: {
        stageName: 'strategicPlanning',
        actual: 1,
        maximum: 0,
      },
    });
  });

  test('requires world decision context coverage for configured cognition stages', () => {
    const result = evaluateRuntimeProfileRunReport(
      createRuntimeProfileRunReport({
        ...createReport(),
        cognitionLlmStageDiagnostics: [
          {
            stageName: 'reflectionSynthesis',
            traceCount: 1,
            llmAcceptedCount: 1,
            deterministicFallbackCount: 0,
            deterministicCount: 0,
            missingProviderTraceCount: 0,
            worldDecisionContextCount: 1,
            completeWorldDecisionContextCount: 1,
            rulesContextCount: 0,
            completeRulesContextCount: 0,
          },
          {
            stageName: 'socialModelSynthesis',
            traceCount: 1,
            llmAcceptedCount: 1,
            deterministicFallbackCount: 0,
            deterministicCount: 0,
            missingProviderTraceCount: 0,
            worldDecisionContextCount: 0,
            completeWorldDecisionContextCount: 0,
            rulesContextCount: 0,
            completeRulesContextCount: 0,
          },
        ],
      }),
      {
        ...createCriteria(),
        requiredCognitionLlmWorldContextStages: ['reflectionSynthesis', 'socialModelSynthesis'],
      },
    );

    expect(result.status).toBe('fail');
    expect(result.failures).toContainEqual({
      code: 'cognition-llm-stage-complete-world-context-count-too-low',
      message:
        'cognition LLM stage socialModelSynthesis completeWorldDecisionContextCount must be at least 1',
      evidence: {
        stageName: 'socialModelSynthesis',
        actual: 0,
        worldDecisionContextCount: 0,
        llmAcceptedCount: 1,
        minimum: 1,
      },
    });
  });

  test('requires complete world decision context for configured cognition stages', () => {
    const result = evaluateRuntimeProfileRunReport(
      createRuntimeProfileRunReport({
        ...createReport(),
        cognitionLlmStageDiagnostics: [
          {
            stageName: 'reflectionSynthesis',
            traceCount: 1,
            llmAcceptedCount: 1,
            deterministicFallbackCount: 0,
            deterministicCount: 0,
            missingProviderTraceCount: 0,
            worldDecisionContextCount: 1,
            completeWorldDecisionContextCount: 1,
            rulesContextCount: 1,
            completeRulesContextCount: 1,
          },
          {
            stageName: 'socialModelSynthesis',
            traceCount: 1,
            llmAcceptedCount: 1,
            deterministicFallbackCount: 0,
            deterministicCount: 0,
            missingProviderTraceCount: 0,
            worldDecisionContextCount: 1,
            completeWorldDecisionContextCount: 0,
            rulesContextCount: 1,
            completeRulesContextCount: 0,
          },
        ],
      }),
      {
        ...createCriteria(),
        requiredCognitionLlmWorldContextStages: ['reflectionSynthesis', 'socialModelSynthesis'],
      },
    );

    expect(result.status).toBe('fail');
    expect(result.failures).toContainEqual({
      code: 'cognition-llm-stage-complete-world-context-count-too-low',
      message:
        'cognition LLM stage socialModelSynthesis completeWorldDecisionContextCount must be at least 1',
      evidence: {
        stageName: 'socialModelSynthesis',
        actual: 0,
        worldDecisionContextCount: 1,
        llmAcceptedCount: 1,
        minimum: 1,
      },
    });
  });

  test('requires complete world decision context for every accepted cognition LLM trace', () => {
    const result = evaluateRuntimeProfileRunReport(
      createRuntimeProfileRunReport({
        ...createReport(),
        cognitionLlmStageDiagnostics: [
          {
            stageName: 'reflectionSynthesis',
            traceCount: 2,
            llmAcceptedCount: 2,
            deterministicFallbackCount: 0,
            deterministicCount: 0,
            missingProviderTraceCount: 0,
            worldDecisionContextCount: 2,
            completeWorldDecisionContextCount: 1,
            rulesContextCount: 2,
            completeRulesContextCount: 2,
          },
        ],
      }),
      {
        ...createCriteria(),
        requiredCognitionLlmWorldContextStages: ['reflectionSynthesis'],
      },
    );

    expect(result.status).toBe('fail');
    expect(result.failures).toContainEqual({
      code: 'cognition-llm-stage-complete-world-context-count-too-low',
      message:
        'cognition LLM stage reflectionSynthesis completeWorldDecisionContextCount must be at least 2',
      evidence: {
        stageName: 'reflectionSynthesis',
        actual: 1,
        worldDecisionContextCount: 2,
        llmAcceptedCount: 2,
        minimum: 2,
      },
    });
  });

  test('requires rules context coverage for configured cognition stages', () => {
    const result = evaluateRuntimeProfileRunReport(
      createRuntimeProfileRunReport({
        ...createReport(),
        cognitionLlmStageDiagnostics: [
          {
            stageName: 'strategicPlanning',
            traceCount: 1,
            llmAcceptedCount: 1,
            deterministicFallbackCount: 0,
            deterministicCount: 0,
            missingProviderTraceCount: 0,
            worldDecisionContextCount: 1,
            completeWorldDecisionContextCount: 1,
            rulesContextCount: 1,
            completeRulesContextCount: 1,
          },
          {
            stageName: 'dailyPlanning',
            traceCount: 1,
            llmAcceptedCount: 1,
            deterministicFallbackCount: 0,
            deterministicCount: 0,
            missingProviderTraceCount: 0,
            worldDecisionContextCount: 1,
            completeWorldDecisionContextCount: 1,
            rulesContextCount: 1,
            completeRulesContextCount: 0,
          },
        ],
      }),
      {
        ...createCriteria(),
        requiredCognitionLlmRulesContextStages: ['strategicPlanning', 'dailyPlanning'],
      },
    );

    expect(result.status).toBe('fail');
    expect(result.failures).toContainEqual({
      code: 'cognition-llm-stage-complete-rules-context-count-too-low',
      message: 'cognition LLM stage dailyPlanning completeRulesContextCount must be at least 1',
      evidence: {
        stageName: 'dailyPlanning',
        actual: 0,
        rulesContextCount: 1,
        llmAcceptedCount: 1,
        minimum: 1,
      },
    });
  });

  test('requires complete rules context for every accepted cognition LLM trace', () => {
    const result = evaluateRuntimeProfileRunReport(
      createRuntimeProfileRunReport({
        ...createReport(),
        cognitionLlmStageDiagnostics: [
          {
            stageName: 'dailyPlanning',
            traceCount: 2,
            llmAcceptedCount: 2,
            deterministicFallbackCount: 0,
            deterministicCount: 0,
            missingProviderTraceCount: 0,
            worldDecisionContextCount: 2,
            completeWorldDecisionContextCount: 2,
            rulesContextCount: 2,
            completeRulesContextCount: 1,
          },
        ],
      }),
      {
        ...createCriteria(),
        requiredCognitionLlmRulesContextStages: ['dailyPlanning'],
      },
    );

    expect(result.status).toBe('fail');
    expect(result.failures).toContainEqual({
      code: 'cognition-llm-stage-complete-rules-context-count-too-low',
      message: 'cognition LLM stage dailyPlanning completeRulesContextCount must be at least 2',
      evidence: {
        stageName: 'dailyPlanning',
        actual: 1,
        rulesContextCount: 2,
        llmAcceptedCount: 2,
        minimum: 2,
      },
    });
  });

  test('requires memory context coverage for configured cognition stages', () => {
    const result = evaluateRuntimeProfileRunReport(
      createRuntimeProfileRunReport({
        ...createReport(),
        cognitionLlmStageDiagnostics: [
          {
            stageName: 'strategicPlanning',
            traceCount: 1,
            llmAcceptedCount: 1,
            deterministicFallbackCount: 0,
            deterministicCount: 0,
            missingProviderTraceCount: 0,
            shortTermMemoryContextCount: 1,
            longTermProfileContextCount: 1,
            worldDecisionContextCount: 1,
            completeWorldDecisionContextCount: 1,
            rulesContextCount: 1,
            completeRulesContextCount: 1,
          },
          {
            stageName: 'dailyPlanning',
            traceCount: 1,
            llmAcceptedCount: 1,
            deterministicFallbackCount: 0,
            deterministicCount: 0,
            missingProviderTraceCount: 0,
            shortTermMemoryContextCount: 0,
            longTermProfileContextCount: 1,
            worldDecisionContextCount: 1,
            completeWorldDecisionContextCount: 1,
            rulesContextCount: 1,
            completeRulesContextCount: 1,
          },
        ],
      }),
      {
        ...createCriteria(),
        requiredCognitionLlmMemoryContextStages: ['strategicPlanning', 'dailyPlanning'],
      },
    );

    expect(result.status).toBe('fail');
    expect(result.failures).toContainEqual({
      code: 'cognition-llm-stage-memory-context-count-too-low',
      message: 'cognition LLM stage dailyPlanning shortTermMemoryContextCount must be at least 1',
      evidence: {
        stageName: 'dailyPlanning',
        actual: 0,
        llmAcceptedCount: 1,
        minimum: 1,
      },
    });
  });

  test('requires memory context coverage for every accepted cognition LLM trace', () => {
    const result = evaluateRuntimeProfileRunReport(
      createRuntimeProfileRunReport({
        ...createReport(),
        cognitionLlmStageDiagnostics: [
          {
            stageName: 'strategicPlanning',
            traceCount: 2,
            llmAcceptedCount: 2,
            deterministicFallbackCount: 0,
            deterministicCount: 0,
            missingProviderTraceCount: 0,
            shortTermMemoryContextCount: 1,
            longTermProfileContextCount: 2,
            worldDecisionContextCount: 2,
            completeWorldDecisionContextCount: 2,
            rulesContextCount: 2,
            completeRulesContextCount: 2,
          },
        ],
      }),
      {
        ...createCriteria(),
        requiredCognitionLlmMemoryContextStages: ['strategicPlanning'],
      },
    );

    expect(result.status).toBe('fail');
    expect(result.failures).toContainEqual({
      code: 'cognition-llm-stage-memory-context-count-too-low',
      message:
        'cognition LLM stage strategicPlanning shortTermMemoryContextCount must be at least 2',
      evidence: {
        stageName: 'strategicPlanning',
        actual: 1,
        llmAcceptedCount: 2,
        minimum: 2,
      },
    });
  });

  test('requires profile context coverage for configured cognition stages', () => {
    const result = evaluateRuntimeProfileRunReport(
      createRuntimeProfileRunReport({
        ...createReport(),
        cognitionLlmStageDiagnostics: [
          {
            stageName: 'strategicPlanning',
            traceCount: 1,
            llmAcceptedCount: 1,
            deterministicFallbackCount: 0,
            deterministicCount: 0,
            missingProviderTraceCount: 0,
            shortTermMemoryContextCount: 1,
            longTermProfileContextCount: 1,
            worldDecisionContextCount: 1,
            completeWorldDecisionContextCount: 1,
            rulesContextCount: 1,
            completeRulesContextCount: 1,
          },
          {
            stageName: 'dailyPlanning',
            traceCount: 1,
            llmAcceptedCount: 1,
            deterministicFallbackCount: 0,
            deterministicCount: 0,
            missingProviderTraceCount: 0,
            shortTermMemoryContextCount: 1,
            longTermProfileContextCount: 0,
            worldDecisionContextCount: 1,
            completeWorldDecisionContextCount: 1,
            rulesContextCount: 1,
            completeRulesContextCount: 1,
          },
        ],
      }),
      {
        ...createCriteria(),
        requiredCognitionLlmProfileContextStages: ['strategicPlanning', 'dailyPlanning'],
      },
    );

    expect(result.status).toBe('fail');
    expect(result.failures).toContainEqual({
      code: 'cognition-llm-stage-profile-context-count-too-low',
      message: 'cognition LLM stage dailyPlanning longTermProfileContextCount must be at least 1',
      evidence: {
        stageName: 'dailyPlanning',
        actual: 0,
        llmAcceptedCount: 1,
        minimum: 1,
      },
    });
  });

  test('requires profile context coverage for every accepted cognition LLM trace', () => {
    const result = evaluateRuntimeProfileRunReport(
      createRuntimeProfileRunReport({
        ...createReport(),
        cognitionLlmStageDiagnostics: [
          {
            stageName: 'dailyPlanning',
            traceCount: 2,
            llmAcceptedCount: 2,
            deterministicFallbackCount: 0,
            deterministicCount: 0,
            missingProviderTraceCount: 0,
            shortTermMemoryContextCount: 2,
            longTermProfileContextCount: 1,
            worldDecisionContextCount: 2,
            completeWorldDecisionContextCount: 2,
            rulesContextCount: 2,
            completeRulesContextCount: 2,
          },
        ],
      }),
      {
        ...createCriteria(),
        requiredCognitionLlmProfileContextStages: ['dailyPlanning'],
      },
    );

    expect(result.status).toBe('fail');
    expect(result.failures).toContainEqual({
      code: 'cognition-llm-stage-profile-context-count-too-low',
      message: 'cognition LLM stage dailyPlanning longTermProfileContextCount must be at least 2',
      evidence: {
        stageName: 'dailyPlanning',
        actual: 1,
        llmAcceptedCount: 2,
        minimum: 2,
      },
    });
  });

  test('requires observed state summary for every accepted cognition LLM trace', () => {
    const result = evaluateRuntimeProfileRunReport(
      createRuntimeProfileRunReport({
        ...createReport(),
        cognitionLlmStageDiagnostics: [
          {
            stageName: 'dailyPlanning',
            traceCount: 2,
            llmAcceptedCount: 2,
            deterministicFallbackCount: 0,
            deterministicCount: 0,
            missingProviderTraceCount: 0,
            observedStateSummaryCount: 1,
            shortTermMemoryContextCount: 2,
            longTermProfileContextCount: 2,
            worldDecisionContextCount: 2,
            completeWorldDecisionContextCount: 2,
            rulesContextCount: 2,
            completeRulesContextCount: 2,
          },
        ],
      }),
      {
        ...createCriteria(),
        requiredCognitionLlmObservedStateStages: ['dailyPlanning'],
      },
    );

    expect(result.status).toBe('fail');
    expect(result.failures).toContainEqual({
      code: 'cognition-llm-stage-observed-state-count-too-low',
      message:
        'cognition LLM stage dailyPlanning observedStateSummaryCount must be at least 2',
      evidence: {
        stageName: 'dailyPlanning',
        actual: 1,
        llmAcceptedCount: 2,
        minimum: 2,
      },
    });
  });
});

function createCriteria(): RuntimeProfileRunGateCriteria {
  return {
    criteriaId: 'smoke-25-gate',
    profileId: 'smoke-25',
    manifestId: 'aivilization-smoke-25',
    partitionCount: 1,
    totalProjectionAgentCount: 25,
    minimumCompletedCycleCount: 1,
    minimumTotalEventCount: 2,
    minimumTotalAgentTraceCount: 1,
    minimumFullReplanMaterializationCount: 0,
    requiredDaemonHealth: 'healthy',
    requiredOutcome: 'succeeded',
    requiredStopReason: 'cycle-count-completed',
    allowedPartitionStatuses: ['completed', 'succeeded'],
    requiredPartitionHealth: 'healthy',
    requireStreamVersionMatchesEventCount: true,
    expectedProjectionAgentCountByPartition: { 'world-main': 25 },
  };
}

function createReport(): RuntimeProfileRunReport {
  return createRuntimeProfileRunReport({
    runId: 'run-1',
    profileId: 'smoke-25',
    manifestId: 'aivilization-smoke-25',
    rootDir: '/tmp/aivilization-profile-run',
    generatedAt: 100,
    requestedAt: 50,
    daemonHealth: 'healthy',
    outcome: 'succeeded',
    requestedCycleCount: 1,
    completedCycleCount: 1,
    stopReason: 'cycle-count-completed',
    partitionCount: 1,
    totalProjectionAgentCount: 25,
    totalEventCount: 10,
    totalAgentTraceCount: 5,
    agentCycleDiagnostics: createAgentCycleDiagnostics(5),
    partitions: [
      {
        simulationId: 'aivilization-smoke-25',
        partitionKey: 'world-main',
        scenarioPresetId: 'aivilization-smoke-25-world-main',
        status: 'completed',
        health: 'healthy',
        lastAppliedSequence: 10,
        streamVersion: 10,
        eventCount: 10,
        projectionAgentCount: 25,
        agentTraceCount: 5,
      },
    ],
  });
}

function createAgentCycleDiagnostics(traceCount: number) {
  return {
    traceCount,
    acceptedSimulatorCount: traceCount,
    repairedSimulatorCount: 0,
    rejectedSimulatorCount: 0,
    replanningDecisionCount: 0,
    simulatorEventTraceCount: traceCount,
    simulatorEventCount: traceCount,
    simulatorRolloutEventCount: traceCount,
    commandEmittingCycleCount: traceCount,
    fullReplanMaterializationCount: 0,
    commandEmittingCycleRatio: traceCount === 0 ? 0 : 1,
    fullReplanMaterializationRatio: 0,
    repairedSimulatorRatio: 0,
    rejectedSimulatorRatio: 0,
    replanningDecisionRatio: 0,
    simulatorRolloutCoverageRatio: traceCount === 0 ? 0 : 1,
  };
}
