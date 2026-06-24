# AIvilization World Policy Factory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote AIvilization default world command rules into a reusable worker-level policy factory and attach the paper-backed residential physiology cap config.

**Architecture:** `packages/content` owns source-backed numeric/config tables without importing domain packages. `apps/worker` adapts those content tables into `WorldCommandPolicies`, while `apps/server` consumes the worker factory instead of hard-coding domain policy assembly. `packages/world` remains the command validation authority and receives policy objects only.

**Tech Stack:** TypeScript, pnpm, Vitest, existing `@aivilization/content`, `@aivilization/worker`, `@aivilization/world`, and `@aivilization/server` package boundaries.

---

## File Structure

- Modify `packages/content/src/scenarios.ts`: add source-backed residential physiology cap config shape and default cap table.
- Modify `packages/content/src/content.test.ts`: prove cap table is exported, monotonic, and anchored to Section 3.1.1 plus Appendix A Table 6.
- Create `apps/worker/src/aivilizationWorldPolicies.ts`: assemble the default AIvilization `WorldCommandPolicyResolver`.
- Create `apps/worker/src/aivilizationWorldPolicies.test.ts`: prove the factory derives population education scores and attaches residential caps.
- Modify `apps/worker/src/index.ts`: export the worker policy factory.
- Modify `apps/server/src/localRuntimeTownProfileRunner.ts`: replace server-private policy construction with the worker factory.
- Modify `apps/server/src/localRuntimeTownProfileRunner.test.ts`: prove the server profile default path uses residential caps.

### Task 1: Content Cap Config

**Files:**

- Modify: `packages/content/src/scenarios.ts`
- Test: `packages/content/src/content.test.ts`

- [x] **Step 1: Write failing content test**

Add expectations that `aivilizationResidentialPhysiologyCaps` has six tiers, tier 1 is lower than tier 5, and tier 5 matches the paper profile example cap of 500 for energy, satiety, and health.

- [x] **Step 2: Verify RED**

Run: `pnpm --filter @aivilization/content test -- content.test.ts`
Expected: FAIL because `aivilizationResidentialPhysiologyCaps` is not exported.

- [x] **Step 3: Implement content config**

Add `ScenarioResidentialPhysiologyCapConfig`, a source string referencing Section 3.1.1 and Appendix A Table 6, and `aivilizationResidentialPhysiologyCaps` in `scenarios.ts`.

- [x] **Step 4: Verify GREEN**

Run: `pnpm --filter @aivilization/content test -- content.test.ts`
Expected: PASS.

### Task 2: Worker Policy Factory

**Files:**

- Create: `apps/worker/src/aivilizationWorldPolicies.ts`
- Test: `apps/worker/src/aivilizationWorldPolicies.test.ts`
- Modify: `apps/worker/src/index.ts`

- [x] **Step 5: Write failing worker tests**

Test `createAivilizationWorldCommandPolicies()` resolves a projection-backed policy containing:

- food satiety recovery derived from content commodity roles;
- `residentialPhysiologyCaps.caps` mapped from content config;
- population education scores from the supplied projection;
- default occupation wages from content occupations.

- [x] **Step 6: Verify RED**

Run: `pnpm --filter @aivilization/worker test -- aivilizationWorldPolicies.test.ts`
Expected: FAIL because the factory module does not exist.

- [x] **Step 7: Implement worker factory**

Move the existing default policy assembly from `apps/server/src/localRuntimeTownProfileRunner.ts` into the new worker module. Keep helpers private and export `createAivilizationWorldCommandPolicies`.

- [x] **Step 8: Verify GREEN**

Run: `pnpm --filter @aivilization/worker test -- aivilizationWorldPolicies.test.ts`
Expected: PASS.

### Task 3: Server Default Wiring

**Files:**

- Modify: `apps/server/src/localRuntimeTownProfileRunner.ts`
- Test: `apps/server/src/localRuntimeTownProfileRunner.test.ts`

- [x] **Step 9: Write failing server integration assertion**

Add a profile runner assertion that default canonical profile execution records no missing cap rejections and completes with healthy partitions when the default policy path is used.

- [x] **Step 10: Verify RED or existing gap**

Run: `pnpm --filter @aivilization/server test -- localRuntimeTownProfileRunner.test.ts`
Expected before wiring: either compile failure from removed server helper import once tests reference worker factory behavior, or a failing assertion if the old server helper remains uncapped.

- [x] **Step 11: Replace server policy helper**

Import `createAivilizationWorldCommandPolicies` from `@aivilization/worker`, use it as the default in `runLocalRuntimeTownDaemonScenarioProfile` and `createLocalRuntimeTownProfileAgentProvider`, and delete the server-private commodity/job/occupation policy helpers.

- [x] **Step 12: Verify GREEN**

Run: `pnpm --filter @aivilization/server test -- localRuntimeTownProfileRunner.test.ts`
Expected: PASS.

### Task 4: Verification and Commit

**Files:**

- Modify: `docs/superpowers/plans/2026-06-25-aivilization-world-policy-factory-slice.md`

- [x] **Step 13: Format changed files**

Run: `pnpm exec prettier --write docs/superpowers/plans/2026-06-25-aivilization-world-policy-factory-slice.md packages/content/src/scenarios.ts packages/content/src/content.test.ts apps/worker/src/aivilizationWorldPolicies.ts apps/worker/src/aivilizationWorldPolicies.test.ts apps/worker/src/index.ts apps/server/src/localRuntimeTownProfileRunner.ts apps/server/src/localRuntimeTownProfileRunner.test.ts`

- [x] **Step 14: Run focused and repo checks**

Run:
`pnpm --filter @aivilization/content test -- content.test.ts`
`pnpm --filter @aivilization/worker test -- aivilizationWorldPolicies.test.ts`
`pnpm --filter @aivilization/server test -- localRuntimeTownProfileRunner.test.ts`
`pnpm typecheck`
`pnpm lint`
`pnpm test`
`git diff --check`

- [x] **Step 15: Commit**

Run:
`git add docs/superpowers/plans/2026-06-25-aivilization-world-policy-factory-slice.md packages/content/src/scenarios.ts packages/content/src/content.test.ts apps/worker/src/aivilizationWorldPolicies.ts apps/worker/src/aivilizationWorldPolicies.test.ts apps/worker/src/index.ts apps/server/src/localRuntimeTownProfileRunner.ts apps/server/src/localRuntimeTownProfileRunner.test.ts`
`git commit -m "feat: centralize aivilization world policies"`

## Self-Review

- Spec coverage: This slice advances paper Section 3.1.1 by making residential physiology caps part of the default runtime policy surface, not just optional command tests.
- Boundary review: Content keeps source config; worker adapts runtime policy; server consumes the worker abstraction.
- Placeholder scan: No TODO placeholders; later exact balancing can replace the content table without changing world/server boundaries.
