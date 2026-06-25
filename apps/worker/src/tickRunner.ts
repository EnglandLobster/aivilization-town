import type {
  ActionSynthesisPolicy,
  ActionSequenceGenerator,
  AdaptiveReplanningPolicy,
  BranchPlan,
  BranchPlanRepository,
  BranchPlanProgressRepository,
  CycleActionSimulator,
  CycleRepairPolicy,
  CycleSubtaskCompletionPolicy,
  DomainMicroPlanner,
  ReactionEvaluator,
  StrategicPlanCompiler,
  SubtaskPrioritizer,
  WorldDecisionContext,
} from '@aivilization/agent-runtime';
import type {
  AgentIntentionRepository,
  LongTermProfileRepository,
  ShortTermMemoryRecord,
  ShortTermMemoryRepository,
} from '@aivilization/memory';
import type {
  AgentCycleTrace,
  MarketObservationRepository,
  ReactionEvaluationTrace as ObservabilityReactionEvaluationTrace,
} from '@aivilization/observability';
import {
  createProjectionCheckpoint,
  createCommandEnvelope,
  type AgentId,
  type EventStore,
  type EventStreamName,
  type PartitionKey,
  type ProjectionCheckpoint,
  type ProjectionCheckpointStore,
  type ProjectionSnapshotStore,
  type SimulationId,
  type SimulationTimestamp,
  type SnapshotReference,
} from '@aivilization/sim-core';
import type { WorldEvent, WorldProjection } from '@aivilization/world';
import {
  runWorkerAgentCycle,
  type WorkerAgentCycleResult,
  type WorkerAgentCycleTraceSink,
} from './agentCycleRunner';
import { dispatchWorldCommandToEventStream } from './commandDispatch';
import type { WorkerExperimentValidationPriceBinning } from './experimentValidationRunner';
import {
  recordWorkerMarketObservations,
  type RecordWorkerMarketObservationsResult,
} from './marketObservationRecording';
import {
  createAmbientObservationMemoryRecords,
  type WorkerAmbientObservationMemoryResult,
} from './ambientObservationMemory';
import { recordMarketPriceIndexToEventStream } from './marketMetrics';
import { hydrateWorldProjectionFromEventStream } from './projectionHydration';
import {
  createTraceableSocialObservationScheduledIntentions,
  type SocialObservationReactionEvaluation,
} from './socialObservationIntentions';
import type { WorldCommandPolicySource } from './worldCommandPolicySource';
import { createWorldDecisionContextFromProjection } from './worldDecisionContext';

type WorkerTickAgentPlanInput =
  | {
      readonly plan: BranchPlan;
      readonly planId?: string;
    }
  | {
      readonly plan?: undefined;
      readonly planId: string;
    };

export type WorkerTickAgentInput = {
  readonly agentId: AgentId;
  readonly observedStateSummary: string;
  readonly worldDecisionContext?: WorldDecisionContext;
  readonly signals: Parameters<typeof runWorkerAgentCycle>[0]['signals'];
  readonly memoryRetrievalLimit?: number;
  readonly memoryRetrievalCandidateLimit?: number;
  readonly microPlanners: readonly DomainMicroPlanner[];
  readonly actionSynthesis?: ActionSynthesisPolicy;
  readonly actionSequenceGenerator?: ActionSequenceGenerator;
  readonly simulate: CycleActionSimulator;
  readonly repair?: CycleRepairPolicy;
  readonly subtaskCompletion?: CycleSubtaskCompletionPolicy;
  readonly subtaskPrioritizer?: SubtaskPrioritizer;
  readonly replanningPolicy?: AdaptiveReplanningPolicy;
} & WorkerTickAgentPlanInput;

export type WorkerTickResult = {
  readonly tickId: string;
  readonly simulationId: SimulationId;
  readonly issuedAt: number;
  readonly agentResults: readonly WorkerAgentCycleResult[];
  readonly events: readonly WorldEvent[];
  readonly projection: WorldProjection;
  readonly traces: readonly AgentCycleTrace[];
  readonly streamVersion: number;
  readonly ambientObservationMemory?: WorkerAmbientObservationMemoryResult;
  readonly checkpoint?: ProjectionCheckpoint;
  readonly snapshot?: SnapshotReference;
  readonly marketObservationRecording?: RecordWorkerMarketObservationsResult;
};

