# Default Survival Time Policies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Attach AIvilization survival time-effect defaults to the centralized world policy factory so default runtime profiles exercise the paper's passive survival loop.

**Architecture:** `packages/content` owns source-backed default tuning values. `apps/worker/src/aivilizationWorldPolicies.ts` maps content config into `WorldCommandPolicies`, and `packages/world` continues to own deterministic event emission for `AdvanceSimulationTime`. This keeps tuning, runtime composition, and command semantics separate.

**Tech Stack:** TypeScript, Vitest, pnpm, existing `@aivilization/content`, `@aivilization/worker`, `@aivilization/world`, and `@aivilization/society` contracts.

---

## File Structure

- Modify `packages/content/src/scenarios.ts`: add `aivilizationSurvivalTimePolicyDefaults` and config types for sleep deprivation, stochastic illness, residential upkeep, and safety net.
- Modify `packages/content/src/content.test.ts`: prove source-backed defaults exist and cover all six residential tiers.
- Modify `apps/worker/src/aivilizationWorldPolicies.ts`: map content survival defaults into the centralized `WorldCommandPolicies`.
- Modify `apps/worker/src/aivilizationWorldPolicies.test.ts`: prove the factory exposes passive survival policies.
- Modify `apps/worker/src/tickRunner.test.ts`: prove a worker tick using the default policy factory emits deterministic passive survival events.
- Modify `docs/superpowers/plans/2026-06-25-default-survival-time-policies-slice.md`: keep task checkboxes current.

### Task 1: Content Survival Defaults

**Files:**

- Modify: `packages/content/src/scenarios.ts`
- Test: `packages/content/src/content.test.ts`

- [x] **Step 1: Write failing content test**

Add a test expecting `aivilizationSurvivalTimePolicyDefaults` to include:

- `sleepDeprivation: { energyThreshold: 20, healthDecayPerSecond: 0.005, minHealth: 10 }`
- `stochasticIllness: { illnessProbabilityPercentPerHour: 1, healthDamage: 5, minHealth: 10 }`
- `safetyNetSubsidy: { minimumBalance: 50, maxSubsidy: 25 }`
- six `residentialUpkeep.costs`, including tier 1 cost `0` and tier 6 cost `320`.

- [x] **Step 2: Verify RED**

Run: `pnpm --filter @aivilization/content test -- content.test.ts`
Expected: FAIL because `aivilizationSurvivalTimePolicyDefaults` is not exported.

- [x] **Step 3: Implement content config**

Add explicit types and a source string referencing Section 3.1.1 survival constraints, Section 3.2 labor-consumption feedback, and Appendix B Table 8 recovery activities. Keep values finite and non-negative.

- [x] **Step 4: Verify GREEN**

Run: `pnpm --filter @aivilization/content test -- content.test.ts`
Expected: PASS.

### Task 2: Worker Policy Factory Mapping

**Files:**

- Modify: `apps/worker/src/aivilizationWorldPolicies.ts`
- Test: `apps/worker/src/aivilizationWorldPolicies.test.ts`

- [x] **Step 5: Write failing worker factory test**

Extend the existing factory test to expect `sleepDeprivation`, `stochasticIllness`, `residentialUpkeep`, and `safetyNetSubsidy` in the resolved policies.

- [x] **Step 6: Verify RED**

Run: `pnpm --filter @aivilization/worker test -- aivilizationWorldPolicies.test.ts`
Expected: FAIL because the factory does not yet map those content defaults.

- [x] **Step 7: Implement policy mapping**

Import `aivilizationSurvivalTimePolicyDefaults` into `apps/worker/src/aivilizationWorldPolicies.ts` and copy the source-backed defaults into the corresponding `WorldCommandPolicies` fields.

- [x] **Step 8: Verify GREEN**

Run: `pnpm --filter @aivilization/worker test -- aivilizationWorldPolicies.test.ts`
Expected: PASS.

### Task 3: Worker Tick Integration

**Files:**

- Modify: `apps/worker/src/tickRunner.test.ts`

- [x] **Step 9: Add worker tick integration regression test**

Add a worker tick test that uses `createAivilizationWorldCommandPolicies()` with:

- an agent at tier 2, balance `10`, and energy `10`;
- a one-hour tick;
- no active agent cycles.

Expect event order:
`SimulationTimeAdvanced`, `PhysiologyChanged`, `ResidentialUpkeepCharged`, `SubsidyPaid`.
Expected final state: health `72`, balance `25`, money supply `1015`.

- [x] **Step 10: Verify integration test**

Run: `pnpm --filter @aivilization/worker test -- tickRunner.test.ts`
Expected: PASS after the factory mapping, proving default policies drive the normal worker time phase.

### Task 4: Verification and Commit

**Files:**

- Modify: `docs/superpowers/plans/2026-06-25-default-survival-time-policies-slice.md`

- [x] **Step 11: Format changed files**

Run: `pnpm exec prettier --write docs/superpowers/plans/2026-06-25-default-survival-time-policies-slice.md packages/content/src/scenarios.ts packages/content/src/content.test.ts apps/worker/src/aivilizationWorldPolicies.ts apps/worker/src/aivilizationWorldPolicies.test.ts apps/worker/src/tickRunner.test.ts`

- [x] **Step 12: Run focused and repo checks**

Run:
`pnpm --filter @aivilization/content test -- content.test.ts`
`pnpm --filter @aivilization/worker test -- aivilizationWorldPolicies.test.ts`
`pnpm --filter @aivilization/worker test -- tickRunner.test.ts`
`pnpm typecheck`
`pnpm lint`
`pnpm test`
`git diff --check`

- [x] **Step 13: Commit**

Run:
`git add docs/superpowers/plans/2026-06-25-default-survival-time-policies-slice.md packages/content/src/scenarios.ts packages/content/src/content.test.ts apps/worker/src/aivilizationWorldPolicies.ts apps/worker/src/aivilizationWorldPolicies.test.ts apps/worker/src/tickRunner.test.ts`
`git commit -m "feat: add default survival time policies"`

## Self-Review

- Spec coverage: This slice makes default runtime profiles include the paper's passive survival mechanisms: sleep-deprivation health decay, illness risk, residential upkeep, and safety-net subsidy.
- Boundary review: Tuning lives in content; policy assembly lives in worker; world semantics remain unchanged.
- Placeholder scan: No placeholders; all values are explicit and source-labeled.
