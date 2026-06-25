# Agent Cycle Default STM Injection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure short-term memory retrieved by the worker is injected into agent-runtime planning stages even when callers rely on default retrieval limits.

**Architecture:** The worker owns memory retrieval and relevance filtering; agent-runtime owns planning cognition. The boundary should pass a resolved `shortTermMemoryContext` consistently, independent of whether the caller explicitly configured `memoryRetrievalLimit`.

**Tech Stack:** TypeScript, Vitest, pnpm workspace packages under `apps/worker` and `packages/agent-runtime`.

---

### Task 1: Lock Default STM Injection With RED Test

**Files:**
- Modify: `apps/worker/src/agentCycleRunner.test.ts`

- [x] **Step 1: Write the failing test**

Add a test that appends a relevant short-term memory record, calls `runWorkerAgentCycle` without `memoryRetrievalLimit`, injects a `SubtaskPrioritizer`, and asserts the prioritizer receives that memory id.

- [x] **Step 2: Run RED**

Run:

```bash
pnpm -s vitest run apps/worker/src/agentCycleRunner.test.ts
```

Expected: FAIL because `input.shortTermMemoryContext` is currently omitted unless `memoryRetrievalLimit` is explicitly set.

### Task 2: Pass Resolved STM Unconditionally

**Files:**
- Modify: `apps/worker/src/agentCycleRunner.ts`

- [x] **Step 1: Implement minimal fix**

Change the cycle input construction from checking `input.memoryRetrievalLimit` to checking the resolved `shortTermMemoryContext`, so the default retrieval path reaches agent-runtime.

- [x] **Step 2: Run GREEN**

Run:

```bash
pnpm -s vitest run apps/worker/src/agentCycleRunner.test.ts
```

Expected: PASS.

### Task 3: Verify And Commit

**Files:**
- Modified test and worker files only, plus this plan document.

- [x] **Step 1: Run focused and full checks**

Run:

```bash
pnpm test
pnpm typecheck
pnpm lint
git diff --check
```

Expected: all pass.

- [x] **Step 2: Commit**

Commit with Conventional Commit format and a body explaining the pipeline defect, changed boundary, user-visible gate implications, and verification commands.