export type WorkerTickProjectionCheckpointingInput = {
  readonly partitionKey: PartitionKey;
  readonly checkpointStore: ProjectionCheckpointStore;
  readonly snapshotStore: ProjectionSnapshotStore<WorldProjection>;
};

export type WorkerTickProjectionCheckpointHydrationInput = WorkerTickProjectionCheckpointingInput;

export type WorkerTickProjectionHydrationInput = {
  readonly initialProjection: WorldProjection;
  readonly fromSequence?: number;
  readonly checkpoint?: WorkerTickProjectionCheckpointHydrationInput;
};

export type WorkerTickMarketMetricsInput = {
  readonly baselineProjection: WorldProjection;
  readonly baselineAt: SimulationTimestamp;
  readonly appendIdempotencyKey?: string;
};

export type WorkerTickMarketObservationsInput = {
  readonly repository: MarketObservationRepository;
  readonly priceBinning?: WorkerExperimentValidationPriceBinning;
};

export type WorkerReactionEvaluationTraceSink = {
  readonly simulationId: SimulationId;
  readonly partitionKey: PartitionKey;
  readonly record: (trace: ObservabilityReactionEvaluationTrace) => Promise<void>;
};

export type WorkerTickAmbientObservationMemoryInput =
  | {
      readonly enabled?: true;
      readonly importanceScore?: number;
      readonly maxObserversPerEvent?: number;
      readonly reactionEvaluator?: ReactionEvaluator;
    }
  | {
      readonly enabled: false;
    };

type WorkerTickBaseInput = {
  readonly tickId: string;
  readonly simulationId: SimulationId;
  readonly issuedAt: number;
  readonly policies: WorldCommandPolicySource;
  readonly eventStore: EventStore<WorldEvent>;
  readonly streamName: EventStreamName;
  readonly intentionRepository: AgentIntentionRepository;
  readonly longTermProfileRepository: LongTermProfileRepository;
  readonly shortTermMemoryRepository: ShortTermMemoryRepository;
  readonly planRepository?: BranchPlanRepository;
  readonly planProgressRepository?: BranchPlanProgressRepository;
  readonly agents: readonly WorkerTickAgentInput[];
  readonly timeDeltaMs?: number;
  readonly marketMetrics?: WorkerTickMarketMetricsInput;
  readonly marketObservations?: WorkerTickMarketObservationsInput;
  readonly ambientObservationMemory?: WorkerTickAmbientObservationMemoryInput;
  readonly reactionEvaluationTraceSink?: WorkerReactionEvaluationTraceSink;
  readonly materializeFullReplan?: {
    readonly strategicPlanCompiler?: StrategicPlanCompiler;
    readonly resetProgress?: boolean;
  };
  readonly expectedVersion?: number;
  readonly checkpointing?: WorkerTickProjectionCheckpointingInput;
  readonly traceSink?: WorkerAgentCycleTraceSink;
};

type WorkerTickProjectionInput =
  | {
      readonly projection: WorldProjection;
      readonly projectionHydration?: never;
    }
  | {
      readonly projection?: never;
      readonly projectionHydration: WorkerTickProjectionHydrationInput;
    };

type CycleProgressInput =
  | {
      readonly planProgressRepository: BranchPlanProgressRepository;
      readonly planProgressId: string;
    }
  | {
      readonly planProgressRepository?: never;
      readonly planProgressId?: never;
    };

