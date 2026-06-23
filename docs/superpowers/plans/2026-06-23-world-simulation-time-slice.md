# World Simulation Time Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote simulation time advancement into the world command/event/projection boundary so worker ticks create replayable, server-authoritative time facts.

**Architecture:** `@aivilization/sim-core` already owns the generic clock primitive and core command/event names. `@aivilization/world` should own the domain event payload and projection state because the world projection is the read model consumed by agent cycles, planners, workers, and future persistence. The worker remains an orchestrator; it should not mutate time outside the command/event path.

**Tech Stack:** TypeScript, Vitest, `@aivilization/sim-core`, `@aivilization/world`.

---

## Scope

This slice adds the smallest complete time boundary:

- Add a world command payload contract for `AdvanceSimulationTime`.
- Dispatch `AdvanceSimulationTime` into a single `SimulationTimeAdvanced` event.
- Store the current simulation clock in `WorldProjection`.
- Apply `SimulationTimeAdvanced` events to advance the projection clock.
- Preserve deterministic event ids, sequence numbers, and command ids.

It does not implement durable schedulers, wall-clock loops, distributed locks, time dilation, calendar systems, agent aging, market timers, or per-partition clocks.

## File Structure

- Modify `packages/world/src/commands.ts`: add `AdvanceSimulationTimePayload` validation.
- Modify `packages/world/src/events.ts`: add `SimulationTimeAdvancedPayload`.
- Modify `packages/world/src/projection.ts`: add world clock state and event application.
- Modify `packages/world/src/agentActions.ts`: dispatch the system time command.
- Add `packages/world/src/simulationTime.test.ts`: TDD coverage for command dispatch, projection application, defaults, and validation.
- Modify this plan file as tasks complete.

## Task 1: Time Boundary Tests

**Files:**

- Add: `packages/world/src/simulationTime.test.ts`

- [x] **Step 1: Write failing tests for world time advancement**

Test the desired contract before implementation:

- Default projections expose `{ now: 0, tickDurationMs: 1000 }`.
- A caller can seed a projection with an explicit clock.
- `AdvanceSimulationTime` produces one `SimulationTimeAdvanced` event with previous clock, next clock, and `deltaMs`.
- Applying the event updates only the projection clock.
- Negative or non-finite deltas are rejected by payload validation.

## Task 2: Command And Event Contracts

**Files:**

- Modify: `packages/world/src/commands.ts`
- Modify: `packages/world/src/events.ts`

- [x] **Step 2: Add explicit world payload types**

Add `AdvanceSimulationTimePayload` and `assertAdvanceSimulationTimePayload` beside the other world command payload contracts. Add `SimulationTimeAdvancedPayload` to `WorldEventPayloadByType` with enough data to audit the transition:

- `previous: SimulationClock`
- `next: SimulationClock`
- `deltaMs: number`

## Task 3: Projection Clock

**Files:**

- Modify: `packages/world/src/projection.ts`

- [x] **Step 3: Make the world projection time-aware**

Add a `clock: SimulationClock` field to `WorldProjection`, default it in `createWorldProjection`, and update it in `applyWorldEvent` for `SimulationTimeAdvanced`.

## Task 4: Command Dispatch

**Files:**

- Modify: `packages/world/src/agentActions.ts`

- [x] **Step 4: Route AdvanceSimulationTime through the world dispatcher**

Add a system-command handler that validates payload, advances the projection clock via `advanceClock`, and emits the `SimulationTimeAdvanced` event. This command has no actor and must not go through agent rejection or memory recording.

## Task 5: Verification

**Files:**

- Modify: this plan file

- [x] **Step 5: Run focused and full verification**

Run:

```bash
pnpm --filter @aivilization/world test
pnpm --filter @aivilization/world typecheck
pnpm check
pnpm build
```

Commit the implementation and update this plan when the checks pass.

## Verification Results

- `pnpm --filter @aivilization/world test` passed.
- `pnpm --filter @aivilization/world typecheck` passed.
- `pnpm check` passed.
- `pnpm build` passed.
