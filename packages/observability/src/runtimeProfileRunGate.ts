import type {
  RuntimeProfileAgentCycleLlmStageName,
  RuntimeProfileCognitionLlmStageName,
  RuntimeProfileRunReport,
} from './runtimeProfileRunReport';

export type RuntimeProfileRunGateEvidenceValue = number | string | boolean;

export type RuntimeProfileRunGateCriteria = {
  readonly criteriaId: string;
  readonly profileId: string;
  readonly manifestId: string;
  readonly partitionCount: number;
  readonly totalProjectionAgentCount: number;
  readonly minimumCompletedCycleCount: number;
  readonly minimumTotalEventCount: number;
  readonly minimumTotalAgentTraceCount: number;
  readonly minimumFullReplanMaterializationCount: number;
  readonly requiredDaemonHealth: string;
  readonly requiredOutcome: string;
  readonly requiredStopReason: string;
  readonly allowedPartitionStatuses: readonly string[];
  readonly requiredPartitionHealth: string;
  readonly requireStreamVersionMatchesEventCount: boolean;
  readonly expectedProjectionAgentCountByPartition: Readonly<Record<string, number>>;
  readonly minimumSimulatorRolloutCoverageRatio?: number;
  readonly requiredAgentCycleLlmAcceptedStages?: readonly RuntimeProfileAgentCycleLlmStageName[];
  readonly requiredAgentCycleLlmNoFallbackStages?: readonly RuntimeProfileAgentCycleLlmStageName[];
  readonly requiredAgentCycleLlmNoDeterministicStages?: readonly RuntimeProfileAgentCycleLlmStageName[];
  readonly requiredAgentCycleLlmWorldContextStages?: readonly RuntimeProfileAgentCycleLlmStageName[];
  readonly requiredAgentCycleLlmRulesContextStages?: readonly RuntimeProfileAgentCycleLlmStageName[];
  readonly requiredAgentCycleLlmMemoryContextStages?: readonly RuntimeProfileAgentCycleLlmStageName[];
  readonly requiredAgentCycleLlmProfileContextStages?: readonly RuntimeProfileAgentCycleLlmStageName[];
  readonly requiredAgentCycleLlmObservedStateStages?: readonly RuntimeProfileAgentCycleLlmStageName[];
  readonly requiredCognitionLlmAcceptedStages?: readonly RuntimeProfileCognitionLlmStageName[];
  readonly requiredCognitionLlmNoFallbackStages?: readonly RuntimeProfileCognitionLlmStageName[];
  readonly requiredCognitionLlmNoDeterministicStages?: readonly RuntimeProfileCognitionLlmStageName[];
  readonly requiredCognitionLlmWorldContextStages?: readonly RuntimeProfileCognitionLlmStageName[];
  readonly requiredCognitionLlmRulesContextStages?: readonly RuntimeProfileCognitionLlmStageName[];
  readonly requiredCognitionLlmMemoryContextStages?: readonly RuntimeProfileCognitionLlmStageName[];
  readonly requiredCognitionLlmProfileContextStages?: readonly RuntimeProfileCognitionLlmStageName[];
  readonly requiredCognitionLlmObservedStateStages?: readonly RuntimeProfileCognitionLlmStageName[];
};

export type RuntimeProfileRunGateFailure = {
  readonly code: string;
  readonly message: string;
  readonly evidence: Readonly<Record<string, RuntimeProfileRunGateEvidenceValue>>;
};

export type RuntimeProfileRunGateResult = {
  readonly status: 'pass' | 'fail';
  readonly criteriaId: string;
  readonly runId: string;
  readonly profileId: string;
  readonly failureCount: number;
  readonly failures: readonly RuntimeProfileRunGateFailure[];
};