export async function runWorkerSimulationTick(
  input: WorkerTickBaseInput & WorkerTickProjectionInput,
): Promise<WorkerTickResult> {
  assertNonEmpty(input.tickId, 'tickId');

  const startingProjection = resolveStartingProjection(input);
  let projection = startingProjection.projection;
  let expectedVersion = input.expectedVersion ?? startingProjection.streamVersion;
  const timeAdvanceResult = dispatchWorldCommandToEventStream({
    command: createCommandEnvelope({
      id: `${input.tickId}-advance-time`,
      simulationId: input.simulationId,
      source: 'system',
      type: 'AdvanceSimulationTime',
      payload: { deltaMs: input.timeDeltaMs ?? projection.clock.tickDurationMs },
      issuedAt: input.issuedAt,
    }),
    projection,
    policies: input.policies,
    eventStore: input.eventStore,
    streamName: input.streamName,
    appendIdempotencyKey: `${input.tickId}:append:time`,
    expectedVersion,
  });
  projection = timeAdvanceResult.projection;
  expectedVersion = timeAdvanceResult.appendResult.streamVersion;
  const agentResults: WorkerAgentCycleResult[] = [];

  for (const [index, agent] of input.agents.entries()) {
    const cycleResult = await runWorkerAgentCycle({
      cycleId: createCycleId(input.tickId, index, agent.agentId),
      simulationId: input.simulationId,
      agentId: agent.agentId,
      issuedAt: input.issuedAt,
      observedStateSummary: agent.observedStateSummary,
      ...(agent.worldDecisionContext === undefined
        ? {}
        : { worldDecisionContext: agent.worldDecisionContext }),
      ...resolveCyclePlanInput({ agent, planRepository: input.planRepository }),
      ...resolveCycleProgressInput({
        agent,
        planProgressRepository: input.planProgressRepository,
      }),
      signals: agent.signals,
      projection,
      policies: input.policies,
      eventStore: input.eventStore,
      streamName: input.streamName,
      appendIdempotencyKey: createAppendIdempotencyKey(input.tickId, index, agent.agentId),
      commandIdPrefix: createCommandIdPrefix(input.tickId, index, agent.agentId),
      intentionRepository: input.intentionRepository,
      longTermProfileRepository: input.longTermProfileRepository,
      shortTermMemoryRepository: input.shortTermMemoryRepository,
      ...(agent.memoryRetrievalLimit === undefined
        ? {}
        : { memoryRetrievalLimit: agent.memoryRetrievalLimit }),
      ...(agent.memoryRetrievalCandidateLimit === undefined
        ? {}
        : { memoryRetrievalCandidateLimit: agent.memoryRetrievalCandidateLimit }),
      microPlanners: agent.microPlanners,
      ...(agent.actionSynthesis === undefined ? {} : { actionSynthesis: agent.actionSynthesis }),
      ...(agent.actionSequenceGenerator === undefined
        ? {}
        : { actionSequenceGenerator: agent.actionSequenceGenerator }),
      simulate: agent.simulate,
      ...(agent.repair === undefined ? {} : { repair: agent.repair }),
      ...(agent.subtaskCompletion === undefined
        ? {}
        : { subtaskCompletion: agent.subtaskCompletion }),
      ...(agent.subtaskPrioritizer === undefined
        ? {}
        : { subtaskPrioritizer: agent.subtaskPrioritizer }),
      ...(agent.replanningPolicy === undefined ? {} : { replanningPolicy: agent.replanningPolicy }),
      ...(input.materializeFullReplan === undefined
        ? {}
        : { materializeFullReplan: input.materializeFullReplan }),
      expectedVersion,
      ...(input.traceSink === undefined ? {} : { traceSink: input.traceSink }),
    });

    agentResults.push(cycleResult);
    projection = cycleResult.projection;
    expectedVersion = cycleResult.dispatchResult?.appendResult.streamVersion ?? expectedVersion;
  }

  const agentEvents = agentResults.flatMap((result) => result.events);
  let marketMetricEvents: readonly WorldEvent[] = [];
  if (input.marketMetrics !== undefined) {
    const marketMetricsResult = recordMarketPriceIndexToEventStream({
      baselineProjection: input.marketMetrics.baselineProjection,
      currentProjection: projection,
      simulationId: input.simulationId,
      baselineAt: input.marketMetrics.baselineAt,
      issuedAt: input.issuedAt,
      eventStore: input.eventStore,
      streamName: input.streamName,
      expectedVersion,
      appendIdempotencyKey:
        input.marketMetrics.appendIdempotencyKey ?? `${input.tickId}:append:market-price-index`,
    });
    projection = marketMetricsResult.projection;
    expectedVersion = marketMetricsResult.appendResult.streamVersion;
    marketMetricEvents = marketMetricsResult.events;
  }
  const events = [...timeAdvanceResult.events, ...agentEvents, ...marketMetricEvents];
  const marketObservationRecording =
    input.marketObservations === undefined
      ? undefined
      : await recordWorkerMarketObservations({
          simulationId: input.simulationId,
          events,
          repository: input.marketObservations.repository,
          ...(input.marketObservations.priceBinning === undefined
            ? {}
            : { priceBinning: input.marketObservations.priceBinning }),
        });
  const ambientObservationMemory = await recordAmbientObservationMemoryIfConfigured({
    input,
    events,
    projection,
  });
  const checkpointResult = saveProjectionCheckpointIfConfigured(input, projection, expectedVersion);

  return {
    tickId: input.tickId,
    simulationId: input.simulationId,
    issuedAt: input.issuedAt,
    agentResults,
    projection,
    traces: agentResults.map((result) => result.trace),
    streamVersion: expectedVersion,
    events,
    ...(ambientObservationMemory === undefined ? {} : { ambientObservationMemory }),
    ...(marketObservationRecording === undefined ? {} : { marketObservationRecording }),
    ...(checkpointResult === undefined
      ? {}
      : { checkpoint: checkpointResult.checkpoint, snapshot: checkpointResult.snapshot }),
  };
}

