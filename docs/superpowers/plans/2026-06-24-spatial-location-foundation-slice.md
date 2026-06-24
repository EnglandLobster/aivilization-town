# Spatial Location Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a server-authoritative location model so agents can occupy town places, move through command/event flow, and make location-aware social decisions.

**Architecture:** `@aivilization/sim-core` owns the branded `LocationId` and core `AgentMoveTo` command type. `@aivilization/content` owns source-auditable town location catalog entries derived from the paper's activity/social/economic environment. `@aivilization/world` owns projection state, movement validation, movement events, and the first co-location guard for social interactions without adding pathfinding, UI, or Godot concerns.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, `@aivilization/sim-core`, `@aivilization/content`, `@aivilization/world`.

---

### Task 1: Source-Auditable Location Catalog

**Files:**

- Modify: `packages/sim-core/src/ids.ts`
- Modify: `packages/sim-core/src/command.ts`
- Modify: `packages/sim-core/src/event.ts`
- Create: `packages/content/src/locations.test.ts`
- Create: `packages/content/src/locations.ts`
- Modify: `packages/content/src/index.ts`

- [x] **Step 1: Write failing content catalog tests**

Add `packages/content/src/locations.test.ts`:

```ts
import { asLocationId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import { townLocations } from './locations';

describe('town location catalog', () => {
  test('defines stable unique location ids with activity affinities', () => {
    const ids = townLocations.map((location) => location.locationId);

    expect(new Set(ids).size).toBe(townLocations.length);
    expect(ids).toContain(asLocationId('town-square'));
    expect(ids).toContain(asLocationId('restaurant'));
    expect(ids).toContain(asLocationId('clinic'));
  });

  test('keeps paper-derived activity sources near each location', () => {
    const restaurant = townLocations.find(
      (location) => location.locationId === asLocationId('restaurant'),
    );
    const school = townLocations.find((location) => location.locationId === asLocationId('school'));

    expect(restaurant).toMatchObject({
      kind: 'food',
      activityAffinities: ['eat', 'socialize', 'trade'],
      source: 'AIvilization v0 Appendix B Table 8 activities and Section 3.3 environment',
    });
    expect(school?.activityAffinities).toContain('study');
  });
});
```

- [x] **Step 2: Run content tests to verify red**

Run:

```bash
pnpm --filter @aivilization/content test -- locations.test.ts
```

Expected: FAIL because `packages/content/src/locations.ts` does not exist.

- [x] **Step 3: Implement location id and catalog**

In `packages/sim-core/src/ids.ts`, add:

```ts
export type LocationId = Brand<string, 'LocationId'>;

export function asLocationId(value: string): LocationId {
  return value as LocationId;
}
```

In `packages/sim-core/src/command.ts`, add `AgentMoveTo` to `CoreCommandType`.

Create `packages/content/src/locations.ts` with `TownLocationConfig`, `TownLocationKind`,
`TownActivityAffinity`, and `townLocations` entries for `town-square`, `residential-block`,
`school`, `clinic`, `restaurant`, `market`, and `workshop`.

Export it from `packages/content/src/index.ts`.

- [x] **Step 4: Verify content and sim-core**

Run:

```bash
pnpm --filter @aivilization/content test -- locations.test.ts
pnpm --filter @aivilization/content typecheck
pnpm --filter @aivilization/sim-core typecheck
```

### Task 2: World Projection Location State

**Files:**

- Modify: `packages/world/src/projection.test.ts`
- Modify: `packages/world/src/projection.ts`
- Modify: `packages/world/src/events.ts`
- Modify: `packages/sim-core/src/event.ts`

- [x] **Step 1: Write failing projection tests**

Add tests proving `createWorldProjection` stores locations, normalizes omitted agent locations to
`null`, rejects unknown initial locations, and replays `AgentLocationChanged`.

- [x] **Step 2: Run world projection tests to verify red**

Run:

