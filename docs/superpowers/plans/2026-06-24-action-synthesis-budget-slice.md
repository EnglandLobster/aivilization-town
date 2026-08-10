# Action Synthesis Budget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a runtime-owned action synthesis layer that ranks and filters micro-planner proposals against shared resource budgets before simulation.

**Architecture:** `@aivilization/agent-runtime` owns action synthesis as a pure planning module. Micro-planners may attach optional priorities and resource estimates to `AtomicActionProposal`; the planning cycle applies synthesis before simulator validation. World command handlers remain responsible only for command invariants and state transitions.

**Tech Stack:** TypeScript, Vitest, `@aivilization/agent-runtime`.

---

## Scope

This slice adds:

- Optional `priority` and `resourceEstimate` metadata on `AtomicActionProposal`.
- `synthesizeActionCandidates`.
- `AgentCycleResult.actionSynthesisResult`.
- Optional `runAgentPlanningCycle(...).actionSynthesis`.
- Runtime tests for synthesis and cycle wiring.

It does not persist synthesis traces, derive budgets from world state, change worker adapters, or
hard-code canonical command payload interpretation.

## File Structure

- Create `packages/agent-runtime/src/actionSynthesis.test.ts`: pure synthesis red tests.
- Create `packages/agent-runtime/src/actionSynthesis.ts`: budget and selection implementation.
- Modify `packages/agent-runtime/src/actions.ts`: optional proposal metadata types.
- Modify `packages/agent-runtime/src/cycle.test.ts`: cycle wiring red test.
- Modify `packages/agent-runtime/src/cycle.ts`: call synthesis before simulation and return result.
- Modify `packages/agent-runtime/src/index.ts`: export synthesis API.
- Modify this plan file as tasks complete.

## Task 1: Pure Action Synthesis Tests

**Files:**

- Create: `packages/agent-runtime/src/actionSynthesis.test.ts`

- [x] **Step 1: Write failing tests**

Create tests that assert:

```ts
test('prioritizes proposals before applying max action budget', () => {
  const result = synthesizeActionCandidates({
    actions: [
      createAction('study', 1),
      createAction('sleep', 3),
      createAction('work', 2),
    ],
    policy: { maxActions: 2 },
  });

  expect(result.acceptedActions.map((action) => action.id)).toEqual(['sleep', 'work']);
  expect(result.rejectedActions).toEqual([
    { action: createAction('study', 1), reason: 'maxActions exhausted' },
  ]);
});
```

and:

```ts
test('rejects actions that would exceed shared resource budgets', () => {
  const bread = createAction('eat-bread', 1, {
    actionSeconds: 30,
    inventoryCosts: { Bread: 1 },
  });
  const work = createAction('work', 2, {
    actionSeconds: 3600,
    energyCost: 20,
  });
  const secondMeal = createAction('eat-second-bread', 1, {
    actionSeconds: 30,
    inventoryCosts: { Bread: 1 },
  });

  const result = synthesizeActionCandidates({
    actions: [bread, work, secondMeal],
    policy: {
      budget: {
        availableActionSeconds: 3630,
        energyBudget: 20,
        inventoryBudget: { Bread: 1 },
      },
    },
  });

  expect(result.acceptedActions.map((action) => action.id)).toEqual(['work', 'eat-bread']);
  expect(result.rejectedActions).toEqual([
    { action: secondMeal, reason: 'inventory budget exceeded for Bread' },
  ]);
});
```

Run:

```bash
pnpm --filter @aivilization/agent-runtime test -- actionSynthesis.test.ts
```

Expected before implementation: fail because `actionSynthesis` exports do not exist.

## Task 2: Pure Action Synthesis Implementation

**Files:**

- Modify: `packages/agent-runtime/src/actions.ts`
- Create: `packages/agent-runtime/src/actionSynthesis.ts`
- Modify: `packages/agent-runtime/src/index.ts`

- [x] **Step 2: Add proposal metadata types**

Add `ActionResourceEstimate` and optional `priority` / `resourceEstimate` fields to
`AtomicActionProposal`.

- [x] **Step 3: Implement `synthesizeActionCandidates`**

Implement a pure function that:

- validates non-negative finite numeric estimates;
- sorts by descending priority and original order;
- accepts actions while all budgets fit;
- returns rejected actions with deterministic reasons;
- accepts all actions when no policy limits are provided.

- [x] **Step 4: Verify pure synthesis**

Run:

```bash
pnpm --filter @aivilization/agent-runtime test -- actionSynthesis.test.ts
```

Expected after implementation: pass.

## Task 3: Planning Cycle Wiring

**Files:**

- Modify: `packages/agent-runtime/src/cycle.test.ts`
- Modify: `packages/agent-runtime/src/cycle.ts`

- [x] **Step 5: Write failing cycle wiring test**

Add a test proving `runAgentPlanningCycle` simulates and drafts only synthesized actions when
`actionSynthesis` policy limits the candidate set.

- [x] **Step 6: Wire synthesis into cycle**

Add optional `actionSynthesis` input, call `synthesizeActionCandidates`, use
`acceptedActions` as `candidateActions`, return `actionSynthesisResult`, and throw if no actions are
accepted.

- [x] **Step 7: Verify runtime package**

Run:

```bash
pnpm --filter @aivilization/agent-runtime test
pnpm --filter @aivilization/agent-runtime typecheck
```

Expected after implementation: pass.

## Task 4: Full Verification and Commit

**Files:**

- Modify: plan checkbox statuses.

- [x] **Step 8: Run full checks**

Run:

```bash
pnpm check
pnpm build
```

Expected: pass.

- [x] **Step 9: Commit**

Commit docs and implementation:

```bash
git add docs/superpowers/specs/2026-06-24-action-synthesis-budget-design.md docs/superpowers/plans/2026-06-24-action-synthesis-budget-slice.md packages/agent-runtime/src
git commit -m "feat: add action synthesis budgets"
```
