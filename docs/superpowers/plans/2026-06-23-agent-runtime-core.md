# Agent Runtime Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first deterministic Branch-Thinking Planner, Action Simulator, repair, and cycle orchestration contracts.

**Architecture:** `agent-runtime` produces proposals and command drafts only; it never mutates world state. Branch selection, micro-planning, simulation, repair, and command creation are separate ports so deterministic rule planners, LLM planners, and domain validators can be swapped independently.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, `@aivilization/sim-core`.

---

## Scope

This plan implements the first Phase 4 agent-runtime slice from `docs/superpowers/specs/2026-06-23-aivilization-town-design.md`.

It covers:

- Branch-thinking plan validation.
- Contextual subtask prioritization from explicit weighted signals.
- Atomic action proposals from micro-planner ports.
- Action simulation results for accepted, rejected, and repaired candidates.
- Local repair escalation when a repair action cannot be validated.
- One deterministic agent-cycle orchestrator that returns command drafts instead of mutating state.

It does not cover live LLM calls, durable task queues, full domain command validation, UI traces, or adaptive long-horizon learning.

## File Structure

- Create `packages/agent-runtime/src/planner.ts`: branch plan types, validation, and contextual subtask selection.
- Create `packages/agent-runtime/src/planner.test.ts`: branch validation and priority tests.
- Create `packages/agent-runtime/src/actions.ts`: atomic action proposal, simulator result, and repair helper types.
- Create `packages/agent-runtime/src/actions.test.ts`: simulation and repair tests.
- Create `packages/agent-runtime/src/cycle.ts`: deterministic planning cycle orchestration.
- Create `packages/agent-runtime/src/cycle.test.ts`: micro-planner selection, simulator gating, and command draft tests.
- Modify `packages/agent-runtime/src/index.ts`: export public runtime API.

## Tasks

### Task 1: Branch Plan And Contextual Prioritization

**Files:**

- Create: `packages/agent-runtime/src/planner.ts`
- Create: `packages/agent-runtime/src/planner.test.ts`
- Modify: `packages/agent-runtime/src/index.ts`

- [x] Write failing tests for branch validation and contextual subtask selection:

```ts
import { describe, expect, test } from 'vitest';
import { createBranchPlan, selectPrioritizedSubtask } from './index';

describe('branch-thinking planner', () => {
  test('rejects empty branches and duplicate branch ids', () => {
    expect(() => createBranchPlan({ objective: 'survive', branches: [] })).toThrow(/branch/);
    expect(() =>
      createBranchPlan({
        objective: 'survive',
        branches: [
          {
            id: 'work',
            objective: 'earn money',
            subtasks: [{ id: 'shift', description: 'work', basePriority: 1 }],
          },
          {
            id: 'work',
            objective: 'study',
            subtasks: [{ id: 'study', description: 'study', basePriority: 1 }],
          },
        ],
      }),
    ).toThrow(/duplicate branch id work/);
  });

  test('selects the highest-scoring subtask from explicit context signals', () => {
    const plan = createBranchPlan({
      objective: 'stabilize life',
      branches: [
        {
          id: 'income',
          objective: 'earn wage',
          subtasks: [
            {
              id: 'work',
              description: 'take a work shift',
              basePriority: 2,
              signalKeys: ['low-money'],
            },
          ],
        },
        {
          id: 'health',
          objective: 'recover',
          subtasks: [
            {
              id: 'eat',
              description: 'buy and eat food',
              basePriority: 1,
              signalKeys: ['low-satiety'],
            },
          ],
        },
      ],
    });

    expect(
      selectPrioritizedSubtask({ plan, signals: [{ key: 'low-satiety', weight: 5 }] }),
    ).toEqual({
      branchId: 'health',
      subtaskId: 'eat',
      description: 'buy and eat food',
      score: 6,
    });
  });
});
```

- [x] Run `pnpm --filter @aivilization/agent-runtime test` and confirm planner APIs are missing.
- [x] Implement `PlannerBranch`, `PlannerSubtask`, `BranchPlan`, `ContextSignal`, `createBranchPlan`, and `selectPrioritizedSubtask`.
- [x] Run `pnpm --filter @aivilization/agent-runtime test` and `pnpm --filter @aivilization/agent-runtime typecheck`.
- [x] Commit with `git commit -m "feat: add branch planner core"`.

### Task 2: Action Simulation And Repair

**Files:**

- Create: `packages/agent-runtime/src/actions.ts`
- Create: `packages/agent-runtime/src/actions.test.ts`
- Modify: `packages/agent-runtime/src/index.ts`

- [ ] Write failing tests for accepted, repaired, and escalated action simulation:

