# Profile Memory Synthesis Default Schedule Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make profile LLM memory synthesis runtime config executable without requiring callers to also
hand-author a memory consolidation schedule.

**Architecture:** `apps/server` owns profile-level runtime configuration. `apps/worker` owns lifecycle
memory consolidation semantics. This slice adds a profile-runner default schedule only when a
reflection or social-model LLM synthesizer is configured and no explicit schedule is provided. Explicit
schedules remain authoritative.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces.

---

## Scope

This slice adds:

- default profile memory consolidation schedule creation for configured memory LLM synthesizers;
- integration coverage that runtime config alone produces reflection and social-model synthesis traces;
- preservation of explicit schedule override semantics.

It does not change worker lifecycle scheduling, memory consolidation algorithms, retrieval scoring,
LLM prompt schemas, or production CLI config parsing.

## File Structure

- Modify `apps/server/src/localRuntimeTownProfileRunner.test.ts`.
- Modify `apps/server/src/localRuntimeTownProfileRunner.ts`.

## Tasks

- [x] **Step 1: Add RED test**

  Add a profile-runner test that configures `reflectionSynthesis` and `socialModelSynthesis` without
  `memoryConsolidationSchedule`, then asserts both scripted providers are called and both cognition
  diagnostics have accepted traces with world decision context.

  RED observed: without implementation, both provider request arrays stayed empty because the profile
  runner returned no memory consolidation schedule.

- [x] **Step 2: Implement default schedule**

  Update `createProfileMemoryConsolidationSchedule` so that:

  - explicit schedule remains unchanged except for injecting configured synthesizers when absent;
  - no schedule plus at least one configured synthesizer creates a bounded default schedule;
  - no schedule and no synthesizer still disables memory consolidation.

- [x] **Step 3: Verify**

  Run:

  ```bash
  pnpm test -- apps/server/src/localRuntimeTownProfileRunner.test.ts
  pnpm --filter @aivilization/server typecheck
  git diff --check
  ```

  GREEN observed for `pnpm test -- apps/server/src/localRuntimeTownProfileRunner.test.ts`.
  Also passed `pnpm --filter @aivilization/server typecheck` and `git diff --check`.

- [x] **Step 4: Commit**

  Commit this slice with a detailed Conventional Commit message.

## Self-Review Notes

- Boundary review: server profile runner provides profile defaults; worker still owns consolidation.
- Data-flow review: runtime config -> synthesizer factory -> default schedule -> lifecycle hook -> trace
  diagnostics.
- Paper alignment: this removes a silent no-op path for reflection and social-model LLM synthesis in
  backend profile runs.
