# Profile Run Agent Cycle Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist compact planner/simulator diagnostics on runtime profile run reports.

**Architecture:** `@aivilization/observability` owns the durable report DTO and validation. `apps/server` computes diagnostics from existing per-partition `AgentCycleTraceRepository` records during profile runs.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, `@aivilization/observability`, `apps/server`.

---

## Scope

- Add `RuntimeProfileAgentCycleDiagnostics`.
- Add required `agentCycleDiagnostics` to `RuntimeProfileRunReport`.
- Clone and validate diagnostics in report repositories.
- Add `createRuntimeProfileAgentCycleDiagnostics`.
- Compute diagnostics in `runLocalRuntimeTownDaemonScenarioProfile`.

## Task 1: Observability Report DTO

**Files:**

- Modify: `packages/observability/src/runtimeProfileRunReport.test.ts`
- Modify: `packages/observability/src/runtimeProfileRunReport.ts`

- [x] **Step 1: Write failing report tests**

Update `createReport` fixtures to include:

```ts
agentCycleDiagnostics: {
  traceCount: 5,
  acceptedSimulatorCount: 2,
  repairedSimulatorCount: 2,
  rejectedSimulatorCount: 1,
  replanningDecisionCount: 3,
  simulatorEventTraceCount: 7,
  simulatorEventCount: 12,
  commandEmittingCycleCount: 4,
  commandEmittingCycleRatio: 0.8,
  repairedSimulatorRatio: 0.4,
  rejectedSimulatorRatio: 0.2,
  replanningDecisionRatio: 0.6,
}
```

Assert:

- in-memory and file repositories return diagnostics unchanged;
- mutating a read report does not mutate the stored diagnostics;
- invalid ratios above `1` throw.

Run:

```bash
pnpm --filter @aivilization/observability test -- runtimeProfileRunReport.test.ts
```

Expected: FAIL because the report DTO does not expose diagnostics.

- [x] **Step 2: Implement report type, clone, and validation**

Add `RuntimeProfileAgentCycleDiagnostics`, required `agentCycleDiagnostics`, clone helper, and
validation. Count fields must be non-negative integers. Ratio fields must be finite and between
`0` and `1`.

- [x] **Step 3: Add diagnostics aggregator**

Export:

```ts
export function createRuntimeProfileAgentCycleDiagnostics(
  traces: readonly AgentCycleTrace[],
): RuntimeProfileAgentCycleDiagnostics
```

It should count simulator statuses, replanning decisions, simulator event entries, nested simulator
events, and command-emitting cycles.

## Task 2: Profile Runner Consumption

**Files:**

- Modify: `apps/server/src/localRuntimeTownProfileRunner.test.ts`
- Modify: `apps/server/src/localRuntimeTownProfileRunner.ts`
- Modify: `apps/server/src/localRuntimeTownProfileRunnerCli.test.ts`

- [x] **Step 4: Write failing profile runner tests**

Assert `runLocalRuntimeTownDaemonScenarioProfile` summary and persisted report include
`agentCycleDiagnostics`.

For a real smoke run:

```ts
expect(summary.agentCycleDiagnostics.traceCount).toBe(summary.totalAgentTraceCount);
expect(summary.agentCycleDiagnostics.commandEmittingCycleCount).toBeGreaterThan(0);
```

For persisted report:

```ts
await expect(repository.get(summary.run.traceId)).resolves.toMatchObject({
  agentCycleDiagnostics: summary.agentCycleDiagnostics,
});
```

Update CLI injected summaries to include zero or one-count diagnostics so CLI tests compile.

Run:

```bash
pnpm --filter @aivilization/server test -- localRuntimeTownProfileRunner.test.ts localRuntimeTownProfileRunnerCli.test.ts
```

Expected: FAIL because summaries and reports do not include diagnostics.

- [x] **Step 5: Implement profile runner aggregation**

While reading traces for each partition, retain the full trace arrays. Use
`createRuntimeProfileAgentCycleDiagnostics` over all partition traces. Add
`agentCycleDiagnostics` to `LocalRuntimeTownProfileRunnerSummary` and pass it into
`createRuntimeProfileRunReport`.

## Task 3: Verification And Commit

**Files:**

- Modify: this plan file.

- [x] **Step 6: Run focused checks**

Run:

```bash
pnpm --filter @aivilization/observability test -- runtimeProfileRunReport.test.ts
pnpm --filter @aivilization/server test -- localRuntimeTownProfileRunner.test.ts localRuntimeTownProfileRunnerCli.test.ts
pnpm --filter @aivilization/observability typecheck
pnpm --filter @aivilization/server typecheck
```

Observed:

- `pnpm --filter @aivilization/observability test -- runtimeProfileRunReport.test.ts` passed.
- `pnpm --filter @aivilization/server test -- localRuntimeTownProfileRunner.test.ts localRuntimeTownProfileRunnerCli.test.ts` passed.
- `pnpm --filter @aivilization/observability typecheck` passed.
- `pnpm --filter @aivilization/server typecheck` passed.

- [x] **Step 7: Run full verification**

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
- `pnpm test` passed with 140 test files and 685 tests.
- `pnpm build` passed.
- `git diff --check` passed.

- [x] **Step 8: Inspect diff**

Confirm changes are limited to report diagnostics DTO/aggregation, profile runner consumption,
tests, and this slice's docs.

Observed: diff is limited to observability report diagnostics, server profile runner/report
consumers, tests/fixtures that construct profile summaries or reports, and this slice's docs.

- [x] **Step 9: Commit**

Commit with:

```bash
git add docs/superpowers/specs/2026-06-25-profile-run-agent-cycle-diagnostics-design.md docs/superpowers/plans/2026-06-25-profile-run-agent-cycle-diagnostics-slice.md packages/observability/src/runtimeProfileRunReport.test.ts packages/observability/src/runtimeProfileRunReport.ts packages/observability/src/runtimeProfileRunGate.test.ts apps/server/src/localRuntimeTownProfileRunner.test.ts apps/server/src/localRuntimeTownProfileRunner.ts apps/server/src/localRuntimeTownProfileRunnerCli.test.ts apps/server/src/localRuntimeTownProfileRunnerCli.ts apps/server/src/localRuntimeTownProfileGateSuite.test.ts apps/server/src/localRuntimeTownProfileGateSuite.ts apps/server/src/localRuntimeTownProfileGateSuiteCli.test.ts apps/server/src/localRuntimeTownPlannerAblationSuite.test.ts apps/server/src/localRuntimeTownPlannerAblationSuite.ts apps/server/src/localRuntimeTownPlannerOutcomeMetrics.test.ts apps/server/src/localRuntimeTownPlannerShapeMetrics.test.ts apps/server/src/localRuntimeTownServer.test.ts apps/worker/src/localExperimentValidationSchedule.test.ts
git commit -m "feat: summarize agent cycle diagnostics in profile reports"
```
