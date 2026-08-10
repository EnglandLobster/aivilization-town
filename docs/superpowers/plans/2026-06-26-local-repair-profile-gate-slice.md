# Local Repair Profile Gate Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make paper Section 2.1.2 local repair visible and enforceable in runtime profile reports and gates.

**Architecture:** Keep agent behavior unchanged. Treat `AgentCycleTrace.actionRepair[*].localRepair` as the authoritative execution evidence, summarize it in `RuntimeProfileAgentCycleDiagnostics`, and let runtime profile gates assert a minimum accepted local-repair count without coupling the gate to worker internals.

**Tech Stack:** TypeScript, Vitest, pnpm workspace, `@aivilization/observability` runtime profile reports and gates.

---

### Task 1: Agent-Cycle Local Repair Diagnostics

**Files:**

- Modify: `packages/observability/src/runtimeProfileRunReport.test.ts`
- Modify: `packages/observability/src/runtimeProfileRunReport.ts`

- [x] **Step 1: Write the failing diagnostics test**

Add a test near the existing `summarizes agent-cycle diagnostics from durable traces` case:

```ts
test('summarizes local repair outcomes from action repair traces', () => {
  const diagnostics = createRuntimeProfileAgentCycleDiagnostics([
    createTrace({
      traceId: 'local-repair-accepted',
      simulatorStatus: 'repaired',
      replanning: false,
      emittedCommandCount: 1,
      simulatorEvents: [],
      actionRepair: [
        {
          actionId: 'eat-apple',
          rejectionReason: 'missing inventory',
          selectedSubtask: { branchId: 'survival', subtaskId: 'eat' },
          localRepair: {
            status: 'accepted',
            attemptedAction: {
              id: 'buy-apple',
              description: 'Buy Apple before eating',
              commandType: 'AgentTrade',
            },
          },
          outcome: 'repaired',
        },
      ],
    }),
    createTrace({
      traceId: 'local-repair-rejected',
      simulatorStatus: 'rejected',
      replanning: true,
      emittedCommandCount: 0,
      simulatorEvents: [],
      actionRepair: [
        {
          actionId: 'work-no-energy',
          rejectionReason: 'energy too low',
          selectedSubtask: { branchId: 'work', subtaskId: 'earn' },
          localRepair: {
            status: 'rejected',
            attemptedAction: {
              id: 'sleep-first',
              description: 'Sleep before work',
              commandType: 'AgentSleep',
            },
            rejectionReason: 'sleep location unavailable',
          },
          outcome: 'needs-replan',
        },
      ],
    }),
    createTrace({
      traceId: 'local-repair-skipped',
      simulatorStatus: 'rejected',
      replanning: true,
      emittedCommandCount: 0,
      simulatorEvents: [],
      actionRepair: [
        {
          actionId: 'unknown-failure',
          rejectionReason: 'unsupported failure',
          selectedSubtask: { branchId: 'explore', subtaskId: 'wander' },
          localRepair: { status: 'skipped' },
          outcome: 'needs-replan',
        },
      ],
    }),
  ]);

  expect(diagnostics).toMatchObject({
    localRepairAttemptCount: 2,
    localRepairAcceptedCount: 1,
    localRepairRejectedCount: 1,
    localRepairSkippedCount: 1,
    localRepairAcceptedRatio: 1 / 2,
  });
});
```

- [x] **Step 2: Run RED**

Run: `pnpm vitest run packages/observability/src/runtimeProfileRunReport.test.ts -t "local repair outcomes"`

Expected: FAIL because `RuntimeProfileAgentCycleDiagnostics` does not expose local repair counts.

- [x] **Step 3: Implement minimal diagnostics support**

In `RuntimeProfileAgentCycleDiagnostics`, add:

```ts
readonly localRepairAttemptCount: number;
readonly localRepairAcceptedCount: number;
readonly localRepairRejectedCount: number;
readonly localRepairSkippedCount: number;
readonly localRepairAcceptedRatio: number;
```

In `createRuntimeProfileAgentCycleDiagnostics`, count `trace.actionRepair ?? []`; treat `accepted` and `rejected` as attempts, and `skipped` as skipped but not an attempt. Use `ratio(localRepairAcceptedCount, localRepairAttemptCount)`.

In `cloneAgentCycleDiagnostics` and `validateAgentCycleDiagnostics`, preserve backward compatibility by defaulting absent local-repair fields to `0`, validate the counts, and enforce `accepted + rejected === attempt`.

- [x] **Step 4: Run GREEN**

Run: `pnpm vitest run packages/observability/src/runtimeProfileRunReport.test.ts -t "local repair outcomes|agent-cycle diagnostics"`

Expected: PASS.

### Task 2: Runtime Profile Gate Criterion

**Files:**

- Modify: `packages/observability/src/runtimeProfileRunGate.test.ts`
- Modify: `packages/observability/src/runtimeProfileRunGate.ts`

- [x] **Step 1: Write the failing gate test**

Add a gate test near other minimum-count criteria:

```ts
test('fails when accepted local repair count is below the configured minimum', () => {
  const result = evaluateRuntimeProfileRunReport(createReport(), {
    ...createCriteria(),
    minimumLocalRepairAcceptedCount: 1,
  });

  expect(result.failures).toContainEqual({
    code: 'local-repair-accepted-count-too-low',
    message: 'localRepairAcceptedCount must be at least 1',
    evidence: {
      actual: 0,
      minimum: 1,
      localRepairAttemptCount: 0,
      localRepairRejectedCount: 0,
      localRepairSkippedCount: 0,
    },
  });
});
```

- [x] **Step 2: Run RED**