export function evaluateRuntimeProfileRunReport(
  report: RuntimeProfileRunReport,
  criteria: RuntimeProfileRunGateCriteria,
): RuntimeProfileRunGateResult {
  const failures: RuntimeProfileRunGateFailure[] = [];

  addExactFailure(failures, {
    code: 'profile-id-mismatch',
    label: 'profileId',
    actual: report.profileId,
    expected: criteria.profileId,
  });
  addExactFailure(failures, {
    code: 'manifest-id-mismatch',
    label: 'manifestId',
    actual: report.manifestId,
    expected: criteria.manifestId,
  });
  addExactFailure(failures, {
    code: 'daemon-health-mismatch',
    label: 'daemonHealth',
    actual: report.daemonHealth,
    expected: criteria.requiredDaemonHealth,
  });
  addExactFailure(failures, {
    code: 'outcome-mismatch',
    label: 'outcome',
    actual: report.outcome,
    expected: criteria.requiredOutcome,
  });
  addExactFailure(failures, {
    code: 'stop-reason-mismatch',
    label: 'stopReason',
    actual: report.stopReason,
    expected: criteria.requiredStopReason,
  });
  addExactFailure(failures, {
    code: 'partition-count-mismatch',
    label: 'partitionCount',
    actual: report.partitionCount,
    expected: criteria.partitionCount,
  });
  addExactFailure(failures, {
    code: 'total-projection-agent-count-mismatch',
    label: 'totalProjectionAgentCount',
    actual: report.totalProjectionAgentCount,
    expected: criteria.totalProjectionAgentCount,
  });
  addMinimumFailure(failures, {
    code: 'completed-cycle-count-too-low',
    label: 'completedCycleCount',
    actual: report.completedCycleCount,
    minimum: criteria.minimumCompletedCycleCount,
  });
  addMinimumFailure(failures, {
    code: 'total-event-count-too-low',
    label: 'totalEventCount',
    actual: report.totalEventCount,
    minimum: criteria.minimumTotalEventCount,
  });
  addMinimumFailure(failures, {
    code: 'total-agent-trace-count-too-low',
    label: 'totalAgentTraceCount',
    actual: report.totalAgentTraceCount,
    minimum: criteria.minimumTotalAgentTraceCount,
  });
  addMinimumFailure(failures, {
    code: 'full-replan-materialization-count-too-low',
    label: 'fullReplanMaterializationCount',
    actual: report.agentCycleDiagnostics.fullReplanMaterializationCount,
    minimum: criteria.minimumFullReplanMaterializationCount,
  });
  addSimulatorRolloutCoverageFailure(failures, report, criteria);
  addRequiredAgentCycleLlmStageFailures(
    failures,
    report,
    criteria.requiredAgentCycleLlmAcceptedStages ?? [],
  );
  addRequiredAgentCycleLlmNoFallbackStageFailures(
    failures,
    report,
    criteria.requiredAgentCycleLlmNoFallbackStages ?? [],
  );
  addRequiredAgentCycleLlmNoDeterministicStageFailures(
    failures,
    report,
    criteria.requiredAgentCycleLlmNoDeterministicStages ?? [],
  );
  addRequiredAgentCycleLlmWorldContextStageFailures(
    failures,
    report,
    criteria.requiredAgentCycleLlmWorldContextStages ?? [],
  );
  addRequiredAgentCycleLlmRulesContextStageFailures(
    failures,
    report,
    criteria.requiredAgentCycleLlmRulesContextStages ?? [],
  );
  addRequiredAgentCycleLlmMemoryContextStageFailures(
    failures,
    report,
    criteria.requiredAgentCycleLlmMemoryContextStages ?? [],
  );
  addRequiredAgentCycleLlmProfileContextStageFailures(
    failures,
    report,
    criteria.requiredAgentCycleLlmProfileContextStages ?? [],
  );
  addRequiredAgentCycleLlmObservedStateStageFailures(
    failures,
    report,
    criteria.requiredAgentCycleLlmObservedStateStages ?? [],
  );
  addRequiredCognitionLlmStageFailures(
    failures,
    report,
    criteria.requiredCognitionLlmAcceptedStages ?? [],
  );
  addRequiredCognitionLlmNoFallbackStageFailures(
    failures,
    report,
    criteria.requiredCognitionLlmNoFallbackStages ?? [],
  );
  addRequiredCognitionLlmNoDeterministicStageFailures(
    failures,
    report,
    criteria.requiredCognitionLlmNoDeterministicStages ?? [],
  );
  addRequiredCognitionLlmWorldContextStageFailures(
    failures,
    report,
    criteria.requiredCognitionLlmWorldContextStages ?? [],
  );
  addRequiredCognitionLlmRulesContextStageFailures(
    failures,
    report,
    criteria.requiredCognitionLlmRulesContextStages ?? [],
  );
  addRequiredCognitionLlmMemoryContextStageFailures(
    failures,
    report,
    criteria.requiredCognitionLlmMemoryContextStages ?? [],
  );
  addRequiredCognitionLlmProfileContextStageFailures(
    failures,
    report,
    criteria.requiredCognitionLlmProfileContextStages ?? [],
  );
  addRequiredCognitionLlmObservedStateStageFailures(
    failures,
    report,
    criteria.requiredCognitionLlmObservedStateStages ?? [],
  );

  const allowedStatuses = new Set(criteria.allowedPartitionStatuses);
  for (const partition of report.partitions) {
    if (!allowedStatuses.has(partition.status)) {
      failures.push({
        code: 'partition-status-mismatch',
        message: `partition ${partition.partitionKey} status ${partition.status} is not allowed`,
        evidence: {
          partitionKey: partition.partitionKey,
          actual: partition.status,
          allowed: criteria.allowedPartitionStatuses.join(','),
        },
      });
    }
    if (partition.health !== criteria.requiredPartitionHealth) {
      failures.push({
        code: 'partition-health-mismatch',
        message: `partition ${partition.partitionKey} health must be ${criteria.requiredPartitionHealth}`,
        evidence: {
          partitionKey: partition.partitionKey,
          actual: partition.health,
          expected: criteria.requiredPartitionHealth,
        },
      });
    }
    if (
      criteria.requireStreamVersionMatchesEventCount &&
      partition.streamVersion !== partition.eventCount
    ) {
      failures.push({
        code: 'partition-stream-version-event-count-mismatch',
        message: `partition ${partition.partitionKey} streamVersion must equal eventCount`,
        evidence: {
          partitionKey: partition.partitionKey,
          streamVersion: partition.streamVersion,
          eventCount: partition.eventCount,
        },
      });
    }

    const expectedAgentCount =
      criteria.expectedProjectionAgentCountByPartition[partition.partitionKey];
    if (expectedAgentCount !== undefined && partition.projectionAgentCount !== expectedAgentCount) {
      failures.push({
        code: 'partition-projection-agent-count-mismatch',
        message: `partition ${partition.partitionKey} projectionAgentCount must be ${expectedAgentCount}`,
        evidence: {
          partitionKey: partition.partitionKey,
          actual: partition.projectionAgentCount,
          expected: expectedAgentCount,
        },
      });
    }
  }

  for (const [partitionKey, expectedAgentCount] of Object.entries(
    criteria.expectedProjectionAgentCountByPartition,
  )) {
    if (!report.partitions.some((partition) => partition.partitionKey === partitionKey)) {
      failures.push({
        code: 'partition-missing',
        message: `partition ${partitionKey} must be present`,
        evidence: {
          partitionKey,
          expectedProjectionAgentCount: expectedAgentCount,
        },
      });
    }
  }

  return {
    status: failures.length === 0 ? 'pass' : 'fail',
    criteriaId: criteria.criteriaId,
    runId: report.runId,
    profileId: report.profileId,
    failureCount: failures.length,
    failures,
  };
}

