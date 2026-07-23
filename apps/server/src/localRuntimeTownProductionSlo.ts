export const LOCAL_RUNTIME_TOWN_PRODUCTION_SLO_POLICY_VERSION = 'production-runtime-slo-v2';

export type LocalRuntimeTownProductionSloPolicy = {
  readonly policyVersion: typeof LOCAL_RUNTIME_TOWN_PRODUCTION_SLO_POLICY_VERSION;
  readonly evaluationKind: 'point-in-time-operational-snapshot';
  readonly queue: {
    readonly maxReadyDepth: number;
    readonly maxOldestReadyAgeMs: number;
  };
  readonly checkpoint: {
    readonly maxSequenceLag: 0;
    readonly maxWallClockAgeMs: number;
    readonly appliesWhenSchedulerDesiredRunning: true;
  };
  readonly llm: {
    readonly simulatedWindowMs: 3_600_000;
    readonly maxFallbackOrFailureRatio: 0.05;
    readonly maxEstimatedCostMicrosPerWindow: 5_000_000;
    readonly deterministicModeStatus: 'not-applicable';
    readonly providerTraceCollection: 'collect-only-when-provider-configured';
  };
  readonly market: {
    readonly maxObservationLagSimulatedMs: 600_000;
    readonly noRecentTradesStatus: 'not-applicable';
  };
  readonly recovery: {
    readonly maxCompletedCheckAgeMs: number;
    readonly appliesWhenDesiredRunning: true;
  };
  readonly artifactIntegrity: {
    readonly requiredVerifiedRatio: 1;
    readonly noRegisteredArtifactsStatus: 'not-applicable';
  };
};

export type LocalRuntimeTownProductionSloStatus = 'pass' | 'fail' | 'not-applicable';

export type LocalRuntimeTownProductionSloCheck = {
  readonly checkId:
    | 'daemon-health'
    | 'run-queue-lag'
    | 'projection-checkpoint-lag'
    | 'llm-reliability-and-cost'
    | 'market-observation-lag'
    | 'recovery-readiness'
    | 'experiment-artifact-integrity';
  readonly status: LocalRuntimeTownProductionSloStatus;
  readonly objective: string;
  readonly measurement: Readonly<Record<string, unknown>>;
  readonly violations: readonly string[];
};

export type LocalRuntimeTownLlmProviderSummary = {
  readonly requestCount: number;
  readonly failedOrFallbackCount: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly estimatedCostMicros: number;
  readonly providerIds: readonly string[];
  readonly models: readonly string[];
};

export type LocalRuntimeTownProductionSloObservation = {
  readonly observedAt: number;
  readonly manifestId: string;
  readonly baseDaemonHealth: 'healthy' | 'degraded' | 'attention';
  readonly schedulerDesiredRunning: boolean;
  readonly queue: {
    readonly readyDepth: number;
    readonly oldestReadyAgeMs?: number;
    readonly deadLetterCount: number;
    readonly expiredLeaseCount: number;
  };
  readonly checkpoints: readonly {
    readonly simulationId: string;
    readonly partitionKey: string;
    readonly eventStreamVersion: number;
    readonly checkpointSequence: number;
    readonly checkpointWallClockAgeMs?: number;
  }[];
  readonly llm: LocalRuntimeTownLlmProviderSummary & {
    readonly providerConfigured: boolean;
    readonly pricingConfigured: boolean;
    readonly observedAgentCycleCount: number;
    readonly traceCollectionTruncated: boolean;
    readonly simulatedWindowStartedAt: number;
    readonly simulatedWindowEndedAt: number;
  };
  readonly market: readonly {
    readonly simulationId: string;
    readonly partitionKey: string;
    readonly recentTradeCount: number;
    readonly latestTradeObservedAt?: number;
    readonly latestCoveringBarEndedAt?: number;
    readonly observationLagSimulatedMs?: number;
    readonly collectionTruncated: boolean;
  }[];
  readonly recovery:
    | {
        readonly desiredRunning: boolean;
        readonly running: boolean;
        readonly attemptedRecoveryCount: number;
        readonly recoveredCount: number;
        readonly lastCompletedCheckAgeMs?: number;
        readonly hasLastError: boolean;
      }
    | undefined;
  readonly artifacts: {
    readonly registeredCount: number;
    readonly verifiedCount: number;
    readonly failedArtifactIds: readonly string[];
  };
};

