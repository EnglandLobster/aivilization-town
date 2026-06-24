# Residential Physiology Cap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make energy, satiety, and health recovery respect residential-tier-specific upper bounds.

**Architecture:** `packages/society` owns pure physiological cap resolution. `packages/world` applies the optional cap policy at command time for recovery actions (`AgentEat`, `AgentSleep`, `AgentSeeDoctor`) while preserving existing global maxima as fallback behavior. `apps/worker` inherits the rule through existing `WorldCommandPolicies` pass-through.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, existing command/event/projection architecture.

---

## Source Notes

- Paper source: `/path/to/user/AgentDev/Ai-Town/AIVILIZATION-20260623201223/AIVILIZATION.md`
- Section 3.1.1 states that satiety, energy, and health have different upper bounds subject to residential tier.
- This slice adds the backend abstraction and command behavior without inventing a hard-coded cap table that is not explicitly listed in the paper extraction.

## File Structure

- Modify `packages/society/src/physiology.ts`: add `ResidentialPhysiologyCapPolicy`, cap resolution, and max-value helpers.
- Modify `packages/society/src/physiology.test.ts`: prove tier cap lookup, missing-tier rejection, and fallback-free pure behavior.
- Modify `packages/world/src/agentActions.ts`: add optional `residentialPhysiologyCaps` policy and apply it in eat/sleep/doctor handlers.
- Modify `packages/world/src/agentActions.test.ts`: prove satiety, energy, and health recovery cap at the agent's residential tier.
- Modify `apps/worker/src/tickRunner.test.ts`: prove worker action dispatch passes cap policy into world recovery.
- Modify this plan file as tasks complete.

## Design Rules

1. The cap policy is optional; existing simulations without it keep current global max behavior.
2. Cap resolution happens during command handling, not projection replay.
3. Events record the resulting physiology; replay remains deterministic and policy-free.
4. If a cap policy is provided but the agent's residential tier is missing or invalid, the command returns `ActionRejected` plus failed STM through existing rejection behavior.
5. `residentialPhysiologyCaps` constrains recovery maxima only; it does not clamp existing state downward during unrelated commands.

## Task 1: Society Cap Rule

**Files:**

- Modify: `packages/society/src/physiology.ts`
- Modify: `packages/society/src/physiology.test.ts`

- [x] **Step 1: Write failing society cap tests**

Add tests for:

- `resolveResidentialPhysiologyCap` returning `{ maxEnergy: 120, maxSatiety: 90, maxHealth: 110 }` for tier 2,
- missing tier returning a rejected decision with `reason: 'cap-missing'`,
- invalid negative cap returning `reason: 'policy-invalid'`.

- [x] **Step 2: Verify RED**

Run:

```bash
pnpm --filter @aivilization/society test -- physiology.test.ts
```

Expected before implementation: FAIL because cap types/functions do not exist.

- [x] **Step 3: Implement pure cap resolution**

Export:

```ts
export type ResidentialPhysiologyCap = {
  readonly residentialTier: number;
  readonly maxEnergy: number;
  readonly maxSatiety: number;
  readonly maxHealth: number;
};

export type ResidentialPhysiologyCapPolicy = {
  readonly caps: readonly ResidentialPhysiologyCap[];
};

export type ResidentialPhysiologyCapDecision =
  | { readonly status: 'accepted'; readonly cap: ResidentialPhysiologyCap }
  | {
      readonly status: 'rejected';
      readonly reason: 'cap-missing' | 'policy-invalid';
      readonly detail: string;
    };
```

Add `resolveResidentialPhysiologyCap(input)` with positive tier and positive max validation.

- [x] **Step 4: Verify GREEN**

Run:

```bash
pnpm --filter @aivilization/society test -- physiology.test.ts
```

## Task 2: World Recovery Command Caps

**Files:**

- Modify: `packages/world/src/agentActions.ts`
- Modify: `packages/world/src/agentActions.test.ts`

- [x] **Step 5: Write failing world recovery tests**

Add tests proving:

- `AgentEat` uses tier max satiety from `residentialPhysiologyCaps`,
- `AgentSleep` uses tier max energy from `residentialPhysiologyCaps`,
- `AgentSeeDoctor` uses tier max health from `residentialPhysiologyCaps`.

- [x] **Step 6: Verify RED**

Run:

```bash
pnpm --filter @aivilization/world test -- agentActions.test.ts
```

Expected before implementation: FAIL because world recovery handlers only use global max values.

- [x] **Step 7: Implement cap-aware recovery**

Add optional policy to `WorldCommandPolicies`:

```ts
readonly residentialPhysiologyCaps?: ResidentialPhysiologyCapPolicy;
```

Pass it into eat/sleep/doctor handlers with exact optional spreads. Add helper functions that either return the global max fallback or resolve the residential cap and throw/reject using existing observable command rejection paths.

- [x] **Step 8: Verify GREEN**

Run:

```bash
pnpm --filter @aivilization/world test -- agentActions.test.ts
```

## Task 3: Worker Integration

**Files:**

- Modify: `apps/worker/src/tickRunner.test.ts`

- [x] **Step 9: Add worker cap integration test**

Add a worker tick with one `AgentSleep` proposal, a tier-2 agent with low energy, `sleep.maxEnergy: 500`, and `residentialPhysiologyCaps` tier-2 `maxEnergy: 120`. Expect the final projection energy to be `120`.

- [x] **Step 10: Verify worker integration**

Run:

```bash
pnpm --filter @aivilization/worker test -- tickRunner.test.ts
```

## Task 4: Verification and Commit

- [x] **Step 11: Format changed files**

Run:

```bash
pnpm exec prettier --write docs/superpowers/plans/2026-06-25-residential-physiology-cap-slice.md packages/society/src/physiology.ts packages/society/src/physiology.test.ts packages/world/src/agentActions.ts packages/world/src/agentActions.test.ts apps/worker/src/tickRunner.test.ts
```

- [x] **Step 12: Run focused checks**

Run:

```bash
pnpm --filter @aivilization/society test -- physiology.test.ts
pnpm --filter @aivilization/world test -- agentActions.test.ts
pnpm --filter @aivilization/worker test -- tickRunner.test.ts
pnpm typecheck
```

- [x] **Step 13: Run repo checks**

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test
git diff --check
```

- [x] **Step 14: Commit**

Run:

```bash
git add docs/superpowers/plans/2026-06-25-residential-physiology-cap-slice.md packages/society/src/physiology.ts packages/society/src/physiology.test.ts packages/world/src/agentActions.ts packages/world/src/agentActions.test.ts apps/worker/src/tickRunner.test.ts
git commit -m "feat: cap recovery by residential tier"
```