function addSimulatorRolloutCoverageFailure(
  failures: RuntimeProfileRunGateFailure[],
  report: RuntimeProfileRunReport,
  criteria: RuntimeProfileRunGateCriteria,
): void {
  if (criteria.minimumSimulatorRolloutCoverageRatio === undefined) {
    return;
  }

  const actual = report.agentCycleDiagnostics.simulatorRolloutCoverageRatio;
  if (actual >= criteria.minimumSimulatorRolloutCoverageRatio) {
    return;
  }

  failures.push({
    code: 'simulator-rollout-coverage-ratio-too-low',
    message: `simulatorRolloutCoverageRatio must be at least ${criteria.minimumSimulatorRolloutCoverageRatio}`,
    evidence: {
      actual,
      minimum: criteria.minimumSimulatorRolloutCoverageRatio,
      simulatorRolloutEventCount: report.agentCycleDiagnostics.simulatorRolloutEventCount,
      simulatorEventCount: report.agentCycleDiagnostics.simulatorEventCount,
    },
  });
}

function addRequiredAgentCycleLlmStageFailures(
  failures: RuntimeProfileRunGateFailure[],
  report: RuntimeProfileRunReport,
  requiredStages: readonly RuntimeProfileAgentCycleLlmStageName[],
): void {
  const diagnosticsByStage = new Map(
    report.agentCycleDiagnostics.llmStageDiagnostics?.map((stage) => [stage.stageName, stage]) ??
      [],
  );

  for (const stageName of new Set(requiredStages)) {
    const actual = diagnosticsByStage.get(stageName)?.llmAcceptedCount ?? 0;
    if (actual >= 1) {
      continue;
    }
    failures.push({
      code: 'agent-cycle-llm-stage-accepted-count-too-low',
      message: `agent-cycle LLM stage ${stageName} llmAcceptedCount must be at least 1`,
      evidence: {
        stageName,
        actual,
        minimum: 1,
      },
    });
  }
}

