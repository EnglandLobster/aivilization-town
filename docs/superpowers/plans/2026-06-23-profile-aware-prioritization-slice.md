# Profile-Aware Prioritization Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let long-term agent profile state bias contextual subtask prioritization.

**Architecture:** Keep `memory` as the owner of profile state and `agent-runtime` as the owner of planning decisions. Add a small profile-influence adapter in `agent-runtime` that reads `LongTermAgentProfile` entries and turns them into deterministic score adjustments for planner subtasks; the planner then combines base priority, context signals, and profile influences without mutating memory.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, `@aivilization/memory`, `@aivilization/agent-runtime`.

---

## Scope

This plan closes the next loop after long-term profile storage: LTM profile entries can now affect contextual prioritization, matching the paper's requirement that personality and values bias each planning cycle.

It covers:

- Adding profile affinity tags to `PlannerSubtask`.
- Computing profile influence scores from habits, values, personality, and social records.
- Combining base priority, explicit context signals, and profile influence inside `selectPrioritizedSubtask`.
- Passing an optional profile through `runAgentPlanningCycle`.
- Keeping existing planner callers working when no profile is supplied.

It does not cover LLM-derived semantic matching, vector embeddings, social target selection, full global synthesis, database-backed profile retrieval, or profile mutation during planning.

## File Structure

- Create `packages/agent-runtime/src/profileInfluence.ts`: profile-to-subtask score adapter.
- Create `packages/agent-runtime/src/profileInfluence.test.ts`: scoring tests.
- Modify `packages/agent-runtime/src/planner.ts`: add optional profile influence tags and score component.
- Modify `packages/agent-runtime/src/planner.test.ts`: planner selection tests with profile influence.
- Modify `packages/agent-runtime/src/cycle.ts`: pass optional profile into planner selection.
- Modify `packages/agent-runtime/src/cycle.test.ts`: planning cycle test with profile-biased selection.
- Modify `packages/agent-runtime/src/index.ts`: export profile influence APIs.
- Modify `docs/superpowers/plans/2026-06-23-profile-aware-prioritization-slice.md`: track implementation status.

## Tasks

### Task 1: Profile Influence Scoring

**Files:**

- Create: `packages/agent-runtime/src/profileInfluence.ts`
- Create: `packages/agent-runtime/src/profileInfluence.test.ts`
- Modify: `packages/agent-runtime/src/index.ts`

- [x] Write failing tests for habit/value/personality/social record keyword influence, section weights, and deterministic tie ordering.
- [x] Run `pnpm --filter @aivilization/agent-runtime test` and confirm profile influence APIs are missing.
- [x] Implement `scoreProfileInfluence` and profile influence types.
- [x] Export the profile influence APIs from `packages/agent-runtime/src/index.ts`.
- [x] Run `pnpm --filter @aivilization/agent-runtime test` and `pnpm --filter @aivilization/agent-runtime typecheck`.
- [x] Commit with `git commit -m "feat: add profile influence scoring"`.

### Task 2: Planner Selection Integration

**Files:**

- Modify: `packages/agent-runtime/src/planner.ts`
- Modify: `packages/agent-runtime/src/planner.test.ts`

- [x] Write failing tests proving profile influence can select a lower-base-priority subtask and is reported in the selected score.
- [x] Run `pnpm --filter @aivilization/agent-runtime test` and confirm planner integration is missing.
- [x] Add optional `profileAffinityTags` to `PlannerSubtask`.
- [x] Add optional `profileInfluence` input to `selectPrioritizedSubtask`.
- [x] Combine base priority, context signals, and profile influence deterministically.
- [x] Run `pnpm --filter @aivilization/agent-runtime test` and `pnpm --filter @aivilization/agent-runtime typecheck`.
- [x] Commit with `git commit -m "feat: add profile-aware planner selection"`.

### Task 3: Planning Cycle Integration

**Files:**

- Modify: `packages/agent-runtime/src/cycle.ts`
- Modify: `packages/agent-runtime/src/cycle.test.ts`

- [x] Write failing tests proving `runAgentPlanningCycle` passes an optional long-term profile into prioritization.
- [x] Run `pnpm --filter @aivilization/agent-runtime test` and confirm cycle integration is missing.
- [x] Add optional `longTermProfile` to `runAgentPlanningCycle`.
- [x] Use `scoreProfileInfluence` before selecting a subtask.
- [x] Keep existing no-profile callers behavior unchanged.
- [x] Run `pnpm --filter @aivilization/agent-runtime test` and `pnpm --filter @aivilization/agent-runtime typecheck`.
- [x] Commit with `git commit -m "feat: connect profile to planning cycle"`.

### Task 4: Whole-Repo Verification

**Files:**

- Modify: `docs/superpowers/plans/2026-06-23-profile-aware-prioritization-slice.md`

- [x] Run `pnpm check`.
- [x] Run `pnpm build`.
- [x] Update this plan's completed checkboxes.
- [x] Commit the final plan update if needed.

## Acceptance Criteria

- Planner subtasks can declare profile affinity tags.
- Long-term profile entries can bias task selection without mutating the profile.
- The planning cycle honors profile influence when a profile is supplied and remains backward-compatible when it is not.
- Profile influence scoring is deterministic and locally testable.
- Full repo checks remain green.
