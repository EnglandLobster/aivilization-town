# Worker Daily Plan Compiler Injection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let worker daily plan renewal use an injected `DailyPlanCompiler` and surface compiler traces.

**Architecture:** Keep repository orchestration in `apps/worker`. Keep planning algorithms in
`packages/agent-runtime`. Worker gathers context, calls the injected compiler or deterministic
fallback, normalizes compiler output, maps the plan to scheduled intentions, and returns optional
trace metadata.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces.

---

## Task 1: Failing Worker Test

**Files:**

- Modify: `apps/worker/src/dailyRoutineSchedule.test.ts`

- [x] **Step 1: Add injected compiler test**

Add a test for `renewDailyPlanScheduledIntentions` with `compileDailyPlan`. The compiler should
return a custom `DailyPlan` plus `planningTrace`. Assert the compiler receives:

- `agentId`;
- `issuedAt`;
- `agent.job`, `agent.locationId`, `agent.physiology`;
- repository-backed `longTermProfile`;
- repository-backed `memoryContext`.

Assert the renewal result includes `planningTrace` and scheduled intentions from the injected plan.

Run:

```bash
pnpm --filter @aivilization/worker test -- dailyRoutineSchedule.test.ts
```

Expected: FAIL because `compileDailyPlan` and `planningTrace` are not part of the worker API.

Observed: after fixing the projection fixture to include the agent's `home` location, the test
failed because the injected compiler was never called and captured compiler input stayed undefined.

## Task 2: Worker Renewal Implementation

**Files:**

- Modify: `apps/worker/src/dailyRoutineSchedule.ts`

- [x] **Step 2: Add compiler input and trace result fields**

Import `DailyPlanCompiler`, `DailyPlanCompilationTrace`, and
`normalizeDailyPlanCompilerOutput`. Extend `DailyPlanRenewalResult` and renewal input.

- [x] **Step 3: Call the compiler seam**

Use `input.compileDailyPlan ?? compileDeterministicDailyPlan`, pass the gathered agent/profile/memory
context, normalize the output, and include `planningTrace` only when present.

Run:

```bash
pnpm --filter @aivilization/worker test -- dailyRoutineSchedule.test.ts
pnpm --filter @aivilization/worker typecheck
```

Expected: PASS.

Observed:

- `pnpm --filter @aivilization/worker test -- dailyRoutineSchedule.test.ts` passed.
- `pnpm --filter @aivilization/worker typecheck` passed.
- `pnpm lint` passed.

## Task 3: Full Verification And Commit

- [x] **Step 4: Full checks**

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
- `pnpm test` passed: 144 test files, 706 tests.
- `pnpm build` passed.
- `git diff --check` passed.

- [x] **Step 5: Inspect and commit**

Confirm the diff is limited to worker daily plan compiler injection, tests, and this slice's docs.

Observed: `git status --short` showed only `apps/worker/src/dailyRoutineSchedule.ts`,
`apps/worker/src/dailyRoutineSchedule.test.ts`, and this slice's docs before staging.

Commit with:

```bash
git add docs/superpowers/specs/2026-06-25-worker-daily-plan-compiler-injection-design.md docs/superpowers/plans/2026-06-25-worker-daily-plan-compiler-injection-slice.md apps/worker/src/dailyRoutineSchedule.ts apps/worker/src/dailyRoutineSchedule.test.ts
git commit -m "feat: inject daily plan compiler in worker renewal"
```