function addRequiredAgentCycleLlmNoFallbackStageFailures(
  failures: RuntimeProfileRunGateFailure[],
  report: RuntimeProfileRunReport,
  requiredStages: readonly RuntimeProfileAgentCycleLlmStageName[],
): void {
  const diagnosticsByStage = new Map(
    report.agentCycleDiagnostics.llmStageDiagnostics?.map((stage) => [stage.stageName, stage]) ??
      [],
  );

  for (const stageName of new Set(requiredStages)) {
    const actual = diagnosticsByStage.get(stageName)?.deterministicFallbackCount ?? 0;
    if (actual <= 0) {
      continue;
    }
    failures.push({
      code: 'agent-cycle-llm-stage-deterministic-fallback-present',
      message: `agent-cycle LLM stage ${stageName} deterministicFallbackCount must be 0`,
      evidence: {
        stageName,
        actual,
        maximum: 0,
      },
    });
  }
}

function addRequiredAgentCycleLlmNoDeterministicStageFailures(
  failures: RuntimeProfileRunGateFailure[],
  report: RuntimeProfileRunReport,
  requiredStages: readonly RuntimeProfileAgentCycleLlmStageName[],
): void {
  const diagnosticsByStage = new Map(
    report.agentCycleDiagnostics.llmStageDiagnostics?.map((stage) => [stage.stageName, stage]) ??
      [],
  );

  for (const stageName of new Set(requiredStages)) {
    const actual = diagnosticsByStage.get(stageName)?.deterministicCount ?? 0;
    if (actual <= 0) {
      continue;
    }
    failures.push({
      code: 'agent-cycle-llm-stage-deterministic-trace-present',
      message: `agent-cycle LLM stage ${stageName} deterministicCount must be 0`,
      evidence: {
        stageName,
        actual,
        maximum: 0,
      },
    });
  }
}

function addRequiredAgentCycleLlmWorldContextStageFailures(
  failures: RuntimeProfileRunGateFailure[],
  report: RuntimeProfileRunReport,
  requiredStages: readonly RuntimeProfileAgentCycleLlmStageName[],
): void {
  const diagnosticsByStage = new Map(
    report.agentCycleDiagnostics.llmStageDiagnostics?.map((stage) => [stage.stageName, stage]) ??
      [],
  );

  for (const stageName of new Set(requiredStages)) {
    const stage = diagnosticsByStage.get(stageName);
    const actual = stage?.completeWorldDecisionContextCount ?? 0;
    const worldDecisionContextCount = stage?.worldDecisionContextCount ?? 0;
    const llmAcceptedCount = stage?.llmAcceptedCount ?? 0;
    const minimum = Math.max(1, llmAcceptedCount);
    if (actual >= minimum) {
      continue;
    }
    failures.push({
      code: 'agent-cycle-llm-stage-complete-world-context-count-too-low',
      message: `agent-cycle LLM stage ${stageName} completeWorldDecisionContextCount must be at least ${minimum}`,
      evidence: {
        stageName,
        actual,
        worldDecisionContextCount,
        llmAcceptedCount,
        minimum,
      },
    });
  }
}

function addRequiredAgentCycleLlmRulesContextStageFailures(
  failures: RuntimeProfileRunGateFailure[],
  report: RuntimeProfileRunReport,
  requiredStages: readonly RuntimeProfileAgentCycleLlmStageName[],
): void {
  const diagnosticsByStage = new Map(
    report.agentCycleDiagnostics.llmStageDiagnostics?.map((stage) => [stage.stageName, stage]) ??
      [],
  );

  for (const stageName of new Set(requiredStages)) {
    const stage = diagnosticsByStage.get(stageName);
    const actual = stage?.completeRulesContextCount ?? 0;
    const rulesContextCount = stage?.rulesContextCount ?? 0;
    const llmAcceptedCount = stage?.llmAcceptedCount ?? 0;
    const minimum = Math.max(1, llmAcceptedCount);
    if (actual >= minimum) {
      continue;
    }
    failures.push({
      code: 'agent-cycle-llm-stage-complete-rules-context-count-too-low',
      message: `agent-cycle LLM stage ${stageName} completeRulesContextCount must be at least ${minimum}`,
      evidence: {
        stageName,
        actual,
        rulesContextCount,
        llmAcceptedCount,
        minimum,
      },
    });
  }
}

