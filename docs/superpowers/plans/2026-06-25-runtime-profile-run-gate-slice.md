# Runtime Profile Run Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an automated acceptance gate for headless runtime profile runs so smoke, default, and stress profiles can fail fast when backend execution stops producing healthy, agent-driven simulation results.

**Architecture:** Keep the generic gate evaluator in `packages/observability` because it judges `RuntimeProfileRunReport` artifacts. Keep profile-specific criteria in `apps/server` because expected manifest ids, partition keys, and agent counts come from the server scenario profile factory. The CLI gets a thin `--require-gate` adapter that evaluates the summary after a run and returns a non-zero exit code on gate failure.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, existing runtime profile report contract and profile runner CLI.

---

### Task 1: Generic Runtime Profile Gate

**Files:**

- Create: `packages/observability/src/runtimeProfileRunGate.test.ts`
- Create: `packages/observability/src/runtimeProfileRunGate.ts`
- Modify: `packages/observability/src/index.ts`

- [x] **Step 1: Write failing gate tests**

Add a passing test:

```ts
const result = evaluateRuntimeProfileRunReport(createReport(), {
  criteriaId: 'smoke-25-gate',
  profileId: 'smoke-25',
  manifestId: 'aivilization-smoke-25',
  partitionCount: 1,
  totalProjectionAgentCount: 25,
  minimumCompletedCycleCount: 1,
  minimumTotalEventCount: 2,
  minimumTotalAgentTraceCount: 1,
  requiredDaemonHealth: 'healthy',
  requiredOutcome: 'succeeded',
  requiredStopReason: 'cycle-count-completed',
  allowedPartitionStatuses: ['completed', 'succeeded'],
  requiredPartitionHealth: 'healthy',
  requireStreamVersionMatchesEventCount: true,
  expectedProjectionAgentCountByPartition: { 'world-main': 25 },
});
expect(result.status).toBe('pass');
```

Add a failing test that mutates the report to `daemonHealth: 'attention'`, `completedCycleCount: 0`, `totalAgentTraceCount: 0`, and a partition `streamVersion` different from `eventCount`, then assert `status === 'fail'` and failure codes include these problems.

- [x] **Step 2: Run observability tests and verify RED**

Run:

```bash
pnpm --filter @aivilization/observability test -- runtimeProfileRunGate.test.ts
```

Expected: FAIL because the gate module is missing.

- [x] **Step 3: Implement generic evaluator**

Add:

- `RuntimeProfileRunGateCriteria`
- `RuntimeProfileRunGateFailure`
- `RuntimeProfileRunGateResult`
- `evaluateRuntimeProfileRunReport(report, criteria)`

The evaluator should collect failures rather than throw, preserve evidence per failure, and return `pass` only when there are no failures.

- [x] **Step 4: Export and verify GREEN**

Export the module from `packages/observability/src/index.ts`, then run:

```bash
pnpm --filter @aivilization/observability test -- runtimeProfileRunGate.test.ts
pnpm --filter @aivilization/observability typecheck
```

Expected: PASS.

### Task 2: Server Profile Criteria

**Files:**

- Create: `apps/server/src/localRuntimeTownProfileGate.test.ts`
- Create: `apps/server/src/localRuntimeTownProfileGate.ts`
- Modify: `apps/server/src/index.ts`

- [x] **Step 1: Write failing server criteria tests**

Add tests for `createLocalRuntimeTownProfileGateCriteria('smoke-25')`, `default-100`, and `headless-stress-1000` asserting:

- smoke expects 1 partition and 25 agents
- default expects 2 partitions and 100 agents
- stress expects 10 partitions and 1000 agents
- expected partition agent counts are derived from the scenario profile manifest and presets

- [x] **Step 2: Run server criteria tests and verify RED**

Run:

```bash
pnpm --filter @aivilization/server test -- localRuntimeTownProfileGate.test.ts
```

Expected: FAIL because the server criteria module is missing.

- [x] **Step 3: Implement profile-derived criteria**

