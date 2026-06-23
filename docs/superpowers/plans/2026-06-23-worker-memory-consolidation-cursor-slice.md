# Worker Memory Consolidation Cursor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add cursor-based memory consolidation scheduling so periodic reflection processes only new short-term memories per agent.

**Architecture:** `@aivilization/memory` owns STM retrieval semantics, so time-window filtering belongs in the repository query contract. `apps/worker` owns scheduling state: a cursor store records the latest STM occurrence processed for each agent, and the scheduler advances cursors only after applying consolidation.

**Tech Stack:** TypeScript, Vitest, Node `fs`/`path`, `@aivilization/memory`, `@aivilization/sim-core`, `apps/worker`.

---

## Scope

This slice adds cursor-aware periodic consolidation:

- Extend `ShortTermMemoryQuery` with `occurredAfter` and `orderBy`.
- Keep the existing importance-first retrieval default unchanged.
- Add worker consolidation cursors per agent.
- Add in-memory and file-backed cursor stores for tests and local runtime persistence.
- Add `runWorkerMemoryConsolidationSchedule` that processes only STM records after each agent cursor and advances the cursor after inspection.

It does not add cron timers, distributed locks, queue leases, failure retries, vector retrieval, or LLM-generated reflection text.

## File Structure

- Modify `packages/memory/src/retrieval.test.ts`: TDD coverage for `occurredAfter` and chronological ordering.
- Modify `packages/memory/src/retrieval.ts`: query filtering and ordering.
- Modify `apps/worker/src/memoryConsolidation.test.ts`: TDD coverage for cursor-aware schedule runs and file cursor restart recovery.
- Modify `apps/worker/src/memoryConsolidation.ts`: cursor store interfaces/adapters and schedule runner.
- Modify this plan file as tasks complete.

## Task 1: STM Retrieval Window Tests

**Files:**

- Modify: `packages/memory/src/retrieval.test.ts`

- [ ] **Step 1: Write failing tests for STM time-window retrieval**

Create tests that require:

- `occurredAfter` filters records strictly greater than the cursor timestamp.
- `orderBy: 'oldest-first'` returns records by ascending `occurredAt`, then id.
- Existing default ordering remains importance-first.

Run:

```bash
pnpm --filter @aivilization/memory test
```

Expected before implementation: tests fail because `occurredAfter` and `orderBy` are not implemented.

## Task 2: Worker Cursor Schedule Tests

**Files:**

- Modify: `apps/worker/src/memoryConsolidation.test.ts`

- [ ] **Step 2: Write failing tests for cursor-aware consolidation schedules**

Create tests that require:

- The first schedule run processes new records and advances the agent cursor.
- A second schedule run with no new records returns no patches and does not reprocess old records.
- Appending later records causes the next schedule run to process only those new records.
- A file-backed cursor store recovers the latest cursor after restart.

Run:

```bash
pnpm --filter @aivilization/worker test
```

Expected before implementation: tests fail because cursor stores and `runWorkerMemoryConsolidationSchedule` are missing.

## Task 3: Implementation

**Files:**

- Modify: `packages/memory/src/retrieval.ts`
- Modify: `apps/worker/src/memoryConsolidation.ts`

- [ ] **Step 3: Implement retrieval windows and cursor scheduler**

Add to memory retrieval:

- `occurredAfter?: SimulationTimestamp`
- `orderBy?: 'importance' | 'oldest-first'`

Add to worker:

- `MemoryConsolidationCursor`
- `MemoryConsolidationCursorStore`
- `InMemoryMemoryConsolidationCursorStore`
- `FileMemoryConsolidationCursorStore`
- `runWorkerMemoryConsolidationSchedule(input)`

Behavior:

- Schedule deduplicates agent ids in first-seen order.
- For each agent, retrieve STM with `occurredAfter: cursor.lastProcessedOccurredAt`, `orderBy: 'oldest-first'`, and `limit: retrievalLimit`.
- Apply patches using the existing profile repository path.
- If records were inspected, save cursor `{ agentId, lastProcessedOccurredAt: max(record.occurredAt), updatedAt: proposedAt }`.
- Return `{ agentIds, results, cursors, patchCount }`.

## Task 4: Verification

**Files:**

- Modify: this plan file

- [ ] **Step 4: Run focused and full verification**

Run:

```bash
pnpm --filter @aivilization/memory test
pnpm --filter @aivilization/worker test
pnpm --filter @aivilization/memory typecheck
pnpm --filter @aivilization/worker typecheck
pnpm check
pnpm build
```

Commit the implementation and update this plan when the checks pass.