function addRequiredAgentCycleLlmMemoryContextStageFailures(
  failures: RuntimeProfileRunGateFailure[],
  report: RuntimeProfileRunReport,
  requiredStages: readonly RuntimeProfileAgentCycleLlmStageName[],
): void {
  const diagnosticsByStage = new Map(
    report.agentCycleDiagnostics.llmStageDiagnostics?.map((stage) => [stage.stageName, stage]) ??
      [],
  );

  for (const stageName of new Set(requiredStages)) {
    const stage = diagnosticsByStage.get(stageName);
    const actual = stage?.shortTermMemoryContextCount ?? 0;
    const llmAcceptedCount = stage?.llmAcceptedCount ?? 0;
    const minimum = Math.max(1, llmAcceptedCount);
    if (actual >= minimum) {
      continue;
    }
    failures.push({
      code: 'agent-cycle-llm-stage-memory-context-count-too-low',
      message: `agent-cycle LLM stage ${stageName} shortTermMemoryContextCount must be at least ${minimum}`,
      evidence: {
        stageName,
        actual,
        llmAcceptedCount,
        minimum,
      },
    });
  }
}

function addRequiredAgentCycleLlmProfileContextStageFailures(
  failures: RuntimeProfileRunGateFailure[],
  report: RuntimeProfileRunReport,
  requiredStages: readonly RuntimeProfileAgentCycleLlmStageName[],
): void {
  const diagnosticsByStage = new Map(
    report.agentCycleDiagnostics.llmStageDiagnostics?.map((stage) => [stage.stageName, stage]) ??
      [],
  );

  for (const stageName of new Set(requiredStages)) {
    const stage = diagnosticsByStage.get(stageName);
    const actual = stage?.longTermProfileContextCount ?? 0;
    const llmAcceptedCount = stage?.llmAcceptedCount ?? 0;
    const minimum = Math.max(1, llmAcceptedCount);
    if (actual >= minimum) {
      continue;
    }
    failures.push({
      code: 'agent-cycle-llm-stage-profile-context-count-too-low',
      message: `agent-cycle LLM stage ${stageName} longTermProfileContextCount must be at least ${minimum}`,
      evidence: {
        stageName,
        actual,
        llmAcceptedCount,
        minimum,
      },
    });
  }
}

function addRequiredAgentCycleLlmObservedStateStageFailures(
  failures: RuntimeProfileRunGateFailure[],
  report: RuntimeProfileRunReport,
  requiredStages: readonly RuntimeProfileAgentCycleLlmStageName[],
): void {
  const diagnosticsByStage = new Map(
    report.agentCycleDiagnostics.llmStageDiagnostics?.map((stage) => [stage.stageName, stage]) ??
      [],
  );

  for (const stageName of new Set(requiredStages)) {
    const stage = diagnosticsByStage.get(stageName);
    const actual = stage?.observedStateSummaryCount ?? 0;
    const llmAcceptedCount = stage?.llmAcceptedCount ?? 0;
    const minimum = Math.max(1, llmAcceptedCount);
    if (actual >= minimum) {
      continue;
    }
    failures.push({
      code: 'agent-cycle-llm-stage-observed-state-count-too-low',
      message: `agent-cycle LLM stage ${stageName} observedStateSummaryCount must be at least ${minimum}`,
      evidence: {
        stageName,
        actual,
        llmAcceptedCount,
        minimum,
      },
    });
  }
}

function addRequiredCognitionLlmStageFailures(
  failures: RuntimeProfileRunGateFailure[],
  report: RuntimeProfileRunReport,
  requiredStages: readonly RuntimeProfileCognitionLlmStageName[],
): void {
  const diagnosticsByStage = new Map(
    report.cognitionLlmStageDiagnostics?.map((stage) => [stage.stageName, stage]) ?? [],
  );

  for (const stageName of new Set(requiredStages)) {
    const actual = diagnosticsByStage.get(stageName)?.llmAcceptedCount ?? 0;
    if (actual >= 1) {
      continue;
    }
    failures.push({
      code: 'cognition-llm-stage-accepted-count-too-low',
      message: `cognition LLM stage ${stageName} llmAcceptedCount must be at least 1`,
      evidence: {
        stageName,
        actual,
        minimum: 1,
      },
    });
  }
}

