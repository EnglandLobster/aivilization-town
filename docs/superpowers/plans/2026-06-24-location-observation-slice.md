# Location Observation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a server-authoritative location observation action that records what an agent perceives at its current town location into events, projection state, and STM.

**Architecture:** Keep perception deterministic and projection-derived in `@aivilization/world`: `AgentObserveLocation` validates the actor's known location, derives co-located agents and location activity affinities from the current projection, emits `LocationObserved`, then writes an observation STM record. This gives future dialogue, reflection, and profile systems a stable evidence stream without coupling them to UI or LLM output.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, `@aivilization/sim-core`, `@aivilization/world`, `@aivilization/memory`.

---

### Task 1: World Observation Command/Event

**Files:**

- Modify: `packages/sim-core/src/command.ts`
- Modify: `packages/sim-core/src/event.ts`
- Modify: `packages/world/src/commands.ts`
- Modify: `packages/world/src/events.ts`
- Modify: `packages/world/src/projection.ts`
- Modify: `packages/world/src/projection.test.ts`
- Modify: `packages/world/src/agentActions.test.ts`
- Modify: `packages/world/src/agentActions.ts`

- [x] **Step 1: Write failing projection tests**

Add projection coverage proving `LocationObserved` is replayed into a `locationObservations` array
without mutating agent state.

- [x] **Step 2: Run projection tests to verify red**

Run:

```bash
pnpm --filter @aivilization/world test -- projection.test.ts
```

Expected: FAIL because `LocationObserved` is not a world/core event and projection has no
`locationObservations`.

- [x] **Step 3: Implement event and projection state**

Add `AgentObserveLocation` to `CoreCommandType`, `LocationObserved` to `CoreEventType`, and world
payload/projection types:

- `AgentObserveLocationPayload` with optional `focus`.
- `LocationObservedPayload` with `agentId`, `locationId`, `locationName`, `observedAgentIds`,
  `activityAffinities`, and optional `focus`.
- `WorldLocationObservationState` and `WorldProjection.locationObservations`.

- [x] **Step 4: Write failing command handler tests**

Add tests proving:

- An agent at `school` observing location emits `LocationObserved` and observation STM containing
  co-located agent ids and activity affinity tags.
- Observing without a known location is rejected with `ActionRejected` and failed STM.
- `dispatchWorldCommand` routes `AgentObserveLocation`.

- [x] **Step 5: Run command tests to verify red**

Run:

```bash
pnpm --filter @aivilization/world test -- agentActions.test.ts
```

Expected: FAIL because command parsing and dispatch do not support `AgentObserveLocation`.

- [x] **Step 6: Implement command parsing and handler**

Implement `assertAgentObserveLocationPayload`, `handleAgentObserveLocationCommand`, and dispatch
routing. On success:

- sort `observedAgentIds` deterministically,
- emit `LocationObserved`,
- emit `ShortTermMemoryRecorded` with `kind: 'observation'`, `status: 'observed'`, tags including
  `observe`, location id, location kind, activity affinities, and co-located agent ids.

- [x] **Step 7: Verify focused world tests**

Run:

```bash
pnpm --filter @aivilization/world test -- projection.test.ts
pnpm --filter @aivilization/world test -- agentActions.test.ts
pnpm --filter @aivilization/world typecheck
pnpm --filter @aivilization/sim-core typecheck
```

### Task 2: Full Verification And Commit

**Files:**

- Review changed world/sim-core files and this plan.

- [x] **Step 1: Run full verification**

Run:

```bash
pnpm check
pnpm build
```

- [x] **Step 2: Commit**

Run:

```bash
git add docs/superpowers/plans/2026-06-24-location-observation-slice.md packages/sim-core/src/command.ts packages/sim-core/src/event.ts packages/world/src/commands.ts packages/world/src/events.ts packages/world/src/projection.ts packages/world/src/projection.test.ts packages/world/src/agentActions.test.ts packages/world/src/agentActions.ts
git commit -m "feat: add location observation command"
```
