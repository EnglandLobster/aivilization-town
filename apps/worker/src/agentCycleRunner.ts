import {
  runAgentPlanningCycle,
  type AgentCycleResult,
  type AdaptiveReplanningPolicy,
  type BranchPlan,
  type BranchPlanRepository,
  type BranchPlanProgress,
  type BranchPlanProgressRepository,
  type CycleActionSimulator,
  type CycleRepairPolicy,
  type DomainMicroPlanner,
} from '@aivilization/agent-runtime';
import type {
  AgentIntentionRepository,
  LongTermProfileRepository,
  ShortTermMemoryRecord,
  ShortTermMemoryRepository,
} from '@aivilization/memory';
import {
  createAgentCycleTrace,
  type AgentCycleTrace,
  type SimulatorTraceResult,
} from '@aivilization/observability';
import type { AgentId, EventStore, EventStreamName, SimulationId } from '@aivilization/sim-core';
import type { WorldCommandPolicies, WorldEvent, WorldProjection } from '@aivilization/world';
import {
  dispatchCommandDraftsToWorldEventStream,
  type DispatchCommandDraftsToEventStreamResult,
} from './commandDispatch';

export type WorkerAgentCycleTraceSink = {
  readonly record: (trace: AgentCycleTrace) => void | Promise<void>;
};

export type WorkerAgentCycleResult = {
  readonly cycleResult: AgentCycleResult;
  readonly dispatchResult?: DispatchCommandDraftsToEventStreamResult;
  readonly events: readonly WorldEvent[];
  readonly projection: WorldProjection;
  readonly shortTermMemoryRecords: readonly ShortTermMemoryRecord[];
  readonly progressUpdate?: BranchPlanProgress;
  readonly trace: AgentCycleTrace;
};

type WorkerAgentCyclePlanInput =
  | {
      readonly plan: BranchPlan;
      readonly planRepository?: BranchPlanRepository;
      readonly planId?: string;
    }
  | {
      readonly plan?: undefined;
      readonly planRepository: BranchPlanRepository;
      readonly planId: string;
    };

export async function runWorkerAgentCycle(
  input: {
    readonly cycleId: string;
    readonly simulationId: SimulationId;
    readonly agentId: AgentId;
    readonly issuedAt: number;
    readonly observedStateSummary: string;
    readonly progress?: BranchPlanProgress;
    readonly planProgressRepository?: BranchPlanProgressRepository;
    readonly planProgressId?: string;
    readonly signals: Parameters<typeof runAgentPlanningCycle>[0]['signals'];
    readonly projection: WorldProjection;
    readonly policies: WorldCommandPolicies;
    readonly eventStore: EventStore<WorldEvent>;
    readonly streamName: EventStreamName;
    readonly appendIdempotencyKey: string;
    readonly commandIdPrefix: string;
    readonly intentionRepository: AgentIntentionRepository;
    readonly longTermProfileRepository: LongTermProfileRepository;
    readonly shortTermMemoryRepository: ShortTermMemoryRepository;
    readonly memoryRetrievalLimit?: number;
    readonly microPlanners: readonly DomainMicroPlanner[];
    readonly simulate: CycleActionSimulator;
    readonly repair?: CycleRepairPolicy;
    readonly replanningPolicy?: AdaptiveReplanningPolicy;
    readonly expectedVersion?: number;
    readonly traceSink?: WorkerAgentCycleTraceSink;
  } & WorkerAgentCyclePlanInput,
): Promise<WorkerAgentCycleResult> {
  const [intentionState, longTermProfile, shortTermMemoryContext, plan] = await Promise.all([
    input.intentionRepository.getOrCreate(input.agentId),
    input.longTermProfileRepository.getOrCreate(input.agentId),
    input.memoryRetrievalLimit === undefined
      ? Promise.resolve<ShortTermMemoryRecord[]>([])
      : input.shortTermMemoryRepository.retrieve({
          agentId: input.agentId,
          limit: input.memoryRetrievalLimit,
        }),
    resolveBranchPlan({
      agentId: input.agentId,
      plan: input.plan,
      planRepository: input.planRepository,
      planId: input.planId,
    }),
  ]);
  const progress = await resolvePlanProgress({
    agentId: input.agentId,
    issuedAt: input.issuedAt,
    progress: input.progress,
    planProgressRepository: input.planProgressRepository,
    planProgressId: input.planProgressId,
  });
  const cycleResult = runAgentPlanningCycle({
    simulationId: input.simulationId,
    agentId: input.agentId,
    issuedAt: input.issuedAt,
    plan,
    ...(progress === undefined ? {} : { progress }),
    signals: input.signals,
    intentionState,
    longTermProfile,
    ...(input.memoryRetrievalLimit === undefined ? {} : { shortTermMemoryContext }),
    microPlanners: input.microPlanners,
    simulate: input.simulate,
    ...(input.repair === undefined ? {} : { repair: input.repair }),
    ...(input.replanningPolicy === undefined ? {} : { replanningPolicy: input.replanningPolicy }),
  });
  if (cycleResult.progressUpdate !== undefined && input.planProgressRepository !== undefined) {
    await input.planProgressRepository.save(cycleResult.progressUpdate);
  }

  const dispatchResult =
    cycleResult.commandDrafts.length === 0
      ? undefined
      : dispatchCommandDraftsToWorldEventStream({
          commandDrafts: cycleResult.commandDrafts,
          projection: input.projection,
          policies: input.policies,
          eventStore: input.eventStore,
          streamName: input.streamName,
          appendIdempotencyKey: input.appendIdempotencyKey,
          commandIdPrefix: input.commandIdPrefix,
          ...(input.expectedVersion === undefined
            ? {}
            : { expectedVersion: input.expectedVersion }),
        });
  const shortTermMemoryRecords =
    dispatchResult === undefined || dispatchResult.appendResult.idempotentReplay
      ? []
      : extractShortTermMemoryRecords(dispatchResult.events);
  if (shortTermMemoryRecords.length > 0) {
    await input.shortTermMemoryRepository.appendMany(shortTermMemoryRecords);
  }

  const trace = createAgentCycleTrace({
    traceId: input.cycleId,
    simulationId: input.simulationId,
    agentId: input.agentId,
    cycleStartedAt: input.issuedAt,
    observedStateSummary: input.observedStateSummary,
    selectedBranch: cycleResult.selectedSubtask.branchId,
    candidateActions: cycleResult.candidateActions.map((action) => action.description),
    simulatorResult: summarizeSimulatorResult(cycleResult),
    replanningDecision: cycleResult.replanningDecision,
    emittedCommandIds: dispatchResult?.commands.map((command) => command.id) ?? [],
    memoryContextIds: shortTermMemoryContext.map((record) => record.id),
    memoryWriteIds: extractShortTermMemoryRecords(dispatchResult?.events ?? []).map(
      (record) => record.id,
    ),
  });
  await input.traceSink?.record(trace);

  return {
    cycleResult,
    ...(dispatchResult === undefined ? {} : { dispatchResult }),
    events: dispatchResult?.events ?? [],
    projection: dispatchResult?.projection ?? input.projection,
    shortTermMemoryRecords,
    ...(cycleResult.progressUpdate === undefined
      ? {}
      : { progressUpdate: cycleResult.progressUpdate }),
    trace,
  };
}