function addRequiredCognitionLlmNoFallbackStageFailures(
  failures: RuntimeProfileRunGateFailure[],
  report: RuntimeProfileRunReport,
  requiredStages: readonly RuntimeProfileCognitionLlmStageName[],
): void {
  const diagnosticsByStage = new Map(
    report.cognitionLlmStageDiagnostics?.map((stage) => [stage.stageName, stage]) ?? [],
  );

  for (const stageName of new Set(requiredStages)) {
    const actual = diagnosticsByStage.get(stageName)?.deterministicFallbackCount ?? 0;
    if (actual <= 0) {
      continue;
    }
    failures.push({
      code: 'cognition-llm-stage-deterministic-fallback-present',
      message: `cognition LLM stage ${stageName} deterministicFallbackCount must be 0`,
      evidence: {
        stageName,
        actual,
        maximum: 0,
      },
    });
  }
}

function addRequiredCognitionLlmNoDeterministicStageFailures(
  failures: RuntimeProfileRunGateFailure[],
  report: RuntimeProfileRunReport,
  requiredStages: readonly RuntimeProfileCognitionLlmStageName[],
): void {
  const diagnosticsByStage = new Map(
    report.cognitionLlmStageDiagnostics?.map((stage) => [stage.stageName, stage]) ?? [],
  );

  for (const stageName of new Set(requiredStages)) {
    const actual = diagnosticsByStage.get(stageName)?.deterministicCount ?? 0;
    if (actual <= 0) {
      continue;
    }
    failures.push({
      code: 'cognition-llm-stage-deterministic-trace-present',
      message: `cognition LLM stage ${stageName} deterministicCount must be 0`,
      evidence: {
        stageName,
        actual,
        maximum: 0,
      },
    });
  }
}

function addRequiredCognitionLlmWorldContextStageFailures(
  failures: RuntimeProfileRunGateFailure[],
  report: RuntimeProfileRunReport,
  requiredStages: readonly RuntimeProfileCognitionLlmStageName[],
): void {
  const diagnosticsByStage = new Map(
    report.cognitionLlmStageDiagnostics?.map((stage) => [stage.stageName, stage]) ?? [],
  );

  for (const stageName of new Set(requiredStages)) {
    const stage = diagnosticsByStage.get(stageName);
    const actual = stage?.completeWorldDecisionContextCount ?? 0;
    const worldDecisionContextCount = stage?.worldDecisionContextCount ?? 0;
    const llmAcceptedCount = stage?.llmAcceptedCount ?? 0;
    const minimum = Math.max(1, llmAcceptedCount);
    if (actual >= minimum) {
      continue;
    }
    failures.push({
      code: 'cognition-llm-stage-complete-world-context-count-too-low',
      message: `cognition LLM stage ${stageName} completeWorldDecisionContextCount must be at least ${minimum}`,
      evidence: {
        stageName,
        actual,
        worldDecisionContextCount,
        llmAcceptedCount,
        minimum,
      },
    });
  }
}

function addRequiredCognitionLlmRulesContextStageFailures(
  failures: RuntimeProfileRunGateFailure[],
  report: RuntimeProfileRunReport,
  requiredStages: readonly RuntimeProfileCognitionLlmStageName[],
): void {
  const diagnosticsByStage = new Map(
    report.cognitionLlmStageDiagnostics?.map((stage) => [stage.stageName, stage]) ?? [],
  );

  for (const stageName of new Set(requiredStages)) {
    const stage = diagnosticsByStage.get(stageName);
    const actual = stage?.completeRulesContextCount ?? 0;
    const rulesContextCount = stage?.rulesContextCount ?? 0;
    const llmAcceptedCount = stage?.llmAcceptedCount ?? 0;
    const minimum = Math.max(1, llmAcceptedCount);
    if (actual >= minimum) {
      continue;
    }
    failures.push({
      code: 'cognition-llm-stage-complete-rules-context-count-too-low',
      message: `cognition LLM stage ${stageName} completeRulesContextCount must be at least ${minimum}`,
      evidence: {
        stageName,
        actual,
        rulesContextCount,
        llmAcceptedCount,
        minimum,
      },
    });
  }
}