export type LocalRuntimeTownProductionSloReport = {
  readonly policy: LocalRuntimeTownProductionSloPolicy;
  readonly observedAt: number;
  readonly manifestId: string;
  readonly status: Extract<LocalRuntimeTownProductionSloStatus, 'pass' | 'fail'>;
  readonly failedCheckIds: readonly LocalRuntimeTownProductionSloCheck['checkId'][];
  readonly checks: readonly LocalRuntimeTownProductionSloCheck[];
  readonly interpretation: readonly string[];
};

export function createLocalRuntimeTownProductionSloPolicy(input: {
  readonly maxPendingJobs: number;
  readonly workerPollIntervalMs: number;
  readonly schedulerIntervalMs: number;
  readonly recoveryIntervalMs: number;
}): LocalRuntimeTownProductionSloPolicy {
  assertPositiveInteger(input.maxPendingJobs, 'maxPendingJobs');
  assertPositiveFinite(input.workerPollIntervalMs, 'workerPollIntervalMs');
  assertPositiveFinite(input.schedulerIntervalMs, 'schedulerIntervalMs');
  assertPositiveFinite(input.recoveryIntervalMs, 'recoveryIntervalMs');
  const schedulingCadenceMs = Math.max(input.workerPollIntervalMs, input.schedulerIntervalMs);
  return {
    policyVersion: LOCAL_RUNTIME_TOWN_PRODUCTION_SLO_POLICY_VERSION,
    evaluationKind: 'point-in-time-operational-snapshot',
    queue: {
      maxReadyDepth: input.maxPendingJobs,
      maxOldestReadyAgeMs: Math.max(10_000, schedulingCadenceMs * 5),
    },
    checkpoint: {
      maxSequenceLag: 0,
      maxWallClockAgeMs: Math.max(10_000, input.schedulerIntervalMs * 5),
      appliesWhenSchedulerDesiredRunning: true,
    },
    llm: {
      simulatedWindowMs: 3_600_000,
      maxFallbackOrFailureRatio: 0.05,
      maxEstimatedCostMicrosPerWindow: 5_000_000,
      deterministicModeStatus: 'not-applicable',
      providerTraceCollection: 'collect-only-when-provider-configured',
    },
    market: {
      maxObservationLagSimulatedMs: 600_000,
      noRecentTradesStatus: 'not-applicable',
    },
    recovery: {
      maxCompletedCheckAgeMs: Math.max(10_000, input.recoveryIntervalMs * 5),
      appliesWhenDesiredRunning: true,
    },
    artifactIntegrity: {
      requiredVerifiedRatio: 1,
      noRegisteredArtifactsStatus: 'not-applicable',
    },
  };
}

export function evaluateLocalRuntimeTownProductionSlo(input: {
  readonly policy: LocalRuntimeTownProductionSloPolicy;
  readonly observation: LocalRuntimeTownProductionSloObservation;
}): LocalRuntimeTownProductionSloReport {
  assertObservation(input.observation);
  const checks = [
    evaluateDaemonHealth(input.observation),
    evaluateQueue(input.policy, input.observation),
    evaluateCheckpoints(input.policy, input.observation),
    evaluateLlm(input.policy, input.observation),
    evaluateMarket(input.policy, input.observation),
    evaluateRecovery(input.policy, input.observation),
    evaluateArtifacts(input.policy, input.observation),
  ];
  const failedCheckIds = checks
    .filter((check) => check.status === 'fail')
    .map((check) => check.checkId);
  return {
    policy: cloneJson(input.policy),
    observedAt: input.observation.observedAt,
    manifestId: input.observation.manifestId,
    status: failedCheckIds.length === 0 ? 'pass' : 'fail',
    failedCheckIds,
    checks,
    interpretation: [
      'This report is a point-in-time operational SLI evaluation, not a historical availability percentage.',
      'A not-applicable LLM check means deterministic mode or no completed agent cycle; it is not provider evidence.',
      'A not-applicable market check means no trade required a recent OHLC observation in the evaluated window.',
      'Any registered artifact integrity failure is an SLO failure; unregistered experiment outputs remain outside this snapshot.',
    ],
  };
}

