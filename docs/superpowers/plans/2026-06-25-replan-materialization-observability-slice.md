# Replan Materialization Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist full-replan materialization outcomes in agent cycle traces and summarize them in runtime profile run diagnostics.

**Architecture:** `apps/worker` already produces `replanMaterialization` on `WorkerAgentCycleResult`; `packages/observability` owns the durable trace and profile report schema. This slice adds an optional trace-level materialization summary and report-level count/ratio without changing planner decisions, world rules, or runtime gate policy. Existing legacy trace files remain readable by treating missing materialization as absent.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, observability trace repositories, worker agent cycle traces, runtime profile run reports.

---

### Task 1: Trace Schema And Repository Persistence

**Files:**

- Modify: `packages/observability/src/agentCycleTrace.ts`
- Modify: `packages/observability/src/agentCycleTraceRepository.ts`
- Test: `packages/observability/src/agentCycleTrace.test.ts`
- Test: `packages/observability/src/agentCycleTraceRepository.test.ts`

- [x] **Step 1: Write failing trace schema test**

Extend the main `createAgentCycleTrace` test with:

```typescript
replanMaterialization: {
  status: 'replanned',
  objectiveId: 'objective-production',
  planId: 'objective-production',
  progressReset: true,
  trigger: 'repeated-failure',
  failedActionIds: ['craft-1'],
  evidenceRecordIds: ['stm-context-1'],
  matchingFailureCount: 2,
},
```

Assert:

```typescript
expect(trace.replanMaterialization).toEqual({
  status: 'replanned',
  objectiveId: 'objective-production',
  planId: 'objective-production',
  progressReset: true,
  trigger: 'repeated-failure',
  failedActionIds: ['craft-1'],
  evidenceRecordIds: ['stm-context-1'],
  matchingFailureCount: 2,
});
```

- [x] **Step 2: Write failing repository clone test**

Update `createTrace()` in `agentCycleTraceRepository.test.ts` to optionally include the same `replanMaterialization`, and mutate a read trace's `failedActionIds`. Assert the repository still returns the original immutable summary.

- [x] **Step 3: Run observability trace tests to verify RED**

Run: `pnpm --filter @aivilization/observability test -- agentCycleTrace.test.ts agentCycleTraceRepository.test.ts`

Expected: FAIL at TypeScript/runtime shape because `AgentCycleTrace` has no `replanMaterialization` field and repository clone does not preserve it.

- [x] **Step 4: Implement trace schema and clone support**

Add:

```typescript
export type AgentCycleReplanMaterializationTrace =
  | {
      readonly status: 'replanned';
      readonly objectiveId: string;
      readonly planId: string;
      readonly progressReset: boolean;
      readonly trigger: 'major-context-shift' | 'repeated-failure';
      readonly failedActionIds: readonly string[];
      readonly evidenceRecordIds: readonly string[];
      readonly matchingFailureCount: number;
    }
  | {
      readonly status: 'skipped';
      readonly planId: string;
      readonly reason: 'missing-active-objective' | 'plan-id-mismatch';
      readonly objectiveId?: string;
    };
```

Add optional `replanMaterialization?: AgentCycleReplanMaterializationTrace` to `AgentCycleTrace`, clone it defensively in the repository, and leave legacy persisted traces compatible by omitting the field when missing.

- [x] **Step 5: Run trace tests to verify GREEN**

Run: `pnpm --filter @aivilization/observability test -- agentCycleTrace.test.ts agentCycleTraceRepository.test.ts`

Expected: PASS.

### Task 2: Worker Trace Wiring

**Files:**

- Modify: `apps/worker/src/agentCycleRunner.ts`
- Test: `apps/worker/src/agentCycleRunner.test.ts`

- [x] **Step 1: Write failing worker trace assertion**

Extend the existing `materializes a replacement plan after repository-backed full replanning` test to assert:

```typescript
expect(result.trace.replanMaterialization).toMatchObject({
  status: 'replanned',
  agentId,
  objectiveId: objective.id,
  planId: objective.id,
  progressReset: true,
  trigger: 'repeated-failure',
});
```

If the trace schema intentionally excludes `agentId` because the trace already has it, assert the schema-owned fields and keep `agentId` on the outer trace.

- [x] **Step 2: Run worker test to verify RED**

Run: `pnpm --filter @aivilization/worker test -- agentCycleRunner.test.ts`

Expected: FAIL because `runWorkerAgentCycle` returns materialization separately but does not include it in `trace`.

