# Intention Schedule Prioritization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add durable long-horizon objective and scheduled intention state, then make Agent planning cycles rank subtasks using that state.

**Architecture:** `packages/memory` owns durable intention state because AIvilization treats human strategic steering as memory-propagated goal context. `packages/agent-runtime` reads an immutable state snapshot and converts active objectives or schedule slots into scoring influence; it still emits command drafts only through simulator-validated actions.

**Tech Stack:** TypeScript, pnpm workspaces, Vitest, strict ESM package boundaries.

---

## Scope

This slice implements the first strategic-steering substrate from the paper:

- Long-horizon objectives are durable state, not prompt-only instructions.
- Scheduled intentions represent temporal abstraction for daily plans and near-term commitments.
- Planner prioritization can favor subtasks aligned with active objectives or current schedule windows.
- Planning cycle callers can pass intention state without coupling memory repositories to runtime execution.

It does not implement LLM-generated decomposition, recurring daily schedule synthesis, reactive command routing, or global synthesis conflict resolution. Those require later slices after this state contract exists.

## File Structure

- Create `packages/memory/src/intentions.ts`: intention-state types, objective setter, schedule upsert, active schedule selector, validation, deterministic sorting.
- Create `packages/memory/src/intentionRepository.ts`: in-memory repository behind a durable-store-ready interface.
- Modify `packages/memory/src/index.ts`: export intention contracts.
- Create `packages/memory/src/intentions.test.ts`: TDD coverage for objective and schedule state.
- Create `packages/memory/src/intentionRepository.test.ts`: TDD coverage for repository clone isolation and state updates.
- Create `packages/agent-runtime/src/intentionInfluence.ts`: scoring bridge from intention state to per-subtask influence.
- Modify `packages/agent-runtime/src/index.ts`: export intention influence contracts.
- Modify `packages/agent-runtime/src/planner.ts`: add intention affinity tags and intention influence to subtask scoring.
- Modify `packages/agent-runtime/src/planner.test.ts`: prove intention influence participates in selection.
- Modify `packages/agent-runtime/src/cycle.ts`: compute intention influence when planning cycle receives intention state.
- Modify `packages/agent-runtime/src/cycle.test.ts`: prove planning cycle uses active objective and schedule state.
- Create `packages/agent-runtime/src/intentionInfluence.test.ts`: TDD coverage for objective and schedule scoring.
- Modify this plan file as tasks are completed.

## Task 1: Memory Intention State

**Files:**

- Create: `packages/memory/src/intentions.ts`
- Modify: `packages/memory/src/index.ts`
- Test: `packages/memory/src/intentions.test.ts`

- [ ] **Step 1: Write failing tests for objective and schedule state**

Create `packages/memory/src/intentions.test.ts` with tests that:

```ts
import { asAgentId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import {
  createEmptyAgentIntentionState,
  setLongHorizonObjective,
  upsertScheduledIntentions,
  selectActiveScheduledIntentions,
  type LongHorizonObjective,
  type ScheduledIntention,
} from './index';

describe('agent intention state', () => {
  test('creates empty intention state for an agent', () => {
    expect(createEmptyAgentIntentionState(asAgentId('agent-1'))).toEqual({
      agentId: 'agent-1',
      updatedAt: 0,
      scheduledIntentions: [],
    });
  });

  test('sets a long-horizon objective as durable goal context', () => {
    const agentId = asAgentId('agent-1');
    const objective: LongHorizonObjective = {
      id: 'objective-study',
      agentId,
      statement: 'Study before taking advanced production work.',
      priority: 2,
      source: 'human',
      affinityTags: ['study', 'education'],
      createdAt: 10,
      updatedAt: 20,
    };

    expect(setLongHorizonObjective(createEmptyAgentIntentionState(agentId), objective)).toEqual({
      agentId: 'agent-1',
      activeObjective: objective,
      updatedAt: 20,
      scheduledIntentions: [],
    });
  });

  test('upserts and sorts scheduled intentions deterministically', () => {
    const agentId = asAgentId('agent-1');
    const scheduled: readonly ScheduledIntention[] = [
      {
        id: 'evening-study',
        agentId,
        description: 'Study after dinner.',
        priority: 1,
        startsAt: 200,
        endsAt: 260,
        status: 'planned',
        affinityTags: ['study'],
        createdAt: 20,
        updatedAt: 20,
      },
      {
        id: 'morning-work',
        agentId,
        description: 'Work a short morning shift.',
        priority: 3,
        startsAt: 100,
        endsAt: 160,
        status: 'planned',
        affinityTags: ['work'],
        createdAt: 10,
        updatedAt: 10,
      },
    ];

    expect(
      upsertScheduledIntentions(createEmptyAgentIntentionState(agentId), scheduled)
        .scheduledIntentions,
    ).toEqual([scheduled[1], scheduled[0]]);
  });

  test('selects currently active non-cancelled schedule windows', () => {
    const agentId = asAgentId('agent-1');
    const state = upsertScheduledIntentions(createEmptyAgentIntentionState(agentId), [
      {
        id: 'active-study',
        agentId,
        description: 'Current study block.',
        priority: 2,
        startsAt: 100,
        endsAt: 200,
        status: 'active',
        affinityTags: ['study'],
        createdAt: 10,
        updatedAt: 10,
      },
      {
        id: 'cancelled-work',
        agentId,
        description: 'Cancelled work block.',
        priority: 5,
        startsAt: 100,
        endsAt: 200,
        status: 'cancelled',
        affinityTags: ['work'],
        createdAt: 10,
        updatedAt: 10,
      },
    ]);

    expect(selectActiveScheduledIntentions(state, 150).map((item) => item.id)).toEqual([
      'active-study',
    ]);
  });
});
```

- [ ] **Step 2: Run memory tests and verify RED**

Run: `pnpm --filter @aivilization/memory test`

Expected: FAIL because `createEmptyAgentIntentionState`, `setLongHorizonObjective`, `upsertScheduledIntentions`, and `selectActiveScheduledIntentions` do not exist.

- [ ] **Step 3: Implement intention state contracts**

Create `packages/memory/src/intentions.ts` with exported types:

```ts
export type LongHorizonObjectiveSource = 'human' | 'agent' | 'system';
export type ScheduledIntentionStatus = 'planned' | 'active' | 'completed' | 'cancelled';
export type LongHorizonObjective = {
  readonly id: string;
  readonly agentId: AgentId;
  readonly statement: string;
  readonly priority: number;
  readonly source: LongHorizonObjectiveSource;
  readonly affinityTags: readonly string[];
  readonly createdAt: SimulationTimestamp;
  readonly updatedAt: SimulationTimestamp;
};
export type ScheduledIntention = {
  readonly id: string;
  readonly agentId: AgentId;
  readonly objectiveId?: string;
  readonly branchId?: string;
  readonly subtaskId?: string;
  readonly description: string;
  readonly priority: number;
  readonly startsAt: SimulationTimestamp;
  readonly endsAt: SimulationTimestamp;
  readonly status: ScheduledIntentionStatus;
  readonly affinityTags: readonly string[];
  readonly createdAt: SimulationTimestamp;
  readonly updatedAt: SimulationTimestamp;
};
export type AgentIntentionState = {
  readonly agentId: AgentId;
  readonly activeObjective?: LongHorizonObjective;
  readonly scheduledIntentions: readonly ScheduledIntention[];
  readonly updatedAt: SimulationTimestamp;
};
```

Implement:

```ts
createEmptyAgentIntentionState(agentId);
setLongHorizonObjective(state, objective);
upsertScheduledIntentions(state, scheduledIntentions);
selectActiveScheduledIntentions(state, at);
```

Validation must reject mismatched agent ids, empty ids/statements/descriptions/tags, non-finite priorities/timestamps, and schedule windows where `endsAt <= startsAt`.

- [ ] **Step 4: Export the intention APIs**

Modify `packages/memory/src/index.ts` to export `./intentions`.

- [ ] **Step 5: Run focused verification**

Run:

```bash
pnpm --filter @aivilization/memory test
pnpm --filter @aivilization/memory typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add packages/memory/src/intentions.ts packages/memory/src/intentions.test.ts packages/memory/src/index.ts
git commit -m "feat: add agent intention state"
```

## Task 2: Intention Repository

**Files:**

- Create: `packages/memory/src/intentionRepository.ts`
- Create: `packages/memory/src/intentionRepository.test.ts`
- Modify: `packages/memory/src/index.ts`