export function summarizeLocalRuntimeTownLlmProviderTraces(
  traceRoots: readonly unknown[],
): LocalRuntimeTownLlmProviderSummary {
  const mutable = {
    requestCount: 0,
    failedOrFallbackCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    estimatedCostMicros: 0,
    providerIds: new Set<string>(),
    models: new Set<string>(),
  };
  const visited = new WeakSet<object>();
  for (const root of traceRoots) {
    visitProviderTrace(root, mutable, visited);
  }
  return {
    requestCount: mutable.requestCount,
    failedOrFallbackCount: mutable.failedOrFallbackCount,
    inputTokens: mutable.inputTokens,
    outputTokens: mutable.outputTokens,
    totalTokens: mutable.totalTokens,
    estimatedCostMicros: mutable.estimatedCostMicros,
    providerIds: [...mutable.providerIds].sort(),
    models: [...mutable.models].sort(),
  };
}

function evaluateDaemonHealth(
  observation: LocalRuntimeTownProductionSloObservation,
): LocalRuntimeTownProductionSloCheck {
  const violations =
    observation.baseDaemonHealth === 'healthy'
      ? []
      : [`daemon base health is ${observation.baseDaemonHealth}`];
  return createCheck({
    checkId: 'daemon-health',
    objective: 'All configured daemon components report healthy.',
    measurement: { health: observation.baseDaemonHealth, requiredHealth: 'healthy' },
    violations,
  });
}

function evaluateQueue(
  policy: LocalRuntimeTownProductionSloPolicy,
  observation: LocalRuntimeTownProductionSloObservation,
): LocalRuntimeTownProductionSloCheck {
  const violations: string[] = [];
  if (observation.queue.readyDepth > policy.queue.maxReadyDepth) {
    violations.push(
      `ready queue depth ${observation.queue.readyDepth} exceeds ${policy.queue.maxReadyDepth}`,
    );
  }
  if (
    observation.queue.oldestReadyAgeMs !== undefined &&
    observation.queue.oldestReadyAgeMs > policy.queue.maxOldestReadyAgeMs
  ) {
    violations.push(
      `oldest ready job age ${observation.queue.oldestReadyAgeMs}ms exceeds ${policy.queue.maxOldestReadyAgeMs}ms`,
    );
  }
  if (observation.queue.deadLetterCount > 0) {
    violations.push(`${observation.queue.deadLetterCount} dead-lettered jobs require attention`);
  }
  if (observation.queue.expiredLeaseCount > 0) {
    violations.push(`${observation.queue.expiredLeaseCount} expired leases require recovery`);
  }
  return createCheck({
    checkId: 'run-queue-lag',
    objective:
      'Ready work remains within the configured capacity and cadence with no dead letters.',
    measurement: {
      ...observation.queue,
      maxReadyDepth: policy.queue.maxReadyDepth,
      maxOldestReadyAgeMs: policy.queue.maxOldestReadyAgeMs,
    },
    violations,
  });
}