```ts
import { describe, expect, test } from 'vitest';
import { simulateActionWithRepair } from './index';

describe('action simulator repair', () => {
  test('returns accepted simulation results without repair', () => {
    const action = {
      id: 'eat-1',
      description: 'eat bread',
      commandType: 'AgentEat' as const,
      payload: { commodity: 'Bread' },
    };
    expect(
      simulateActionWithRepair({ action, simulate: () => ({ status: 'accepted', action }) }),
    ).toEqual({
      status: 'accepted',
      action,
    });
  });

  test('repairs a rejected action when the repaired action validates', () => {
    const action = {
      id: 'work-1',
      description: 'work shift',
      commandType: 'AgentWork' as const,
      payload: { occupation: 'Cleaner' },
    };
    const repairedAction = {
      id: 'eat-before-work',
      description: 'eat before work',
      commandType: 'AgentEat' as const,
      payload: { commodity: 'Bread' },
    };

    expect(
      simulateActionWithRepair({
        action,
        simulate: (candidate) =>
          candidate.id === 'eat-before-work'
            ? { status: 'accepted', action: candidate }
            : { status: 'rejected', action: candidate, reason: 'satiety too low' },
        repair: ({ reason }) => (reason === 'satiety too low' ? repairedAction : undefined),
      }),
    ).toEqual({
      status: 'repaired',
      originalAction: action,
      repairedAction,
      reason: 'satiety too low',
    });
  });
});
```

- [ ] Add a test in the same file proving an invalid repaired action returns `status: 'needs-replan'`.
- [ ] Run `pnpm --filter @aivilization/agent-runtime test` and confirm action APIs are missing.
- [ ] Implement `AtomicActionProposal`, `ActionSimulationResult`, `RepairPolicy`, and `simulateActionWithRepair`.
- [ ] Run `pnpm --filter @aivilization/agent-runtime test` and `pnpm --filter @aivilization/agent-runtime typecheck`.
- [ ] Commit with `git commit -m "feat: add action simulation repair"`.

### Task 3: Agent Cycle Orchestration

**Files:**

- Create: `packages/agent-runtime/src/cycle.ts`
- Create: `packages/agent-runtime/src/cycle.test.ts`
- Modify: `packages/agent-runtime/src/index.ts`

- [ ] Write failing tests for deterministic micro-planner selection and command drafts:

```ts
import { asAgentId, asSimulationId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import { createBranchPlan, runAgentPlanningCycle } from './index';

describe('agent planning cycle', () => {
  test('selects a subtask, gates actions through the simulator, and returns command drafts', () => {
    const plan = createBranchPlan({
      objective: 'survive',
      branches: [
        {
          id: 'income',
          objective: 'earn wage',
          subtasks: [{ id: 'work', description: 'work shift', basePriority: 5 }],
        },
      ],
    });

    const result = runAgentPlanningCycle({
      simulationId: asSimulationId('sim-1'),
      agentId: asAgentId('agent-1'),
      issuedAt: 100,
      plan,
      signals: [],
      microPlanners: [
        {
          domain: 'work',
          supports: ({ subtaskId }) => subtaskId === 'work',
          propose: () => [
            {
              id: 'work-1',
              description: 'work as Cleaner',
              commandType: 'AgentWork',
              payload: { occupation: 'Cleaner' },
            },
          ],
        },
      ],
      simulate: ({ action }) => ({ status: 'accepted', action }),
    });

    expect(result.selectedSubtask.subtaskId).toBe('work');
    expect(result.commandDrafts).toEqual([
      {
        simulationId: 'sim-1',
        actorId: 'agent-1',
        source: 'agent-runtime',
        type: 'AgentWork',
        payload: { occupation: 'Cleaner' },
        issuedAt: 100,
      },
    ]);
  });
});
```

- [ ] Add a test in the same file proving rejected and unrepaired actions produce no command drafts and set `needsReplan` to `true`.
- [ ] Run `pnpm --filter @aivilization/agent-runtime test` and confirm cycle APIs are missing.
- [ ] Implement `DomainMicroPlanner`, `CommandDraft`, `AgentCycleResult`, and `runAgentPlanningCycle`.
- [ ] Run `pnpm --filter @aivilization/agent-runtime test`, `pnpm --filter @aivilization/agent-runtime typecheck`, `pnpm check`, and `pnpm build`.
- [ ] Commit with `git commit -m "feat: add agent planning cycle core"`.

## Self-Review

- Spec coverage: This plan covers branch thinking, contextual prioritization, micro-planners, action simulation, local repair, re-planning escalation, and command-draft output from the design spec.
- Red-flag scan: No forbidden marker strings remain in this plan.
- Type consistency: Planned tests use the same exported names as the implementation tasks.
