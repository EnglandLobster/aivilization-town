# Multi-Subtask Progress Attribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make branch-plan progress follow the producer subtask of each accepted action when Global Synthesis interleaves actions from multiple branches.

**Architecture:** Keep immutable progress primitives in `planProgress.ts`, keep failure escalation in `replanning.ts`, and make `cycle.ts` the orchestration boundary that groups simulation results by action synthesis context before completion/progress updates. Worker code continues to persist the runtime's `progressUpdate` without duplicating attribution logic.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, `@aivilization/agent-runtime`, `apps/worker`.

---

## Scope

- Add per-subtask completion decisions to `AgentCycleResult`.
- Preserve `subtaskCompletionDecision` as the top selected subtask decision for compatibility.
- Group accepted and repaired simulation results by their producer subtask.
- Mark all completed producer subtasks in progress when no global replan is needed.
- Keep full-replan blocking behavior selected-subtask based for this slice.
- Add runtime and worker tests for multi-subtask progress attribution.

## Task 1: Runtime Multi-Subtask Progress

**Files:**

- Modify: `packages/agent-runtime/src/cycle.test.ts`
- Modify: `packages/agent-runtime/src/cycle.ts`

- [x] **Step 1: Write failing runtime progress test**

Add a test proving:

- a progress object starts empty;
- `candidateSubtasks.maxSubtasks = 2`;
- accepted `income/work` and `development/study` actions both simulate successfully;
- `progressUpdate.completedSubtaskIds` contains both `study` and `work`.

Run:

```bash
pnpm --filter @aivilization/agent-runtime test -- cycle.test.ts
```

Expected: FAIL because only the top selected subtask is currently marked completed.

Observed red: `progressUpdate.completedSubtaskIds` only contained `work`.

- [x] **Step 2: Write failing partial-completion test**

Add a test proving:

- `work` and `study` both execute in one cycle;
- a custom `subtaskCompletion` returns `in-progress` for `study`;
- `progressUpdate.completedSubtaskIds` contains only `work`;
- `subtaskCompletionDecisions` records separate decisions for `work` and `study`.

Run:

```bash
pnpm --filter @aivilization/agent-runtime test -- cycle.test.ts
```

Expected: FAIL because the result has no per-subtask completion decision surface and progress is not grouped.

Observed red: `subtaskCompletionDecisions` was `undefined`.

- [x] **Step 3: Implement grouped completion and progress**

In `cycle.ts`:

- add `AgentCycleSubtaskCompletionDecision`;
- add `subtaskCompletionDecisions` to `AgentCycleResult`;
- build grouped simulation results from accepted/repaired action contexts;
- run `decideSubtaskCompletion` per group;
- when `replanningDecision.kind === 'none'`, apply completed group decisions to progress in deterministic order;
- keep `subtaskCompletionDecision` equal to the top selected subtask's group decision.

## Task 2: Worker Repository Integration

**Files:**

- Modify: `apps/worker/src/agentCycleRunner.test.ts`

- [x] **Step 1: Write failing worker progress persistence test**

Add a worker test with repository-backed progress, `candidateSubtasks.maxSubtasks = 2`, sleep and
study planners, and accepted actions for both subtasks. Expect:

- `result.progressUpdate?.completedSubtaskIds` equals `['sleep', 'study']`;
- the `InMemoryBranchPlanProgressRepository` returns the same saved progress.

Run:

```bash
pnpm --filter @aivilization/worker test -- agentCycleRunner.test.ts
```

Expected: FAIL until runtime progress attribution can complete multiple subtasks.

Observed red: persisted progress only completed `sleep`.

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
- [x] Commit as `feat: attribute progress across synthesized subtasks`.