```bash
pnpm --filter @aivilization/world test -- projection.test.ts
```

Expected: FAIL because projection has no `locations`, no normalized `locationId`, and no
`AgentLocationChanged` event.

- [x] **Step 3: Implement projection location state**

Add `WorldLocationState`, `WorldAgentStateInput`, `WorldLocationStateInput`, and
`AgentLocationChangedPayload`. `WorldAgentState` should expose required
`locationId: LocationId | null`, while projection input agents may omit `locationId` for backwards
compatible seed construction. `createWorldProjection` should reject duplicate locations and reject
agents whose non-null initial location is not present in the projection.

- [x] **Step 4: Verify world projection**

Run:

```bash
pnpm --filter @aivilization/world test -- projection.test.ts
pnpm --filter @aivilization/world typecheck
```

### Task 3: AgentMoveTo Command And Co-Located Social Guard

**Files:**

- Modify: `packages/world/src/commands.ts`
- Modify: `packages/world/src/agentActions.test.ts`
- Modify: `packages/world/src/agentActions.ts`

- [x] **Step 1: Write failing command tests**

Add tests proving `AgentMoveTo` emits `AgentLocationChanged` plus STM, rejects unknown locations,
and `AgentSocialize` rejects when both agents have known but different locations.

- [x] **Step 2: Run world action tests to verify red**

Run:

```bash
pnpm --filter @aivilization/world test -- agentActions.test.ts
```

Expected: FAIL because command payload parsing and dispatch do not support `AgentMoveTo`, and social
actions do not check co-location.

- [x] **Step 3: Implement movement command and guard**

Add `AgentMoveToPayload` and `assertAgentMoveToPayload`. Add `handleAgentMoveToCommand`, route it
from `dispatchWorldCommand`, emit `AgentLocationChanged` and STM on success, and emit observable
`ActionRejected` plus failed STM on invalid/unknown/same-location movement. In
`handleAgentSocializeCommand`, reject only when both source and target have non-null locations and
they differ, keeping old non-spatial seeds compatible.

- [x] **Step 4: Verify world actions**

Run:

```bash
pnpm --filter @aivilization/world test -- agentActions.test.ts
pnpm --filter @aivilization/world typecheck
```

### Task 4: Full Verification And Commit

**Files:**

- Review all changed files and this plan.
- Modify worker test fixtures to default `WorldAgentState.locationId` to `null`:
  `apps/worker/src/actionSynthesisPolicy.test.ts`,
  `apps/worker/src/canonicalActivePlanTick.test.ts`,
  `apps/worker/src/canonicalDomainRuntimes.test.ts`,
  `apps/worker/src/canonicalWorkerRuntimeResolver.test.ts`,
  `apps/worker/src/objectiveLifecycle.test.ts`, and
  `apps/worker/src/objectiveRenewal.test.ts`.

- [x] **Step 1: Run full verification**

Run:

```bash
pnpm check
pnpm build
```

- [x] **Step 2: Commit**

Run:

```bash
git add docs/superpowers/plans/2026-06-24-spatial-location-foundation-slice.md packages/sim-core/src/ids.ts packages/sim-core/src/command.ts packages/sim-core/src/event.ts packages/content/src/locations.test.ts packages/content/src/locations.ts packages/content/src/index.ts packages/world/src/projection.test.ts packages/world/src/projection.ts packages/world/src/events.ts packages/world/src/commands.ts packages/world/src/agentActions.test.ts packages/world/src/agentActions.ts apps/worker/src/actionSynthesisPolicy.test.ts apps/worker/src/canonicalActivePlanTick.test.ts apps/worker/src/canonicalDomainRuntimes.test.ts apps/worker/src/canonicalWorkerRuntimeResolver.test.ts apps/worker/src/objectiveLifecycle.test.ts apps/worker/src/objectiveRenewal.test.ts
git commit -m "feat: add spatial location foundation"
```
