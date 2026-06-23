# Worker Memory Consolidation Batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a batch worker memory consolidation runner so local runtimes can periodically reflect over multiple agents.

**Architecture:** `runWorkerMemoryConsolidation` remains the single-agent unit of work. The new batch runner is orchestration-only: normalize the agent roster, execute each agent in deterministic order, and return aggregate observability fields for schedulers and future queue workers.

**Tech Stack:** TypeScript, Vitest, `@aivilization/memory`, `@aivilization/sim-core`, `apps/worker`.

---

## Scope

This slice adds a multi-agent consolidation runner:

- Accept a roster of agent ids plus shared STM/LTM repositories.
- Deduplicate repeated agent ids while preserving first-seen order.
- Run single-agent consolidation for each unique agent.
- Return per-agent results and aggregate patch count.
- Export the batch runner from `apps/worker`.

It does not add cron scheduling, queue leases, distributed locks, per-agent error isolation, cursor bookkeeping, or LLM-generated reflections.

## File Structure

- Modify `apps/worker/src/memoryConsolidation.test.ts`: add TDD coverage for multi-agent batch consolidation and duplicate roster handling.
- Modify `apps/worker/src/memoryConsolidation.ts`: add batch input/result types and runner.
- Modify this plan file as tasks complete.

## Task 1: Batch Consolidation Tests

**Files:**

- Modify: `apps/worker/src/memoryConsolidation.test.ts`

- [x] **Step 1: Write failing tests for batch memory consolidation**

Create tests that require:

- Two agents with matching STM patterns both receive long-term profile patches.
- The batch result preserves first-seen agent order.
- Duplicate agent ids are consolidated only once.
- The batch result returns aggregate `patchCount`.

Run:

```bash
pnpm --filter @aivilization/worker test
```

Expected before implementation: tests fail because `runWorkerMemoryConsolidationBatch` is missing.

## Task 2: Batch Consolidation Implementation

**Files:**

- Modify: `apps/worker/src/memoryConsolidation.ts`

- [x] **Step 2: Implement deterministic batch consolidation**

Add:

- `WorkerMemoryConsolidationBatchInput`
- `WorkerMemoryConsolidationBatchResult`
- `runWorkerMemoryConsolidationBatch(input)`

Behavior:

- Deduplicate `agentIds` by string identity while preserving first occurrence.
- For each unique agent, call `runWorkerMemoryConsolidation`.
- Return `{ agentIds, results, patchCount }`, where `patchCount` sums all result patch lengths.

## Task 3: Verification

**Files:**

- Modify: this plan file

- [x] **Step 3: Run focused and full verification**

Run:

```bash
pnpm --filter @aivilization/worker test
pnpm --filter @aivilization/worker typecheck
pnpm check
pnpm build
```

Commit the implementation and update this plan when the checks pass.

## Verification Results

- `pnpm --filter @aivilization/worker test` failed before implementation because `runWorkerMemoryConsolidationBatch` was not exported.
- `pnpm --filter @aivilization/worker test` passed after implementation.
- `pnpm --filter @aivilization/worker typecheck` passed after implementation.
- `pnpm --filter @aivilization/worker test` passed after targeted formatting.
- `pnpm --filter @aivilization/worker typecheck` passed after targeted formatting.
- `pnpm check` passed.
- `pnpm build` passed.
