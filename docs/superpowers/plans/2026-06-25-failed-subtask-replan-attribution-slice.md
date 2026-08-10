# Failed Subtask Replan Attribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Attribute full-replan progress blocking to the producer subtask whose synthesized action failed, instead of always blocking the top selected subtask.

**Architecture:** Keep adaptive replanning decisions global and backward compatible. `cycle.ts` uses existing action synthesis context plus simulation results to derive failed producer subtasks, while `replanning.ts` remains the pure single-subtask decision/progress helper.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, `@aivilization/agent-runtime`, `apps/worker`.

---

## Scope

- Preserve existing `replanningDecision` shape.
- Preserve selected-subtask fallback for major context shifts or un-attributed failed actions.
- Block all failed producer subtasks for `full-replan` decisions with failed action results.
- Keep `memory-guided-correction` and no-replan completion behavior unchanged.
- Add runtime and worker regression tests for multi-subtask failure attribution.

## Task 1: Runtime Failed Producer Blocking

**Files:**

- Modify: `packages/agent-runtime/src/cycle.test.ts`
- Modify: `packages/agent-runtime/src/cycle.ts`

- [x] **Step 1: Write failing runtime test**

Add a test proving:

- `income/work` is the top selected subtask and succeeds;
- `development/study` is a second synthesized subtask and fails simulator validation;
- STM evidence plus `consecutiveFailureThreshold: 1` escalates to `full-replan`;
- `progressUpdate.blockedSubtasks` contains `study`;
- `progressUpdate.blockedSubtasks` does not contain `work`.

Run:

```bash
pnpm --filter @aivilization/agent-runtime test -- cycle.test.ts
```

Expected: FAIL because current progress blocking still uses the top selected subtask.

Observed red: `blockedSubtasks[0].subtaskId` was `work` instead of `study`.

- [x] **Step 2: Implement failed producer blocking**

In `cycle.ts`:

- derive failed producer subtasks from `simulationResults` with `status === 'needs-replan'`;
- resolve each failed action through the existing selected-subtask map;
- deduplicate by `branchId/subtaskId`;
- when `replanningDecision.kind === 'full-replan'`, mark failed producers blocked;
- keep existing selected-subtask fallback when no failed producers are available.

## Task 2: Worker Repository Integration

**Files:**

- Modify: `apps/worker/src/agentCycleRunner.test.ts`

- [x] **Step 1: Write failing worker persistence test**

Add a repository-backed worker test proving:

- `sleep` is top selected and succeeds;
- `study` is a second synthesized subtask and fails;
- full-replan progress blocks `study`, not `sleep`;
- `InMemoryBranchPlanProgressRepository` saves the same progress update.

Run:

```bash
pnpm --filter @aivilization/worker test -- agentCycleRunner.test.ts
```

Expected: FAIL until runtime full-replan progress blocking is producer-subtask aware.

Observed red: persisted progress blocked `sleep` instead of `study`.

## Task 3: Verification

**Files:**

- Modify: this plan file

- [x] Run focused tests:

```bash
pnpm --filter @aivilization/agent-runtime test -- cycle.test.ts
pnpm --filter @aivilization/worker test -- agentCycleRunner.test.ts
```

- [x] Run focused typechecks:

```bash
pnpm --filter @aivilization/agent-runtime typecheck
pnpm --filter @aivilization/worker typecheck
```

- [x] Run full verification:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

- [x] Inspect `git diff`.
- [x] Commit as `feat: attribute replans to failed subtasks`.