- [ ] **Step 1: Write failing repository tests**

Create `packages/memory/src/intentionRepository.test.ts`:

```ts
import { asAgentId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import {
  createEmptyAgentIntentionState,
  InMemoryAgentIntentionRepository,
  type LongHorizonObjective,
  type ScheduledIntention,
} from './index';

describe('agent intention repository', () => {
  test('gets or creates empty intention state for an agent', async () => {
    const repository = new InMemoryAgentIntentionRepository();

    await expect(repository.getOrCreate(asAgentId('agent-1'))).resolves.toEqual(
      createEmptyAgentIntentionState(asAgentId('agent-1')),
    );
  });

  test('clones saved state at repository boundaries', async () => {
    const agentId = asAgentId('agent-1');
    const repository = new InMemoryAgentIntentionRepository();
    const schedule: ScheduledIntention = {
      id: 'study-block',
      agentId,
      description: 'Study quietly.',
      priority: 2,
      startsAt: 100,
      endsAt: 200,
      status: 'planned',
      affinityTags: ['study'],
      createdAt: 10,
      updatedAt: 10,
    };

    await repository.save({
      agentId,
      updatedAt: 10,
      scheduledIntentions: [schedule],
    });
    const firstRead = await repository.getOrCreate(agentId);
    firstRead.scheduledIntentions[0]?.affinityTags.includes('mutated');

    await expect(repository.getOrCreate(agentId)).resolves.toEqual({
      agentId: 'agent-1',
      updatedAt: 10,
      scheduledIntentions: [schedule],
    });
  });

  test('persists objective and schedule updates', async () => {
    const agentId = asAgentId('agent-1');
    const repository = new InMemoryAgentIntentionRepository();
    const objective: LongHorizonObjective = {
      id: 'objective-study',
      agentId,
      statement: 'Study before high-tech work.',
      priority: 2,
      source: 'human',
      affinityTags: ['study'],
      createdAt: 10,
      updatedAt: 20,
    };

    await repository.setObjective(agentId, objective);
    await repository.upsertScheduledIntentions(agentId, [
      {
        id: 'study-block',
        agentId,
        objectiveId: objective.id,
        description: 'Study now.',
        priority: 1,
        startsAt: 100,
        endsAt: 200,
        status: 'planned',
        affinityTags: ['study'],
        createdAt: 30,
        updatedAt: 30,
      },
    ]);

    await expect(repository.getOrCreate(agentId)).resolves.toMatchObject({
      activeObjective: objective,
      scheduledIntentions: [{ id: 'study-block' }],
      updatedAt: 30,
    });
  });
});
```

- [ ] **Step 2: Run memory tests and verify RED**

Run: `pnpm --filter @aivilization/memory test`

Expected: FAIL because `InMemoryAgentIntentionRepository` does not exist.

- [ ] **Step 3: Implement repository**

Create `AgentIntentionRepository` and `InMemoryAgentIntentionRepository` with methods:

```ts
getOrCreate(agentId);
save(state);
setObjective(agentId, objective);
upsertScheduledIntentions(agentId, scheduledIntentions);
```

Clone `activeObjective`, `scheduledIntentions`, and tag arrays on every repository boundary.

- [ ] **Step 4: Export repository**

Modify `packages/memory/src/index.ts` to export `./intentionRepository`.

- [ ] **Step 5: Run focused verification**

Run:

```bash
pnpm --filter @aivilization/memory test
pnpm --filter @aivilization/memory typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add packages/memory/src/intentionRepository.ts packages/memory/src/intentionRepository.test.ts packages/memory/src/index.ts
git commit -m "feat: add agent intention repository"
```

## Task 3: Runtime Intention Influence Scoring

**Files:**

- Create: `packages/agent-runtime/src/intentionInfluence.ts`
- Create: `packages/agent-runtime/src/intentionInfluence.test.ts`
- Modify: `packages/agent-runtime/src/index.ts`

- [ ] **Step 1: Write failing scoring tests**

Create `packages/agent-runtime/src/intentionInfluence.test.ts`:

