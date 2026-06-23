# Worker Tick Time Advance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every worker simulation tick append a replayable `SimulationTimeAdvanced` event before running agent cycles.

**Architecture:** `apps/worker` owns tick orchestration and event-stream ordering. `@aivilization/world` owns the `AdvanceSimulationTime` command semantics and projection update. This slice connects the two through a reusable command-to-event-stream helper so the worker never mutates projection time directly.

**Tech Stack:** TypeScript, Vitest, `@aivilization/sim-core`, `@aivilization/world`, `apps/worker`.

---

## Scope

This slice turns a worker tick into an authoritative time batch:

- Dispatch one system `AdvanceSimulationTime` command at the start of each worker tick.
- Append the resulting `SimulationTimeAdvanced` event to the same world event stream as agent actions.
- Run agent cycles against the projection after the time event has been applied.
- Carry the stream version forward from the time append into ordered agent cycle appends.
- Preserve whole-tick idempotency when retrying with the same `tickId` and starting `expectedVersion`.

It does not implement a long-running scheduler loop, leases, distributed locks, wall-clock timers, empty-agent ticks, time dilation, calendar rules, or per-partition clocks.

## File Structure

- Modify `apps/worker/src/tickRunner.test.ts`: update tick expectations so the first event is `SimulationTimeAdvanced`, stream versions include it, and idempotent replay keeps a single time event.
- Modify `apps/worker/src/commandDispatch.ts`: add a reusable `dispatchWorldCommandToEventStream` helper for pre-built system commands.
- Modify `apps/worker/src/tickRunner.ts`: create and append the time command before agent cycles.
- Modify this plan file as tasks complete.

## Task 1: Tick Time Tests

**Files:**

- Modify: `apps/worker/src/tickRunner.test.ts`

- [ ] **Step 1: Write failing tests for tick-owned time advancement**

Update the worker tick tests to require:

- The first event in a tick is `[1, 'SimulationTimeAdvanced']`.
- Agent cycle events start after the time event.
- The returned projection clock advances by the projection clock's `tickDurationMs`.
- The returned stream version includes the time event.
- Retrying the same tick does not duplicate the time event.
- Replanning in an early agent still keeps the tick time event and continues later agents from the advanced projection.

Run:

```bash
pnpm --filter @aivilization/worker test
```

Expected before implementation: tests fail because the tick runner does not append `SimulationTimeAdvanced`.

## Task 2: Event Stream Helper

**Files:**

- Modify: `apps/worker/src/commandDispatch.ts`

- [ ] **Step 2: Add command-envelope event-stream dispatch**

Add a helper that takes a validated `CommandEnvelope<CoreCommandType, unknown>`, dispatches it through `dispatchWorldCommand`, appends the resulting events with optimistic concurrency and idempotency, and rebuilds projection from the appended events.

The helper should return:

- `command`
- `events`
- `projection`
- `appendResult`

## Task 3: Tick Runner Integration

**Files:**

- Modify: `apps/worker/src/tickRunner.ts`

- [ ] **Step 3: Append tick time before agent cycles**

At the start of `runWorkerSimulationTick`:

- Create `AdvanceSimulationTime` command id `${tickId}-advance-time`.
- Use append idempotency key `${tickId}:append:time`.
- Default `deltaMs` to `input.projection.clock.tickDurationMs`.
- Apply the appended time event to the projection.
- Start agent cycle appends from the time append stream version.
- Include the time event in `WorkerTickResult.events`.

## Task 4: Verification

**Files:**

- Modify: this plan file

- [ ] **Step 4: Run focused and full verification**

Run:

```bash
pnpm --filter @aivilization/worker test
pnpm --filter @aivilization/worker typecheck
pnpm check
pnpm build
```

Commit the implementation and update this plan when the checks pass.
