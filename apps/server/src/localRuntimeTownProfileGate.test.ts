import { describe, expect, test } from 'vitest';
import { createLocalRuntimeTownProfileGateCriteria } from './index';
import type { LocalRuntimeTownProfileRuntimeConfig } from './localRuntimeTownProfileRuntimeConfig';

describe('local runtime town profile gate criteria', () => {
  test('derives smoke profile gate criteria from the scenario profile', () => {
    expect(createLocalRuntimeTownProfileGateCriteria('smoke-25')).toMatchObject({
      criteriaId: 'aivilization-smoke-25:profile-run-gate',
      profileId: 'smoke-25',
      manifestId: 'aivilization-smoke-25',
      partitionCount: 1,
      totalProjectionAgentCount: 25,
      minimumCompletedCycleCount: 1,
      minimumTotalEventCount: 2,
      minimumTotalAgentTraceCount: 1,
      minimumFullReplanMaterializationCount: 0,
      minimumSimulatorRolloutCoverageRatio: 1,
      requiredDaemonHealth: 'healthy',
      requiredOutcome: 'succeeded',
      requiredStopReason: 'cycle-count-completed',
      allowedPartitionStatuses: ['completed', 'succeeded'],
      requiredPartitionHealth: 'healthy',
      requireStreamVersionMatchesEventCount: true,
      expectedProjectionAgentCountByPartition: {
        'world-main': 25,
      },
    });
  });

  test('allows profile gates to require full replan materialization evidence', () => {
    expect(
      createLocalRuntimeTownProfileGateCriteria('smoke-25', {
        minimumFullReplanMaterializationCount: 1,
      }),
    ).toMatchObject({
      criteriaId: 'aivilization-smoke-25:profile-run-gate',
      minimumFullReplanMaterializationCount: 1,
    });
  });

  test('allows profile gates to override simulator rollout coverage requirements', () => {
    expect(
      createLocalRuntimeTownProfileGateCriteria('smoke-25', {
        minimumSimulatorRolloutCoverageRatio: 0.5,
      }),
    ).toMatchObject({
      criteriaId: 'aivilization-smoke-25:profile-run-gate',
      minimumSimulatorRolloutCoverageRatio: 0.5,
    });
  });

  test('allows profile gates to require accepted local repair evidence', () => {
    expect(
      createLocalRuntimeTownProfileGateCriteria('smoke-25', {
        minimumLocalRepairAcceptedCount: 1,
      }),
    ).toMatchObject({
      criteriaId: 'aivilization-smoke-25:profile-run-gate',
      minimumLocalRepairAcceptedCount: 1,
    });
  });

  test('derives required agent-cycle LLM accepted stages from runtime config', () => {
    const runtimeConfig: LocalRuntimeTownProfileRuntimeConfig = {
      strategicPlanning: createLlmConfig('traceable-llm-strategic-planner'),
      dailyPlanning: createLlmConfig('traceable-llm-daily-planner'),
      reactionPlanning: createLlmConfig('traceable-llm-reaction-evaluator'),
      subtaskPrioritization: createLlmConfig('traceable-llm-subtask-prioritizer'),
      actionSequenceGeneration: createLlmConfig('traceable-llm-action-sequence-generator'),
      socialDialogue: createLlmConfig('traceable-llm-social-dialogue-generator'),
      globalSynthesis: createLlmConfig('traceable-llm-global-synthesizer'),
      reactiveCorrection: createLlmConfig('traceable-llm-reactive-corrector'),
      replanningDecision: createLlmConfig('traceable-llm-replanning-decider'),
      reflectionSynthesis: createLlmConfig('traceable-llm-reflective-insight-synthesizer'),
      socialModelSynthesis: createLlmConfig('traceable-llm-social-model-synthesizer'),
    };

    expect(
      createLocalRuntimeTownProfileGateCriteria('smoke-25', {
        runtimeConfig,
      }).requiredAgentCycleLlmAcceptedStages,
    ).toEqual([
      'contextualPrioritization',
      'actionSequenceGeneration',
      'socialDialogueGeneration',
      'globalSynthesis',
      'reactiveCorrection',
      'replanningDecision',
    ]);
    expect(
      createLocalRuntimeTownProfileGateCriteria('smoke-25', {
        runtimeConfig,
      }).requiredAgentCycleLlmNoFallbackStages,
    ).toEqual([
      'contextualPrioritization',
      'actionSequenceGeneration',
      'socialDialogueGeneration',
      'globalSynthesis',
      'reactiveCorrection',
      'replanningDecision',
    ]);
    expect(
      createLocalRuntimeTownProfileGateCriteria('smoke-25', {
        runtimeConfig,
      }).requiredAgentCycleLlmNoDeterministicStages,
    ).toEqual([
      'contextualPrioritization',
      'actionSequenceGeneration',
      'socialDialogueGeneration',
      'globalSynthesis',
      'reactiveCorrection',
      'replanningDecision',
    ]);
    expect(
      createLocalRuntimeTownProfileGateCriteria('smoke-25', {
        runtimeConfig,
      }).requiredAgentCycleLlmWorldContextStages,
    ).toEqual([
      'contextualPrioritization',
      'actionSequenceGeneration',
      'socialDialogueGeneration',
      'globalSynthesis',
      'reactiveCorrection',
      'replanningDecision',
    ]);
    expect(
      createLocalRuntimeTownProfileGateCriteria('smoke-25', {
        runtimeConfig,
      }).requiredAgentCycleLlmEconomicContextStages,
    ).toEqual([
      'contextualPrioritization',
      'actionSequenceGeneration',
      'socialDialogueGeneration',
      'globalSynthesis',
      'reactiveCorrection',
      'replanningDecision',
    ]);
    expect(
      createLocalRuntimeTownProfileGateCriteria('smoke-25', {
        runtimeConfig,
      }).requiredAgentCycleLlmRulesContextStages,
    ).toEqual([
      'contextualPrioritization',
      'actionSequenceGeneration',
      'socialDialogueGeneration',
      'globalSynthesis',
      'reactiveCorrection',
      'replanningDecision',
    ]);
    expect(
      createLocalRuntimeTownProfileGateCriteria('smoke-25', {
        runtimeConfig,
      }).requiredAgentCycleLlmMemoryContextStages,
    ).toEqual([
      'contextualPrioritization',
      'actionSequenceGeneration',
      'socialDialogueGeneration',
      'globalSynthesis',
      'reactiveCorrection',
      'replanningDecision',
    ]);
    expect(
      createLocalRuntimeTownProfileGateCriteria('smoke-25', {
        runtimeConfig,
      }).requiredAgentCycleLlmProfileContextStages,
    ).toEqual([
      'contextualPrioritization',
      'actionSequenceGeneration',
      'socialDialogueGeneration',
      'globalSynthesis',
      'reactiveCorrection',
      'replanningDecision',
    ]);
    expect(
      createLocalRuntimeTownProfileGateCriteria('smoke-25', {
        runtimeConfig,
      }).requiredAgentCycleLlmObservedStateStages,
    ).toEqual([
      'contextualPrioritization',
      'actionSequenceGeneration',
      'socialDialogueGeneration',
      'globalSynthesis',
      'reactiveCorrection',
      'replanningDecision',
    ]);
    expect(
      createLocalRuntimeTownProfileGateCriteria('smoke-25', {
        runtimeConfig,
      }).requiredCognitionLlmAcceptedStages,
    ).toEqual([
      'strategicPlanning',
      'dailyPlanning',
      'reactionEvaluation',
      'reflectionSynthesis',
      'socialModelSynthesis',
    ]);
    expect(
      createLocalRuntimeTownProfileGateCriteria('smoke-25', {
        runtimeConfig,
      }).requiredCognitionLlmNoFallbackStages,
    ).toEqual([
      'strategicPlanning',
      'dailyPlanning',
      'reactionEvaluation',
      'reflectionSynthesis',
      'socialModelSynthesis',
    ]);
    expect(
      createLocalRuntimeTownProfileGateCriteria('smoke-25', {
        runtimeConfig,
      }).requiredCognitionLlmNoDeterministicStages,
    ).toEqual([
      'strategicPlanning',
      'dailyPlanning',
      'reactionEvaluation',
      'reflectionSynthesis',
      'socialModelSynthesis',
    ]);
    expect(
      createLocalRuntimeTownProfileGateCriteria('smoke-25', {
        runtimeConfig,
      }).requiredCognitionLlmWorldContextStages,
    ).toEqual([
      'strategicPlanning',
      'dailyPlanning',
      'reactionEvaluation',
      'reflectionSynthesis',
      'socialModelSynthesis',
    ]);
    expect(
      createLocalRuntimeTownProfileGateCriteria('smoke-25', {
        runtimeConfig,
      }).requiredCognitionLlmEconomicContextStages,
    ).toEqual([
      'strategicPlanning',
      'dailyPlanning',
      'reactionEvaluation',
      'reflectionSynthesis',
      'socialModelSynthesis',
    ]);
    expect(
      createLocalRuntimeTownProfileGateCriteria('smoke-25', {
        runtimeConfig,
      }).requiredCognitionLlmRulesContextStages,
    ).toEqual([
      'strategicPlanning',
      'dailyPlanning',
      'reactionEvaluation',
      'reflectionSynthesis',
      'socialModelSynthesis',
    ]);
    expect(
      createLocalRuntimeTownProfileGateCriteria('smoke-25', {
        runtimeConfig,
      }).requiredCognitionLlmMemoryContextStages,
    ).toEqual(['strategicPlanning', 'reflectionSynthesis', 'socialModelSynthesis']);
    expect(
      createLocalRuntimeTownProfileGateCriteria('smoke-25', {
        runtimeConfig,
      }).requiredCognitionLlmProfileContextStages,
    ).toEqual(['strategicPlanning', 'reflectionSynthesis', 'socialModelSynthesis']);
    expect(
      createLocalRuntimeTownProfileGateCriteria('smoke-25', {
        runtimeConfig,
      }).requiredCognitionLlmObservedStateStages,
    ).toEqual([
      'strategicPlanning',
      'dailyPlanning',
      'reactionEvaluation',
      'reflectionSynthesis',
      'socialModelSynthesis',
    ]);
    expect(
      createLocalRuntimeTownProfileGateCriteria('smoke-25', {
        runtimeConfig,
      }).minimumCognitionLlmOutputArtifactCounts,
    ).toEqual({
      reflectionSynthesis: 1,
      socialModelSynthesis: 1,
    });
  });

  test('derives multi-partition default and stress profile gate criteria', () => {
    const standard = createLocalRuntimeTownProfileGateCriteria('default-100');
    expect(standard).toMatchObject({
      criteriaId: 'aivilization-default-100:profile-run-gate',
      profileId: 'default-100',
      manifestId: 'aivilization-default-100',
      partitionCount: 2,
      totalProjectionAgentCount: 100,
      expectedProjectionAgentCountByPartition: {
        'world-main': 50,
        'world-east': 50,
      },
    });

    const stress = createLocalRuntimeTownProfileGateCriteria('headless-stress-1000');
    expect(stress).toMatchObject({
      criteriaId: 'aivilization-headless-stress-1000:profile-run-gate',
      profileId: 'headless-stress-1000',
      manifestId: 'aivilization-headless-stress-1000',
      partitionCount: 10,
      totalProjectionAgentCount: 1000,
      expectedProjectionAgentCountByPartition: {
        'world-main': 100,
        'world-east': 100,
        'world-west': 100,
        'world-north': 100,
        'world-south': 100,
        'world-market': 100,
        'world-residential': 100,
        'world-industrial': 100,
        'world-campus': 100,
        'world-rural': 100,
      },
    });

    expect(createLocalRuntimeTownProfileGateCriteria('recovery-drill-25')).toMatchObject({
      criteriaId: 'aivilization-recovery-drill-25:profile-run-gate',
      profileId: 'recovery-drill-25',
      manifestId: 'aivilization-recovery-drill-25',
      partitionCount: 1,
      totalProjectionAgentCount: 25,
      minimumFullReplanMaterializationCount: 1,
      expectedProjectionAgentCountByPartition: {
        'world-main': 25,
      },
    });
  });

  test('allows callers to override recovery drill full replan materialization requirements', () => {
    expect(
      createLocalRuntimeTownProfileGateCriteria('recovery-drill-25', {
        minimumFullReplanMaterializationCount: 0,
      }),
    ).toMatchObject({
      criteriaId: 'aivilization-recovery-drill-25:profile-run-gate',
      minimumFullReplanMaterializationCount: 0,
    });
  });
});

function createLlmConfig<const TKind extends string>(kind: TKind) {
  return {
    kind,
    profileId: 'smoke-25',
    model: `${kind}-model`,
    provider: {
      kind: 'openai-compatible' as const,
      providerId: `${kind}-provider`,
      endpoint: `https://${kind}.example.test/v1/chat/completions`,
    },
  };
}
