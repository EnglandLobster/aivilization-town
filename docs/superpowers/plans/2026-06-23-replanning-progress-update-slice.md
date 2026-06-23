# Replanning Progress Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert full-replan decisions into explicit branch plan progress updates so failed subtasks become blocked and future planning cycles avoid repeating them.

**Architecture:** `@aivilization/agent-runtime` owns the pure transition from `ReplanningDecision` to `BranchPlanProgress`. `runAgentPlanningCycle` exposes the optional progress update, and `apps/worker` passes progress through without owning the policy.

**Tech Stack:** TypeScript, Vitest, `@aivilization/agent-runtime`, `apps/worker`.

---

## Scope

This slice makes adaptive replanning decisions actionable:

- Add `applyReplanningDecisionToProgress`.
- Return no progress update for `none` and `memory-guided-correction`.
- For `full-replan`, mark the selected subtask as blocked with a trigger-qualified reason.
- Add optional `progressUpdate` to `AgentCycleResult`.
- Let `runWorkerAgentCycle` accept optional `progress` and return optional `progressUpdate`.

It does not persist progress to a repository, generate replacement actions, or execute top-down objective decomposition. Those require separate repository and planner orchestration slices.

## File Structure

- Modify `packages/agent-runtime/src/replanning.test.ts`: TDD coverage for decision-to-progress transition.
- Modify `packages/agent-runtime/src/replanning.ts`: implement progress update helper.
- Modify `packages/agent-runtime/src/cycle.test.ts`: cycle result exposes full-replan progress update.
- Modify `packages/agent-runtime/src/cycle.ts`: include optional `progressUpdate`.
- Modify `apps/worker/src/agentCycleRunner.test.ts`: worker passes and returns progress updates.
- Modify `apps/worker/src/agentCycleRunner.ts`: wire progress through.
- Modify this plan file as tasks complete.

## Task 1: Replanning Progress Transition Tests

**Files:**

- Modify: `packages/agent-runtime/src/replanning.test.ts`

- [x] **Step 1: Write failing tests for decision-to-progress transition**

Create tests that require:

- `memory-guided-correction` returns `undefined` because it should not block the subtask yet.
- `full-replan` marks `selectedSubtask.subtaskId` as blocked.
- Blocked reason is formatted as `<trigger>: <reason>`.
- Existing progress is not mutated.

Run:

```bash
pnpm --filter @aivilization/agent-runtime test
```

Expected before implementation: tests fail because `applyReplanningDecisionToProgress` is missing.

Observed red test: `pnpm --filter @aivilization/agent-runtime test` failed because `applyReplanningDecisionToProgress` was not implemented/exported.

## Task 2: Cycle Progress Update Tests

**Files:**

- Modify: `packages/agent-runtime/src/cycle.test.ts`

- [x] **Step 2: Write failing tests for cycle progress updates**

Create tests that require:

- A full-replan decision with input `progress` returns `progressUpdate`.
- The update blocks the selected subtask at `issuedAt`.
- A memory-guided correction does not return a progress update.

Run:

```bash
pnpm --filter @aivilization/agent-runtime test
```

Expected before implementation: tests fail because cycle results do not expose `progressUpdate`.

Observed red test: cycle result `progressUpdate` was `undefined` after a full-replan decision.

## Task 3: Worker Progress Update Tests

**Files:**

- Modify: `apps/worker/src/agentCycleRunner.test.ts`

- [x] **Step 3: Write failing tests for worker progress pass-through**

Create a worker test that requires:

- `runWorkerAgentCycle` accepts `progress`.
- On full-replan, `result.progressUpdate` contains the blocked selected subtask.
- No world events are appended when the action needs replanning.

Run:

```bash
pnpm --filter @aivilization/worker test
```

Expected before implementation: tests fail because worker input/result do not include progress updates.

Observed red test: worker result `progressUpdate` was `undefined` after a full-replan decision.

## Task 4: Implementation

**Files:**

- Modify: `packages/agent-runtime/src/replanning.ts`
- Modify: `packages/agent-runtime/src/cycle.ts`
- Modify: `apps/worker/src/agentCycleRunner.ts`

- [x] **Step 4: Implement progress update wiring**

Behavior:

- `applyReplanningDecisionToProgress(input)` returns `undefined` unless `decision.kind === 'full-replan'`.
- On full replan, call `markSubtaskBlocked(progress, { subtaskId: selectedSubtask.subtaskId, reason: `${decision.trigger}: ${decision.reason}`, blockedAt: at })`.
- `runAgentPlanningCycle` passes `progress`, selected subtask, decision, and `issuedAt` to the helper.
- `AgentCycleResult.progressUpdate` is optional and only present when a transition happened.
- `runWorkerAgentCycle` accepts optional `progress`, passes it to `runAgentPlanningCycle`, and returns optional `progressUpdate`.

Implemented in `packages/agent-runtime/src/replanning.ts`, `packages/agent-runtime/src/cycle.ts`, and `apps/worker/src/agentCycleRunner.ts`.

## Task 5: Verification

**Files:**

- Modify: this plan file

- [x] **Step 5: Run focused and full verification**

Run:

```bash
pnpm --filter @aivilization/agent-runtime test
pnpm --filter @aivilization/worker test
pnpm --filter @aivilization/agent-runtime typecheck
pnpm --filter @aivilization/worker typecheck
pnpm check
pnpm build
```

Commit the implementation and update this plan when the checks pass.

Verification passed:

- `pnpm --filter @aivilization/agent-runtime test`
- `pnpm --filter @aivilization/worker test`
- `pnpm --filter @aivilization/agent-runtime typecheck`
- `pnpm --filter @aivilization/worker typecheck`
- `pnpm check`
- `pnpm build`
