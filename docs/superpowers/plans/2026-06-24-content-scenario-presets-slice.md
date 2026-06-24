# Content Scenario Presets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add source-auditable initial scenario and experiment preset data to the `content` package so world startup and validation runs do not depend on scattered test fixtures.

**Architecture:** Keep scenario seed data in `@aivilization/content` as pure configuration and deterministic factory functions. Do not make `content` depend on `world`, `economy`, `society`, or worker runtime modules; projection construction remains a later adapter concern.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, source-derived content config.

---

## Scope

This slice adds scenario seed contracts, the AIvilization Section 5.1 ablation cohort preset, and a commodity market-pool seed helper that derives tradable commodities from source content while requiring reserves to be explicit caller input.

It does not create world projections, durable simulation instances, UI controls, or hidden economic constants.

## File Structure

- Create `packages/content/src/scenarios.ts`: scenario seed contracts and deterministic preset helpers.
- Modify `packages/content/src/content.test.ts`: coverage for scenario defaults, cohort generation, and market seed generation.
- Modify `packages/content/src/index.ts`: export scenario APIs.
- Create `docs/superpowers/plans/2026-06-24-content-scenario-presets-slice.md`: track this implementation slice.

## Tasks

### Task 1: Failing Scenario Preset Tests

**Files:**

- Modify: `packages/content/src/content.test.ts`

- [x] **Step 1: Write failing tests**

Add tests for:

- AIvilization scenario defaults: max physiology 500, public time scale 7x, ablation time scale 35x, 80-agent ablation cohort.
- Deterministic ablation agent seeds: 80 agents, 16 MBTI types with 5 agents each, initial physiology 60/60/60, zero balance, zero education, empty inventory.
- Explicit market pool seed generation: all tradable commodities except Gold Apple, with reserves supplied by caller.

- [x] **Step 2: Verify red**

Run:

```bash
pnpm --filter @aivilization/content test -- content.test.ts
```

Expected: FAIL because scenario APIs are not exported yet.

### Task 2: Scenario Config Implementation

**Files:**

- Create: `packages/content/src/scenarios.ts`
- Modify: `packages/content/src/index.ts`

- [x] **Step 1: Implement scenario contracts and helpers**

Add pure config types and functions:

- `aivilizationScenarioDefaults`
- `createAivilizationAblationAgentSeeds`
- `createCommodityMarketPoolSeeds`
- `aivilizationAblationScenarioPreset`

- [x] **Step 2: Verify green**

Run:

```bash
pnpm --filter @aivilization/content test -- content.test.ts
pnpm --filter @aivilization/content typecheck
```

Expected: PASS.

### Task 3: Verification And Commit

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
git add docs/superpowers/plans/2026-06-24-content-scenario-presets-slice.md packages/content/src/content.test.ts packages/content/src/scenarios.ts packages/content/src/index.ts
git commit -m "feat: add source-backed scenario presets"
```

## Self-Review

- Spec coverage: Adds the missing content-owned initial scenario and experiment preset boundary named by the architecture spec.
- Boundary review: Content remains pure configuration and deterministic generation; runtime projection creation stays outside the package.
- Placeholder scan: No deferred implementation markers remain.
