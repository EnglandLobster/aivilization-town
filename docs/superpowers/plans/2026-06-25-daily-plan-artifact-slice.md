# Daily Plan Artifact Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a first-class high-level daily plan artifact and materialize it into scheduled intentions.

**Architecture:** Keep daily plan validation and deterministic compilation in `packages/agent-runtime`.
Keep repository orchestration in `apps/worker`. Extend `ScheduledIntention` with optional plan and
memory provenance fields so future observability can trace why an agenda item exists.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces.

---

## Task 1: Agent Runtime Daily Plan Tests

**Files:**

- Create: `packages/agent-runtime/src/dailyPlanning.test.ts`

- [x] **Step 1: Write failing tests for plan generation and mapping**

Add tests that call `compileDeterministicDailyPlan` with:

- an employed agent snapshot;
- a long-term study habit;
- one recent social memory.

Assert the plan includes baseline routine, job shift, profile study, and memory social follow-up
items. Then call `dailyPlanToScheduledIntentions` and assert mapped scheduled intentions preserve
`sourcePlanId` and `provenanceRecordIds`.

Run:

```bash
pnpm --filter @aivilization/agent-runtime test -- dailyPlanning.test.ts
```

Expected: FAIL because the daily planning API does not exist.

Observed: failed because `compileDeterministicDailyPlan` and `createDailyPlan` were not functions.

## Task 2: Agent Runtime Daily Plan Implementation

**Files:**

- Create: `packages/agent-runtime/src/dailyPlanning.ts`
- Modify: `packages/agent-runtime/src/index.ts`
- Modify: `packages/memory/src/intentions.ts`
- Modify: `packages/memory/src/intentionRepository.ts`
- Modify: `packages/memory/src/fileRepositories.ts`

- [x] **Step 2: Add optional scheduled intention provenance fields**

Extend `ScheduledIntention` with optional `sourcePlanId` and `provenanceRecordIds`, validate cloned
arrays without changing existing required behavior.

- [x] **Step 3: Implement daily plan types, validation, deterministic compiler, and mapper**

Create `DailyPlan`, `DailyPlanItem`, `DailyPlanAgentSnapshot`, `createDailyPlan`,
`compileDeterministicDailyPlan`, and `dailyPlanToScheduledIntentions`.

- [x] **Step 4: Export the module**

Export `dailyPlanning.ts` from `packages/agent-runtime/src/index.ts`.

Run:

```bash
pnpm --filter @aivilization/agent-runtime test -- dailyPlanning.test.ts
pnpm --filter @aivilization/agent-runtime typecheck
```

Expected: PASS.

Observed:

- `pnpm --filter @aivilization/agent-runtime test -- dailyPlanning.test.ts` passed.
- `pnpm --filter @aivilization/agent-runtime typecheck` passed.
- `pnpm --filter @aivilization/memory typecheck` passed.

## Task 3: Worker Renewal Integration

**Files:**

- Modify: `apps/worker/src/dailyRoutineSchedule.ts`
- Modify: `apps/worker/src/dailyRoutineSchedule.test.ts`

- [x] **Step 5: Write failing worker test**

Add a test for `renewDailyPlanScheduledIntentions` that loads profile and short-term memory from
repositories, compiles a daily plan, upserts scheduled intentions, and returns the generated plan id.

Run:

```bash
pnpm --filter @aivilization/worker test -- dailyRoutineSchedule.test.ts
```

Expected: FAIL because the worker renewal function does not exist.

Observed: failed because `renewDailyPlanScheduledIntentions` was not a function.

- [x] **Step 6: Implement repository-backed renewal**

Add `renewDailyPlanScheduledIntentions` to gather each agent's world state, long-term profile, and
recent short-term memories, compile a deterministic daily plan, map it to scheduled intentions, and
upsert them.

Run:

```bash
pnpm --filter @aivilization/worker test -- dailyRoutineSchedule.test.ts
pnpm --filter @aivilization/worker typecheck
```

Expected: PASS.

Observed:

- `pnpm --filter @aivilization/worker test -- dailyRoutineSchedule.test.ts` passed.
- `pnpm --filter @aivilization/worker typecheck` passed.

## Task 4: Full Verification And Commit

- [x] **Step 7: Full checks**

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
- `pnpm test` passed with 143 test files and 701 tests.
- `pnpm build` passed.
- `git diff --check` passed.

- [x] **Step 8: Inspect and commit**

Confirm the diff is limited to daily-plan artifact/compiler, scheduled-intention provenance,
worker renewal integration, tests, and this slice's docs.

Observed: diff is limited to daily-plan artifact/compiler, scheduled-intention provenance, worker
renewal integration, tests, and this slice's docs.

Commit with:

```bash
git add docs/superpowers/specs/2026-06-25-daily-plan-artifact-design.md docs/superpowers/plans/2026-06-25-daily-plan-artifact-slice.md packages/agent-runtime/src/dailyPlanning.ts packages/agent-runtime/src/dailyPlanning.test.ts packages/agent-runtime/src/index.ts packages/memory/src/intentions.ts packages/memory/src/intentionRepository.ts packages/memory/src/fileRepositories.ts apps/worker/src/dailyRoutineSchedule.ts apps/worker/src/dailyRoutineSchedule.test.ts
git commit -m "feat: materialize daily plans into intentions"
```
