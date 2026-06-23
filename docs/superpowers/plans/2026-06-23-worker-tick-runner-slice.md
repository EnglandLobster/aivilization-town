# Worker Tick Runner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a worker-owned tick runner that executes multiple agent cycles in deterministic order while carrying projection and event-stream versions forward.

**Architecture:** `apps/worker` owns tick orchestration because it coordinates cycle execution, event-store optimistic concurrency, projection chaining, STM synchronization, and traces. This slice composes the existing single-agent cycle runner; it does not create a long-running loop, queue lease, distributed scheduler, or persistence adapter.

**Tech Stack:** TypeScript, Vitest, `@aivilization/agent-runtime`, `@aivilization/memory`, `@aivilization/sim-core`, `@aivilization/world`, worker cycle runner.

---

## Scope

This slice advances the worker from single-agent execution to a tick-sized batch unit:

- Run a list of agent cycle requests in caller-provided deterministic order.
- Pass the projection from each agent cycle into the next agent cycle.
- Track event stream `expectedVersion` across agent cycles.
- Use deterministic cycle ids, append idempotency keys, and command id prefixes derived from tick id, agent index, and agent id.
- Support idempotent whole-tick retries when the caller supplies the same starting `expectedVersion`.
- Continue after an agent needs replanning without appending an empty event batch.

It does not implement timed loops, queue leasing, distributed locks, parallel partitions, durable trace storage, file-backed event stores, SQLite projections, or live LLM calls.

## File Structure

- Create `apps/worker/src/tickRunner.test.ts`: TDD coverage for ordered multi-agent ticks, idempotent whole-tick retry, and replan continuation.
- Create `apps/worker/src/tickRunner.ts`: tick runner contracts and implementation.
- Modify `apps/worker/src/index.ts`: export the tick runner.
- Modify this plan file as tasks complete.

## Task 1: Tick Runner Tests

**Files:**

- Create: `apps/worker/src/tickRunner.test.ts`

- [x] **Step 1: Write failing tests for deterministic tick orchestration**

Create `apps/worker/src/tickRunner.test.ts`:

```ts
import {
  createBranchPlan,
  type AtomicActionProposal,
  type DomainMicroPlanner,
} from '@aivilization/agent-runtime';
import {
  InMemoryAgentIntentionRepository,
  InMemoryLongTermProfileRepository,
  InMemoryShortTermMemoryRepository,
} from '@aivilization/memory';
import {
  InMemoryEventStore,
  asAgentId,
  asSimulationId,
  createSimulationPartition,
} from '@aivilization/sim-core';
import {
  createWorldProjection,
  type WorldCommandPolicies,
  type WorldEvent,
} from '@aivilization/world';
import { describe, expect, test } from 'vitest';
import { runWorkerSimulationTick } from './index';

const simulationId = asSimulationId('sim-1');
const agentOne = asAgentId('agent-1');
const agentTwo = asAgentId('agent-2');
const partition = createSimulationPartition({ simulationId, partitionKey: 'world-main' });

const policies: WorldCommandPolicies = {
  satietyRecoveryByCommodity: { Bread: 15 },
  maxSatiety: 100,
  wageCalculator: () => 10,
  laborCost: { energyCostPerHour: 10, satietyCostPerHour: 10 },
  criticalThresholds: { energy: 1, health: 1 },
  sleep: { energyRecoveryPerSecond: 1, maxEnergy: 100 },
  jobApplication: {
    populationEducationScores: [0],
    quotaByResidentialTier: [1, 1, 1, 1, 1],
  },
};

function createProjection() {
  return createWorldProjection({
    agents: [
      {
        agentId: agentOne,
        physiology: { energy: 50, satiety: 80, health: 100 },
        educationScore: 10,
        balance: 100,
        residentialTier: 1,
        job: null,
        inventory: {},
      },
      {
        agentId: agentTwo,
        physiology: { energy: 60, satiety: 80, health: 100 },
        educationScore: 20,
        balance: 100,
        residentialTier: 1,
        job: null,
        inventory: {},
      },
    ],
  });
}

function createStudyPlan() {
  return createBranchPlan({
    objective: 'develop education',
    branches: [
      {
        id: 'development',
        objective: 'improve education',
        subtasks: [{ id: 'study', description: 'self study', basePriority: 5 }],
      },
    ],
  });
}

function createStudyPlanner(action: AtomicActionProposal): DomainMicroPlanner {
  return {
    domain: 'study',
    supports: ({ subtaskId }) => subtaskId === 'study',
    propose: () => [action],
  };
}

function createRepositories() {
  return {
    intentionRepository: new InMemoryAgentIntentionRepository(),
    longTermProfileRepository: new InMemoryLongTermProfileRepository(),
    shortTermMemoryRepository: new InMemoryShortTermMemoryRepository(),
  };
}

function createTickAgents() {
  return [
    {
      agentId: agentOne,
      observedStateSummary: 'agent-1 education=10',
      plan: createStudyPlan(),
      signals: [],
      microPlanners: [
        createStudyPlanner({
          id: 'study-agent-1',
          description: 'agent 1 studies',
          commandType: 'AgentStudy',
          payload: { durationSeconds: 60, educationRatePerSecond: 1 },
        }),
      ],
      simulate: ({ action }) => ({ status: 'accepted', action }),
    },
    {
      agentId: agentTwo,
      observedStateSummary: 'agent-2 education=20',
      plan: createStudyPlan(),
      signals: [],
      microPlanners: [
        createStudyPlanner({
          id: 'study-agent-2',
          description: 'agent 2 studies',
          commandType: 'AgentStudy',
          payload: { durationSeconds: 30, educationRatePerSecond: 1 },
        }),
      ],
      simulate: ({ action }) => ({ status: 'accepted', action }),
    },
  ] satisfies Parameters<typeof runWorkerSimulationTick>[0]['agents'];
}

describe('worker tick runner', () => {
  test('runs agent cycles in order while carrying projection and stream version forward', async () => {
    const eventStore = new InMemoryEventStore<WorldEvent>();
    const repositories = createRepositories();
    const result = await runWorkerSimulationTick({
      tickId: 'tick-1',
      simulationId,
      issuedAt: 100,
      projection: createProjection(),
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      agents: createTickAgents(),
      ...repositories,
    });

    expect(result.agentResults).toHaveLength(2);
    expect(result.events.map((event) => [event.sequence, event.type])).toEqual([
      [1, 'EducationChanged'],
      [2, 'ShortTermMemoryRecorded'],
      [3, 'EducationChanged'],
      [4, 'ShortTermMemoryRecorded'],
    ]);
    expect(result.projection.agents['agent-1']?.educationScore).toBe(70);
    expect(result.projection.agents['agent-2']?.educationScore).toBe(50);
    expect(result.streamVersion).toBe(4);
    expect(result.traces.map((trace) => trace.traceId)).toEqual([
      'tick-1:cycle:1:agent-1',
      'tick-1:cycle:2:agent-2',
    ]);
    expect(eventStore.getStreamVersion(partition.eventStreamName)).toBe(4);
  });

  test('replays a whole tick idempotently from the same starting expected version', async () => {
    const eventStore = new InMemoryEventStore<WorldEvent>();
    const repositories = createRepositories();
    const input = {
      tickId: 'tick-1',
      simulationId,
      issuedAt: 100,
      projection: createProjection(),
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      agents: createTickAgents(),
      ...repositories,
    } satisfies Parameters<typeof runWorkerSimulationTick>[0];

    await runWorkerSimulationTick(input);
    const replay = await runWorkerSimulationTick(input);

    expect(replay.agentResults.map((result) => result.dispatchResult?.appendResult.idempotentReplay)).toEqual([
      true,
      true,
    ]);
    expect(eventStore.readStream(partition.eventStreamName)).toHaveLength(4);
    await expect(
      repositories.shortTermMemoryRepository.retrieve({
        agentId: agentOne,
        statuses: ['succeeded'],
        requiredTags: ['study'],
        limit: 10,
      }),
    ).resolves.toHaveLength(1);
    await expect(
      repositories.shortTermMemoryRepository.retrieve({
        agentId: agentTwo,
        statuses: ['succeeded'],
        requiredTags: ['study'],
        limit: 10,
      }),
    ).resolves.toHaveLength(1);
  });

  test('continues later agents when an earlier agent requires replanning', async () => {
    const eventStore = new InMemoryEventStore<WorldEvent>();
    const repositories = createRepositories();
    const agents = createTickAgents();
    const result = await runWorkerSimulationTick({
      tickId: 'tick-replan',
      simulationId,
      issuedAt: 100,
      projection: createProjection(),
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      agents: [
        {
          ...agents[0],
          simulate: ({ action }) => ({ status: 'rejected', action, reason: 'energy too low' }),
        },
        agents[1],
      ],
      ...repositories,
    });

    expect(result.agentResults[0]?.dispatchResult).toBeUndefined();
    expect(result.agentResults[0]?.cycleResult.needsReplan).toBe(true);
    expect(result.events.map((event) => event.sequence)).toEqual([1, 2]);
    expect(result.projection.agents['agent-1']?.educationScore).toBe(10);
    expect(result.projection.agents['agent-2']?.educationScore).toBe(50);
    expect(result.streamVersion).toBe(2);
    expect(result.traces.map((trace) => trace.simulatorResult.status)).toEqual([
      'rejected',
      'accepted',
    ]);
  });
});
```

