# Reactive Steering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the AIvilization reactive-steering route for immediate human commands, bypassing full Branch-Thinking while still using localized planning, Action Simulator validation, repair, command drafts, and STM propagation.

**Architecture:** `packages/agent-runtime` owns the lightweight route because it translates human temporary commands into atomic action proposals. `packages/memory` remains the STM contract owner; the route returns short-term memory records for the worker/API layer to persist, rather than mutating repositories directly.

**Tech Stack:** TypeScript, pnpm workspaces, Vitest, strict ESM package boundaries.

---

## Scope

This slice implements the paper's Reactive Steering path:

- A temporary human command is represented as a first-class runtime input.
- A localized reactive planner translates the command into action proposals.
- The Action Simulator validates each proposal and may use the existing repair policy.
- Accepted or repaired actions become command drafts.
- The command receipt and outcome are returned as short-term memory records.
- The route does not invoke `BranchPlan`, `selectPrioritizedSubtask`, or full `runAgentPlanningCycle`.

It does not implement natural-language parsing, API endpoints, UI controls, durable persistence calls, or LLM provider calls. Those should use this route as their runtime boundary later.

## File Structure

- Create `packages/agent-runtime/src/reactiveSteering.ts`: reactive command types, localized planner interface, route runner, command draft creation, and STM record generation.
- Create `packages/agent-runtime/src/reactiveSteering.test.ts`: TDD coverage for accepted, repaired, and unrepaired reactive commands.
- Modify `packages/agent-runtime/src/index.ts`: export reactive-steering contracts.
- Modify this plan file as tasks complete.

## Task 1: Reactive Steering Route Tests

**Files:**

- Create: `packages/agent-runtime/src/reactiveSteering.test.ts`

- [x] **Step 1: Write failing tests for accepted, repaired, and failed reactive commands**

Create `packages/agent-runtime/src/reactiveSteering.test.ts`:

```ts
import { asAgentId, asSimulationId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import { runReactiveSteeringRoute } from './index';

describe('reactive steering route', () => {
  test('uses a localized planner and simulator without branch planning', () => {
    const result = runReactiveSteeringRoute({
      simulationId: asSimulationId('sim-1'),
      agentId: asAgentId('agent-1'),
      issuedAt: 100,
      command: {
        id: 'reactive-buy-fish',
        summary: 'buy 10 fish now',
        tags: ['fish', 'trade'],
      },
      localizedPlanners: [
        {
          domain: 'trade',
          supports: ({ summary }) => summary.includes('fish'),
          propose: () => [
            {
              id: 'buy-fish',
              description: 'buy 10 fish',
              commandType: 'AgentTrade',
              payload: { side: 'buy', commodityName: 'Fish', quantity: 10 },
            },
          ],
        },
      ],
      simulate: ({ action }) => ({ status: 'accepted', action }),
    });

    expect(result.selectedPlannerDomain).toBe('trade');
    expect(result.commandDrafts).toEqual([
      {
        simulationId: 'sim-1',
        actorId: 'agent-1',
        source: 'agent-runtime',
        type: 'AgentTrade',
        payload: { side: 'buy', commodityName: 'Fish', quantity: 10 },
        issuedAt: 100,
      },
    ]);
    expect(result.needsReplan).toBe(false);
    expect(result.shortTermMemoryRecords.map((record) => record.status)).toEqual([
      'observed',
      'succeeded',
    ]);
  });

  test('uses repair for minor reactive command failures', () => {
    const result = runReactiveSteeringRoute({
      simulationId: asSimulationId('sim-1'),
      agentId: asAgentId('agent-1'),
      issuedAt: 100,
      command: {
        id: 'reactive-sleep',
        summary: 'sleep for 8 hours',
      },
      localizedPlanners: [
        {
          domain: 'recovery',
          supports: ({ summary }) => summary.includes('sleep'),
          propose: () => [
            {
              id: 'sleep-too-long',
              description: 'sleep for 8 hours',
              commandType: 'AgentSleep',
              payload: { durationSeconds: 28800 },
            },
          ],
        },
      ],
      simulate: ({ action }) =>
        action.id === 'sleep-too-long'
          ? { status: 'rejected', action, reason: 'duration exceeds safe local route limit' }
          : { status: 'accepted', action },
      repair: ({ rejectedAction }) => ({
        ...rejectedAction,
        id: 'sleep-repaired',
        payload: { durationSeconds: 7200 },
      }),
    });

    expect(result.commandDrafts[0]).toMatchObject({
      type: 'AgentSleep',
      payload: { durationSeconds: 7200 },
    });
    expect(result.simulationResults[0]).toMatchObject({ status: 'repaired' });
    expect(result.shortTermMemoryRecords[1]).toMatchObject({
      kind: 'human-command',
      status: 'repaired',
    });
  });

  test('records failed STM outcome and emits no command drafts when repair cannot recover', () => {
    const result = runReactiveSteeringRoute({
      simulationId: asSimulationId('sim-1'),
      agentId: asAgentId('agent-1'),
      issuedAt: 100,
      command: {
        id: 'reactive-work',
        summary: 'work immediately',
      },
      localizedPlanners: [
        {
          domain: 'work',
          supports: ({ summary }) => summary.includes('work'),
          propose: () => [
            {
              id: 'work-now',
              description: 'work now',
              commandType: 'AgentWork',
              payload: { occupationName: 'Cleaner', laborSeconds: 3600 },
            },
          ],
        },
      ],
      simulate: ({ action }) => ({ status: 'rejected', action, reason: 'energy too low' }),
    });

    expect(result.commandDrafts).toEqual([]);
    expect(result.needsReplan).toBe(true);
    expect(result.shortTermMemoryRecords[1]).toMatchObject({
      kind: 'human-command',
      status: 'failed',
      summary: 'Reactive command "work immediately" failed: energy too low.',
    });
  });
});
```

