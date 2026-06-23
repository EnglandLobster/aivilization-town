# Memory Profile Application Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply consolidated long-term memory patches into durable agent profile state.

**Architecture:** Keep patch proposal and patch application separated. `consolidation.ts` proposes `LongTermMemoryPatch` values from STM; `profile.ts` owns pure profile creation and patch reduction; `profileRepository.ts` owns a replaceable persistence port plus an in-memory implementation for deterministic tests and early runtime.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, `@aivilization/sim-core`, `@aivilization/memory`.

---

## Scope

This plan closes the first memory loop gap after social interactions: STM can already produce social/habit/caution LTM patches, but those patches are not yet applied to the agent's long-term profile.

It covers:

- Creating an empty `LongTermAgentProfile` for an agent.
- Applying `LongTermMemoryPatch` values to the correct profile section.
- Replacing an existing entry when a newer patch targets the same section/key.
- Merging provenance and confidence deterministically.
- Preserving optional `relationDelta` and `attitudeDelta` on social profile entries.
- A repository port for reading, saving, and applying patches to profiles.
- An in-memory repository implementation for tests and early runtime.

It does not cover vector search, database persistence, profile-to-planner weighting, UI profile panels, or LLM-generated values/personality synthesis.

## File Structure

- Modify `packages/memory/src/profile.ts`: add profile entry metadata fields, profile factory, and patch reducer.
- Create `packages/memory/src/profile.test.ts`: reducer tests.
- Create `packages/memory/src/profileRepository.ts`: repository port and in-memory implementation.
- Create `packages/memory/src/profileRepository.test.ts`: repository tests.
- Modify `packages/memory/src/index.ts`: export repository APIs.
- Modify `docs/superpowers/plans/2026-06-23-memory-profile-application-slice.md`: track implementation status.

## Tasks

### Task 1: Profile Patch Reducer

**Files:**

- Modify: `packages/memory/src/profile.ts`
- Create: `packages/memory/src/profile.test.ts`
- Modify: `packages/memory/src/index.ts`

- [ ] Write failing tests for empty profile creation, new patch insertion, same-key replacement, provenance merge, and social relation metadata preservation.
- [ ] Run `pnpm --filter @aivilization/memory test` and confirm reducer APIs are missing.
- [ ] Implement `createEmptyLongTermAgentProfile`, `applyLongTermMemoryPatch`, and `applyLongTermMemoryPatches`.
- [ ] Export the profile APIs from `packages/memory/src/index.ts`.
- [ ] Run `pnpm --filter @aivilization/memory test` and `pnpm --filter @aivilization/memory typecheck`.
- [ ] Commit with `git commit -m "feat: add long-term profile patch reducer"`.

### Task 2: Profile Repository Port

**Files:**

- Create: `packages/memory/src/profileRepository.ts`
- Create: `packages/memory/src/profileRepository.test.ts`
- Modify: `packages/memory/src/index.ts`

- [ ] Write failing tests for profile isolation, automatic empty profile creation, and applying patches through the repository.
- [ ] Run `pnpm --filter @aivilization/memory test` and confirm repository APIs are missing.
- [ ] Implement `LongTermProfileRepository` and `InMemoryLongTermProfileRepository`.
- [ ] Export the repository APIs from `packages/memory/src/index.ts`.
- [ ] Run `pnpm --filter @aivilization/memory test` and `pnpm --filter @aivilization/memory typecheck`.
- [ ] Commit with `git commit -m "feat: add long-term profile repository"`.

### Task 3: Whole-Repo Verification

**Files:**

- Modify: `docs/superpowers/plans/2026-06-23-memory-profile-application-slice.md`

- [ ] Run `pnpm check`.
- [ ] Run `pnpm build`.
- [ ] Update this plan's completed checkboxes.
- [ ] Commit the final plan update if needed.

## Acceptance Criteria

- LTM patches from consolidation can become queryable `LongTermAgentProfile` state.
- Profile application is deterministic and side-effect-free at the reducer layer.
- Repository callers depend on a small interface that can later be backed by a database without changing agent-runtime contracts.
- Social record patches preserve relation and attitude deltas for future profile panels and planner context.
- Full repo checks remain green.