function evaluateCheckpoints(
  policy: LocalRuntimeTownProductionSloPolicy,
  observation: LocalRuntimeTownProductionSloObservation,
): LocalRuntimeTownProductionSloCheck {
  if (!observation.schedulerDesiredRunning) {
    return createNotApplicableCheck({
      checkId: 'projection-checkpoint-lag',
      objective: 'Every running partition checkpoint is current with its event stream.',
      measurement: { schedulerDesiredRunning: false, partitions: observation.checkpoints },
    });
  }
  const violations: string[] = [];
  const partitions = observation.checkpoints.map((checkpoint) => {
    const sequenceLag = checkpoint.eventStreamVersion - checkpoint.checkpointSequence;
    if (sequenceLag < 0) {
      violations.push(
        `${checkpoint.simulationId}/${checkpoint.partitionKey} checkpoint is ahead of the event stream`,
      );
    } else if (sequenceLag > policy.checkpoint.maxSequenceLag) {
      violations.push(
        `${checkpoint.simulationId}/${checkpoint.partitionKey} checkpoint lags by ${sequenceLag} events`,
      );
    }
    if (
      checkpoint.checkpointWallClockAgeMs !== undefined &&
      checkpoint.checkpointWallClockAgeMs > policy.checkpoint.maxWallClockAgeMs
    ) {
      violations.push(
        `${checkpoint.simulationId}/${checkpoint.partitionKey} checkpoint age ${checkpoint.checkpointWallClockAgeMs}ms exceeds ${policy.checkpoint.maxWallClockAgeMs}ms`,
      );
    }
    return { ...checkpoint, sequenceLag };
  });
  return createCheck({
    checkId: 'projection-checkpoint-lag',
    objective: 'Every running partition checkpoint is current with its event stream.',
    measurement: {
      maxSequenceLag: policy.checkpoint.maxSequenceLag,
      maxWallClockAgeMs: policy.checkpoint.maxWallClockAgeMs,
      partitions,
    },
    violations,
  });
}

function evaluateLlm(
  policy: LocalRuntimeTownProductionSloPolicy,
  observation: LocalRuntimeTownProductionSloObservation,
): LocalRuntimeTownProductionSloCheck {
  const measurement = {
    providerConfigured: observation.llm.providerConfigured,
    pricingConfigured: observation.llm.pricingConfigured,
    observedAgentCycleCount: observation.llm.observedAgentCycleCount,
    traceCollectionTruncated: observation.llm.traceCollectionTruncated,
    simulatedWindowStartedAt: observation.llm.simulatedWindowStartedAt,
    simulatedWindowEndedAt: observation.llm.simulatedWindowEndedAt,
    requestCount: observation.llm.requestCount,
    failedOrFallbackCount: observation.llm.failedOrFallbackCount,
    failureRatio:
      observation.llm.requestCount === 0
        ? null
        : observation.llm.failedOrFallbackCount / observation.llm.requestCount,
    estimatedCostMicros: observation.llm.estimatedCostMicros,
    maxFallbackOrFailureRatio: policy.llm.maxFallbackOrFailureRatio,
    maxEstimatedCostMicrosPerWindow: policy.llm.maxEstimatedCostMicrosPerWindow,
    providerIds: observation.llm.providerIds,
    models: observation.llm.models,
  };
  if (!observation.llm.providerConfigured || observation.llm.observedAgentCycleCount === 0) {
    return createNotApplicableCheck({
      checkId: 'llm-reliability-and-cost',
      objective:
        'Provider failures/fallbacks stay below 5% and estimated cost stays within budget.',
      measurement,
    });
  }
  const violations: string[] = [];
  if (!observation.llm.pricingConfigured) {
    violations.push('provider pricing is not configured, so estimated cost is not meaningful');
  }
  if (observation.llm.traceCollectionTruncated) {
    violations.push('LLM trace collection reached its safety limit and is incomplete');
  }
  if (observation.llm.requestCount === 0) {
    violations.push('provider mode completed agent cycles without any observable provider request');
  } else {
    const failureRatio = observation.llm.failedOrFallbackCount / observation.llm.requestCount;
    if (failureRatio > policy.llm.maxFallbackOrFailureRatio) {
      violations.push(
        `LLM failure/fallback ratio ${failureRatio} exceeds ${policy.llm.maxFallbackOrFailureRatio}`,
      );
    }
  }
  if (observation.llm.estimatedCostMicros > policy.llm.maxEstimatedCostMicrosPerWindow) {
    violations.push(
      `estimated LLM cost ${observation.llm.estimatedCostMicros} micros exceeds ${policy.llm.maxEstimatedCostMicrosPerWindow}`,
    );
  }
  return createCheck({
    checkId: 'llm-reliability-and-cost',
    objective: 'Provider failures/fallbacks stay below 5% and estimated cost stays within budget.',
    measurement,
    violations,
  });
}

