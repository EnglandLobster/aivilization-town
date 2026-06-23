# Worker Agent Cycle Runner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a worker-owned single-agent cycle runner that executes planner cycles, persists emitted world events, projects STM writes, and records an observability trace.

**Architecture:** `apps/worker` owns this orchestration because it coordinates `agent-runtime`, memory repositories, world dispatch, event-store append, and observability without moving those responsibilities into domain packages. The runner is a single-cycle unit: durable queues, repeating tick loops, file-backed event logs, and SQLite projections can compose it later.

**Tech Stack:** TypeScript, Vitest, `@aivilization/agent-runtime`, `@aivilization/memory`, `@aivilization/observability`, `@aivilization/sim-core`, `@aivilization/world`.

---

## Scope

This slice advances worker execution from command dispatch to an agent cycle unit:

- Fetch intention state and long-term profile for the agent.
- Run `runAgentPlanningCycle`.
- Persist accepted/repaired command drafts through `dispatchCommandDraftsToWorldEventStream`.
- Mirror freshly committed `ShortTermMemoryRecorded` events into the STM repository.
- Create an `AgentCycleTrace` containing selected branch, candidate actions, simulator outcome, emitted command ids, and memory write ids.
- Support cycles that need replanning without appending empty event batches.

It does not implement queue leasing, retry backoff, durable trace storage, file-backed event store, SQLite projections, live LLM calls, or a repeating worker loop.

## File Structure

- Create `apps/worker/src/agentCycleRunner.test.ts`: TDD coverage for successful cycles, idempotent event append replay, and needs-replan cycles.
- Create `apps/worker/src/agentCycleRunner.ts`: runner contract and implementation.
- Modify `apps/worker/src/index.ts`: export the runner.
- Modify this plan file as tasks complete.

## Task 1: Agent Cycle Runner Tests

**Files:**

- Create: `apps/worker/src/agentCycleRunner.test.ts`

- [ ] **Step 1: Write failing tests for worker agent cycle orchestration**

Create `apps/worker/src/agentCycleRunner.test.ts`:

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
import { InMemoryEventStore, asAgentId, asSimulationId, createSimulationPartition } from '@aivilization/sim-core';
import { createWorldProjection, type WorldCommandPolicies, type WorldEvent } from '@aivilization/world';
import { describe, expect, test } from 'vitest';
import { runWorkerAgentCycle, type WorkerAgentCycleTraceSink } from './index';

const simulationId = asSimulationId('sim-1');
const agentId = asAgentId('agent-1');
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
        agentId,
        physiology: { energy: 50, satiety: 80, health: 100 },
        educationScore: 10,
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

