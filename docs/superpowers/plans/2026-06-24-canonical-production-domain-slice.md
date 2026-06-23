# Canonical Production Domain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a canonical production domain that emits `AgentProduce` proposals and runs through active-plan worker ticks.

**Architecture:** `apps/worker` owns canonical domain adaptation. The new production registration uses `@aivilization/economy`'s `planProduction` for estimates and leaves authoritative command validation to `@aivilization/world`. Existing worker scheduling, action synthesis, dry-run simulation, trace, and command dispatch paths are reused unchanged.

**Tech Stack:** TypeScript, Vitest, `@aivilization/economy`, `@aivilization/world`, `apps/worker`.

---

## Scope

This slice adds:

- `production` canonical domain registration.
- `ProductionDomainRuntimeConfig`.
- `AgentProduce` canonical proposals with priority and optional resource estimates.
- Active-plan tick coverage for production.

It does not implement production-chain planning, commodity-demand optimization, UI, or reward RNG
seeding.

## File Structure

- Modify `apps/worker/src/canonicalDomainRuntimes.test.ts`: red tests for registration, configured
  production proposal, and defaults.
- Modify `apps/worker/src/canonicalDomainRuntimes.ts`: production domain implementation.
- Modify `apps/worker/src/canonicalActivePlanTick.test.ts`: red test for full active-plan production
  tick.
- Modify this plan file as tasks complete.

## Task 1: Canonical Domain Tests

**Files:**

- Modify: `apps/worker/src/canonicalDomainRuntimes.test.ts`

- [x] **Step 1: Write failing canonical runtime tests**

Update `domainOrder` to include `'production'`.

Update the configured proposal test with:

```ts
production: { commodityName: 'Book', quantity: 1, availableLaborSeconds: 10 },
```

Assert:

```ts
expect(firstProposal(binding.microPlanners, 'production')).toMatchObject({
  id: 'canonical-production-step-f',
  commandType: 'AgentProduce',
  payload: { commodityName: 'Book', quantity: 1, availableLaborSeconds: 10 },
  priority: 10,
  resourceEstimate: {
    actionSeconds: 1.6,
    energyCost: 32,
    satietyCost: 8,
    inventoryCosts: { Wood: 1 },
  },
});
```

Update context defaults to assert production defaults to `Apple`:

```ts
expect(firstProposal(binding.microPlanners, 'production')).toMatchObject({
  commandType: 'AgentProduce',
  payload: { commodityName: 'Apple', quantity: 1, availableLaborSeconds: 3600 },
});
```

Run:

```bash
pnpm --filter @aivilization/worker test -- canonicalDomainRuntimes.test.ts
```

Expected before implementation: fail because `production` is not registered.

## Task 2: Canonical Production Implementation

**Files:**

- Modify: `apps/worker/src/canonicalDomainRuntimes.ts`

- [x] **Step 2: Implement production registration**

Add production config, append `createProductionDomainRuntimeRegistration` to canonical registrations,
and include `AgentProducePayload` in `CanonicalActionProposal`.

Use `planProduction` to create resource estimates when accepted:

```ts
{
  actionSeconds: productionPlan.laborSeconds,
  energyCost: productionPlan.energyCost,
  satietyCost: productionPlan.satietyCost,
  ...(Object.keys(productionPlan.consumedInputs).length === 0
    ? {}
    : { inventoryCosts: productionPlan.consumedInputs }),
}
```

- [x] **Step 3: Verify canonical runtime tests**

Run:

```bash
pnpm --filter @aivilization/worker test -- canonicalDomainRuntimes.test.ts
pnpm --filter @aivilization/worker typecheck
```

Expected after implementation: pass.

## Task 3: Active-Plan Tick Integration

**Files:**

- Modify: `apps/worker/src/canonicalActivePlanTick.test.ts`

- [x] **Step 4: Write failing active-plan production tick test**

Add a test that creates an active production objective and plan with production affinity, runs
`runCanonicalWorkerActivePlanTick`, and asserts:

```ts
expect(result.events.map((event) => event.type)).toContain('CommodityProduced');
expect(result.projection.agents['agent-1']?.inventory).toEqual({ Apple: 1 });
expect(result.traces[0]?.actionSynthesis.acceptedActions[0]).toMatchObject({
  commandType: 'AgentProduce',
});
```

Run:

```bash
pnpm --filter @aivilization/worker test -- canonicalActivePlanTick.test.ts
```

Expected before implementation wiring is complete: fail if production does not execute through
canonical ticks.

- [x] **Step 5: Verify active-plan production tick**

Run:

```bash
pnpm --filter @aivilization/worker test -- canonicalActivePlanTick.test.ts
```

Expected after implementation: pass.

## Task 4: Verification and Commit

**Files:**

- Modify: this plan file.

- [x] **Step 6: Run worker checks**

Run:

```bash
pnpm --filter @aivilization/worker test
pnpm --filter @aivilization/worker typecheck
```

Expected: pass.

- [x] **Step 7: Run full checks**

Run:

```bash
pnpm check
pnpm build
```

Expected: pass.

- [ ] **Step 8: Commit**

Commit docs and implementation:

```bash
git add docs/superpowers/specs/2026-06-24-canonical-production-domain-design.md docs/superpowers/plans/2026-06-24-canonical-production-domain-slice.md apps/worker/src
git commit -m "feat: add canonical production domain"
```