- [x] **Step 2: Run worker tests and verify RED**

Run:

```bash
pnpm --filter @aivilization/worker test
```

Expected: FAIL because `runWorkerSimulationTick` is not exported.

## Task 2: Tick Runner Implementation

**Files:**

- Create: `apps/worker/src/tickRunner.ts`
- Modify: `apps/worker/src/index.ts`

- [x] **Step 1: Implement tick runner contracts and orchestration**

Create `apps/worker/src/tickRunner.ts`:

```ts
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
import type { AgentId, EventStore, EventStreamName, SimulationId } from '@aivilization/sim-core';
import type { WorldCommandPolicies, WorldEvent, WorldProjection } from '@aivilization/world';
import {
  runWorkerAgentCycle,
  type WorkerAgentCycleResult,
  type WorkerAgentCycleTraceSink,
} from './agentCycleRunner';

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
  readonly expectedVersion?: number;
  readonly traceSink?: WorkerAgentCycleTraceSink;
}): Promise<WorkerTickResult> {
  assertNonEmpty(input.tickId, 'tickId');
  if (input.agents.length === 0) {
    throw new Error('worker tick requires at least one agent');
  }

  let projection = input.projection;
  let expectedVersion = input.expectedVersion ?? input.eventStore.getStreamVersion(input.streamName);
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

  return {
    tickId: input.tickId,
    simulationId: input.simulationId,
    issuedAt: input.issuedAt,
    agentResults,
    events: agentResults.flatMap((result) => result.events),
    projection,
    traces: agentResults.map((result) => result.trace),
    streamVersion: expectedVersion,
  };
}
```

Then add helper functions in the same file:

```ts
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
```

- [x] **Step 2: Export tick runner**

Modify `apps/worker/src/index.ts`:

```ts
export * from './tickRunner';
```

- [x] **Step 3: Run focused verification**

Run:

```bash
pnpm --filter @aivilization/worker test
pnpm --filter @aivilization/worker typecheck
```

Expected: PASS.

- [x] **Step 4: Commit**

Run:

```bash
git add apps/worker/src/tickRunner.ts apps/worker/src/tickRunner.test.ts apps/worker/src/index.ts
git commit -m "feat: add worker tick runner"
```

## Task 3: Whole-Repo Verification

**Files:**

- Modify: `docs/superpowers/plans/2026-06-23-worker-tick-runner-slice.md`

- [x] Run `pnpm check`.
- [x] Run `pnpm build`.
- [x] Update this plan's completed checkboxes.
- [x] Commit the final plan update.

## Acceptance Criteria

- Worker can run a deterministic tick containing multiple agent cycles.
- Projection state flows from each completed agent cycle to the next.
- Event stream expected versions advance across agent cycles.
- Whole-tick retries with the same starting expected version replay idempotently without duplicating committed events or STM writes.
- Agents that need replan do not append empty event batches and do not block later agents in the same tick.
- Tick result returns aggregate events, traces, final projection, and final stream version.
- Existing worker cycle, dispatch, and steering tests remain green.
- `pnpm check` and `pnpm build` pass.
