import type {
  ActionSynthesisPolicy,
  BranchPlan,
  BranchPlanRepository,
  BranchPlanProgressRepository,
  CycleActionSimulator,
  CycleRepairPolicy,
  CycleSubtaskCompletionPolicy,
  DomainMicroPlanner,
} from '@aivilization/agent-runtime';
import type {
  AgentIntentionRepository,
  LongTermProfileRepository,
  ShortTermMemoryRepository,
} from '@aivilization/memory';
import type { AgentCycleTrace, MarketObservationRepository } from '@aivilization/observability';
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
import type { WorldCommandPolicySource } from './worldCommandPolicySource';

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
  readonly signals: Parameters<typeof runWorkerAgentCycle>[0]['signals'];
  readonly memoryRetrievalLimit?: number;
  readonly microPlanners: readonly DomainMicroPlanner[];
  readonly actionSynthesis?: ActionSynthesisPolicy;
  readonly simulate: CycleActionSimulator;
  readonly repair?: CycleRepairPolicy;
  readonly subtaskCompletion?: CycleSubtaskCompletionPolicy;
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

export type WorkerTickAmbientObservationMemoryInput =
  | {
      readonly enabled?: true;
      readonly importanceScore?: number;
      readonly maxObserversPerEvent?: number;
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
      microPlanners: agent.microPlanners,
      ...(agent.actionSynthesis === undefined ? {} : { actionSynthesis: agent.actionSynthesis }),
      simulate: agent.simulate,
      ...(agent.repair === undefined ? {} : { repair: agent.repair }),
      ...(agent.subtaskCompletion === undefined
        ? {}
        : { subtaskCompletion: agent.subtaskCompletion }),
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
        input.marketMetrics.appendIdempotencyKey ??
        `${input.tickId}:append:market-price-index`,
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
  }
  return result;
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