Run: `pnpm vitest run packages/observability/src/runtimeProfileRunGate.test.ts -t "accepted local repair count"`

Expected: FAIL because criteria lacks `minimumLocalRepairAcceptedCount`.

- [x] **Step 3: Implement minimal gate support**

Add optional criteria:

```ts
readonly minimumLocalRepairAcceptedCount?: number;
```

Call `addMinimumLocalRepairAcceptedCountFailure` from `evaluateRuntimeProfileRunReport`. The helper should skip when the criterion is undefined, compare against `report.agentCycleDiagnostics.localRepairAcceptedCount ?? 0`, and include attempt/rejected/skipped evidence.

- [x] **Step 4: Run GREEN**

Run: `pnpm vitest run packages/observability/src/runtimeProfileRunGate.test.ts -t "accepted local repair count|profile run report gate"`

Expected: PASS.

### Task 3: Verification and Commit

**Files:**

- Modify: `docs/superpowers/plans/2026-06-26-local-repair-profile-gate-slice.md`
- Modify: `apps/server/src/localRuntimeTownProfileGate.test.ts`
- Modify: `apps/server/src/localRuntimeTownProfileGate.ts`

- [x] **Step 1: Write the failing server criteria forwarding test**

Add a test near the existing profile gate override tests:

```ts
test('allows profile gates to require accepted local repair evidence', () => {
  expect(
    createLocalRuntimeTownProfileGateCriteria('smoke-25', {
      minimumLocalRepairAcceptedCount: 1,
    }),
  ).toMatchObject({
    criteriaId: 'aivilization-smoke-25:profile-run-gate',
    minimumLocalRepairAcceptedCount: 1,
  });
});
```

- [x] **Step 2: Run RED**

Run: `pnpm vitest run apps/server/src/localRuntimeTownProfileGate.test.ts -t "accepted local repair evidence"`

Expected: FAIL because `createLocalRuntimeTownProfileGateCriteria` does not yet return `minimumLocalRepairAcceptedCount`.

- [x] **Step 3: Implement minimal server forwarding**

Add optional `minimumLocalRepairAcceptedCount?: number` to `LocalRuntimeTownProfileGateCriteriaInput` and include it in the returned criteria only when callers provide it:

```ts
...(input.minimumLocalRepairAcceptedCount === undefined
  ? {}
  : { minimumLocalRepairAcceptedCount: input.minimumLocalRepairAcceptedCount }),
```

- [x] **Step 4: Run GREEN**

Run: `pnpm vitest run apps/server/src/localRuntimeTownProfileGate.test.ts -t "accepted local repair evidence"`

Expected: PASS.

### Task 4: Verification and Commit

**Files:**

- Modify: `docs/superpowers/plans/2026-06-26-local-repair-profile-gate-slice.md`

- [x] **Step 1: Format touched files**

Run:

```bash
pnpm exec prettier --write \
  docs/superpowers/plans/2026-06-26-local-repair-profile-gate-slice.md \
  packages/observability/src/runtimeProfileRunReport.ts \
  packages/observability/src/runtimeProfileRunReport.test.ts \
  packages/observability/src/runtimeProfileRunGate.ts \
  packages/observability/src/runtimeProfileRunGate.test.ts \
  apps/server/src/localRuntimeTownProfileGate.ts \
  apps/server/src/localRuntimeTownProfileGate.test.ts
```

- [x] **Step 2: Run targeted verification**

Run:

```bash
pnpm vitest run \
  packages/observability/src/runtimeProfileRunReport.test.ts \
  packages/observability/src/runtimeProfileRunGate.test.ts \
  apps/server/src/localRuntimeTownProfileGate.test.ts
```

- [x] **Step 3: Run workspace sanity checks**

Run:

```bash
pnpm typecheck
pnpm lint
git diff --check
```

- [x] **Step 4: Commit**

Run:

```bash
git add \
  docs/superpowers/plans/2026-06-26-local-repair-profile-gate-slice.md \
  packages/observability/src/runtimeProfileRunReport.ts \
  packages/observability/src/runtimeProfileRunReport.test.ts \
  packages/observability/src/runtimeProfileRunGate.ts \
  packages/observability/src/runtimeProfileRunGate.test.ts \
  apps/server/src/localRuntimeTownProfileGate.ts \
  apps/server/src/localRuntimeTownProfileGate.test.ts

git commit
```

Commit message:

```text
feat(observability): 增加 local repair profile gate 诊断

- 为论文 2.1.2 的 local repair 增加 runtime profile 一手观测，避免只用 simulator repaired 结果间接判断修复能力
- 扩展 agent-cycle diagnostics，统计 local repair attempt、accepted、rejected、skipped 与 accepted ratio
- 增加 runtime profile gate 的 minimumLocalRepairAcceptedCount，允许 profile/suite 显式要求本地快速修复发生过
- 语义上保持 agent-runtime 和 worker 行为不变，只强化 observability/gate 边界，降低后续论文对齐验证的耦合
- 验证包含 observability report/gate 单测、typecheck、lint 和 git diff --check
```

---

### Self-Review

Spec coverage:

- Covers local repair as a first-class Section 2.1.2 backend capability.
- Does not claim local repair is LLM-based; it measures the currently implemented cheap local repair tier separately from reactive correction.
- Leaves paper-alignment coverage matrix integration for a later slice, because that type currently models only LLM stages.

Placeholder scan:

- No TBD/TODO/fill-in placeholders.

Type consistency:

- Diagnostics names use `localRepair*`.
- Gate criterion uses `minimumLocalRepairAcceptedCount`.
- Failure code uses `local-repair-accepted-count-too-low`.