function evaluateMarket(
  policy: LocalRuntimeTownProductionSloPolicy,
  observation: LocalRuntimeTownProductionSloObservation,
): LocalRuntimeTownProductionSloCheck {
  const active = observation.market.filter((entry) => entry.recentTradeCount > 0);
  if (active.length === 0) {
    return createNotApplicableCheck({
      checkId: 'market-observation-lag',
      objective:
        'Every recently traded commodity has a covering OHLC bar within two five-minute bins.',
      measurement: { partitions: observation.market },
    });
  }
  const violations: string[] = [];
  for (const entry of active) {
    if (entry.collectionTruncated) {
      violations.push(
        `${entry.simulationId}/${entry.partitionKey} market collection reached its safety limit`,
      );
    } else if (entry.observationLagSimulatedMs === undefined) {
      violations.push(
        `${entry.simulationId}/${entry.partitionKey} has recent trades without a covering OHLC bar`,
      );
    } else if (entry.observationLagSimulatedMs > policy.market.maxObservationLagSimulatedMs) {
      violations.push(
        `${entry.simulationId}/${entry.partitionKey} market observation lag ${entry.observationLagSimulatedMs}ms exceeds ${policy.market.maxObservationLagSimulatedMs}ms`,
      );
    }
  }
  return createCheck({
    checkId: 'market-observation-lag',
    objective:
      'Every recently traded commodity has a covering OHLC bar within two five-minute bins.',
    measurement: {
      maxObservationLagSimulatedMs: policy.market.maxObservationLagSimulatedMs,
      partitions: observation.market,
    },
    violations,
  });
}

function evaluateRecovery(
  policy: LocalRuntimeTownProductionSloPolicy,
  observation: LocalRuntimeTownProductionSloObservation,
): LocalRuntimeTownProductionSloCheck {
  if (observation.recovery === undefined || !observation.recovery.desiredRunning) {
    return createNotApplicableCheck({
      checkId: 'recovery-readiness',
      objective: 'Configured recovery stays running, error-free, and within its check cadence.',
      measurement: { configured: observation.recovery !== undefined, desiredRunning: false },
    });
  }
  const violations: string[] = [];
  if (!observation.recovery.running) {
    violations.push('recovery host is expected to run but is stopped');
  }
  if (observation.recovery.hasLastError) {
    violations.push('recovery host has a recorded error');
  }
  if (
    observation.recovery.lastCompletedCheckAgeMs !== undefined &&
    observation.recovery.lastCompletedCheckAgeMs > policy.recovery.maxCompletedCheckAgeMs
  ) {
    violations.push(
      `last recovery check age ${observation.recovery.lastCompletedCheckAgeMs}ms exceeds ${policy.recovery.maxCompletedCheckAgeMs}ms`,
    );
  }
  return createCheck({
    checkId: 'recovery-readiness',
    objective: 'Configured recovery stays running, error-free, and within its check cadence.',
    measurement: {
      ...observation.recovery,
      maxCompletedCheckAgeMs: policy.recovery.maxCompletedCheckAgeMs,
    },
    violations,
  });
}

function evaluateArtifacts(
  policy: LocalRuntimeTownProductionSloPolicy,
  observation: LocalRuntimeTownProductionSloObservation,
): LocalRuntimeTownProductionSloCheck {
  if (observation.artifacts.registeredCount === 0) {
    return createNotApplicableCheck({
      checkId: 'experiment-artifact-integrity',
      objective:
        'Every registered run or experiment artifact passes its repository integrity check.',
      measurement: observation.artifacts,
    });
  }
  const verifiedRatio = observation.artifacts.verifiedCount / observation.artifacts.registeredCount;
  const violations: string[] = [];
  if (verifiedRatio < policy.artifactIntegrity.requiredVerifiedRatio) {
    violations.push(
      `verified artifact ratio ${verifiedRatio} is below ${policy.artifactIntegrity.requiredVerifiedRatio}`,
    );
  }
  if (observation.artifacts.failedArtifactIds.length > 0) {
    violations.push(
      `artifact integrity failed for ${observation.artifacts.failedArtifactIds.join(', ')}`,
    );
  }
  return createCheck({
    checkId: 'experiment-artifact-integrity',
    objective: 'Every registered run or experiment artifact passes its repository integrity check.',
    measurement: { ...observation.artifacts, verifiedRatio },
    violations,
  });
}