- [x] **Step 2: Run agent-runtime tests and verify RED**

Run:

```bash
pnpm --filter @aivilization/agent-runtime test
```

Expected: FAIL because `runReactiveSteeringRoute` does not exist.

## Task 2: Reactive Steering Route Implementation

**Files:**

- Create: `packages/agent-runtime/src/reactiveSteering.ts`
- Modify: `packages/agent-runtime/src/index.ts`

- [x] **Step 1: Implement the route contracts**

Create `ReactiveCommandInput`, `ReactiveLocalizedPlanner`, `ReactiveActionSimulator`, `ReactiveRepairPolicy`, `ReactiveSteeringResult`, and `runReactiveSteeringRoute`.

The route must:

- validate non-empty command id and summary;
- select the first localized planner whose `supports(command)` returns true;
- return a failed STM outcome and `needsReplan: true` when no planner supports the command;
- return a failed STM outcome and `needsReplan: true` when the planner proposes no actions;
- run every proposed action through `simulateActionWithRepair`;
- convert accepted and repaired results into `CommandDraft` objects;
- return two STM records: one observed receipt and one final outcome.

- [x] **Step 2: Export the route**

Modify `packages/agent-runtime/src/index.ts`:

```ts
export * from './reactiveSteering';
```

- [x] **Step 3: Run focused verification**

Run:

```bash
pnpm --filter @aivilization/agent-runtime test
pnpm --filter @aivilization/agent-runtime typecheck
```

Expected: PASS.

- [x] **Step 4: Commit**

Run:

```bash
git add packages/agent-runtime/src/reactiveSteering.ts packages/agent-runtime/src/reactiveSteering.test.ts packages/agent-runtime/src/index.ts
git commit -m "feat: add reactive steering route"
```

## Task 3: Whole-Repo Verification

**Files:**

- Modify: `docs/superpowers/plans/2026-06-23-reactive-steering-slice.md`

- [x] Run `pnpm check`.
- [x] Run `pnpm build`.
- [x] Update this plan's completed checkboxes.
- [x] Commit the final plan update.

## Acceptance Criteria

- Reactive commands have a distinct lightweight runtime route separate from full Branch-Thinking.
- The route uses localized planners and the existing Action Simulator/repair mechanism.
- Accepted and repaired reactive actions emit command drafts only after simulator validation.
- Failed reactive commands emit no command drafts and request replan/escalation.
- Every reactive command returns STM receipt and outcome records for memory-mediated propagation.
- `pnpm check` and `pnpm build` pass.