async function resolveBranchPlan(input: {
  readonly agentId: AgentId;
  readonly plan: BranchPlan | undefined;
  readonly planRepository: BranchPlanRepository | undefined;
  readonly planId: string | undefined;
}): Promise<BranchPlan> {
  if (input.plan !== undefined) {
    return input.plan;
  }
  if (input.planRepository === undefined) {
    throw new Error('planRepository is required when plan is omitted');
  }
  if (input.planId === undefined) {
    throw new Error('planId is required when plan is omitted');
  }
  return (await input.planRepository.require({ planId: input.planId, agentId: input.agentId }))
    .plan;
}

async function resolvePlanProgress(input: {
  readonly agentId: AgentId;
  readonly issuedAt: number;
  readonly progress: BranchPlanProgress | undefined;
  readonly planProgressRepository: BranchPlanProgressRepository | undefined;
  readonly planProgressId: string | undefined;
}): Promise<BranchPlanProgress | undefined> {
  if (input.progress !== undefined) {
    return input.progress;
  }
  if (input.planProgressRepository === undefined) {
    return undefined;
  }
  if (input.planProgressId === undefined) {
    throw new Error('planProgressId is required when planProgressRepository is provided');
  }
  return input.planProgressRepository.getOrCreate({
    planId: input.planProgressId,
    agentId: input.agentId,
    createdAt: input.issuedAt,
  });
}

function extractShortTermMemoryRecords(
  events: readonly WorldEvent[],
): readonly ShortTermMemoryRecord[] {
  return events.flatMap((event) =>
    event.type === 'ShortTermMemoryRecorded' ? [event.payload.record] : [],
  );
}

function summarizeSimulatorResult(cycleResult: AgentCycleResult): SimulatorTraceResult {
  const firstReplan = cycleResult.simulationResults.find(
    (result) => result.status === 'needs-replan',
  );
  if (firstReplan !== undefined) {
    return { status: 'rejected', reason: firstReplan.reason };
  }
  const firstRepair = cycleResult.simulationResults.find((result) => result.status === 'repaired');
  if (firstRepair !== undefined) {
    return { status: 'repaired', reason: firstRepair.reason };
  }
  return { status: 'accepted' };
}
