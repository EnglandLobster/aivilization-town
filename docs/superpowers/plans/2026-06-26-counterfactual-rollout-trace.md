# Counterfactual Rollout Trace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Action Simulator traces prove sequence-level counterfactual rollout state, not only per-action event lists.

**Architecture:** Add optional rollout metadata to simulator trace events at the lowest shared type, emit it from the canonical world dry-run simulator, preserve it through worker agent-cycle trace mapping, and persist it in observability repositories. The metadata is diagnostic-only and must not change command execution, world projection semantics, or planner decisions.

**Tech Stack:** TypeScript, Vitest, pnpm workspace, existing `@aivilization/agent-runtime`, `@aivilization/worker`, and `@aivilization/observability` packages.

---

### Task 1: Canonical Dry-Run Rollout Metadata

**Files:**
- Modify: `packages/agent-runtime/src/actions.ts`
- Modify: `apps/worker/src/canonicalWorkerRuntimeResolver.ts`
- Test: `apps/worker/src/canonicalWorkerRuntimeResolver.test.ts`

- [ ] **Step 1: Write failing tests**

Expect accepted and rejected dry-run trace events to include:
- `counterfactualStep`: 1-based simulator invocation within the dry-run closure.
- `projectionEventCountBefore`: number of accepted dry-run world events already applied before this action.
- `projectionEventCountAfter`: number after this action; unchanged for rejected actions.

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run apps/worker/src/canonicalWorkerRuntimeResolver.test.ts`

Expected: FAIL because trace events do not include rollout metadata.

- [ ] **Step 3: Implement minimal runtime trace metadata**

Extend `ActionSimulationTraceEvent` with the three optional fields and have `createWorldCommandDryRunSimulator` stamp them when mapping world events.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm vitest run apps/worker/src/canonicalWorkerRuntimeResolver.test.ts`

Expected: PASS.

### Task 2: Agent-Cycle Trace Mapping And Persistence

**Files:**
- Modify: `packages/observability/src/agentCycleTrace.ts`
- Modify: `apps/worker/src/agentCycleRunner.ts`
- Modify: `packages/observability/src/agentCycleTraceRepository.ts`
- Test: `apps/worker/src/agentCycleRunner.test.ts`
- Test: `packages/observability/src/agentCycleTraceRepository.test.ts`

- [ ] **Step 1: Write failing tests**

Add assertions that agent-cycle traces and repository query results preserve all three rollout metadata fields.

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run apps/worker/src/agentCycleRunner.test.ts packages/observability/src/agentCycleTraceRepository.test.ts`

Expected: FAIL because mapper and repository clone currently drop unknown trace fields.

- [ ] **Step 3: Implement minimal propagation**

Extend `AgentCycleSimulatorTraceEvent` and copy the optional fields in `mapSimulatorTraceEvents` and repository clone helpers.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm vitest run apps/worker/src/agentCycleRunner.test.ts packages/observability/src/agentCycleTraceRepository.test.ts`

Expected: PASS.

### Task 3: Full Validation And Commit

**Files:**
- Verify all changed files.

- [ ] **Step 1: Run focused and full validation**

Run:
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `git diff --check`

- [ ] **Step 2: Commit**

Commit only this stage's plan and code/test files. Leave unrelated untracked paper/report folders untouched.