```ts
import { asAgentId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import { scoreIntentionInfluence } from './index';

describe('intention influence scoring', () => {
  test('scores active objective and active schedule matches', () => {
    const agentId = asAgentId('agent-1');

    expect(
      scoreIntentionInfluence({
        intentionState: {
          agentId,
          updatedAt: 20,
          activeObjective: {
            id: 'objective-study',
            agentId,
            statement: 'Study before high-tech production.',
            priority: 2,
            source: 'human',
            affinityTags: ['education'],
            createdAt: 10,
            updatedAt: 20,
          },
          scheduledIntentions: [
            {
              id: 'current-study',
              agentId,
              description: 'Study current lessons.',
              priority: 1.5,
              startsAt: 100,
              endsAt: 200,
              status: 'active',
              affinityTags: ['study'],
              createdAt: 30,
              updatedAt: 30,
            },
          ],
        },
        affinityTags: ['education', 'study'],
        at: 150,
      }),
    ).toEqual({
      score: 8.5,
      matches: [
        {
          source: 'objective',
          id: 'objective-study',
          tag: 'education',
          contribution: 4,
        },
        {
          source: 'scheduled-intention',
          id: 'current-study',
          tag: 'study',
          contribution: 4.5,
        },
      ],
    });
  });

  test('ignores cancelled and out-of-window scheduled intentions', () => {
    const agentId = asAgentId('agent-1');

    expect(
      scoreIntentionInfluence({
        intentionState: {
          agentId,
          updatedAt: 20,
          scheduledIntentions: [
            {
              id: 'old-study',
              agentId,
              description: 'Past study.',
              priority: 10,
              startsAt: 1,
              endsAt: 2,
              status: 'completed',
              affinityTags: ['study'],
              createdAt: 1,
              updatedAt: 2,
            },
            {
              id: 'cancelled-study',
              agentId,
              description: 'Cancelled study.',
              priority: 10,
              startsAt: 100,
              endsAt: 200,
              status: 'cancelled',
              affinityTags: ['study'],
              createdAt: 1,
              updatedAt: 2,
            },
          ],
        },
        affinityTags: ['study'],
        at: 150,
      }),
    ).toEqual({ score: 0, matches: [] });
  });
});
```

- [ ] **Step 2: Run agent-runtime tests and verify RED**

Run: `pnpm --filter @aivilization/agent-runtime test`

Expected: FAIL because `scoreIntentionInfluence` does not exist.

- [ ] **Step 3: Implement scoring**

Create `scoreIntentionInfluence(input)` with:

```ts
input: {
  intentionState: AgentIntentionState;
  affinityTags: readonly string[];
  at: SimulationTimestamp;
}
```

Matching is case-insensitive against affinity tags plus objective statements or schedule descriptions.

Weights:

- active objective: `priority * 2`
- active schedule window: `priority * 3`

Return `{ score, matches }` with score rounded to 6 decimals and matches sorted deterministically.

- [ ] **Step 4: Export scoring**

Modify `packages/agent-runtime/src/index.ts` to export `./intentionInfluence`.

- [ ] **Step 5: Run focused verification**

Run:

```bash
pnpm --filter @aivilization/agent-runtime test
pnpm --filter @aivilization/agent-runtime typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add packages/agent-runtime/src/intentionInfluence.ts packages/agent-runtime/src/intentionInfluence.test.ts packages/agent-runtime/src/index.ts
git commit -m "feat: add intention influence scoring"
```

## Task 4: Planner and Cycle Integration

**Files:**

- Modify: `packages/agent-runtime/src/planner.ts`
- Modify: `packages/agent-runtime/src/planner.test.ts`
- Modify: `packages/agent-runtime/src/cycle.ts`
- Modify: `packages/agent-runtime/src/cycle.test.ts`

- [ ] **Step 1: Write failing planner and cycle tests**

Add planner coverage to `packages/agent-runtime/src/planner.test.ts`:

```ts
test('adds intention influence when selecting prioritized subtasks', () => {
  const plan = createBranchPlan({
    objective: 'follow long-term goal',
    branches: [
      {
        id: 'income',
        objective: 'earn wage',
        subtasks: [{ id: 'work', description: 'work shift', basePriority: 4 }],
      },
      {
        id: 'development',
        objective: 'study',
        subtasks: [
          {
            id: 'study',
            description: 'study now',
            basePriority: 2,
            intentionAffinityTags: ['study'],
          },
        ],
      },
    ],
  });

  expect(
    selectPrioritizedSubtask({
      plan,
      signals: [],
      intentionInfluence: {
        study: { score: 3, matches: [] },
      },
    }),
  ).toMatchObject({ branchId: 'development', subtaskId: 'study', score: 5 });
});
```

