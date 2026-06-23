import type {
  CycleActionSimulator,
  CycleRepairPolicy,
  DomainMicroPlanner,
} from '@aivilization/agent-runtime';
import type {
  AgentIntentionRepository,
  LongTermProfileRepository,
  ShortTermMemoryRepository,
} from '@aivilization/memory';
import type { AgentCycleTrace } from '@aivilization/observability';
import {
  createCommandEnvelope,
  type AgentId,
  type EventStore,
  type EventStreamName,
  type SimulationId,
} from '@aivilization/sim-core';
import type { WorldCommandPolicies, WorldEvent, WorldProjection } from '@aivilization/world';
import {
  runWorkerAgentCycle,
  type WorkerAgentCycleResult,
  type WorkerAgentCycleTraceSink,
} from './agentCycleRunner';
import { dispatchWorldCommandToEventStream } from './commandDispatch';

export type WorkerTickAgentInput = {
  readonly agentId: AgentId;
  readonly observedStateSummary: string;
  readonly plan: Parameters<typeof runWorkerAgentCycle>[0]['plan'];
  readonly signals: Parameters<typeof runWorkerAgentCycle>[0]['signals'];
  readonly microPlanners: readonly DomainMicroPlanner[];
  readonly simulate: CycleActionSimulator;
  readonly repair?: CycleRepairPolicy;
};

export type WorkerTickResult = {
  readonly tickId: string;
  readonly simulationId: SimulationId;
  readonly issuedAt: number;
  readonly agentResults: readonly WorkerAgentCycleResult[];
  readonly events: readonly WorldEvent[];
  readonly projection: WorldProjection;
  readonly traces: readonly AgentCycleTrace[];
  readonly streamVersion: number;
};

export async function runWorkerSimulationTick(input: {
  readonly tickId: string;
  readonly simulationId: SimulationId;
  readonly issuedAt: number;
  readonly projection: WorldProjection;
  readonly policies: WorldCommandPolicies;
  readonly eventStore: EventStore<WorldEvent>;
  readonly streamName: EventStreamName;
  readonly intentionRepository: AgentIntentionRepository;
  readonly longTermProfileRepository: LongTermProfileRepository;
  readonly shortTermMemoryRepository: ShortTermMemoryRepository;
  readonly agents: readonly WorkerTickAgentInput[];
  readonly timeDeltaMs?: number;
  readonly expectedVersion?: number;
  readonly traceSink?: WorkerAgentCycleTraceSink;
}): Promise<WorkerTickResult> {
  assertNonEmpty(input.tickId, 'tickId');
  if (input.agents.length === 0) {
    throw new Error('worker tick requires at least one agent');
  }

  let projection = input.projection;
  let expectedVersion =
    input.expectedVersion ?? input.eventStore.getStreamVersion(input.streamName);
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
      plan: agent.plan,
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
      microPlanners: agent.microPlanners,
      simulate: agent.simulate,
      ...(agent.repair === undefined ? {} : { repair: agent.repair }),
      expectedVersion,
      ...(input.traceSink === undefined ? {} : { traceSink: input.traceSink }),
    });

    agentResults.push(cycleResult);
    projection = cycleResult.projection;
    expectedVersion = cycleResult.dispatchResult?.appendResult.streamVersion ?? expectedVersion;
  }

  const agentEvents = agentResults.flatMap((result) => result.events);

  return {
    tickId: input.tickId,
    simulationId: input.simulationId,
    issuedAt: input.issuedAt,
    agentResults,
    events: [...timeAdvanceResult.events, ...agentEvents],
    projection,
    traces: agentResults.map((result) => result.trace),
    streamVersion: expectedVersion,
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