function createCheck(input: {
  readonly checkId: LocalRuntimeTownProductionSloCheck['checkId'];
  readonly objective: string;
  readonly measurement: Readonly<Record<string, unknown>>;
  readonly violations: readonly string[];
}): LocalRuntimeTownProductionSloCheck {
  return {
    ...input,
    status: input.violations.length === 0 ? 'pass' : 'fail',
    measurement: cloneJson(input.measurement),
    violations: [...input.violations],
  };
}

function createNotApplicableCheck(input: {
  readonly checkId: LocalRuntimeTownProductionSloCheck['checkId'];
  readonly objective: string;
  readonly measurement: Readonly<Record<string, unknown>>;
}): LocalRuntimeTownProductionSloCheck {
  return {
    ...input,
    status: 'not-applicable',
    measurement: cloneJson(input.measurement),
    violations: [],
  };
}

type MutableLlmSummary = {
  requestCount: number;
  failedOrFallbackCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostMicros: number;
  providerIds: Set<string>;
  models: Set<string>;
};

function visitProviderTrace(
  value: unknown,
  summary: MutableLlmSummary,
  visited: WeakSet<object>,
): void {
  if (value === null || typeof value !== 'object' || visited.has(value)) {
    return;
  }
  visited.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry) => visitProviderTrace(entry, summary, visited));
    return;
  }
  const record = value as Readonly<Record<string, unknown>>;
  const isProviderRequest = record.source === 'llm' || record.source === 'deterministic-fallback';
  if (isProviderRequest) {
    summary.requestCount += 1;
    if (
      record.source === 'deterministic-fallback' ||
      record.status === 'fallback' ||
      typeof record.failureReason === 'string'
    ) {
      summary.failedOrFallbackCount += 1;
    }
    if (typeof record.providerId === 'string') {
      summary.providerIds.add(record.providerId);
    }
    if (typeof record.model === 'string') {
      summary.models.add(record.model);
    }
    addUsage(record.usage, summary);
  }
  for (const [key, entry] of Object.entries(record)) {
    if (key !== 'usage' && key !== 'attempts') {
      visitProviderTrace(entry, summary, visited);
    }
  }
}

function addUsage(value: unknown, summary: MutableLlmSummary): void {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return;
  }
  const usage = value as Readonly<Record<string, unknown>>;
  for (const field of [
    'inputTokens',
    'outputTokens',
    'totalTokens',
    'estimatedCostMicros',
  ] as const) {
    if (typeof usage[field] !== 'number' || !Number.isFinite(usage[field])) {
      return;
    }
  }
  summary.inputTokens += usage.inputTokens as number;
  summary.outputTokens += usage.outputTokens as number;
  summary.totalTokens += usage.totalTokens as number;
  summary.estimatedCostMicros += usage.estimatedCostMicros as number;
}

function assertObservation(observation: LocalRuntimeTownProductionSloObservation): void {
  assertNonNegativeFinite(observation.observedAt, 'observedAt');
  if (observation.manifestId.trim().length === 0) {
    throw new Error('manifestId must be non-empty');
  }
  if (observation.llm.simulatedWindowStartedAt > observation.llm.simulatedWindowEndedAt) {
    throw new Error('LLM simulated window start must not exceed end');
  }
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
}

function assertPositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be positive and finite`);
  }
}

function assertNonNegativeFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be non-negative and finite`);
  }
}

function cloneJson<TValue>(value: TValue): TValue {
  return JSON.parse(JSON.stringify(value)) as TValue;
}
