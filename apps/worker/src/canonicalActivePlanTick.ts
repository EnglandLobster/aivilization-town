import type {
  BranchPlanProgressRepository,
  BranchPlanRepository,
  CycleRepairPolicy,
  DailyPlanCompiler,
  StrategicPlanCompiler,
} from '@aivilization/agent-runtime';
import type {
  AgentIntentionRepository,
  LongTermProfileRepository,
  ShortTermMemoryRepository,
} from '@aivilization/memory';
import type {
  EventStore,
  EventStreamName,
  SimulationId,
  SimulationTimestamp,
} from '@aivilization/sim-core';
import type { WorldEvent, WorldProjection } from '@aivilization/world';
import { buildWorkerTickAgentsFromActivePlans } from './agentScheduling';
import type { WorkerAgentCycleTraceSink } from './agentCycleRunner';
import type { CanonicalDomainRuntimeConfig } from './canonicalDomainRuntimes';
import { createCanonicalWorkerRuntimeResolver } from './canonicalWorkerRuntimeResolver';
import {
  renewDailyPlanScheduledIntentions,
  renewDailyRoutineScheduledIntentions,
  type DailyRoutineSchedule,
  type DailyRoutineScheduleResolver,
  type DailyPlanRenewalTraceScope,
  type DailyPlanRenewalTraceSink,
} from './dailyRoutineSchedule';
import type { WorkerDomainRuntimeRegistration } from './domainRuntimeRegistry';
import { completeFinishedActiveObjectives } from './objectiveLifecycle';
import {
  renewMissingActiveObjectives,
  type AutonomousObjectiveProposer,
  type WorkerObjectiveRenewalTraceSink,
} from './objectiveRenewal';
import { hydrateWorldProjectionFromEventStream } from './projectionHydration';
import {
  runWorkerSimulationTick,
  type WorkerTickMarketMetricsInput,
  type WorkerTickMarketObservationsInput,
  type WorkerTickProjectionCheckpointingInput,
  type WorkerTickProjectionHydrationInput,
  type WorkerTickResult,
} from './tickRunner';
import type { WorldCommandPolicySource } from './worldCommandPolicySource';

export type CanonicalWorkerActivePlanTickBaseInput = {
  readonly tickId: string;
  readonly simulationId: SimulationId;
  readonly issuedAt: SimulationTimestamp;
  readonly policies: WorldCommandPolicySource;
  readonly eventStore: EventStore<WorldEvent>;
  readonly streamName: EventStreamName;
  readonly intentionRepository: AgentIntentionRepository;
  readonly longTermProfileRepository: LongTermProfileRepository;
  readonly shortTermMemoryRepository: ShortTermMemoryRepository;
  readonly planRepository: BranchPlanRepository;
  readonly planProgressRepository?: BranchPlanProgressRepository;
  readonly objectiveProposer?: AutonomousObjectiveProposer;
  readonly objectiveRenewalTraceSink?: WorkerObjectiveRenewalTraceSink;
  readonly objectiveMemoryRetrievalLimit?: number;
  readonly agentMemoryRetrievalLimit?: number;
  readonly agentMemoryRetrievalCandidateLimit?: number;
  readonly dailyRoutineSchedule?: DailyRoutineSchedule | null;
  readonly dailyRoutineScheduleResolver?: DailyRoutineScheduleResolver;
  readonly dailyPlanCompiler?: DailyPlanCompiler;
  readonly dailyPlanRenewalTraceScope?: DailyPlanRenewalTraceScope;
  readonly dailyPlanRenewalTraceSink?: DailyPlanRenewalTraceSink;
  readonly strategicPlanCompiler?: StrategicPlanCompiler;
  readonly domainConfig?: CanonicalDomainRuntimeConfig;
  readonly additionalRegistrations?: readonly WorkerDomainRuntimeRegistration[];
  readonly repair?: CycleRepairPolicy;
  readonly timeDeltaMs?: number;
  readonly marketMetrics?: WorkerTickMarketMetricsInput;
  readonly marketObservations?: WorkerTickMarketObservationsInput;
  readonly expectedVersion?: number;
  readonly checkpointing?: WorkerTickProjectionCheckpointingInput;
  readonly traceSink?: WorkerAgentCycleTraceSink;
};

type CanonicalWorkerActivePlanTickProjectionInput =
  | {
      readonly projection: WorldProjection;
      readonly projectionHydration?: never;
    }
  | {
      readonly projection?: never;
      readonly projectionHydration: WorkerTickProjectionHydrationInput;
    };

export type CanonicalWorkerActivePlanTickInput = CanonicalWorkerActivePlanTickBaseInput &
  CanonicalWorkerActivePlanTickProjectionInput;

