# Runtime Run Queue Retry And Dead Letter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add attempt history, retry delay, and dead-letter terminal state to runtime run queue jobs.

**Architecture:** Keep retry semantics inside the queue repository and single-job worker. The repository records each lease as an attempt, schedules retryable failures by returning the job to `queued` with `nextAttemptAt`, and marks the job `dead-lettered` only after max attempts are exhausted. Worker host, API, and HTTP controls keep using existing `runNext`/`drain` boundaries.

**Tech Stack:** TypeScript, Vitest, pnpm, local in-memory and JSONL file-backed queue repositories.

---

### Task 1: Repository And Worker Behavior

**Files:**

- Modify: `apps/worker/src/localSimulationRuntimeRunQueue.ts`
- Modify: `apps/worker/src/localSimulationRuntimeRunQueue.test.ts`

- [ ] **Step 1: Write failing retry test**

Add a test where a worker with `maxAttempts: 2` and `retryDelayMs: 25` fails the first attempt, leaves the job queued with `nextAttemptAt`, skips it before that time, then completes it on the second attempt while preserving both attempts in history.

- [ ] **Step 2: Write failing dead-letter test**

Update the existing terminal failure expectation so a worker with the default one-attempt policy marks the job `dead-lettered`, records `deadLetteredAt`, and keeps the failed attempt in history.

- [ ] **Step 3: Run worker tests and verify RED**

Run: `pnpm --filter @aivilization/worker test -- localSimulationRuntimeRunQueue.test.ts`

Expected: FAIL because queue jobs do not have attempt history, `nextAttemptAt`, or `dead-lettered` state yet.

- [ ] **Step 4: Implement queue reliability fields**

Add:

- status `dead-lettered`
- `attemptCount`
- `failedAttemptCount`
- `maxAttempts`
- `nextAttemptAt`
- `deadLetteredAt`
- `attempts`

Claiming appends a new attempt. Completing annotates the latest attempt. Failing either requeues with `nextAttemptAt` or dead-letters when attempts are exhausted.

- [ ] **Step 5: Run worker tests and verify GREEN**

Run: `pnpm --filter @aivilization/worker test -- localSimulationRuntimeRunQueue.test.ts`

Expected: PASS.

### Task 2: File Repository Recovery

**Files:**

- Modify: `apps/worker/src/localSimulationRuntimeRunQueue.test.ts`
- Modify: `apps/worker/src/localSimulationRuntimeRunQueue.ts`

- [ ] **Step 1: Write failing recovery assertion**

Extend file repository recovery coverage to verify retry/dead-letter metadata survives restart through JSONL replay.

- [ ] **Step 2: Run worker tests and verify RED if not already covered**

Run: `pnpm --filter @aivilization/worker test -- localSimulationRuntimeRunQueue.test.ts`

Expected: FAIL until file replay preserves the new fields.

- [ ] **Step 3: Implement clone/replay compatibility**

Ensure JSON clone/replay preserves all added queue metadata and older records default missing counters safely.

- [ ] **Step 4: Run worker tests and verify GREEN**

Run: `pnpm --filter @aivilization/worker test -- localSimulationRuntimeRunQueue.test.ts`

Expected: PASS.

### Task 3: Verification And Commit

**Files:**

- All files above plus this plan file.

- [ ] **Step 1: Format touched files**

Run: `pnpm exec prettier --write apps/worker/src/localSimulationRuntimeRunQueue.ts apps/worker/src/localSimulationRuntimeRunQueue.test.ts docs/superpowers/plans/2026-06-25-runtime-run-queue-retry-dead-letter-slice.md`

- [ ] **Step 2: Run worker checks**

Run: `pnpm --filter @aivilization/worker typecheck && pnpm --filter @aivilization/worker test`

- [ ] **Step 3: Run repository checks**

Run:

- `pnpm lint`
- `pnpm typecheck`
- `git diff --check`

- [ ] **Step 4: Commit**

Run: `git add <touched files> && git commit -m "feat: add runtime run queue retries"`
