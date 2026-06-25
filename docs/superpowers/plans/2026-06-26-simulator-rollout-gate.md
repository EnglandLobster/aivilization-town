# Simulator Rollout Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote Action Simulator counterfactual rollout metadata from raw trace detail into runtime profile diagnostics and gates.

**Architecture:** Compute rollout coverage from existing `AgentCycleTrace.simulatorEvents` without changing simulator behavior. Store the coverage in `RuntimeProfileAgentCycleDiagnostics`, validate and clone it like other diagnostics, and add an optional runtime profile gate criterion that can fail profile runs missing rollout evidence.

**Tech Stack:** TypeScript, Vitest, pnpm workspace, `@aivilization/observability`.

---

### Task 1: Runtime Profile Rollout Diagnostics And Gate

**Files:**
- Modify: `packages/observability/src/runtimeProfileRunReport.ts`
- Modify: `packages/observability/src/runtimeProfileRunReport.test.ts`
- Modify: `packages/observability/src/runtimeProfileRunGate.ts`
- Modify: `packages/observability/src/runtimeProfileRunGate.test.ts`

- [x] **Step 1: Write failing report tests**

Add expectations that `createRuntimeProfileAgentCycleDiagnostics` returns:
- `simulatorRolloutEventCount`
- `simulatorRolloutCoverageRatio`

The test should mix events with and without `counterfactualStep`, `projectionEventCountBefore`, and `projectionEventCountAfter`.

- [x] **Step 2: Verify report RED**

Run: `pnpm vitest run packages/observability/src/runtimeProfileRunReport.test.ts`

Expected: FAIL because diagnostics do not yet expose rollout coverage fields.

- [x] **Step 3: Implement report diagnostics**

Add optional-compatible fields to `RuntimeProfileAgentCycleDiagnostics`, clone/validate them, and compute them from simulator event trace metadata.

- [x] **Step 4: Write failing gate tests**

Add a criterion field `minimumSimulatorRolloutCoverageRatio` and assert a report below the threshold fails with evidence.

- [x] **Step 5: Verify gate RED**

Run: `pnpm vitest run packages/observability/src/runtimeProfileRunGate.test.ts`

Expected: FAIL because gate criteria does not yet enforce rollout coverage.

- [x] **Step 6: Implement gate enforcement**

Check `report.agentCycleDiagnostics.simulatorRolloutCoverageRatio` against the criterion when provided.

- [x] **Step 7: Verify focused and full tests**

Run:
- `pnpm vitest run packages/observability/src/runtimeProfileRunReport.test.ts packages/observability/src/runtimeProfileRunGate.test.ts`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `git diff --check`

- [x] **Step 8: Commit**

Commit only this stage's plan and observability files. Leave unrelated untracked paper/report directories untouched.
