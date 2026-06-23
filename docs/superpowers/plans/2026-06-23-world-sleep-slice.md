# World Sleep Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the first recovery action to the server-authoritative world command/event/projection loop through `AgentSleep`.

**Architecture:** Keep physiology formulas in `society`; keep command orchestration, immutable event emission, projection replay, rejection observability, and STM records in `world`. Reuse the existing `PhysiologyChanged` event instead of introducing a sleep-specific state event.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, `@aivilization/sim-core`, `@aivilization/society`, `@aivilization/memory`, `@aivilization/world`.

---

## Scope

This plan extends the current `@aivilization/world` command vertical slices.

It covers:

- A society-layer energy recovery helper with validation and max-energy capping.
- `AgentSleep` command payload validation.
- `AgentSleep` command handling through the society recovery helper.
- `PhysiologyChanged` events and successful STM records for accepted sleep commands.
- `ActionRejected` events and failed STM records for invalid sleep commands or invalid policy.
- Dispatcher routing for `AgentSleep`.

It does not cover health recovery, doctor visits, sleep scheduling, time advancement, location occupancy, circadian rhythms, UI panels, or durable persistence.

## File Structure

- Modify `packages/society/src/physiology.ts`: add energy recovery helper.
- Modify `packages/society/src/physiology.test.ts`: add recovery tests.
- Modify `packages/world/src/commands.ts`: add `AgentSleepPayload` and guard.
- Modify `packages/world/src/agentActions.ts`: add sleep policy, handler, and dispatcher routing.
- Modify `packages/world/src/agentActions.test.ts`: add sleep command tests.
- Modify `docs/superpowers/plans/2026-06-23-world-sleep-slice.md`: track implementation status.

## Tasks

### Task 1: Society Energy Recovery

**Files:**

- Modify: `packages/society/src/physiology.ts`
- Modify: `packages/society/src/physiology.test.ts`

- [ ] Write failing tests for capped energy recovery and invalid policy rejection.
- [ ] Run `pnpm --filter @aivilization/society test` and confirm the recovery API is missing.
- [ ] Implement `applyEnergyRecovery`.
- [ ] Run `pnpm --filter @aivilization/society test` and `pnpm --filter @aivilization/society typecheck`.
- [ ] Commit with `git commit -m "feat: add energy recovery physiology rule"`.

### Task 2: AgentSleep Command Handler

**Files:**

- Modify: `packages/world/src/commands.ts`
- Modify: `packages/world/src/agentActions.ts`
- Modify: `packages/world/src/agentActions.test.ts`

- [ ] Write failing tests for `AgentSleep` success, invalid payload rejection, invalid policy rejection, and dispatcher routing.
- [ ] Run `pnpm --filter @aivilization/world test` and confirm handler support is missing.
- [ ] Implement payload validation and handler orchestration.
- [ ] Use `applyEnergyRecovery` from `society` instead of duplicating physiology math.
- [ ] Emit `PhysiologyChanged` and successful STM for accepted sleep commands.
- [ ] Emit `ActionRejected` and failed STM for rejected sleep commands.
- [ ] Route `AgentSleep` through `dispatchWorldCommand`.
- [ ] Run `pnpm --filter @aivilization/world test` and `pnpm --filter @aivilization/world typecheck`.
- [ ] Commit with `git commit -m "feat: add sleep command handler"`.

### Task 3: Whole-Repo Verification

**Files:**

- Modify: `docs/superpowers/plans/2026-06-23-world-sleep-slice.md`

- [ ] Run `pnpm check`.
- [ ] Run `pnpm build`.
- [ ] Update this plan's completed checkboxes.
- [ ] Commit the final plan update if needed.

## Acceptance Criteria

- `AgentSleep` deterministically restores energy up to a policy-defined cap.
- World handlers do not duplicate physiology recovery formulas.
- Invalid sleep payloads and invalid sleep policies become observable failed actions.
- The existing `PhysiologyChanged` projection path remains the single source of truth for agent physiology.
- Full repo checks remain green.
