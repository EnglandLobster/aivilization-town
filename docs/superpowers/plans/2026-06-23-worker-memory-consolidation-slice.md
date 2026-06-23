# Worker Memory Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a worker-level memory consolidation job that promotes short-term memory records into long-term agent profile patches.

**Architecture:** `@aivilization/memory` owns pure consolidation and profile patching rules. `apps/worker` owns orchestration: retrieve recent STM from a repository, propose patches, apply them through the long-term profile repository, and return an auditable result that a scheduler can persist or trace later.

**Tech Stack:** TypeScript, Vitest, `@aivilization/memory`, `@aivilization/sim-core`, `apps/worker`.

---

## Scope

This slice adds an explicit worker consolidation job:

- Retrieve an agent's short-term memory records from `ShortTermMemoryRepository`.
- Generate long-term profile patches with `proposeLongTermMemoryPatches`.
- Apply generated patches through `LongTermProfileRepository`.
- Return the inspected records, generated patches, and updated profile.
- Export the job from `apps/worker`.

It does not schedule periodic jobs, deduplicate already-applied STM windows, compact memory logs, add vector embeddings, call an LLM for reflection, or batch multiple agents.

## File Structure

- Add `apps/worker/src/memoryConsolidation.test.ts`: TDD coverage for STM-to-LTM profile promotion and no-op consolidation.
- Add `apps/worker/src/memoryConsolidation.ts`: worker job orchestration.
- Modify `apps/worker/src/index.ts`: export the worker memory consolidation job.
- Modify this plan file as tasks complete.

## Task 1: Worker Consolidation Tests

**Files:**

- Add: `apps/worker/src/memoryConsolidation.test.ts`

- [ ] **Step 1: Write failing tests for worker memory consolidation**

Create tests that require:

- Repeated STM habit hints are retrieved and applied to the long-term profile as habit entries.
- The result returns inspected records, generated patches, and the updated profile.
- A no-op consolidation with too few matching records returns no patches and leaves the profile empty.

Run:

```bash
pnpm --filter @aivilization/worker test
```

Expected before implementation: tests fail because `runWorkerMemoryConsolidation` is missing.

## Task 2: Worker Consolidation Implementation

**Files:**

- Add: `apps/worker/src/memoryConsolidation.ts`
- Modify: `apps/worker/src/index.ts`

- [ ] **Step 2: Implement the single-agent consolidation job**

Add:

- `WorkerMemoryConsolidationInput`
- `WorkerMemoryConsolidationResult`
- `runWorkerMemoryConsolidation(input)`

Behavior:

- Validate `retrievalLimit` is a positive integer by relying on repository retrieval.
- Retrieve STM records with `{ agentId, limit: retrievalLimit }`.
- Generate patches with `{ agentId, records, minPatternCount, proposedAt }`.
- If patches are empty, return the current long-term profile from `longTermProfileRepository.getOrCreate(agentId)`.
- If patches exist, apply them with `longTermProfileRepository.applyPatches(agentId, patches)`.
- Return `{ agentId, records, patches, profile }`.

## Task 3: Verification

**Files:**

- Modify: this plan file

- [ ] **Step 3: Run focused and full verification**

Run:

```bash
pnpm --filter @aivilization/worker test
pnpm --filter @aivilization/worker typecheck
pnpm check
pnpm build
```

Commit the implementation and update this plan when the checks pass.

