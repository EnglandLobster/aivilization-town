# Daily Routine Schedule Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seed deterministic daily routine windows as durable scheduled intentions so idle agents and branch selection can be guided by time-of-day without hard-coding planner behavior.

**Architecture:** `apps/worker` owns schedule interpretation because it already orchestrates projection time, repositories, and canonical ticks. `@aivilization/memory` remains the durable intention store, while `@aivilization/agent-runtime` continues to consume scheduled intentions through the existing intention-influence contract. Objective renewal only reads active scheduled intentions and turns them into a traceable candidate when a routine is actually present.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, strict ESM package boundaries.

---

## Scope

- Add a pure daily routine schedule generator that maps simulation timestamps to repeatable daily scheduled intentions.
- Upsert routine intentions before objective renewal in canonical active-plan ticks.
- Let the default autonomous objective proposer choose an active routine objective when no stronger survival, recovery, education, income, or profile signal wins.
- Preserve deterministic ids and idempotent upserts so repeated ticks do not accumulate duplicate schedule state.

## Task 1: Daily Routine Schedule Model

**Files:**

- Create: `apps/worker/src/dailyRoutineSchedule.ts`
- Create: `apps/worker/src/dailyRoutineSchedule.test.ts`
- Modify: `apps/worker/src/index.ts`

- [x] **Step 1: Write failing tests**

Add tests proving:

- Morning timestamps produce a study routine intention with stable absolute start and end times.
- Midday timestamps produce an eat/social routine intention.
- Re-running the same day produces the same ids for idempotent repository upsert.

Run:

```bash
pnpm test -- apps/worker/src/dailyRoutineSchedule.test.ts
```

Expected: FAIL because the module does not exist.

- [x] **Step 2: Implement minimal schedule generator**

Create a pure `createDailyRoutineScheduledIntentions` function and a repository-backed `renewDailyRoutineScheduledIntentions` helper. Routine ids must include `daily-routine:<agentId>:<dayStart>:<slotId>` and schedule windows must be absolute simulation timestamps.

## Task 2: Objective Renewal Routine Candidate

**Files:**

- Modify: `apps/worker/src/objectiveRenewal.ts`
- Modify: `apps/worker/src/objectiveRenewal.test.ts`

- [x] **Step 1: Write failing test**

Add a test where an otherwise stable agent has one active scheduled intention for study and the default proposer selects a `scheduled-routine-study` candidate with profile-free trace evidence.

Run:

```bash
pnpm test -- apps/worker/src/objectiveRenewal.test.ts
```

Expected: FAIL because active scheduled intentions are not candidate inputs yet.

- [x] **Step 2: Implement minimal candidate scoring**

Read active scheduled intentions using `selectActiveScheduledIntentions`. The routine candidate should score below survival, recent recovery, education, and income pressure, but above balanced fallback.

## Task 3: Canonical Tick Integration

**Files:**

- Modify: `apps/worker/src/canonicalActivePlanTick.ts`
- Modify: `apps/worker/src/canonicalActivePlanTick.test.ts`

- [x] **Step 1: Write failing integration test**

Add a canonical tick test where routine seeding happens before objective renewal, the renewal trace selects the routine candidate, and the persisted intention state contains the routine window exactly once.

Run:

```bash
pnpm test -- apps/worker/src/dailyRoutineSchedule.test.ts apps/worker/src/objectiveRenewal.test.ts apps/worker/src/canonicalActivePlanTick.test.ts
```

Expected: FAIL because canonical ticks do not call the routine scheduler.

- [x] **Step 2: Wire routine scheduling before renewal**

Call `renewDailyRoutineScheduledIntentions` immediately after projection resolution and before `renewMissingActiveObjectives`. Provide an optional `dailyRoutineSchedule` input so callers can disable or replace the default in later slices.

## Task 4: Verification

**Files:**

- Modify: this plan file

- [x] Run focused tests.
- [x] Run `pnpm --filter @aivilization/worker typecheck`.
- [x] Run `pnpm lint`.
- [x] Run `pnpm test`.
- [x] Inspect `git diff`.
- [x] Commit as `feat: seed daily routine intentions`.

Verification observed:

- `pnpm test -- apps/worker/src/dailyRoutineSchedule.test.ts apps/worker/src/objectiveRenewal.test.ts apps/worker/src/canonicalActivePlanTick.test.ts packages/observability/src/objectiveRenewalTraceRepository.test.ts`: 139 files / 660 tests passed.
- `pnpm --filter @aivilization/worker typecheck`: passed after copying the readonly scheduled intention list before sorting.
- `pnpm --filter @aivilization/observability typecheck`: passed.
- `pnpm --filter @aivilization/server typecheck`: passed.
- `pnpm lint`: passed.
- `pnpm typecheck`: passed across workspace packages.
- `pnpm test`: 139 files / 660 tests passed.
- `pnpm build`: passed across buildable workspace packages.