Create `createLocalRuntimeTownProfileGateCriteria(profileId, input?)`. It should call `createLocalRuntimeTownDaemonScenarioProfile(profileId)` and derive manifest id, partition count, total agent count, and per-partition expected agent counts from scenario presets.

- [x] **Step 4: Export and verify GREEN**

Export from `apps/server/src/index.ts`, then run:

```bash
pnpm --filter @aivilization/server test -- localRuntimeTownProfileGate.test.ts
pnpm --filter @aivilization/server typecheck
```

Expected: PASS.

### Task 3: CLI Require-Gate Adapter

**Files:**

- Modify: `apps/server/src/localRuntimeTownProfileRunnerCli.test.ts`
- Modify: `apps/server/src/localRuntimeTownProfileRunnerCli.ts`

- [x] **Step 1: Write failing CLI gate tests**

Extend parser test with bare `--require-gate` and assert `requireGate: true`.

Add an injected-runner test where the summary has `daemonHealth: 'attention'`, `completedCycleCount: 0`, and no agent traces. Run the CLI with `--require-gate` and assert:

```ts
expect(exitCode).toBe(2);
expect(stderr).toContain('runtime profile run gate failed');
```

- [x] **Step 2: Run CLI tests and verify RED**

Run:

```bash
pnpm --filter @aivilization/server test -- localRuntimeTownProfileRunnerCli.test.ts
```

Expected: FAIL because `--require-gate` is not parsed or evaluated.

- [x] **Step 3: Implement CLI gate**

Parse `--require-gate` as a boolean flag. After the run completes, convert the summary into a `RuntimeProfileRunReport`, evaluate it using `createLocalRuntimeTownProfileGateCriteria(summary.profileId)`, write failure messages to stderr, and return exit code `2` on failure. Keep successful CLI stdout as the existing JSON summary.

- [x] **Step 4: Run CLI tests and verify GREEN**

Run:

```bash
pnpm --filter @aivilization/server test -- localRuntimeTownProfileRunnerCli.test.ts
pnpm --filter @aivilization/server typecheck
```

Expected: PASS.

### Task 4: Verification And Commit

**Files:**

- Modify all files above.

- [x] **Step 1: Format touched files**

Run:

```bash
pnpm exec prettier --write docs/superpowers/plans/2026-06-25-runtime-profile-run-gate-slice.md packages/observability/src/runtimeProfileRunGate.ts packages/observability/src/runtimeProfileRunGate.test.ts packages/observability/src/index.ts apps/server/src/localRuntimeTownProfileGate.ts apps/server/src/localRuntimeTownProfileGate.test.ts apps/server/src/localRuntimeTownProfileRunnerCli.ts apps/server/src/localRuntimeTownProfileRunnerCli.test.ts apps/server/src/index.ts
```

- [x] **Step 2: Run focused and full verification**

Run:

```bash
pnpm --filter @aivilization/observability typecheck && pnpm --filter @aivilization/observability test -- runtimeProfileRunGate.test.ts && pnpm --filter @aivilization/server typecheck && pnpm --filter @aivilization/server test -- localRuntimeTownProfileGate.test.ts localRuntimeTownProfileRunnerCli.test.ts && pnpm lint && pnpm typecheck && pnpm test && git diff --check
```

Expected: all commands exit 0.

- [x] **Step 3: Commit**

Run:

```bash
git add docs/superpowers/plans/2026-06-25-runtime-profile-run-gate-slice.md packages/observability/src/runtimeProfileRunGate.ts packages/observability/src/runtimeProfileRunGate.test.ts packages/observability/src/index.ts apps/server/src/localRuntimeTownProfileGate.ts apps/server/src/localRuntimeTownProfileGate.test.ts apps/server/src/localRuntimeTownProfileRunnerCli.ts apps/server/src/localRuntimeTownProfileRunnerCli.test.ts apps/server/src/index.ts
git commit -m "feat: add runtime profile run gate"
```
