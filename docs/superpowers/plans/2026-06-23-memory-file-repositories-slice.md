# Memory File Repositories Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add file-backed memory repository adapters so agent short-term memories, intentions, and long-term profiles survive local worker restarts.

**Architecture:** `@aivilization/memory` owns memory repository contracts and local repository adapters. The adapters use append-only JSONL logs for recoverability and simple inspection, while workers continue depending only on existing repository interfaces.

**Tech Stack:** TypeScript, Vitest, Node `fs`/`path`, `@aivilization/memory`.

---

## Scope

This slice adds local durable memory repository adapters:

- `FileShortTermMemoryRepository` for append-only short-term memory records.
- `FileAgentIntentionRepository` for latest agent intention state recovery.
- `FileLongTermProfileRepository` for latest long-term profile recovery.
- Exports from `@aivilization/memory`.
- Tests that recreate repository instances from the same root and recover state.

It does not add vector search, semantic embeddings, compaction, SQLite/Postgres adapters, cross-process locks, retention policies, or automatic consolidation scheduling.

## File Structure

- Add `packages/memory/src/fileRepositories.test.ts`: TDD coverage for durable short-term memory, intention state, and long-term profile recovery.
- Add `packages/memory/src/fileRepositories.ts`: file-backed adapters and JSONL helpers.
- Modify `packages/memory/src/index.ts`: export file repositories.
- Modify this plan file as tasks complete.

## Task 1: File Repository Tests

**Files:**

- Add: `packages/memory/src/fileRepositories.test.ts`

- [x] **Step 1: Write failing tests for durable memory repositories**

Create tests that require:

- `FileShortTermMemoryRepository` persists appended records and retrieves them after a repository restart.
- `FileAgentIntentionRepository` persists objectives and scheduled intentions after restart.
- `FileLongTermProfileRepository` persists applied long-term memory patches after restart.

Run:

```bash
pnpm --filter @aivilization/memory test
```

Expected before implementation: tests fail because file repository exports do not exist.

## Task 2: File Repository Implementation

**Files:**

- Add: `packages/memory/src/fileRepositories.ts`
- Modify: `packages/memory/src/index.ts`

- [x] **Step 2: Implement append-only JSONL memory adapters**

Add:

- `FileShortTermMemoryRepository`
- `FileAgentIntentionRepository`
- `FileLongTermProfileRepository`

Behavior:

- Constructor input: `{ rootDir: string }`.
- Files:
  - `rootDir/short-term-memory.jsonl`
  - `rootDir/agent-intentions.jsonl`
  - `rootDir/long-term-profiles.jsonl`
- Create `rootDir` and empty files on construction.
- Use append-only JSONL writes.
- Read latest state per agent by scanning each state log and choosing the last matching record.
- Preserve existing interface behavior for `getOrCreate`, `save`, `setObjective`, `upsertScheduledIntentions`, and `applyPatches`.

## Task 3: Verification

**Files:**

- Modify: this plan file

- [x] **Step 3: Run focused and full verification**

Run:

```bash
pnpm --filter @aivilization/memory test
pnpm --filter @aivilization/memory typecheck
pnpm check
pnpm build
```

Commit the implementation and update this plan when the checks pass.

## Verification Results

- `pnpm --filter @aivilization/memory test` failed before implementation because file repository exports were missing.
- `pnpm --filter @aivilization/memory test` passed after implementation.
- `pnpm --filter @aivilization/memory typecheck` passed after implementation.
- `pnpm --filter @aivilization/memory test` passed after targeted formatting.
- `pnpm --filter @aivilization/memory typecheck` passed after targeted formatting.
- `pnpm check` passed.
- `pnpm build` passed.
