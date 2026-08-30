import type {
  ActionSynthesisPolicy,
  ActionSequenceGenerator,
  AdaptiveReplanningPolicy,
  BranchPlan,
  BranchPlanProgress,
  BranchPlanRepository,
  BranchPlanProgressRepository,
  CycleActionSimulator,
  CycleRepairPolicy,
  CycleSubtaskCompletionPolicy,
  DomainMicroPlanner,
  GlobalActionSynthesizer,
  ReactiveCorrector,
  ReplanningDecider,
  ReactionEvaluator,
  SocialDialogueGenerator,
  SocialSignalExtractor,
  StrategicPlanCompiler,
  SubtaskPrioritizer,
  WorldDecisionContext,
} from '@aivilization/agent-runtime';
import type {
  AgentIntentionRepository,
  LongTermAgentProfile,
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
import {
  applyWorldEvent,
  isAgentAvailableForWorldAction,
  type WorldCommandPolicies,
  type WorldEvent,
  type WorldProjection,
} from '@aivilization/world';
import type { EducationSystemPolicy } from '@aivilization/society';
import {
  runWorkerAgentCycle,
  type WorkerAgentCycleResult,
  type WorkerAgentCycleTraceSink,
} from './agentCycleRunner';
import { dispatchWorldCommandToEventStream } from './commandDispatch';
import type { SimulationCommandRouter } from './simulationCommandRouter';
import type { WorkerExperimentValidationPriceBinning } from './experimentValidationRunner';
import {
  recordWorkerMarketObservations,
  type RecordWorkerMarketObservationsResult,
} from './marketObservationRecording';
import {
  createAmbientObservationMemoryRecords,
  type WorkerAmbientObservationMemoryResult,
} from './ambientObservationMemory';
import { recordMarketMetricsToEventStream } from './marketMetrics';
import { hydrateWorldProjectionFromEventStream } from './projectionHydration';
import {
  createTraceableSocialObservationScheduledIntentions,
  type SocialObservationReactionEvaluation,
} from './socialObservationIntentions';
import {
  resolveWorldCommandPolicies,
  type WorldCommandPolicySource,
} from './worldCommandPolicySource';
import {
  createWorldDecisionContextFromProjection,
  type WorldDecisionMarketOverride,
} from './worldDecisionContext';

const DEFAULT_AMBIENT_REACTION_MEMORY_CONTEXT_LIMIT = 8;
/**
 * Bound synchronous Agent work between event-loop turns. This is runtime
 * scheduling only: it neither reads wall time nor changes within-partition
 * domain order, while queue heartbeats and health checks remain responsive.
 */
const AGENT_LOOP_COOPERATIVE_YIELD_INTERVAL = 4;

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
  readonly progress?: BranchPlanProgress;
  readonly signals: Parameters<typeof runWorkerAgentCycle>[0]['signals'];
  readonly memoryRetrievalLimit?: number;
  readonly memoryRetrievalCandidateLimit?: number;
  readonly microPlanners: readonly DomainMicroPlanner[];
  readonly actionSynthesis?: ActionSynthesisPolicy;
  readonly actionSequenceGenerator?: ActionSequenceGenerator;
  readonly socialDialogueGenerator?: SocialDialogueGenerator;
  readonly socialSignalExtractor?: SocialSignalExtractor;
  readonly globalSynthesizer?: GlobalActionSynthesizer;
  readonly reactiveCorrector?: ReactiveCorrector;
  readonly replanningDecider?: ReplanningDecider;
  readonly simulate: CycleActionSimulator;
  readonly repair?: CycleRepairPolicy;
  readonly subtaskCompletion?: CycleSubtaskCompletionPolicy;
  readonly subtaskPrioritizer?: SubtaskPrioritizer;
  readonly replanningPolicy?: AdaptiveReplanningPolicy;
} & WorkerTickAgentPlanInput;

export type WorkerTickAgentProvider = (input: {
  readonly projection: WorldProjection;
}) => readonly WorkerTickAgentInput[] | Promise<readonly WorkerTickAgentInput[]>;