- [x] **Step 3: Implement worker trace mapping**

Map `WorkerFullReplanMaterializationResult` into the observability trace shape when creating `AgentCycleTrace`. Do not include duplicate `agentId`; the trace already has `agentId`.

- [x] **Step 4: Run worker test to verify GREEN**

Run: `pnpm --filter @aivilization/worker test -- agentCycleRunner.test.ts`

Expected: PASS.

### Task 3: Runtime Profile Diagnostics

**Files:**

- Modify: `packages/observability/src/runtimeProfileRunReport.ts`
- Test: `packages/observability/src/runtimeProfileRunReport.test.ts`
- Test fixture sync: `packages/observability/src/runtimeProfileRunGate.test.ts`
- Test fixture sync: server/worker profile-run diagnostics fixtures that construct reports by hand.

- [x] **Step 1: Write failing profile diagnostics test**

Update `summarizes agent cycle diagnostics from traces` so one trace includes a replanned materialization and one includes a skipped materialization. Expect:

```typescript
fullReplanMaterializationCount: 2,
fullReplanMaterializationRatio: 2 / 3,
```

Update empty diagnostics and default fixture diagnostics to include zero/default values.

- [x] **Step 2: Run runtime profile report test to verify RED**

Run: `pnpm --filter @aivilization/observability test -- runtimeProfileRunReport.test.ts`

Expected: FAIL because `RuntimeProfileAgentCycleDiagnostics` does not include materialization count/ratio.

- [x] **Step 3: Implement diagnostics aggregation and validation**

Add fields:

```typescript
readonly fullReplanMaterializationCount: number;
readonly fullReplanMaterializationRatio: number;
```

Count traces with `trace.replanMaterialization !== undefined`; validate count is non-negative and no larger than `traceCount`; validate ratio in `[0, 1]`.

- [x] **Step 4: Run runtime profile report test to verify GREEN**

Run: `pnpm --filter @aivilization/observability test -- runtimeProfileRunReport.test.ts`

Expected: PASS.

### Task 4: Verification And Commit

**Files:**

- Verify all files changed in Tasks 1-3 plus this plan document.

- [x] **Step 1: Run focused test suite**

Run:

- `pnpm --filter @aivilization/observability test -- agentCycleTrace.test.ts agentCycleTraceRepository.test.ts runtimeProfileRunReport.test.ts`
- `pnpm --filter @aivilization/worker test -- agentCycleRunner.test.ts`

- [x] **Step 2: Run type and format checks**

Run:

- `pnpm --filter @aivilization/observability typecheck`
- `pnpm --filter @aivilization/worker typecheck`
- `pnpm exec prettier --check packages/observability/src/agentCycleTrace.ts packages/observability/src/agentCycleTrace.test.ts packages/observability/src/agentCycleTraceRepository.ts packages/observability/src/agentCycleTraceRepository.test.ts packages/observability/src/runtimeProfileRunReport.ts packages/observability/src/runtimeProfileRunReport.test.ts apps/worker/src/agentCycleRunner.ts apps/worker/src/agentCycleRunner.test.ts docs/superpowers/plans/2026-06-25-replan-materialization-observability-slice.md`

- [x] **Step 3: Run full repository verification**

Run:

- `pnpm check`
- `git diff --check`

- [x] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-06-25-replan-materialization-observability-slice.md packages/observability/src/agentCycleTrace.ts packages/observability/src/agentCycleTrace.test.ts packages/observability/src/agentCycleTraceRepository.ts packages/observability/src/agentCycleTraceRepository.test.ts packages/observability/src/runtimeProfileRunReport.ts packages/observability/src/runtimeProfileRunReport.test.ts packages/observability/src/runtimeProfileRunGate.test.ts apps/worker/src/agentCycleRunner.ts apps/worker/src/agentCycleRunner.test.ts apps/worker/src/localExperimentValidationSchedule.test.ts apps/server/src/localRuntimeTownPlannerShapeMetrics.test.ts apps/server/src/localRuntimeTownProfileRunnerCli.test.ts apps/server/src/localRuntimeTownProfileGateSuiteCli.test.ts apps/server/src/localRuntimeTownProfileGateSuite.test.ts apps/server/src/localRuntimeTownServer.test.ts apps/server/src/localRuntimeTownPlannerAblationSuite.test.ts apps/server/src/localRuntimeTownPlannerOutcomeMetrics.test.ts
git commit -m "feat(observability): 汇总 full replan 物化诊断"
```