export async function runCanonicalWorkerActivePlanTick(
  input: CanonicalWorkerActivePlanTickInput,
): Promise<WorkerTickResult> {
  const projection = resolveSchedulingProjection(input);
  if (input.dailyPlanCompiler !== undefined) {
    await renewDailyPlanScheduledIntentions({
      projection,
      intentionRepository: input.intentionRepository,
      longTermProfileRepository: input.longTermProfileRepository,
      shortTermMemoryRepository: input.shortTermMemoryRepository,
      issuedAt: input.issuedAt,
      compileDailyPlan: input.dailyPlanCompiler,
      ...(input.dailyPlanRenewalTraceScope === undefined
        ? {}
        : { dailyPlanRenewalTraceScope: input.dailyPlanRenewalTraceScope }),
      ...(input.dailyPlanRenewalTraceSink === undefined
        ? {}
        : { dailyPlanRenewalTraceSink: input.dailyPlanRenewalTraceSink }),
    });
  } else if (input.dailyRoutineSchedule !== null) {
    await renewDailyRoutineScheduledIntentions({
      projection,
      intentionRepository: input.intentionRepository,
      longTermProfileRepository: input.longTermProfileRepository,
      issuedAt: input.issuedAt,
      ...(input.dailyRoutineSchedule === undefined ? {} : { schedule: input.dailyRoutineSchedule }),
      ...(input.dailyRoutineScheduleResolver === undefined
        ? {}
        : { resolveSchedule: input.dailyRoutineScheduleResolver }),
    });
  }
  await renewMissingActiveObjectives({
    projection,
    intentionRepository: input.intentionRepository,
    longTermProfileRepository: input.longTermProfileRepository,
    shortTermMemoryRepository: input.shortTermMemoryRepository,
    planRepository: input.planRepository,
    issuedAt: input.issuedAt,
    ...(input.objectiveMemoryRetrievalLimit === undefined
      ? {}
      : { memoryRetrievalLimit: input.objectiveMemoryRetrievalLimit }),
    ...(input.objectiveProposer === undefined
      ? {}
      : { objectiveProposer: input.objectiveProposer }),
    ...(input.objectiveRenewalTraceSink === undefined
      ? {}
      : { objectiveRenewalTraceSink: input.objectiveRenewalTraceSink }),
    ...(input.strategicPlanCompiler === undefined
      ? {}
      : { strategicPlanCompiler: input.strategicPlanCompiler }),
  });
  const agents = await buildWorkerTickAgentsFromActivePlans({
    projection,
    intentionRepository: input.intentionRepository,
    longTermProfileRepository: input.longTermProfileRepository,
    planRepository: input.planRepository,
    ...(input.planProgressRepository === undefined
      ? {}
      : { planProgressRepository: input.planProgressRepository }),
    ...(input.agentMemoryRetrievalLimit === undefined
      ? {}
      : { memoryRetrievalLimit: input.agentMemoryRetrievalLimit }),
    ...(input.agentMemoryRetrievalCandidateLimit === undefined
      ? {}
      : { memoryRetrievalCandidateLimit: input.agentMemoryRetrievalCandidateLimit }),
    resolveRuntime: createCanonicalWorkerRuntimeResolver({
      simulationId: input.simulationId,
      policies: input.policies,
      issuedAt: input.issuedAt,
      commandIdPrefix: `${input.tickId}-dry-run`,
      ...(input.domainConfig === undefined ? {} : { domainConfig: input.domainConfig }),
      ...(input.additionalRegistrations === undefined
        ? {}
        : { additionalRegistrations: input.additionalRegistrations }),
      ...(input.repair === undefined ? {} : { repair: input.repair }),
    }),
  });

  const result = await runWorkerSimulationTick({
    tickId: input.tickId,
    simulationId: input.simulationId,
    issuedAt: input.issuedAt,
    projection,
    policies: input.policies,
    eventStore: input.eventStore,
    streamName: input.streamName,
    intentionRepository: input.intentionRepository,
    longTermProfileRepository: input.longTermProfileRepository,
    shortTermMemoryRepository: input.shortTermMemoryRepository,
    planRepository: input.planRepository,
    ...(input.planProgressRepository === undefined
      ? {}
      : { planProgressRepository: input.planProgressRepository }),
    agents,
    ...(input.timeDeltaMs === undefined ? {} : { timeDeltaMs: input.timeDeltaMs }),
    ...(input.marketMetrics === undefined ? {} : { marketMetrics: input.marketMetrics }),
    ...(input.marketObservations === undefined
      ? {}
      : { marketObservations: input.marketObservations }),
    ...(input.expectedVersion === undefined ? {} : { expectedVersion: input.expectedVersion }),
    ...(input.checkpointing === undefined ? {} : { checkpointing: input.checkpointing }),
    ...(input.traceSink === undefined ? {} : { traceSink: input.traceSink }),
  });
  if (input.planProgressRepository !== undefined) {
    await completeFinishedActiveObjectives({
      projection: result.projection,
      intentionRepository: input.intentionRepository,
      planRepository: input.planRepository,
      planProgressRepository: input.planProgressRepository,
      completedAt: input.issuedAt,
    });
  }

  return result;
}

function resolveSchedulingProjection(input: CanonicalWorkerActivePlanTickInput): WorldProjection {
  if (input.projection !== undefined) {
    return input.projection;
  }

  return hydrateWorldProjectionFromEventStream({
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
  }).projection;
}
