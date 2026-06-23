# Adaptive Replanning Decision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an adaptive replanning decision layer that distinguishes no recovery, STM-guided correction, and full top-down replanning after simulator failures or major context shifts.

**Architecture:** `@aivilization/agent-runtime` owns the decision policy because it interprets simulator results and memory context. `@aivilization/observability` owns a serializable trace summary of the decision. `apps/worker` only wires the cycle decision into traces; it does not decide replanning policy.

**Tech Stack:** TypeScript, Vitest, `@aivilization/agent-runtime`, `@aivilization/memory`, `@aivilization/observability`, `apps/worker`.

---

## Scope

This slice implements the first explicit Adaptive Re-planning layer from the paper:

- Add `decideAdaptiveReplanning` as a pure policy function.
- Return `none` when action simulation accepts or repairs all actions.
- Return `memory-guided-correction` for a current unrepaired simulator failure with insufficient repeated-failure evidence.
- Return `full-replan` for major context shifts or repeated matching STM failures.
- Add the decision to `AgentCycleResult`.
- Add a serializable `replanningDecision` summary to `AgentCycleTrace`.
- Wire worker traces from the cycle result.

It does not yet generate replacement actions, mutate plan progress, persist failure counters, invoke an LLM, or run full top-down objective decomposition. Those follow after the decision boundary exists.

## File Structure

- Add `packages/agent-runtime/src/replanning.test.ts`: TDD coverage for adaptive replanning policy.
- Add `packages/agent-runtime/src/replanning.ts`: decision types and pure policy function.
- Modify `packages/agent-runtime/src/cycle.test.ts`: cycle-level decision tests.
- Modify `packages/agent-runtime/src/cycle.ts`: include replanning decision in cycle result.
- Modify `packages/agent-runtime/src/index.ts`: export replanning APIs.
- Modify `packages/observability/src/agentCycleTrace.test.ts`: trace decision coverage.
- Modify `packages/observability/src/agentCycleTrace.ts`: serializable trace decision type.
- Modify `apps/worker/src/agentCycleRunner.test.ts`: worker trace wiring coverage.
- Modify `apps/worker/src/agentCycleRunner.ts`: map runtime decision into trace.
- Modify this plan file as tasks complete.

## Task 1: Replanning Policy Tests

**Files:**

- Add: `packages/agent-runtime/src/replanning.test.ts`

- [ ] **Step 1: Write failing tests for adaptive replanning decisions**

Create tests that require:

- Accepted and repaired simulation results return `{ kind: 'none' }`.
- A current unrepaired simulator failure returns `memory-guided-correction` with failed action ids and matching STM evidence.
- Repeated matching failed STM records at or above the threshold return `full-replan` with trigger `repeated-failure`.
- A major context shift returns `full-replan` with trigger `major-context-shift` even without current simulator failure.

Run:

```bash
pnpm --filter @aivilization/agent-runtime test
```

Expected before implementation: tests fail because replanning APIs are missing.

## Task 2: Cycle Decision Tests

**Files:**

- Modify: `packages/agent-runtime/src/cycle.test.ts`

- [ ] **Step 2: Write failing tests for cycle-level replanning decisions**

Create tests that require:

- `runAgentPlanningCycle` includes `replanningDecision`.
- Existing local repair still returns decision `none`.
- Unrepaired simulator rejection with a matching STM failure returns `memory-guided-correction`.
- Major context shift returns `full-replan`.

Run:

```bash
pnpm --filter @aivilization/agent-runtime test
```

Expected before implementation: tests fail because cycle results do not include explicit replanning decisions.

## Task 3: Trace Wiring Tests

**Files:**

- Modify: `packages/observability/src/agentCycleTrace.test.ts`
- Modify: `apps/worker/src/agentCycleRunner.test.ts`

- [ ] **Step 3: Write failing tests for trace replanning summaries**

Create tests that require:

- `AgentCycleTrace.replanningDecision` accepts a serializable `none`, `memory-guided-correction`, or `full-replan` summary.
- Worker traces copy the cycle result decision into the trace.

Run:

```bash
pnpm --filter @aivilization/observability test
pnpm --filter @aivilization/worker test
```

Expected before implementation: tests fail because traces do not expose replanning decisions.

## Task 4: Implementation

**Files:**

- Add: `packages/agent-runtime/src/replanning.ts`
- Modify: `packages/agent-runtime/src/cycle.ts`
- Modify: `packages/agent-runtime/src/index.ts`
- Modify: `packages/observability/src/agentCycleTrace.ts`
- Modify: `apps/worker/src/agentCycleRunner.ts`

- [ ] **Step 4: Implement adaptive replanning decision and trace wiring**

Behavior:

- `decideAdaptiveReplanning` inspects `ActionWithRepairResult[]`.
- `failedActionIds` are collected from `needs-replan` results.
- Matching STM evidence comes from failed records whose tags or summary match failed action descriptions, selected subtask id, selected subtask description, or optional `failureTags`.
- Repeated failure count uses matching failed STM evidence.
- If `majorContextShift` is provided, return `full-replan`.
- If no current failure and no major shift, return `none`.
- If repeated failure count is at least `consecutiveFailureThreshold`, return `full-replan`.
- Otherwise return `memory-guided-correction`.
- Cycle result includes the decision.
- Worker maps the runtime decision into `AgentCycleTrace.replanningDecision`.

## Task 5: Verification

**Files:**

- Modify: this plan file

- [ ] **Step 5: Run focused and full verification**

Run:

```bash
pnpm --filter @aivilization/agent-runtime test
pnpm --filter @aivilization/observability test
pnpm --filter @aivilization/worker test
pnpm --filter @aivilization/agent-runtime typecheck
pnpm --filter @aivilization/observability typecheck
pnpm --filter @aivilization/worker typecheck
pnpm check
pnpm build
```

Commit the implementation and update this plan when the checks pass.