async function recordAmbientObservationMemoryIfConfigured(input: {
  readonly input: WorkerTickBaseInput;
  readonly events: readonly WorldEvent[];
  readonly projection: WorldProjection;
}): Promise<WorkerAmbientObservationMemoryResult | undefined> {
  if (
    input.input.ambientObservationMemory === undefined ||
    input.input.ambientObservationMemory.enabled === false
  ) {
    return undefined;
  }

  const result = createAmbientObservationMemoryRecords({
    tickId: input.input.tickId,
    events: input.events,
    projection: input.projection,
    occurredAt: input.input.issuedAt,
    ...(input.input.ambientObservationMemory.importanceScore === undefined
      ? {}
      : { importanceScore: input.input.ambientObservationMemory.importanceScore }),
    ...(input.input.ambientObservationMemory.maxObserversPerEvent === undefined
      ? {}
      : { maxObserversPerEvent: input.input.ambientObservationMemory.maxObserversPerEvent }),
  });
  if (result.records.length > 0) {
    await input.input.shortTermMemoryRepository.appendMany(result.records);
    await upsertSocialObservationIntentions({
      intentionRepository: input.input.intentionRepository,
      records: result.records,
      createdAt: input.input.issuedAt,
      worldDecisionContextByAgentId: createWorldDecisionContextByAgentId({
        projection: input.projection,
        records: result.records,
      }),
      ...(input.input.ambientObservationMemory.reactionEvaluator === undefined
        ? {}
        : { reactionEvaluator: input.input.ambientObservationMemory.reactionEvaluator }),
      ...(input.input.reactionEvaluationTraceSink === undefined
        ? {}
        : { reactionEvaluationTraceSink: input.input.reactionEvaluationTraceSink }),
    });
  }
  return result;
}

async function upsertSocialObservationIntentions(input: {
  readonly intentionRepository: AgentIntentionRepository;
  readonly records: readonly ShortTermMemoryRecord[];
  readonly createdAt: SimulationTimestamp;
  readonly worldDecisionContextByAgentId?: Readonly<Record<string, WorldDecisionContext>>;
  readonly reactionEvaluator?: ReactionEvaluator;
  readonly reactionEvaluationTraceSink?: WorkerReactionEvaluationTraceSink;
}): Promise<void> {
  const result = await createTraceableSocialObservationScheduledIntentions({
    records: input.records,
    createdAt: input.createdAt,
    ...(input.worldDecisionContextByAgentId === undefined
      ? {}
      : { worldDecisionContextByAgentId: input.worldDecisionContextByAgentId }),
    ...(input.reactionEvaluator === undefined
      ? {}
      : { reactionEvaluator: input.reactionEvaluator }),
  });
  const intentions = result.intentions;
  if (intentions.length === 0) {
    await recordReactionEvaluationTracesIfConfigured({
      traceSink: input.reactionEvaluationTraceSink,
      evaluations: result.evaluations,
      issuedAt: input.createdAt,
    });
    return;
  }

  const intentionsByAgentId = new Map<AgentId, typeof intentions>();
  for (const intention of intentions) {
    const existing = intentionsByAgentId.get(intention.agentId) ?? [];
    intentionsByAgentId.set(intention.agentId, [...existing, intention]);
  }
  await Promise.all(
    [...intentionsByAgentId.entries()].map(([agentId, scheduledIntentions]) =>
      input.intentionRepository.upsertScheduledIntentions(agentId, scheduledIntentions),
    ),
  );
  await recordReactionEvaluationTracesIfConfigured({
    traceSink: input.reactionEvaluationTraceSink,
    evaluations: result.evaluations,
    issuedAt: input.createdAt,
  });
}