describe('worker agent cycle runner', () => {
  test('runs a planning cycle, appends world events, stores STM records, and emits a trace', async () => {
    const repositories = createRepositories();
    const eventStore = new InMemoryEventStore<WorldEvent>();
    const traces: unknown[] = [];
    const traceSink: WorkerAgentCycleTraceSink = {
      record: (trace) => {
        traces.push(trace);
      },
    };

    const result = await runWorkerAgentCycle({
      cycleId: 'cycle-1',
      simulationId,
      agentId,
      issuedAt: 100,
      observedStateSummary: 'energy=50 satiety=80 health=100 education=10',
      plan: createStudyPlan(),
      signals: [],
      projection: createProjection(),
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      appendIdempotencyKey: 'cycle-1',
      commandIdPrefix: 'cycle-1-command',
      microPlanners: [
        createStudyPlanner({
          id: 'study-1',
          description: 'study for one minute',
          commandType: 'AgentStudy',
          payload: { durationSeconds: 60, educationRatePerSecond: 1 },
        }),
      ],
      simulate: ({ action }) => ({ status: 'accepted', action }),
      traceSink,
      ...repositories,
    });

    expect(result.cycleResult.selectedSubtask).toMatchObject({
      branchId: 'development',
      subtaskId: 'study',
    });
    expect(result.dispatchResult?.appendResult).toMatchObject({
      streamVersion: 2,
      idempotentReplay: false,
    });
    expect(result.events.map((event) => [event.sequence, event.type])).toEqual([
      [1, 'EducationChanged'],
      [2, 'ShortTermMemoryRecorded'],
    ]);
    expect(result.projection.agents['agent-1']?.educationScore).toBe(70);
    await expect(
      repositories.shortTermMemoryRepository.retrieve({
        agentId,
        statuses: ['succeeded'],
        requiredTags: ['study'],
        limit: 10,
      }),
    ).resolves.toHaveLength(1);
    expect(result.trace).toMatchObject({
      traceId: 'cycle-1',
      selectedBranch: 'development',
      candidateActions: ['study for one minute'],
      simulatorResult: { status: 'accepted' },
      emittedCommandIds: ['cycle-1-command-1'],
      memoryWriteIds: ['cycle-1-command-1:memory:1'],
    });
    expect(traces).toEqual([result.trace]);
  });

  test('replays idempotent event appends without duplicating STM repository writes', async () => {
    const repositories = createRepositories();
    const eventStore = new InMemoryEventStore<WorldEvent>();
    const input = {
      cycleId: 'cycle-1',
      simulationId,
      agentId,
      issuedAt: 100,
      observedStateSummary: 'energy=50 satiety=80 health=100 education=10',
      plan: createStudyPlan(),
      signals: [],
      projection: createProjection(),
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      appendIdempotencyKey: 'cycle-1',
      commandIdPrefix: 'cycle-1-command',
      microPlanners: [
        createStudyPlanner({
          id: 'study-1',
          description: 'study for one minute',
          commandType: 'AgentStudy',
          payload: { durationSeconds: 60, educationRatePerSecond: 1 },
        }),
      ],
      simulate: ({ action }) => ({ status: 'accepted', action }),
      ...repositories,
    } satisfies Parameters<typeof runWorkerAgentCycle>[0];

    await runWorkerAgentCycle(input);
    const replay = await runWorkerAgentCycle(input);

    expect(replay.dispatchResult?.appendResult.idempotentReplay).toBe(true);
    expect(eventStore.readStream(partition.eventStreamName)).toHaveLength(2);
    await expect(
      repositories.shortTermMemoryRepository.retrieve({
        agentId,
        statuses: ['succeeded'],
        requiredTags: ['study'],
        limit: 10,
      }),
    ).resolves.toHaveLength(1);
  });

  test('records a rejected trace and skips event append when simulator requires replanning', async () => {
    const repositories = createRepositories();
    const eventStore = new InMemoryEventStore<WorldEvent>();

    const result = await runWorkerAgentCycle({
      cycleId: 'cycle-replan',
      simulationId,
      agentId,
      issuedAt: 100,
      observedStateSummary: 'energy=0 satiety=80 health=100 education=10',
      plan: createStudyPlan(),
      signals: [],
      projection: createProjection(),
      policies,
      eventStore,
      streamName: partition.eventStreamName,
      expectedVersion: 0,
      appendIdempotencyKey: 'cycle-replan',
      commandIdPrefix: 'cycle-replan-command',
      microPlanners: [
        createStudyPlanner({
          id: 'study-1',
          description: 'study for one minute',
          commandType: 'AgentStudy',
          payload: { durationSeconds: 60, educationRatePerSecond: 1 },
        }),
      ],
      simulate: ({ action }) => ({ status: 'rejected', action, reason: 'energy too low' }),
      ...repositories,
    });

    expect(result.cycleResult.needsReplan).toBe(true);
    expect(result.dispatchResult).toBeUndefined();
    expect(result.events).toEqual([]);
    expect(eventStore.getStreamVersion(partition.eventStreamName)).toBe(0);
    expect(result.trace).toMatchObject({
      traceId: 'cycle-replan',
      simulatorResult: { status: 'rejected', reason: 'energy too low' },
      emittedCommandIds: [],
      memoryWriteIds: [],
    });
  });
});
```

- [ ] **Step 2: Run worker tests and verify RED**

Run:

```bash
pnpm --filter @aivilization/worker test
```

Expected: FAIL because `runWorkerAgentCycle` is not exported.

## Task 2: Agent Cycle Runner Implementation

**Files:**

- Create: `apps/worker/src/agentCycleRunner.ts`
- Modify: `apps/worker/src/index.ts`

- [ ] **Step 1: Implement runner contract and orchestration**

Create `apps/worker/src/agentCycleRunner.ts`:

```ts
import {
  runAgentPlanningCycle,
  type AgentCycleResult,
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
import { createAgentCycleTrace, type AgentCycleTrace, type SimulatorTraceResult } from '@aivilization/observability';
import type { AgentId, EventStore, EventStreamName, SimulationId } from '@aivilization/sim-core';
import type { WorldCommandPolicies, WorldEvent, WorldProjection } from '@aivilization/world';
import { dispatchCommandDraftsToWorldEventStream, type DispatchCommandDraftsToEventStreamResult } from './commandDispatch';

export type WorkerAgentCycleTraceSink = {
  readonly record: (trace: AgentCycleTrace) => void | Promise<void>;
};

export type WorkerAgentCycleResult = {
  readonly cycleResult: AgentCycleResult;
  readonly dispatchResult?: DispatchCommandDraftsToEventStreamResult;
  readonly events: readonly WorldEvent[];
  readonly projection: WorldProjection;
  readonly shortTermMemoryRecords: readonly ShortTermMemoryRecord[];
  readonly trace: AgentCycleTrace;
};

export async function runWorkerAgentCycle(input: {
  readonly cycleId: string;
  readonly simulationId: SimulationId;
  readonly agentId: AgentId;
  readonly issuedAt: number;
  readonly observedStateSummary: string;
  readonly plan: Parameters<typeof runAgentPlanningCycle>[0]['plan'];
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
  readonly microPlanners: readonly DomainMicroPlanner[];
  readonly simulate: CycleActionSimulator;
  readonly repair?: CycleRepairPolicy;
  readonly expectedVersion?: number;
  readonly traceSink?: WorkerAgentCycleTraceSink;
}): Promise<WorkerAgentCycleResult> {
  const [intentionState, longTermProfile] = await Promise.all([
    input.intentionRepository.getOrCreate(input.agentId),
    input.longTermProfileRepository.getOrCreate(input.agentId),
  ]);
  const cycleResult = runAgentPlanningCycle({
    simulationId: input.simulationId,
    agentId: input.agentId,
    issuedAt: input.issuedAt,
    plan: input.plan,
    signals: input.signals,
    intentionState,
    longTermProfile,
    microPlanners: input.microPlanners,
    simulate: input.simulate,
    ...(input.repair === undefined ? {} : { repair: input.repair }),
  });

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
          ...(input.expectedVersion === undefined ? {} : { expectedVersion: input.expectedVersion }),
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
    emittedCommandIds: dispatchResult?.commands.map((command) => command.id) ?? [],
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
    trace,
  };
}
```

Then add helper functions in the same file:

```ts
function extractShortTermMemoryRecords(events: readonly WorldEvent[]): readonly ShortTermMemoryRecord[] {
  return events.flatMap((event) =>
    event.type === 'ShortTermMemoryRecorded' ? [event.payload.record] : [],
  );
}