export type WorkerTickResult = {
  readonly tickId: string;
  readonly simulationId: SimulationId;
  readonly issuedAt: number;
  readonly agentResults: readonly WorkerAgentCycleResult[];
  readonly skippedBusyAgentIds: readonly AgentId[];
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
  /**
   * When the unified authority owns the market, the pool-derived metric values
   * (price index, AMM composition, net-worth valuation) are computed from these
   * authoritative global pools instead of the partition projection's own. The
   * recorded events still append to and apply against the partition stream;
   * only the computed values change.
   */
  readonly currentMarketOverride?: WorldDecisionMarketOverride;
  readonly baselineMarketOverride?: WorldDecisionMarketOverride;
  /**
   * Enabled education-system policy used to record the per-level agent
   * headcount (`educationDistribution`) on the composition event. Absent or
   * disabled omits the field, keeping legacy runs byte-for-byte compatible.
   */
  readonly educationSystemPolicy?: EducationSystemPolicy;
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
      readonly visibleEventTypes?: readonly WorldEvent['type'][];
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
  readonly agentProvider?: WorkerTickAgentProvider;
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
  readonly replayExistingAgentAppends?: boolean;
  readonly checkpointing?: WorkerTickProjectionCheckpointingInput;
  readonly traceSink?: WorkerAgentCycleTraceSink;
  readonly commandRouter?: SimulationCommandRouter;
  readonly marketOverride?: WorldDecisionMarketOverride;
  /**
   * Flush authority-settled events into the partition stream before the next
   * Agent or any post-agent observation runs. Without this boundary a later
   * local command or metric could be persisted ahead of a global fact it
   * already consumed from the in-memory projection.
   */
  readonly materializeAuthorityEvents?: (input: {
    readonly projection: WorldProjection;
    readonly issuedAt: number;
  }) => Promise<{
    readonly projection: WorldProjection;
    readonly marketOverride?: WorldDecisionMarketOverride;
    /**
     * False when the hook intentionally did not persist the authority facts
     * represented by `projection` (for example during interrupted-tick replay).
     */
    readonly authorityEventsMaterialized?: boolean;
  }>;
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
      readonly progress?: BranchPlanProgress;
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
  let marketOverride = input.marketOverride;
  let hasUnstreamedAuthorityEvents = false;
  const timeAppendIdempotencyKey = `${input.tickId}:append:time`;
  const recoveredTimeAppend =
    input.replayExistingAgentAppends === true
      ? input.eventStore.getIdempotentAppend(timeAppendIdempotencyKey)
      : undefined;
  let timeAdvanceEvents: readonly WorldEvent[];
  if (recoveredTimeAppend !== undefined) {
    assertRecoveredAppendContinuesTick({
      appendIdempotencyKey: timeAppendIdempotencyKey,
      recoveredAppend: recoveredTimeAppend,
      streamName: input.streamName,
      expectedVersion,
    });
    projection = recoveredTimeAppend.appendedEvents.reduce(applyWorldEvent, projection);
    expectedVersion = recoveredTimeAppend.streamVersion;
    timeAdvanceEvents = recoveredTimeAppend.appendedEvents;
  } else {
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
      appendIdempotencyKey: timeAppendIdempotencyKey,
      expectedVersion,
    });
    projection = timeAdvanceResult.projection;
    expectedVersion = timeAdvanceResult.appendResult.streamVersion;
    timeAdvanceEvents = timeAdvanceResult.events;
  }
  const agentResults: WorkerAgentCycleResult[] = [];
  const recoveredAgentEvents: WorldEvent[] = [];
  const skippedBusyAgentIds: AgentId[] = [];
  const tickAgents = [...input.agents, ...((await input.agentProvider?.({ projection })) ?? [])];
  const batchedTraceSink = input.traceSink?.recordMany === undefined ? undefined : input.traceSink;
  let agentLoopFailed = false;
  let agentLoopFailure: unknown;

  try {
    for (const [index, agent] of tickAgents.entries()) {
      if (index > 0 && index % AGENT_LOOP_COOPERATIVE_YIELD_INTERVAL === 0) {
        await yieldWorkerHostControl();
      }
      if (!isAgentAvailableForWorldAction(projection, agent.agentId)) {
        skippedBusyAgentIds.push(agent.agentId);
        continue;
      }
      const appendIdempotencyKey = createAppendIdempotencyKey(input.tickId, index, agent.agentId);
      const recoveredAppend =
        input.replayExistingAgentAppends === true
          ? input.eventStore.getIdempotentAppend(appendIdempotencyKey)
          : undefined;
      if (recoveredAppend !== undefined) {
        assertRecoveredAppendContinuesTick({
          appendIdempotencyKey,
          recoveredAppend,
          streamName: input.streamName,
          expectedVersion,
        });
        projection = recoveredAppend.appendedEvents.reduce(applyWorldEvent, projection);
        expectedVersion = recoveredAppend.streamVersion;
        recoveredAgentEvents.push(...recoveredAppend.appendedEvents);
        continue;
      }
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
        appendIdempotencyKey,
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
        ...(agent.socialDialogueGenerator === undefined
          ? {}
          : { socialDialogueGenerator: agent.socialDialogueGenerator }),
        ...(agent.socialSignalExtractor === undefined
          ? {}
          : { socialSignalExtractor: agent.socialSignalExtractor }),
        ...(agent.globalSynthesizer === undefined
          ? {}
          : { globalSynthesizer: agent.globalSynthesizer }),
        ...(agent.reactiveCorrector === undefined
          ? {}
          : { reactiveCorrector: agent.reactiveCorrector }),
        ...(agent.replanningDecider === undefined
          ? {}
          : { replanningDecider: agent.replanningDecider }),
        simulate: agent.simulate,
        ...(agent.repair === undefined ? {} : { repair: agent.repair }),
        ...(agent.subtaskCompletion === undefined
          ? {}
          : { subtaskCompletion: agent.subtaskCompletion }),
        ...(agent.subtaskPrioritizer === undefined
          ? {}
          : { subtaskPrioritizer: agent.subtaskPrioritizer }),
        ...(agent.replanningPolicy === undefined
          ? {}
          : { replanningPolicy: agent.replanningPolicy }),
        ...(input.materializeFullReplan === undefined
          ? {}
          : { materializeFullReplan: input.materializeFullReplan }),
        expectedVersion,
        ...(input.commandRouter === undefined ? {} : { commandRouter: input.commandRouter }),
        ...(marketOverride === undefined ? {} : { marketOverride }),
        ...(input.traceSink === undefined || batchedTraceSink !== undefined
          ? {}
          : { traceSink: input.traceSink }),
      });

      agentResults.push(cycleResult);
      projection = cycleResult.projection;
      expectedVersion = cycleResult.dispatchResult?.appendResult.streamVersion ?? expectedVersion;
      if (cycleResult.dispatchResult?.hasUnstreamedAuthorityEvents === true) {
        if (input.materializeAuthorityEvents === undefined) {
          hasUnstreamedAuthorityEvents = true;
        } else {
          const materialized = await input.materializeAuthorityEvents({
            projection,
            issuedAt: input.issuedAt,
          });
          projection = materialized.projection;
          expectedVersion = input.eventStore.getStreamVersion(input.streamName);
          marketOverride = materialized.marketOverride ?? marketOverride;
          if (materialized.authorityEventsMaterialized === false) {
            hasUnstreamedAuthorityEvents = true;
          }
        }
      }
    }
  } catch (error) {
    agentLoopFailed = true;
    agentLoopFailure = error;
  }

  if (batchedTraceSink !== undefined && agentResults.length > 0) {
    try {
      await batchedTraceSink.recordMany!(agentResults.map((result) => result.trace));
    } catch (tracePersistenceFailure) {
      if (agentLoopFailed) {
        throw new AggregateError(
          [agentLoopFailure, tracePersistenceFailure],
          'worker agent loop and batched trace persistence both failed',
        );
      }
      throw tracePersistenceFailure;
    }
  }
  if (agentLoopFailed) {
    throw agentLoopFailure;
  }

  const agentEvents = [...recoveredAgentEvents, ...agentResults.flatMap((result) => result.events)];
  let marketMetricEvents: readonly WorldEvent[] = [];
  if (input.marketMetrics !== undefined) {
    const marketAppendIdempotencyKey =
      input.marketMetrics.appendIdempotencyKey ?? `${input.tickId}:append:market-price-index`;
    const recoveredMarketAppend =
      input.replayExistingAgentAppends === true
        ? input.eventStore.getIdempotentAppend(marketAppendIdempotencyKey)
        : undefined;
    if (recoveredMarketAppend !== undefined) {
      assertRecoveredAppendContinuesTick({
        appendIdempotencyKey: marketAppendIdempotencyKey,
        recoveredAppend: recoveredMarketAppend,
        streamName: input.streamName,
        expectedVersion,
      });
      projection = recoveredMarketAppend.appendedEvents.reduce(applyWorldEvent, projection);
      expectedVersion = recoveredMarketAppend.streamVersion;
      marketMetricEvents = recoveredMarketAppend.appendedEvents;
    } else {
      const marketMetricsResult = recordMarketMetricsToEventStream({
        baselineProjection: input.marketMetrics.baselineProjection,
        currentProjection: projection,
        ...(input.marketMetrics.baselineMarketOverride === undefined
          ? {}
          : { baselineMarketOverride: input.marketMetrics.baselineMarketOverride }),
        ...(marketOverride === undefined && input.marketMetrics.currentMarketOverride === undefined
          ? {}
          : { currentMarketOverride: marketOverride ?? input.marketMetrics.currentMarketOverride }),
        ...(input.marketMetrics.educationSystemPolicy === undefined
          ? {}
          : { educationSystemPolicy: input.marketMetrics.educationSystemPolicy }),
        simulationId: input.simulationId,
        baselineAt: input.marketMetrics.baselineAt,
        issuedAt: input.issuedAt,
        eventStore: input.eventStore,
        streamName: input.streamName,
        expectedVersion,
        appendIdempotencyKey: marketAppendIdempotencyKey,
      });
      projection = marketMetricsResult.projection;
      expectedVersion = marketMetricsResult.appendResult.streamVersion;
      marketMetricEvents = marketMetricsResult.events;
    }
  }
  const events = [...timeAdvanceEvents, ...agentEvents, ...marketMetricEvents];
  const marketObservationRecording =
    input.marketObservations === undefined
      ? undefined
      : await recordWorkerMarketObservations({
          simulationId: input.simulationId,
          simulatedAt: projection.clock.now,
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
  // Under the simulation-wide authority, router-settled events are applied to
  // this tick's projection without a partition stream append (they arrive via
  // the materializer inbox). Checkpointing that projection against the stream
  // version would corrupt the checkpoint/stream invariant — hydration would
  // replay the delivered events onto a snapshot already containing them — so
  // the tick skips its checkpoint; the materializer writes the next boundary
  // once the deliveries land in the stream.
  const checkpointResult = hasUnstreamedAuthorityEvents
    ? undefined
    : saveProjectionCheckpointIfConfigured(input, projection, expectedVersion);

  return {
    tickId: input.tickId,
    simulationId: input.simulationId,
    issuedAt: input.issuedAt,
    agentResults,
    skippedBusyAgentIds,
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

function yieldWorkerHostControl(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
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
    ...(input.input.ambientObservationMemory.visibleEventTypes === undefined
      ? {}
      : { visibleEventTypes: input.input.ambientObservationMemory.visibleEventTypes }),
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
        policies: resolveWorldCommandPolicies({
          policies: input.input.policies,
          projection: input.projection,
        }),
      }),
      longTermProfileByAgentId: await createLongTermProfileByAgentId({
        longTermProfileRepository: input.input.longTermProfileRepository,
        records: result.records,
      }),
      memoryContextByAgentId: await createMemoryContextByAgentId({
        shortTermMemoryRepository: input.input.shortTermMemoryRepository,
        records: result.records,
        limit: DEFAULT_AMBIENT_REACTION_MEMORY_CONTEXT_LIMIT,
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
  readonly longTermProfileByAgentId?: Readonly<Record<string, LongTermAgentProfile>>;
  readonly memoryContextByAgentId?: Readonly<Record<string, readonly ShortTermMemoryRecord[]>>;
  readonly reactionEvaluator?: ReactionEvaluator;
  readonly reactionEvaluationTraceSink?: WorkerReactionEvaluationTraceSink;
}): Promise<void> {
  const result = await createTraceableSocialObservationScheduledIntentions({
    records: input.records,
    createdAt: input.createdAt,
    ...(input.worldDecisionContextByAgentId === undefined
      ? {}
      : { worldDecisionContextByAgentId: input.worldDecisionContextByAgentId }),
    ...(input.longTermProfileByAgentId === undefined
      ? {}
      : { longTermProfileByAgentId: input.longTermProfileByAgentId }),
    ...(input.memoryContextByAgentId === undefined
      ? {}
      : { memoryContextByAgentId: input.memoryContextByAgentId }),
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
  readonly policies?: WorldCommandPolicies;
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
      ...(input.policies === undefined ? {} : { policies: input.policies }),
    });
  }
  return contexts;
}

async function createLongTermProfileByAgentId(input: {
  readonly longTermProfileRepository: LongTermProfileRepository;
  readonly records: readonly ShortTermMemoryRecord[];
}): Promise<Readonly<Record<string, LongTermAgentProfile>>> {
  const profiles: Record<string, LongTermAgentProfile> = {};
  for (const agentId of collectReactionAgentIds(input.records)) {
    profiles[agentId] = await input.longTermProfileRepository.getOrCreate(agentId);
  }
  return profiles;
}

async function createMemoryContextByAgentId(input: {
  readonly shortTermMemoryRepository: ShortTermMemoryRepository;
  readonly records: readonly ShortTermMemoryRecord[];
  readonly limit: number;
}): Promise<Readonly<Record<string, readonly ShortTermMemoryRecord[]>>> {
  const context: Record<string, readonly ShortTermMemoryRecord[]> = {};
  for (const agentId of collectReactionAgentIds(input.records)) {
    context[agentId] = await input.shortTermMemoryRepository.retrieve({
      agentId,
      limit: input.limit,
    });
  }
  return context;
}

function collectReactionAgentIds(records: readonly ShortTermMemoryRecord[]): readonly AgentId[] {
  return [...new Set(records.map((record) => record.agentId))].sort((left, right) =>
    left.localeCompare(right),
  );
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
    ...(input.agent.progress === undefined ? {} : { progress: input.agent.progress }),
  };
}

function createCycleId(tickId: string, index: number, agentId: AgentId): string {
  return `${tickId}:cycle:${index + 1}:${agentId}`;
}

function createAppendIdempotencyKey(tickId: string, index: number, agentId: AgentId): string {
  return `${tickId}:append:${index + 1}:${agentId}`;
}

function assertRecoveredAppendContinuesTick(input: {
  readonly appendIdempotencyKey: string;
  readonly recoveredAppend: NonNullable<ReturnType<EventStore<WorldEvent>['getIdempotentAppend']>>;
  readonly streamName: EventStreamName;
  readonly expectedVersion: number;
}): void {
  if (
    input.recoveredAppend.streamName !== input.streamName ||
    input.recoveredAppend.expectedVersion !== input.expectedVersion
  ) {
    throw new Error(
      `recovered append ${input.appendIdempotencyKey} does not continue the interrupted tick`,
    );
  }
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
