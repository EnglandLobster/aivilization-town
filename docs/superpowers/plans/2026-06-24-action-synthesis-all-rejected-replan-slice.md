# Action Synthesis All-Rejected Replan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Treat cycles where action synthesis rejects every proposal as observable replan/block outcomes instead of throwing and aborting the worker tick.

**Architecture:** `@aivilization/agent-runtime` remains the authority for cycle semantics. Action synthesis rejection is converted into `needs-replan` results before command drafting. Observability traces must allow zero accepted actions when rejected synthesis decisions explain why no command was emitted.

**Tech Stack:** TypeScript, Vitest, `@aivilization/agent-runtime`, `@aivilization/observability`, `apps/worker`.

---

### Task 1: Red Tests

**Files:**
- Modify: `packages/agent-runtime/src/cycle.test.ts`
- Modify: `packages/observability/src/agentCycleTrace.test.ts`
- Modify: `apps/worker/src/agentCycleRunner.test.ts`

- [x] **Step 1: Runtime cycle test**

Add a cycle where resource budget rejects every proposed action. Assert no simulator call happens,
no command draft is produced, `needsReplan` is true, and rejected synthesis decisions become
`needs-replan` simulation results.

- [x] **Step 2: Observability trace test**

Assert `createAgentCycleTrace` accepts a trace with zero accepted actions and zero candidate actions
when rejected action synthesis entries explain the blocked cycle.

- [x] **Step 3: Worker runner test**

Assert `runWorkerAgentCycle` records a trace and skips event append when synthesis rejects all
actions before simulation.

### Task 2: Runtime Semantics

**Files:**
- Modify: `packages/agent-runtime/src/cycle.ts`

- [x] **Step 1: Convert all-rejected synthesis into replan results**

When `actionSynthesisResult.acceptedActions` is empty, return an `AgentCycleResult` with empty
`candidateActions`, synthesized `needs-replan` simulation results for each rejected action, no command
drafts, and normal replanning/subtask-completion decisions.

### Task 3: Trace Contract

**Files:**
- Modify: `packages/observability/src/agentCycleTrace.ts`
- Modify: `apps/worker/src/agentCycleRunner.ts`

- [x] **Step 1: Relax trace validation for blocked cycles**

Require at least one synthesis decision across accepted or rejected actions, and allow empty
`candidateActions` when rejected actions are present.

- [x] **Step 2: Preserve rejected simulator summary**

Ensure worker trace summaries show the synthesis rejection reason as a rejected simulator result.

### Task 4: Verify And Commit

**Files:**
- Review: changed runtime, observability, worker files, and this plan.

- [x] **Step 1: Focused verification**

Run:

```bash
pnpm --filter @aivilization/agent-runtime test -- cycle.test.ts
pnpm --filter @aivilization/observability test -- agentCycleTrace.test.ts
pnpm --filter @aivilization/worker test -- agentCycleRunner.test.ts
pnpm --filter @aivilization/agent-runtime typecheck
pnpm --filter @aivilization/observability typecheck
pnpm --filter @aivilization/worker typecheck
```

- [x] **Step 2: Full verification**

Run:

```bash
pnpm check
pnpm build
```

- [x] **Step 3: Commit**

Run:

```bash
git add docs/superpowers/plans/2026-06-24-action-synthesis-all-rejected-replan-slice.md packages/agent-runtime/src/cycle.ts packages/agent-runtime/src/cycle.test.ts packages/observability/src/agentCycleTrace.ts packages/observability/src/agentCycleTrace.test.ts apps/worker/src/agentCycleRunner.ts apps/worker/src/agentCycleRunner.test.ts
git commit -m "feat: replan when action synthesis rejects all actions"
```
