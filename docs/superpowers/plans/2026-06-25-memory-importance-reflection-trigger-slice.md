# Memory Importance Reflection Trigger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate scheduled memory consolidation/reflection on accumulated pending memory importance.

**Architecture:** Keep reflection synthesis in `packages/memory`; add the trigger to worker
consolidation scheduling, where cursors and pending STM windows are already coordinated.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, `apps/worker`.

---

## Scope

- Add optional `reflectionTrigger.minimumImportanceScore` to scheduled memory consolidation.
- Report skipped agents when pending importance is below threshold.
- Preserve cursor state while skipped so importance accumulates across runs.
- Keep existing eager schedule behavior when no trigger is configured.

## Task 1: Failing Worker Consolidation Tests

**Files:**

- Modify: `apps/worker/src/memoryConsolidation.test.ts`

- [x] **Step 1: Test skip below threshold**

Add a scheduled consolidation test that appends two low-importance unhinted study memories, runs
`runWorkerMemoryConsolidationSchedule` with `reflectionTrigger.minimumImportanceScore: 1`, and
asserts:

- `results` is empty;
- `patchCount` is `0`;
- `cursors` is empty;
- `skipped` contains the pending count and summed importance;
- long-term profile is unchanged.

- [x] **Step 2: Test accumulation across runs**

In the same test, append one more memory so total pending importance reaches the threshold, run the
schedule again, and assert consolidation runs over all pending memories and cursor advances.

Run:

```bash
pnpm --filter @aivilization/worker test -- memoryConsolidation.test.ts
```

Expected: FAIL because schedule results do not expose `skipped` and consolidation runs eagerly.

Observed: failed because below-threshold runs still returned a consolidation result for pending
records.

## Task 2: Trigger Implementation

**Files:**

- Modify: `apps/worker/src/memoryConsolidation.ts`

- [x] **Step 3: Add trigger types and validation**

Add:

```ts
export type WorkerMemoryConsolidationReflectionTrigger = {
  readonly minimumImportanceScore: number;
};
```

Thread `reflectionTrigger?: WorkerMemoryConsolidationReflectionTrigger` through
`WorkerMemoryConsolidationScheduleInput`.

- [x] **Step 4: Implement schedule gate**

For each agent, retrieve pending records after cursor in oldest-first order. If a trigger is set
and `sum(record.importanceScore) < minimumImportanceScore`, push a skipped result and do not call
`runWorkerMemoryConsolidation` or save a cursor. Otherwise run existing consolidation with the
pending records' cursor window.

- [x] **Step 5: Run focused tests**

Run:

```bash
pnpm --filter @aivilization/worker test -- memoryConsolidation.test.ts
pnpm --filter @aivilization/worker typecheck
```

Expected: PASS.

Observed:

- `pnpm --filter @aivilization/worker test -- memoryConsolidation.test.ts` passed.
- `pnpm --filter @aivilization/worker typecheck` passed.

## Task 3: Lifecycle Plumbing

**Files:**

- Modify: `apps/worker/src/localSimulationLifecycle.ts`
- Modify: `apps/worker/src/localSimulationLifecycle.test.ts`

- [x] **Step 6: Expose trigger in local lifecycle schedules**

Add optional `reflectionTrigger` to `LocalSimulationLifecycleMemoryConsolidationSchedule` and pass
it into `runWorkerMemoryConsolidationSchedule`.

- [x] **Step 7: Test lifecycle skip visibility**

Add a lifecycle test that configures a threshold higher than pending importance and asserts the
completed start returns memory consolidation with `skipped` metadata and no cursor.

Run:

```bash
pnpm --filter @aivilization/worker test -- localSimulationLifecycle.test.ts
```

Expected: PASS.

Observed: `pnpm --filter @aivilization/worker test -- localSimulationLifecycle.test.ts` passed.

## Task 4: Full Verification And Commit

- [x] **Step 8: Full checks**

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

Observed:

- `pnpm lint` passed.
- `pnpm typecheck` passed.
- `pnpm test` passed with 142 test files and 698 tests.
- `pnpm build` passed.
- `git diff --check` passed.

- [x] **Step 9: Inspect and commit**

Confirm the diff is limited to reflection-trigger scheduling, lifecycle plumbing/tests, and this
slice's docs.

Observed: diff is limited to reflection-trigger scheduling, lifecycle plumbing/tests, and this
slice's docs.

Commit with:

```bash
git add docs/superpowers/specs/2026-06-25-memory-importance-reflection-trigger-design.md docs/superpowers/plans/2026-06-25-memory-importance-reflection-trigger-slice.md apps/worker/src/memoryConsolidation.ts apps/worker/src/memoryConsolidation.test.ts apps/worker/src/localSimulationLifecycle.ts apps/worker/src/localSimulationLifecycle.test.ts
git commit -m "feat: trigger reflection by memory importance"
```
