import type {
  BranchPlanProgressRepository,
  BranchPlanRepository,
  CycleRepairPolicy,
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
import type { WorldCommandPolicies, WorldEvent, WorldProjection } from '@aivilization/world';
import { buildWorkerTickAgentsFromActivePlans } from './agentScheduling';
import type { WorkerAgentCycleTraceSink } from './agentCycleRunner';
import type { CanonicalDomainRuntimeConfig } from './canonicalDomainRuntimes';
import { createCanonicalWorkerRuntimeResolver } from './canonicalWorkerRuntimeResolver';
import type { WorkerDomainRuntimeRegistration } from './domainRuntimeRegistry';
import { hydrateWorldProjectionFromEventStream } from './projectionHydration';
import {
  runWorkerSimulationTick,
  type WorkerTickProjectionCheckpointingInput,
  type WorkerTickProjectionHydrationInput,
  type WorkerTickResult,
} from './tickRunner';

export type CanonicalWorkerActivePlanTickBaseInput = {
  readonly tickId: string;
  readonly simulationId: SimulationId;
  readonly issuedAt: SimulationTimestamp;
  readonly policies: WorldCommandPolicies;
  readonly eventStore: EventStore<WorldEvent>;
  readonly streamName: EventStreamName;
  readonly intentionRepository: AgentIntentionRepository;
  readonly longTermProfileRepository: LongTermProfileRepository;
  readonly shortTermMemoryRepository: ShortTermMemoryRepository;
  readonly planRepository: BranchPlanRepository;
  readonly planProgressRepository?: BranchPlanProgressRepository;
  readonly domainConfig?: CanonicalDomainRuntimeConfig;
  readonly additionalRegistrations?: readonly WorkerDomainRuntimeRegistration[];
  readonly repair?: CycleRepairPolicy;
  readonly timeDeltaMs?: number;
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
  const agents = await buildWorkerTickAgentsFromActivePlans({
    projection,
    intentionRepository: input.intentionRepository,
    planRepository: input.planRepository,
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

  return runWorkerSimulationTick({
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
    ...(input.expectedVersion === undefined ? {} : { expectedVersion: input.expectedVersion }),
    ...(input.checkpointing === undefined ? {} : { checkpointing: input.checkpointing }),
    ...(input.traceSink === undefined ? {} : { traceSink: input.traceSink }),
  });
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
