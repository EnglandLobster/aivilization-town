# Location-Aware Domain Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make canonical domain micro-planners use the town location model so agents move to the required place before executing domain actions.

**Architecture:** Keep `@aivilization/agent-runtime` generic and location-free. `apps/worker` owns the canonical game-domain adapter, so it maps domains to projection locations, emits `AgentMoveTo` as a precondition action when required, and keeps the selected subtask in progress after movement-only cycles. Actual movement and social co-location validation remain in `@aivilization/world`.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, `@aivilization/worker`, `@aivilization/world`, `@aivilization/agent-runtime`.

---

### Task 1: Location-Aware Canonical Runtime Proposals

**Files:**

- Modify: `apps/worker/src/canonicalDomainRuntimes.test.ts`
- Modify: `apps/worker/src/canonicalDomainRuntimes.ts`

- [x] **Step 1: Write failing canonical runtime tests**

Add tests proving:

- A study subtask proposes `AgentMoveTo` to `school` when the agent is at `residential-block`.
- The same study subtask proposes `AgentStudy` when the agent is already at `school`.
- A social subtask proposes `AgentMoveTo` to the target agent's known location before socializing.

- [x] **Step 2: Run focused canonical runtime tests and observe red**

Run:

```bash
pnpm --filter @aivilization/worker test -- canonicalDomainRuntimes.test.ts
```

Expected: FAIL because canonical domain micro-planners currently ignore `WorldAgentState.locationId`
and never emit `AgentMoveTo`.

- [x] **Step 3: Implement location precondition proposals**

Add canonical domain location defaults:

```ts
const DEFAULT_DOMAIN_LOCATION_IDS = {
  study: asLocationId('school'),
  sleep: asLocationId('residential-block'),
  health: asLocationId('clinic'),
  eat: asLocationId('restaurant'),
  trade: asLocationId('market'),
  production: asLocationId('workshop'),
  work: asLocationId('workshop'),
  residential: asLocationId('residential-block'),
  social: asLocationId('town-square'),
} as const;
```

Wrap each domain proposal through a helper that returns `[AgentMoveTo]` when:

- the projection contains the target location,
- the agent has a known `locationId`,
- the agent is not already at the target location.

For social, prefer the target agent's known location over `town-square` so the runtime can satisfy
world-level co-location checks.

- [x] **Step 4: Verify canonical runtime focused tests**

Run:

```bash
pnpm --filter @aivilization/worker test -- canonicalDomainRuntimes.test.ts
pnpm --filter @aivilization/worker typecheck
```

### Task 2: Active-Plan Movement Cycles Stay In Progress

**Files:**

- Modify: `apps/worker/src/canonicalActivePlanTick.test.ts`
- Modify: `apps/worker/src/canonicalWorkerRuntimeResolver.ts`

- [x] **Step 1: Write failing two-tick active-plan test**

Add a test proving a study objective for an agent at `residential-block` does this:

1. Tick 1 emits `AgentMoveTo`, `AgentLocationChanged`, and STM.
2. Tick 1 progress keeps the study subtask incomplete.
3. Tick 2 hydrates from the event stream, emits `AgentStudy`, and completes the objective.

- [x] **Step 2: Run active-plan focused test and observe red**

Run:

```bash
pnpm --filter @aivilization/worker test -- canonicalActivePlanTick.test.ts
```

Expected: FAIL because accepted movement currently counts as a completed selected subtask.

- [x] **Step 3: Keep movement-only cycles in progress**

Update `createCanonicalSubtaskCompletionPolicy` so any accepted/repaired `AgentMoveTo` action returns:

```ts
{ status: 'in-progress', reason: 'moved to required location before executing subtask' }
```

Do this before production/residential completion logic.

- [x] **Step 4: Verify active-plan focused tests**

Run:

```bash
pnpm --filter @aivilization/worker test -- canonicalActivePlanTick.test.ts
pnpm --filter @aivilization/worker typecheck
```

### Task 3: Full Verification And Commit

**Files:**

- Review changed tests, runtime implementation, completion policy, and this plan.

- [x] **Step 1: Run full verification**

Run:

```bash
pnpm check
pnpm build
```

- [x] **Step 2: Commit**

Run:

```bash
git add docs/superpowers/plans/2026-06-24-location-aware-domain-runtime-slice.md apps/worker/src/canonicalDomainRuntimes.test.ts apps/worker/src/canonicalDomainRuntimes.ts apps/worker/src/canonicalActivePlanTick.test.ts apps/worker/src/canonicalWorkerRuntimeResolver.ts
git commit -m "feat: route domain actions through town locations"
```
