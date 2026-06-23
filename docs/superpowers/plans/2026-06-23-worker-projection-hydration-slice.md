# Worker Projection Hydration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let worker ticks hydrate their starting world projection from the event stream instead of requiring callers to pass a fully current projection.

**Architecture:** `@aivilization/sim-core` already owns replay ordering and the event-store contract; `@aivilization/world` owns projection application. `apps/worker` should compose those contracts into a hydration seam so durable event-log files, SQLite projections, or Postgres-backed stores can enter later through adapters without changing tick orchestration.

**Tech Stack:** TypeScript, Vitest, `@aivilization/sim-core`, `@aivilization/world`, `apps/worker`.

---

## Scope

This slice adds the smallest replay-backed projection recovery boundary:

- Add a worker helper that rebuilds a `WorldProjection` by reading a world event stream and applying events in sequence.
- Support hydrating to the latest stream version for new ticks.
- Support hydrating to a caller-provided `expectedVersion` for idempotent tick retries.
- Allow `runWorkerSimulationTick` to accept either an explicit projection or a projection hydration seed.
- Keep the existing explicit-projection path working for tests, experiments, and callers with already-materialized projections.

It does not implement local event-log files, SQLite projection persistence, snapshot serialization, snapshot loading, compaction, distributed locks, or long-running worker leases.

## File Structure

- Add `apps/worker/src/projectionHydration.test.ts`: TDD coverage for event-stream replay and bounded hydration.
- Add `apps/worker/src/projectionHydration.ts`: worker-owned helper for hydrating world projections from an event stream.
- Modify `apps/worker/src/index.ts`: export the helper.
- Modify `apps/worker/src/tickRunner.test.ts`: add a tick test that starts from event-stream hydration instead of a passed projection.
- Modify `apps/worker/src/tickRunner.ts`: accept the hydration input and resolve the starting projection/version before time advance.
- Modify this plan file as tasks complete.

## Task 1: Projection Hydration Tests

**Files:**

- Add: `apps/worker/src/projectionHydration.test.ts`
- Modify: `apps/worker/src/tickRunner.test.ts`

- [ ] **Step 1: Write failing tests for replay-backed projection hydration**

Create helper tests that require:

- Reading world events from an event stream and applying them to an initial projection.
- Returning the hydrated projection, applied events, `lastAppliedSequence`, and current `streamVersion`.
- Supporting a bounded `toSequence` so retries can hydrate to the original expected stream version.

Add a tick runner test that:

- Runs an initial tick with an explicit projection.
- Runs a second tick with `projectionHydration: { initialProjection }` and no explicit projection.
- Verifies the second tick starts from the first tick's event stream state, advances time from `1000` to `2000`, and appends events after the prior stream version.

Run:

```bash
pnpm --filter @aivilization/worker test
```

Expected before implementation: tests fail because the hydration helper and tick input do not exist.

## Task 2: Hydration Helper

**Files:**

- Add: `apps/worker/src/projectionHydration.ts`
- Modify: `apps/worker/src/index.ts`

- [ ] **Step 2: Implement event-stream projection hydration**

Add `hydrateWorldProjectionFromEventStream(input)`:

- Inputs: `initialProjection`, `eventStore`, `streamName`, optional `fromSequence`, optional `toSequence`.
- Validate `fromSequence` and `toSequence` as non-negative integer bounds.
- Use `eventStore.getStreamVersion(streamName)` to discover current stream version.
- Default `toSequence` to the current stream version.
- Throw if `toSequence` is greater than current stream version or less than `fromSequence`.
- Read stream events after `fromSequence`, filter through `toSequence`, and replay them via `replayEvents(initialProjection, events, applyWorldEvent)`.
- Return `projection`, `events`, `lastAppliedSequence: toSequence`, and `streamVersion`.

## Task 3: Tick Runner Integration

**Files:**

- Modify: `apps/worker/src/tickRunner.ts`

- [ ] **Step 3: Resolve tick starting projection from explicit input or hydration**

Update `runWorkerSimulationTick` so callers can pass either:

- `projection`
- `projectionHydration: { initialProjection, fromSequence? }`

When hydrating:

- Hydrate to `input.expectedVersion` when provided, so same-tick retries can replay from the same starting version.
- Otherwise hydrate to the latest stream version.
- Use the hydration result's `lastAppliedSequence` as the default append expected version.

Keep the existing behavior for explicit projections unchanged.

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
