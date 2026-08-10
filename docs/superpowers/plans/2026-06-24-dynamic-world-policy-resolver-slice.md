# Dynamic World Policy Resolver Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let worker command dispatch and tick orchestration accept projection-aware policy resolvers so dynamic policies can be recomputed from the latest projection instead of freezing at tick start.

**Architecture:** Keep `WorldCommandPolicies` as the world package contract and add a worker-only `WorldCommandPolicySource` union of static policy object or resolver function. Worker dispatch resolves the source immediately before each world command using the current projection, while canonical runtime setup resolves policies per agent context before building domain registrations and dry-run simulators.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, `@aivilization/world`, worker orchestration modules.

---

## Scope

This slice fixes stale projection-derived policy wiring. It covers command draft dispatch, event-stream command dispatch, worker agent cycles, worker simulation ticks, canonical active-plan ticks, and canonical dry-run runtime resolution.

It does not add new economic formulas, market metric scheduling, UI surfaces, or persistence changes.

## File Structure

- Create `apps/worker/src/worldCommandPolicySource.ts`: static-or-resolver policy source type and resolver helper.
- Modify `apps/worker/src/commandDispatch.ts`: resolve policies from the current projection before each command.
- Modify `apps/worker/src/agentCycleRunner.ts`: accept policy sources and forward them to dispatch.
- Modify `apps/worker/src/tickRunner.ts`: accept policy sources and resolve time-advance policies from the current projection.
- Modify `apps/worker/src/canonicalWorkerRuntimeResolver.ts`: accept policy sources, resolve them per agent context, and use resolved policies for domain registrations.
- Modify `apps/worker/src/canonicalWorkerRuntimeResolver.test.ts`: prove dry-run simulators resolve policy sources from projection.
- Modify `apps/worker/src/canonicalActivePlanTick.ts`: accept policy sources.
- Modify `apps/worker/src/index.ts`: export policy source helpers.
- Modify `apps/worker/src/commandDispatch.test.ts`: prove sequential command drafts use refreshed projection-backed policies.

## Tasks

### Task 1: Failing Sequential Policy Test

**Files:**

- Modify: `apps/worker/src/commandDispatch.test.ts`

- [x] **Step 1: Write failing test**

Add a test that passes a policy resolver to `dispatchCommandDraftsToWorld`. The first draft studies and changes the population education distribution; the second draft works as `Doctor` and must receive the wage calculated from the updated projection:

```ts
const policies = (currentProjection: WorldProjection) =>
  createProjectionBackedWorldCommandPolicies({
    basePolicies,
    projection: currentProjection,
    knowledgePremium: (effectiveKnowledgeThreshold) => 1 + effectiveKnowledgeThreshold / 1000,
  });

expect(wagePaid.payload.amount).toBeCloseTo(1801.8);
```

- [x] **Step 2: Verify red**

Run:

```bash
pnpm --filter @aivilization/worker test -- commandDispatch.test.ts
```

Expected: FAIL because dispatch still treats `policies` as a static object.

### Task 2: Policy Source Helper And Dispatch Wiring

**Files:**

- Create: `apps/worker/src/worldCommandPolicySource.ts`
- Modify: `apps/worker/src/commandDispatch.ts`
- Modify: `apps/worker/src/index.ts`

- [x] **Step 1: Implement helper**

Create this API:

```ts
export type WorldCommandPolicyResolver = (
  projection: WorldProjection,
) => WorldCommandPolicies;

export type WorldCommandPolicySource = WorldCommandPolicies | WorldCommandPolicyResolver;

export function resolveWorldCommandPolicies(input: {
  readonly policies: WorldCommandPolicySource;
  readonly projection: WorldProjection;
}): WorldCommandPolicies;
```

- [x] **Step 2: Resolve policies per command**

In `dispatchCommandDraftsToWorld`, call `resolveWorldCommandPolicies` inside the command loop after applying previous events to `projection`. In `dispatchWorldCommandToEventStream`, resolve once from the input projection.

- [x] **Step 3: Run focused test**

Run:

```bash
pnpm --filter @aivilization/worker test -- commandDispatch.test.ts
```

Expected: PASS.

### Task 3: Worker Runtime Type Propagation

**Files:**

- Modify: `apps/worker/src/agentCycleRunner.ts`
- Modify: `apps/worker/src/tickRunner.ts`
- Modify: `apps/worker/src/canonicalWorkerRuntimeResolver.ts`
- Modify: `apps/worker/src/canonicalActivePlanTick.ts`

- [x] **Step 1: Accept `WorldCommandPolicySource` in worker orchestration inputs**

Replace input-only `WorldCommandPolicies` annotations with `WorldCommandPolicySource` where worker code stores a policy source for later command dispatch.

- [x] **Step 2: Resolve canonical runtime policies per agent context**

In `createCanonicalWorkerRuntimeResolver`, resolve `config.policies` from `context.projection` before calling `createCanonicalDomainRuntimeRegistrations`, and pass the policy source into the dry-run simulator so dry runs resolve against their configured projection.

- [x] **Step 3: Run worker typecheck**

Run:

```bash
pnpm --filter @aivilization/worker typecheck
```

Expected: PASS.

### Task 4: Verification And Commit

**Files:**

- All files touched in this plan.

- [x] **Step 1: Run full verification**

Run:

```bash
pnpm check
pnpm build
git diff --check
```

Expected: all commands pass.

- [x] **Step 2: Commit**

Run:

```bash
git add docs/superpowers/plans/2026-06-24-dynamic-world-policy-resolver-slice.md apps/worker/src/worldCommandPolicySource.ts apps/worker/src/commandDispatch.ts apps/worker/src/commandDispatch.test.ts apps/worker/src/agentCycleRunner.ts apps/worker/src/tickRunner.ts apps/worker/src/canonicalWorkerRuntimeResolver.ts apps/worker/src/canonicalWorkerRuntimeResolver.test.ts apps/worker/src/canonicalActivePlanTick.ts apps/worker/src/index.ts
git commit -m "feat: resolve world policies from current projection"
```

## Self-Review

- Spec coverage: The plan preserves server-authoritative command/event flow while making dynamic education and macroeconomic policies current at dispatch time.
- Boundary review: World remains policy-driven; worker owns runtime policy resolution; society and economy formulas remain pure.
- Placeholder scan: No deferred implementation markers remain.
