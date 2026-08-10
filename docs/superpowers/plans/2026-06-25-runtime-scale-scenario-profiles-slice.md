# Runtime Scale Scenario Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add first-class backend scale scenario profiles for the planned 25-agent smoke, 100-agent default, and 1000-agent headless stress runtime modes.

**Architecture:** Keep deterministic population/scenario preset generation in `packages/content`, close to paper-derived scenario metadata. Keep local daemon profile composition in `apps/server`, where manifests, partitions, market pools, and runtime daemon settings are assembled without coupling domain packages to server process concerns.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, existing content scenario presets and local runtime server composition.

---

### Task 1: Content Population Preset Factory

**Files:**

- Modify: `packages/content/src/scenarios.ts`
- Modify: `packages/content/src/content.test.ts`

- [x] **Step 1: Write failing content tests**

Add tests requiring `createAivilizationPopulationAgentSeeds` and `createAivilizationPopulationScenarioPreset` to generate deterministic, unique, MBTI-distributed, location-aware populations with arbitrary agent counts.

- [x] **Step 2: Run content tests and verify RED**

Run: `pnpm --filter @aivilization/content test -- content.test.ts`

Expected: FAIL because the population preset factories are not exported.

- [x] **Step 3: Implement content factories**

Add population factory inputs, validate positive counts and ids, generate deterministic agent ids, display names, MBTI round-robin assignments, source tags, and town-location distribution.

- [x] **Step 4: Run content tests and verify GREEN**

Run: `pnpm --filter @aivilization/content test -- content.test.ts`

Expected: PASS.

### Task 2: Server Runtime Scale Profiles

**Files:**

- Create: `apps/server/src/localRuntimeTownScenarioProfile.test.ts`
- Create: `apps/server/src/localRuntimeTownScenarioProfile.ts`
- Modify: `apps/server/src/index.ts`

- [x] **Step 1: Write failing server profile tests**

Add tests requiring `createLocalRuntimeTownDaemonScenarioProfile('smoke-25' | 'default-100' | 'headless-stress-1000')` to return registered scenario presets, manifest partitions, market pools, and runtime daemon settings.

- [x] **Step 2: Run server tests and verify RED**

Run: `pnpm --filter @aivilization/server test -- localRuntimeTownScenarioProfile.test.ts`

Expected: FAIL because the scenario profile factory is not exported.

- [x] **Step 3: Implement server profile factory**

Create one partition for smoke, two for default, and ten for headless stress. Generate one scenario preset per partition, attach explicit commodity market pools to each partition, and return runtime run queue, scheduler, and recovery defaults.

- [x] **Step 4: Run server tests and verify GREEN**

Run: `pnpm --filter @aivilization/server test -- localRuntimeTownScenarioProfile.test.ts`

Expected: PASS.

### Task 3: HTTP Server Smoke Integration

**Files:**

- Modify: `apps/server/src/localRuntimeTownServer.test.ts`

- [x] **Step 1: Write failing smoke profile integration test**

Add a test that uses the smoke profile to start `createLocalRuntimeTownNodeHttpServer`, fetches `/runtime/daemon/status`, and verifies `/simulations/aivilization-smoke-25/partitions/world-main/projection` contains 25 agents.

- [x] **Step 2: Run server tests and verify RED**

Run: `pnpm --filter @aivilization/server test -- localRuntimeTownServer.test.ts localRuntimeTownScenarioProfile.test.ts`

Expected: FAIL until the profile factory and export are wired.

- [x] **Step 3: Keep integration server-only**

No domain changes are needed here; use the profile's manifest, scenario presets, and runtime daemon options as the `createLocalRuntimeTownNodeHttpServer` inputs.

- [x] **Step 4: Run server tests and verify GREEN**

Run: `pnpm --filter @aivilization/server test -- localRuntimeTownServer.test.ts localRuntimeTownScenarioProfile.test.ts`

Expected: PASS.

### Task 4: Verification And Commit

**Files:**

- Modify: all files above

- [x] **Step 1: Format touched files**

Run: `pnpm exec prettier --write docs/superpowers/plans/2026-06-25-runtime-scale-scenario-profiles-slice.md packages/content/src/scenarios.ts packages/content/src/content.test.ts apps/server/src/localRuntimeTownScenarioProfile.ts apps/server/src/localRuntimeTownScenarioProfile.test.ts apps/server/src/localRuntimeTownServer.test.ts apps/server/src/index.ts`

- [x] **Step 2: Run focused and full verification**

Run: `pnpm --filter @aivilization/content typecheck && pnpm --filter @aivilization/content test -- content.test.ts && pnpm --filter @aivilization/server typecheck && pnpm --filter @aivilization/server test -- localRuntimeTownScenarioProfile.test.ts localRuntimeTownServer.test.ts && pnpm lint && pnpm typecheck && pnpm test && git diff --check`

Expected: all commands exit 0.

- [x] **Step 3: Commit**

```bash
git add docs/superpowers/plans/2026-06-25-runtime-scale-scenario-profiles-slice.md packages/content/src/scenarios.ts packages/content/src/content.test.ts apps/server/src/localRuntimeTownScenarioProfile.ts apps/server/src/localRuntimeTownScenarioProfile.test.ts apps/server/src/localRuntimeTownServer.test.ts apps/server/src/index.ts
git commit -m "feat: add runtime scale scenario profiles"
```
