# Profile-Aware Daily Routine Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make daily routine seeding depend on agent state and long-term profile so schedule intentions become individualized control signals rather than one global fixed timetable.

**Architecture:** Keep routine construction in `apps/worker/src/dailyRoutineSchedule.ts` behind an injectable resolver. The resolver reads immutable inputs from `WorldAgentState` and optional `LongTermAgentProfile`, then returns schedule slots that are still stored as durable `ScheduledIntention` records in `@aivilization/memory`. Canonical ticks pass the long-term profile repository to the routine seeder, while objective renewal and planner selection continue consuming only scheduled intentions.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, strict ESM package boundaries.

---

## Scope

- Add a `DailyRoutineScheduleResolver` boundary.
- Add a default profile-aware resolver that:
  - adds a higher-priority job shift for employed agents,
  - adds habit-driven evening study for LTM study habits,
  - adds MBTI-derived evening routine hints from the scenario-seeded personality entry.
- Keep fixed default schedule behavior when no profile/job signal is present.
- Wire canonical ticks to pass `longTermProfileRepository` into routine renewal.
- Prove routine-driven objective renewal can select a work routine for an employed agent.

## Task 1: Resolver Contract And Pure Policy

**Files:**

- Modify: `apps/worker/src/dailyRoutineSchedule.ts`
- Modify: `apps/worker/src/dailyRoutineSchedule.test.ts`

- [x] **Step 1: Write failing tests**

Add tests proving:

- An employed agent receives a `job-work-shift` slot with higher priority than default morning study.
- A profile habit containing study/education adds a `habit-evening-study` slot.
- An extroverted MBTI profile adds a `profile-evening-social` slot.

Run:

```bash
pnpm test -- apps/worker/src/dailyRoutineSchedule.test.ts
```

Expected: FAIL because `createProfileAwareDailyRoutineSchedule` and resolver inputs do not exist.

- [x] **Step 2: Implement minimal resolver**

Add `DailyRoutineScheduleResolver`, `DailyRoutineScheduleResolverInput`, and `createProfileAwareDailyRoutineSchedule`. Preserve `defaultDailyRoutineSchedule` and deterministic slot sorting.

## Task 2: Repository Renewal Integration

**Files:**

- Modify: `apps/worker/src/dailyRoutineSchedule.ts`
- Modify: `apps/worker/src/dailyRoutineSchedule.test.ts`

- [x] **Step 1: Write failing test**

Add a test where `renewDailyRoutineScheduledIntentions` receives a long-term profile repository and persists the habit-derived slot.

Run:

```bash
pnpm test -- apps/worker/src/dailyRoutineSchedule.test.ts
```

Expected: FAIL because renewal does not load LTM profiles or call a resolver.

- [x] **Step 2: Implement renewal support**

Accept optional `longTermProfileRepository` and optional `resolveSchedule`; load profile only when a repository is supplied.

## Task 3: Canonical Tick Integration

**Files:**

- Modify: `apps/worker/src/canonicalActivePlanTick.ts`
- Modify: `apps/worker/src/canonicalActivePlanTick.test.ts`

- [x] **Step 1: Write failing integration test**

Add a canonical tick test for an employed stable agent at morning work time. Expected renewal trace:

- `selectedCandidateId: scheduled-routine-work`
- `scheduledIntentionIds: [daily-routine:<agent>:0:job-work-shift]`

Run:

```bash
pnpm test -- apps/worker/src/dailyRoutineSchedule.test.ts apps/worker/src/canonicalActivePlanTick.test.ts
```

Expected: FAIL because canonical routine seeding does not pass the profile-aware resolver context.

- [x] **Step 2: Wire canonical input**

Pass `longTermProfileRepository` to `renewDailyRoutineScheduledIntentions`; expose optional `dailyRoutineScheduleResolver` for future game-mode overrides.

## Task 4: Verification

**Files:**

- Modify: this plan file

- [x] Run focused tests.
- [x] Run `pnpm --filter @aivilization/worker typecheck`.
- [x] Run `pnpm lint`.
- [x] Run `pnpm test`.
- [x] Run `pnpm build`.
- [x] Inspect `git diff`.
- [x] Commit as `feat: personalize daily routine policy`.

Observed verification:

- Red focused tests failed first because the profile-aware resolver did not exist and canonical renewal still selected the default routine path.
- Focused test pass: `pnpm test -- apps/worker/src/dailyRoutineSchedule.test.ts apps/worker/src/canonicalActivePlanTick.test.ts`.
- Worker typecheck pass: `pnpm --filter @aivilization/worker typecheck`.
- Full lint pass: `pnpm lint`.
- Full typecheck pass: `pnpm typecheck`.
- Full test pass: `pnpm test` (`139` files, `665` tests).
- Full build pass: `pnpm build`.
- Diff inspected before commit.
