# Runtime Recovery Policy Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a guarded runtime recovery orchestrator that can repair recoverable queue conditions, including dead-letter replay and ready/expired lease draining, without embedding recovery policy inside the scheduler or worker host.

**Architecture:** Implement the recovery orchestrator in the worker package. It depends on the run queue repository's `getStats`, `query`, and `replayDeadLetter` methods plus an optional worker host `drain` capability. Recovery returns a structured report with stats before/after, replayed jobs, skipped dead letters, and drain results.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, local in-memory run queue repository.

---

### Task 1: Recovery Orchestrator Core

**Files:**

- Create: `apps/worker/src/localSimulationRuntimeRecovery.test.ts`
- Create: `apps/worker/src/localSimulationRuntimeRecovery.ts`
- Modify: `apps/worker/src/index.ts`

- [ ] **Step 1: Write the failing test**

```ts
const recovery = createLocalSimulationRuntimeRecovery({
  manifestId: 'town-runtime',
  queueRepository: repository,
  policy: {
    maxDeadLetterReplaysPerRun: 2,
    maxReplayCountPerJob: 1,
    deadLetterReplayMaxAttempts: 3,
  },
});

await expect(recovery.recover({ observedAt: 300 })).resolves.toMatchObject({
  status: 'recovered',
  replayedDeadLetterJobs: [
    {
      jobId: 'job-dead-1',
      status: 'queued',
      nextAttemptAt: 300,
      replayCount: 1,
      maxAttempts: 3,
    },
  ],
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aivilization/worker test -- localSimulationRuntimeRecovery.test.ts`

Expected: FAIL because `createLocalSimulationRuntimeRecovery` is not exported.

- [ ] **Step 3: Implement minimal recovery**

Create recovery types and `createLocalSimulationRuntimeRecovery`. It must read queue stats, query dead-lettered jobs, replay only jobs below `maxReplayCountPerJob`, and expose skipped jobs when guardrails prevent replay.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @aivilization/worker test -- localSimulationRuntimeRecovery.test.ts`

Expected: PASS.

### Task 2: Drain Ready And Expired Work

**Files:**

- Modify: `apps/worker/src/localSimulationRuntimeRecovery.test.ts`
- Modify: `apps/worker/src/localSimulationRuntimeRecovery.ts`

- [ ] **Step 1: Write the failing drain test**

```ts
await expect(recovery.recover({ observedAt: 500 })).resolves.toMatchObject({
  status: 'recovered',
  drainResult: {
    processedJobCount: 2,
    completedJobCount: 1,
    failedJobCount: 1,
  },
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aivilization/worker test -- localSimulationRuntimeRecovery.test.ts`

Expected: FAIL until worker host draining is integrated.

- [ ] **Step 3: Implement drain recovery**

If `readyQueueCount + expiredLeaseCount > 0` and a worker host is available, call `drain` with `maxDrainJobsPerRun` or the recoverable count, whichever is smaller.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @aivilization/worker test -- localSimulationRuntimeRecovery.test.ts`

Expected: PASS.

### Task 3: Final Verification And Commit

**Files:**

- Modify: all files above

- [ ] **Step 1: Format changed files**

Run: `pnpm exec prettier --write apps/worker/src/localSimulationRuntimeRecovery.ts apps/worker/src/localSimulationRuntimeRecovery.test.ts apps/worker/src/index.ts docs/superpowers/plans/2026-06-25-runtime-recovery-policy-slice.md`

- [ ] **Step 2: Run focused and full verification**

Run: `pnpm --filter @aivilization/worker typecheck && pnpm --filter @aivilization/worker test -- localSimulationRuntimeRecovery.test.ts && pnpm lint && pnpm typecheck && pnpm test && git diff --check`

Expected: all commands exit 0.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/2026-06-25-runtime-recovery-policy-slice.md apps/worker/src/localSimulationRuntimeRecovery.ts apps/worker/src/localSimulationRuntimeRecovery.test.ts apps/worker/src/index.ts
git commit -m "feat: add runtime recovery policy"
```
