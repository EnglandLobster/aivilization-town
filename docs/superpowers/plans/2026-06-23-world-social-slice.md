# World Social Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the first AIvilization social interaction loop through `AgentSocialize`, relationship projection state, and social STM consolidation hints.

**Architecture:** Keep social relationship arithmetic in `society`; keep command orchestration, event emission, projection replay, and STM writes in `world`; keep durable identity synthesis in `memory` through existing social consolidation hints. This mirrors the paper's loop: social interaction updates relation/attitude immediately and feeds memory consolidation for long-term profile evolution.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, `@aivilization/sim-core`, `@aivilization/society`, `@aivilization/memory`, `@aivilization/world`.

---

## Scope

This plan extends the current `@aivilization/world` command vertical slices and implements the first social slice from `docs/superpowers/specs/2026-06-23-aivilization-town-design.md`.

It covers:

- Society-layer relationship state, clamped relation/attitude updates, and relation labels.
- Replay support for `SocialInteractionCompleted`.
- A `socialRelations` projection keyed by directed actor-target pairs.
- `AgentSocialize` command payload validation.
- `AgentSocialize` command handling with target-agent existence checks.
- Successful social STM records with `kind: 'social-interaction'` and social consolidation hints.
- Rejection events and failed STM records for invalid social commands.
- Dispatcher routing for `AgentSocialize`.

It does not cover LLM-generated dialogue, social micro-planners, group conversations, spatial proximity, UI panels, durable storage, or profile-patch application into an agent profile store.

## File Structure

- Create `packages/society/src/social.ts`: relationship state, clamped updates, labels, and directed relation keys.
- Create `packages/society/src/social.test.ts`: relationship and validation tests.
- Modify `packages/society/src/index.ts`: export social APIs.
- Modify `packages/world/src/events.ts`: add `SocialInteractionCompletedPayload`.
- Modify `packages/world/src/projection.ts`: add social relation projection state and replay.
- Modify `packages/world/src/projection.test.ts`: add replay test for social interactions.
- Modify `packages/world/src/commands.ts`: add `AgentSocializePayload` and guard.
- Modify `packages/world/src/agentActions.ts`: add social handler and dispatcher routing.
- Modify `packages/world/src/agentActions.test.ts`: add social command handler tests.
- Modify `docs/superpowers/plans/2026-06-23-world-social-slice.md`: track implementation status.

## Tasks

### Task 1: Society Social Rules

**Files:**

- Create: `packages/society/src/social.ts`
- Create: `packages/society/src/social.test.ts`
- Modify: `packages/society/src/index.ts`

- [x] Write failing tests for clamped relation updates, relation labels, directed keys, and invalid delta rejection.
- [x] Run `pnpm --filter @aivilization/society test` and confirm the social APIs are missing.
- [x] Implement `applySocialInteraction`, `classifyRelation`, and `createDirectedSocialRelationKey`.
- [x] Export the social APIs from `packages/society/src/index.ts`.
- [x] Run `pnpm --filter @aivilization/society test` and `pnpm --filter @aivilization/society typecheck`.
- [x] Commit with `git commit -m "feat: add social relationship rules"`.

### Task 2: Social Projection Events

**Files:**

- Modify: `packages/world/src/events.ts`
- Modify: `packages/world/src/projection.ts`
- Modify: `packages/world/src/projection.test.ts`

- [x] Write failing tests for replaying `SocialInteractionCompleted` into directed social relation state.
- [x] Run `pnpm --filter @aivilization/world test` and confirm event payload support is missing.
- [x] Implement the social event payload and projection replay.
- [x] Run `pnpm --filter @aivilization/world test` and `pnpm --filter @aivilization/world typecheck`.
- [x] Commit with `git commit -m "feat: add world social projection events"`.

### Task 3: AgentSocialize Command Handler

**Files:**

- Modify: `packages/world/src/commands.ts`
- Modify: `packages/world/src/agentActions.ts`
- Modify: `packages/world/src/agentActions.test.ts`

- [x] Write failing tests for `AgentSocialize` success, unknown target rejection, self-target rejection, invalid delta rejection, and dispatcher routing.
- [x] Run `pnpm --filter @aivilization/world test` and confirm handler support is missing.
- [x] Implement payload validation and handler orchestration.
- [x] Use `applySocialInteraction` from `society` instead of duplicating relationship math.
- [x] Emit `SocialInteractionCompleted` and social-interaction STM for accepted commands.
- [x] Emit `ActionRejected` and failed STM for rejected commands.
- [x] Route `AgentSocialize` through `dispatchWorldCommand`.
- [x] Run `pnpm --filter @aivilization/world test` and `pnpm --filter @aivilization/world typecheck`.
- [x] Commit with `git commit -m "feat: add socialize command handler"`.

### Task 4: Whole-Repo Verification

**Files:**

- Modify: `docs/superpowers/plans/2026-06-23-world-social-slice.md`

- [x] Run `pnpm check`.
- [x] Run `pnpm build`.
- [x] Update this plan's completed checkboxes.
- [x] Commit the final plan update if needed.

## Acceptance Criteria

- Social interactions deterministically update directed relation and attitude state.
- World replay can reconstruct social relation state from events alone.
- Social STM records carry social consolidation hints compatible with the existing memory LTM pipeline.
- The implementation keeps relationship math in `society`, orchestration in `world`, and profile synthesis in `memory`.
- Full repo checks remain green.