Add cycle coverage to `packages/agent-runtime/src/cycle.test.ts`:

```ts
test('uses intention state during subtask selection', () => {
  const agentId = asAgentId('agent-1');
  const plan = createBranchPlan({
    objective: 'follow strategic steering',
    branches: [
      {
        id: 'income',
        objective: 'earn wage',
        subtasks: [{ id: 'work', description: 'work shift', basePriority: 4 }],
      },
      {
        id: 'development',
        objective: 'study',
        subtasks: [
          {
            id: 'study',
            description: 'study now',
            basePriority: 1,
            intentionAffinityTags: ['study'],
          },
        ],
      },
    ],
  });

  const result = runAgentPlanningCycle({
    simulationId: asSimulationId('sim-1'),
    agentId,
    issuedAt: 150,
    plan,
    signals: [],
    intentionState: {
      agentId,
      updatedAt: 20,
      activeObjective: {
        id: 'objective-study',
        agentId,
        statement: 'Study before production.',
        priority: 2,
        source: 'human',
        affinityTags: ['study'],
        createdAt: 10,
        updatedAt: 20,
      },
      scheduledIntentions: [],
    },
    microPlanners: [
      {
        domain: 'study',
        supports: ({ subtaskId }) => subtaskId === 'study',
        propose: () => [
          {
            id: 'study-1',
            description: 'self study',
            commandType: 'AgentStudy',
            payload: { durationSeconds: 60, educationRatePerSecond: 1 },
          },
        ],
      },
    ],
    simulate: ({ action }) => ({ status: 'accepted', action }),
  });

  expect(result.selectedSubtask).toMatchObject({
    branchId: 'development',
    subtaskId: 'study',
    score: 5,
  });
  expect(result.commandDrafts[0]?.type).toBe('AgentStudy');
});
```

- [ ] **Step 2: Run agent-runtime tests and verify RED**

Run: `pnpm --filter @aivilization/agent-runtime test`

Expected: FAIL because `PlannerSubtask.intentionAffinityTags`, `selectPrioritizedSubtask.intentionInfluence`, and `runAgentPlanningCycle.intentionState` are missing.

- [ ] **Step 3: Implement planner integration**

Modify `PlannerSubtask` to include optional `intentionAffinityTags`.

Modify `createBranchPlan` to clone `intentionAffinityTags`.

Modify `selectPrioritizedSubtask` to accept optional `intentionInfluence` and add `intentionInfluence[subtask.id]?.score ?? 0`.

- [ ] **Step 4: Implement cycle integration**

Modify `runAgentPlanningCycle` input to include optional `intentionState`.

Build an intention influence record for every subtask using `scoreIntentionInfluence({ intentionState, affinityTags: subtask.intentionAffinityTags ?? [], at: issuedAt })`.

- [ ] **Step 5: Run focused verification**

Run:

```bash
pnpm --filter @aivilization/agent-runtime test
pnpm --filter @aivilization/agent-runtime typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add packages/agent-runtime/src/planner.ts packages/agent-runtime/src/planner.test.ts packages/agent-runtime/src/cycle.ts packages/agent-runtime/src/cycle.test.ts
git commit -m "feat: connect intentions to planning cycle"
```

## Task 5: Whole-Repo Verification

**Files:**

- Modify: `docs/superpowers/plans/2026-06-23-intention-schedule-prioritization-slice.md`

- [ ] Run `pnpm check`.
- [ ] Run `pnpm build`.
- [ ] Update completed checkboxes in this plan.
- [ ] Commit the final plan update.

## Acceptance Criteria

- Long-horizon objectives and scheduled intentions are first-class durable memory state.
- Repositories clone state at boundaries and are replaceable by future durable adapters.
- Planner subtask selection can be influenced independently by profile and intention state.
- Planning cycles remain pure over input snapshots and only emit command drafts after simulation.
- All new behavior is covered by failing-first tests.
- `pnpm check` and `pnpm build` pass.
