# World-State Action Synthesis Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Derive action synthesis policies from world agent state and pass them through canonical worker ticks.

**Architecture:** `apps/worker` owns world-state adaptation. A pure policy factory converts `WorldAgentState` into `ActionSynthesisPolicy`; canonical runtime bindings attach the policy to scheduled tick agents; tick execution forwards it into `runWorkerAgentCycle`. Canonical micro-planners add resource estimates so runtime synthesis can evaluate the policy.

**Tech Stack:** TypeScript, Vitest, `@aivilization/agent-runtime`, `@aivilization/world`, `apps/worker`.

---

## Scope

This slice adds:

- `deriveActionSynthesisPolicyFromWorldState`.
- Optional `actionSynthesis` in worker runtime bindings and tick agent inputs.
- Canonical default action synthesis policy derivation.
- Canonical action proposal priorities and resource estimates.
- Tests proving policy derivation, canonical estimates, and tick-level policy propagation.

It does not add UI, production-domain estimates, schedule-derived time windows, or new runtime
optimization algorithms.

## File Structure

- Create `apps/worker/src/actionSynthesisPolicy.test.ts`: pure policy factory tests.
- Create `apps/worker/src/actionSynthesisPolicy.ts`: world-state policy derivation.
- Modify `apps/worker/src/index.ts`: export the policy factory.
- Modify `apps/worker/src/canonicalDomainRuntimes.test.ts`: resource estimate red tests.
- Modify `apps/worker/src/canonicalDomainRuntimes.ts`: proposal priority and estimates.
- Modify `apps/worker/src/agentScheduling.ts`: runtime binding action synthesis propagation.
- Modify `apps/worker/src/tickRunner.ts`: tick agent action synthesis propagation.
- Modify `apps/worker/src/canonicalWorkerRuntimeResolver.test.ts`: default derived policy red test.
- Modify `apps/worker/src/canonicalWorkerRuntimeResolver.ts`: derive canonical policy.
- Modify this plan file as steps complete.

## Task 1: Policy Factory

**Files:**

- Create: `apps/worker/src/actionSynthesisPolicy.test.ts`
- Create: `apps/worker/src/actionSynthesisPolicy.ts`
- Modify: `apps/worker/src/index.ts`

- [x] **Step 1: Write failing policy factory tests**

Add tests that assert:

```ts
expect(
  deriveActionSynthesisPolicyFromWorldState({
    agent: createAgent({
      physiology: { energy: 25, satiety: 7, health: 100 },
      balance: 14,
      inventory: { Bread: 2, Rock: 0 },
    }),
    config: {
      maxActions: 2,
      planningWindowSeconds: 3600,
      minEnergyReserve: 5,
      minSatietyReserve: 2,
      minBalanceReserve: 10,
    },
  }),
).toEqual({
  maxActions: 2,
  budget: {
    availableActionSeconds: 3600,
    energyBudget: 20,
    satietyBudget: 5,
    currencyBudget: 4,
    inventoryBudget: { Bread: 2 },
  },
});
```

and a clamp test where reserves exceed current state and budgets become zero.

Run:

```bash
pnpm --filter @aivilization/worker test -- actionSynthesisPolicy.test.ts
```

Expected before implementation: fail because the module does not exist.

- [x] **Step 2: Implement policy factory**

Create the module, validate non-negative finite config values, copy positive inventory entries, and
export it from `apps/worker/src/index.ts`.

## Task 2: Canonical Proposal Estimates

**Files:**

- Modify: `apps/worker/src/canonicalDomainRuntimes.test.ts`
- Modify: `apps/worker/src/canonicalDomainRuntimes.ts`

- [x] **Step 3: Write failing canonical estimate tests**

Update the existing canonical proposal test to assert:

- study has `priority: 10` and `resourceEstimate: { actionSeconds: 900 }`
- sleep has `priority: 10` and `resourceEstimate: { actionSeconds: 7200 }`
- work has `resourceEstimate: { actionSeconds: 1200, energyCost: 3.333333333333333, satietyCost: 3.333333333333333 }`
- trade sell has `resourceEstimate: { inventoryCosts: { Book: 2 } }`

Run:

```bash
pnpm --filter @aivilization/worker test -- canonicalDomainRuntimes.test.ts
```

Expected before implementation: fail because proposals do not carry estimates.

- [x] **Step 4: Implement canonical estimates**

Add helpers for work labor costs and trade AMM estimates. Keep missing-pool or invalid-pool cases
estimate-free so dry-run simulation remains authoritative.

## Task 3: Policy Propagation Through Scheduling

**Files:**

- Modify: `apps/worker/src/agentScheduling.ts`
- Modify: `apps/worker/src/tickRunner.ts`
- Modify: `apps/worker/src/canonicalWorkerRuntimeResolver.test.ts`
- Modify: `apps/worker/src/canonicalWorkerRuntimeResolver.ts`

- [x] **Step 5: Write failing propagation tests**

Add a resolver test asserting `buildWorkerTickAgentsFromActivePlans` produces a tick agent with:

```ts
expect(agents[0]?.actionSynthesis?.budget.energyBudget).toBe(50);
expect(agents[0]?.actionSynthesis?.budget.currencyBudget).toBe(1000);
```

Add or update a tick runner test that supplies a tick agent with `actionSynthesis: { maxActions: 1 }`
and a micro-planner proposing two actions. Assert the trace contains one accepted action and one
rejected action.

Run:

```bash
pnpm --filter @aivilization/worker test -- canonicalWorkerRuntimeResolver.test.ts tickRunner.test.ts
```

Expected before implementation: fail because bindings and tick agents do not propagate policies.

- [x] **Step 6: Implement propagation**

Add optional `actionSynthesis` to `WorkerAgentRuntimeBinding` and `WorkerTickAgentInput`. Copy it
from runtime binding into scheduled agents, then from tick agent into `runWorkerAgentCycle`.
`createCanonicalWorkerRuntimeResolver` derives a default policy unless `actionSynthesis: false`.

## Task 4: Verification and Commit

**Files:**

- Modify: this plan file.

- [x] **Step 7: Run targeted worker checks**

Run:

```bash
pnpm --filter @aivilization/worker test
pnpm --filter @aivilization/worker typecheck
```

Expected after implementation: pass.

- [x] **Step 8: Run full checks**

Run:

```bash
pnpm check
pnpm build
```

Expected: pass.

- [x] **Step 9: Commit**

Commit docs and implementation:

```bash
git add docs/superpowers/specs/2026-06-24-world-state-action-synthesis-policy-design.md docs/superpowers/plans/2026-06-24-world-state-action-synthesis-policy-slice.md apps/worker/src
git commit -m "feat: derive action synthesis policy from world state"
```