function summarizeSimulatorResult(cycleResult: AgentCycleResult): SimulatorTraceResult {
  const firstReplan = cycleResult.simulationResults.find((result) => result.status === 'needs-replan');
  if (firstReplan !== undefined) {
    return { status: 'rejected', reason: firstReplan.reason };
  }
  const firstRepair = cycleResult.simulationResults.find((result) => result.status === 'repaired');
  if (firstRepair !== undefined) {
    return { status: 'repaired', reason: firstRepair.reason };
  }
  return { status: 'accepted' };
}
```

- [ ] **Step 2: Export runner**

Modify `apps/worker/src/index.ts`:

```ts
export * from './agentCycleRunner';
```

- [ ] **Step 3: Run focused verification**

Run:

```bash
pnpm --filter @aivilization/worker test
pnpm --filter @aivilization/worker typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

Run:

```bash
git add apps/worker/src/agentCycleRunner.ts apps/worker/src/agentCycleRunner.test.ts apps/worker/src/index.ts
git commit -m "feat: add worker agent cycle runner"
```

## Task 3: Whole-Repo Verification

**Files:**

- Modify: `docs/superpowers/plans/2026-06-23-worker-agent-cycle-runner-slice.md`

- [ ] Run `pnpm check`.
- [ ] Run `pnpm build`.
- [ ] Update this plan's completed checkboxes.
- [ ] Commit the final plan update.

## Acceptance Criteria

- Worker can execute one agent planning cycle using intention state and long-term profile.
- Accepted/repaired command drafts are appended through the authoritative world event stream seam.
- Fresh committed STM events are reflected into the STM repository.
- Idempotent event-store replays do not duplicate STM repository writes.
- Cycles requiring replan record a rejected trace and skip empty event appends.
- Every cycle returns an `AgentCycleTrace` with planner, simulator, command, and memory evidence.
- Existing worker steering and command dispatch tests remain green.
- `pnpm check` and `pnpm build` pass.