function addRequiredCognitionLlmMemoryContextStageFailures(
  failures: RuntimeProfileRunGateFailure[],
  report: RuntimeProfileRunReport,
  requiredStages: readonly RuntimeProfileCognitionLlmStageName[],
): void {
  const diagnosticsByStage = new Map(
    report.cognitionLlmStageDiagnostics?.map((stage) => [stage.stageName, stage]) ?? [],
  );

  for (const stageName of new Set(requiredStages)) {
    const stage = diagnosticsByStage.get(stageName);
    const actual = stage?.shortTermMemoryContextCount ?? 0;
    const llmAcceptedCount = stage?.llmAcceptedCount ?? 0;
    const minimum = Math.max(1, llmAcceptedCount);
    if (actual >= minimum) {
      continue;
    }
    failures.push({
      code: 'cognition-llm-stage-memory-context-count-too-low',
      message: `cognition LLM stage ${stageName} shortTermMemoryContextCount must be at least ${minimum}`,
      evidence: {
        stageName,
        actual,
        llmAcceptedCount,
        minimum,
      },
    });
  }
}

function addRequiredCognitionLlmProfileContextStageFailures(
  failures: RuntimeProfileRunGateFailure[],
  report: RuntimeProfileRunReport,
  requiredStages: readonly RuntimeProfileCognitionLlmStageName[],
): void {
  const diagnosticsByStage = new Map(
    report.cognitionLlmStageDiagnostics?.map((stage) => [stage.stageName, stage]) ?? [],
  );

  for (const stageName of new Set(requiredStages)) {
    const stage = diagnosticsByStage.get(stageName);
    const actual = stage?.longTermProfileContextCount ?? 0;
    const llmAcceptedCount = stage?.llmAcceptedCount ?? 0;
    const minimum = Math.max(1, llmAcceptedCount);
    if (actual >= minimum) {
      continue;
    }
    failures.push({
      code: 'cognition-llm-stage-profile-context-count-too-low',
      message: `cognition LLM stage ${stageName} longTermProfileContextCount must be at least ${minimum}`,
      evidence: {
        stageName,
        actual,
        llmAcceptedCount,
        minimum,
      },
    });
  }
}

function addRequiredCognitionLlmObservedStateStageFailures(
  failures: RuntimeProfileRunGateFailure[],
  report: RuntimeProfileRunReport,
  requiredStages: readonly RuntimeProfileCognitionLlmStageName[],
): void {
  const diagnosticsByStage = new Map(
    report.cognitionLlmStageDiagnostics?.map((stage) => [stage.stageName, stage]) ?? [],
  );

  for (const stageName of new Set(requiredStages)) {
    const stage = diagnosticsByStage.get(stageName);
    const actual = stage?.observedStateSummaryCount ?? 0;
    const llmAcceptedCount = stage?.llmAcceptedCount ?? 0;
    const minimum = Math.max(1, llmAcceptedCount);
    if (actual >= minimum) {
      continue;
    }
    failures.push({
      code: 'cognition-llm-stage-observed-state-count-too-low',
      message: `cognition LLM stage ${stageName} observedStateSummaryCount must be at least ${minimum}`,
      evidence: {
        stageName,
        actual,
        llmAcceptedCount,
        minimum,
      },
    });
  }
}

function addExactFailure(
  failures: RuntimeProfileRunGateFailure[],
  input: {
    readonly code: string;
    readonly label: string;
    readonly actual: string | number;
    readonly expected: string | number;
  },
): void {
  if (input.actual === input.expected) {
    return;
  }
  failures.push({
    code: input.code,
    message: `${input.label} must be ${input.expected}`,
    evidence: {
      actual: input.actual,
      expected: input.expected,
    },
  });
}

function addMinimumFailure(
  failures: RuntimeProfileRunGateFailure[],
  input: {
    readonly code: string;
    readonly label: string;
    readonly actual: number;
    readonly minimum: number;
  },
): void {
  if (input.actual >= input.minimum) {
    return;
  }
  failures.push({
    code: input.code,
    message: `${input.label} must be at least ${input.minimum}`,
    evidence: {
      actual: input.actual,
      minimum: input.minimum,
    },
  });
}