function createWorldDecisionContextByAgentId(input: {
  readonly projection: WorldProjection;
  readonly records: readonly ShortTermMemoryRecord[];
}): Readonly<Record<string, WorldDecisionContext>> {
  const contexts: Record<string, WorldDecisionContext> = {};
  for (const record of input.records) {
    if (
      contexts[record.agentId] !== undefined ||
      input.projection.agents[record.agentId] === undefined
    ) {
      continue;
    }
    contexts[record.agentId] = createWorldDecisionContextFromProjection({
      projection: input.projection,
      agentId: record.agentId,
    });
  }
  return contexts;
}

async function recordReactionEvaluationTracesIfConfigured(input: {
  readonly traceSink: WorkerReactionEvaluationTraceSink | undefined;
  readonly evaluations: readonly SocialObservationReactionEvaluation[];
  readonly issuedAt: SimulationTimestamp;
}): Promise<void> {
  if (input.traceSink === undefined || input.evaluations.length === 0) {
    return;
  }
  const traceSink = input.traceSink;

  await Promise.all(
    input.evaluations.map((evaluation) =>
      traceSink.record(
        createReactionEvaluationTrace({
          traceSink,
          evaluation,
          issuedAt: input.issuedAt,
        }),
      ),
    ),
  );
}

function createReactionEvaluationTrace(input: {
  readonly traceSink: WorkerReactionEvaluationTraceSink;
  readonly evaluation: SocialObservationReactionEvaluation;
  readonly issuedAt: SimulationTimestamp;
}): ObservabilityReactionEvaluationTrace {
  return {
    traceId: createReactionEvaluationTraceId({
      traceSink: input.traceSink,
      evaluation: input.evaluation,
      issuedAt: input.issuedAt,
    }),
    simulationId: input.traceSink.simulationId,
    partitionKey: input.traceSink.partitionKey,
    agentId: input.evaluation.memoryRecord.agentId,
    memoryRecordId: input.evaluation.memoryRecord.id,
    decision:
      input.evaluation.decision.kind === 'ignore'
        ? {
            kind: 'ignore',
            confidence: input.evaluation.decision.confidence,
            rationale: input.evaluation.decision.rationale,
          }
        : {
            kind: 'follow-up',
            confidence: input.evaluation.decision.confidence,
            rationale: input.evaluation.decision.rationale,
            description: input.evaluation.decision.description,
            priority: input.evaluation.decision.priority,
            reactionWindowMs: input.evaluation.decision.reactionWindowMs,
            affinityTags: input.evaluation.decision.affinityTags,
          },
    ...(input.evaluation.reactionTrace === undefined
      ? {}
      : { reactionTrace: input.evaluation.reactionTrace }),
    ...(input.evaluation.scheduledIntention === undefined
      ? {}
      : { scheduledIntentionId: input.evaluation.scheduledIntention.id }),
    issuedAt: input.issuedAt,
  };
}

function createReactionEvaluationTraceId(input: {
  readonly traceSink: WorkerReactionEvaluationTraceSink;
  readonly evaluation: SocialObservationReactionEvaluation;
  readonly issuedAt: SimulationTimestamp;
}): string {
  return `reaction-evaluation:${input.traceSink.simulationId}:${input.traceSink.partitionKey}:${input.evaluation.memoryRecord.agentId}:${input.evaluation.memoryRecord.id}:${input.issuedAt}`;
}

function resolveCyclePlanInput(input: {
  readonly agent: WorkerTickAgentInput;
  readonly planRepository: BranchPlanRepository | undefined;
}):
  | { readonly plan: BranchPlan }
  | { readonly planRepository: BranchPlanRepository; readonly planId: string } {
  if (input.agent.plan !== undefined) {
    return { plan: input.agent.plan };
  }
  if (input.planRepository === undefined) {
    throw new Error('planRepository is required when tick agent uses planId');
  }
  return { planRepository: input.planRepository, planId: input.agent.planId };
}

function resolveCycleProgressInput(input: {
  readonly agent: WorkerTickAgentInput;
  readonly planProgressRepository: BranchPlanProgressRepository | undefined;
}): CycleProgressInput {
  if (input.planProgressRepository === undefined || input.agent.planId === undefined) {
    return {};
  }

  return {
    planProgressRepository: input.planProgressRepository,
    planProgressId: input.agent.planId,
  };
}

function createCycleId(tickId: string, index: number, agentId: AgentId): string {
  return `${tickId}:cycle:${index + 1}:${agentId}`;
}

function createAppendIdempotencyKey(tickId: string, index: number, agentId: AgentId): string {
  return `${tickId}:append:${index + 1}:${agentId}`;
}

function createCommandIdPrefix(tickId: string, index: number, agentId: AgentId): string {
  return `${tickId}-${index + 1}-${agentId}-command`;
}

function assertNonEmpty(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${name} must not be empty`);
  }
}

function resolveStartingProjection(input: WorkerTickBaseInput & WorkerTickProjectionInput): {
  readonly projection: WorldProjection;
  readonly streamVersion: number;
} {
  if (input.projection !== undefined) {
    return {
      projection: input.projection,
      streamVersion: input.eventStore.getStreamVersion(input.streamName),
    };
  }

  const hydration = hydrateWorldProjectionFromEventStream({
    initialProjection: input.projectionHydration.initialProjection,
    eventStore: input.eventStore,
    streamName: input.streamName,
    ...(input.projectionHydration.fromSequence === undefined
      ? {}
      : { fromSequence: input.projectionHydration.fromSequence }),
    ...(input.expectedVersion === undefined ? {} : { toSequence: input.expectedVersion }),
    ...(input.projectionHydration.checkpoint === undefined
      ? {}
      : {
          checkpoint: {
            checkpointStore: input.projectionHydration.checkpoint.checkpointStore,
            snapshotStore: input.projectionHydration.checkpoint.snapshotStore,
            lookup: {
              simulationId: input.simulationId,
              partitionKey: input.projectionHydration.checkpoint.partitionKey,
            },
          },
        }),
  });

  return {
    projection: hydration.projection,
    streamVersion: hydration.lastAppliedSequence,
  };
}

type SavedProjectionCheckpoint = {
  readonly checkpoint: ProjectionCheckpoint;
  readonly snapshot: SnapshotReference;
};

function saveProjectionCheckpointIfConfigured(
  input: WorkerTickBaseInput,
  projection: WorldProjection,
  streamVersion: number,
): SavedProjectionCheckpoint | undefined {
  if (input.checkpointing === undefined) {
    return undefined;
  }

  const lookup = {
    simulationId: input.simulationId,
    partitionKey: input.checkpointing.partitionKey,
  };
  const current = input.checkpointing.checkpointStore.getLatestCheckpoint(lookup);
  if (current !== undefined && streamVersion < current.lastAppliedSequence) {
    throw new Error(
      `checkpoint sequence ${streamVersion} is older than current sequence ${current.lastAppliedSequence}`,
    );
  }

  const snapshot = input.checkpointing.snapshotStore.saveSnapshot({
    simulationId: input.simulationId,
    partitionKey: input.checkpointing.partitionKey,
    sequence: streamVersion,
    createdAt: input.issuedAt,
    projection,
  });
  const checkpoint = input.checkpointing.checkpointStore.saveCheckpoint(
    createProjectionCheckpoint({
      simulationId: input.simulationId,
      partitionKey: input.checkpointing.partitionKey,
      lastAppliedSequence: streamVersion,
      snapshot,
    }),
  );

  return { checkpoint, snapshot };
}
