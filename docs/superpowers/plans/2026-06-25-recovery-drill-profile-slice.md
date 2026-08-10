# Recovery Drill Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a named `recovery-drill-25` backend profile that deterministically exercises adaptive full-replan materialization and is included in profile gate suites.

**Architecture:** Scenario profiles continue to own manifest/population shape. A new server profile-defaults module owns profile-specific runtime and gate defaults. Runner, gate, suite, and CLI layers consume those defaults through existing inputs without inspecting agent-runtime replanning internals.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, server profile runner, runtime profile gates, adaptive replanning policy, deterministic branch plan compiler.

---

### Task 1: Scenario Profile Registration

**Files:**

- Modify: `apps/server/src/localRuntimeTownScenarioProfile.ts`
- Test: `apps/server/src/localRuntimeTownScenarioProfile.test.ts`

- [x] **Step 1: Write failing scenario profile test**

Add assertions for:

```typescript
const recovery = createLocalRuntimeTownDaemonScenarioProfile('recovery-drill-25');
expect(recovery).toMatchObject({
  profileId: 'recovery-drill-25',
  agentCount: 25,
  headless: true,
  manifest: {
    id: 'aivilization-recovery-drill-25',
    defaults: {
      tickBatchSize: 1,
      tickIntervalMs: 0,
      commandConsumerIdPrefix: 'recovery-drill-worker',
    },
  },
});
expect(recovery.manifest.partitions.map((partition) => partition.partitionKey)).toEqual([
  'world-main',
]);
```

- [x] **Step 2: Run scenario profile test to verify RED**

Run: `pnpm --filter @aivilization/server test -- localRuntimeTownScenarioProfile.test.ts`

Expected: FAIL because `recovery-drill-25` is not a registered profile id.

- [x] **Step 3: Implement profile registration**

Add `'recovery-drill-25'` to `LocalRuntimeTownDaemonScenarioProfileId` and `profileConfigs` with 25 agents, headless `true`, manifest id `aivilization-recovery-drill-25`, command consumer prefix `recovery-drill-worker`, tick batch size `1`, tick interval `0`, and one `world-main` partition.

- [x] **Step 4: Run scenario profile test to verify GREEN**

Run: `pnpm --filter @aivilization/server test -- localRuntimeTownScenarioProfile.test.ts`

Expected: PASS.

### Task 2: Profile Runtime And Gate Defaults

**Files:**

- Create: `apps/server/src/localRuntimeTownProfileDefaults.ts`
- Create: `apps/server/src/localRuntimeTownProfileDefaults.test.ts`
- Modify: `apps/server/src/index.ts`

- [x] **Step 1: Write failing defaults tests**

Add tests requiring:

```typescript
const defaults = createLocalRuntimeTownProfileDefaults('recovery-drill-25');
expect(defaults.replanningPolicy).toEqual({
  consecutiveFailureThreshold: 2,
  majorContextShift: {
    key: 'profile-recovery-drill',
    reason: 'profile recovery drill requires a replacement plan',
  },
});
expect(defaults.minimumFullReplanMaterializationCount).toBe(1);
const compiled = defaults.strategicPlanCompiler?.({
  objective: createObjective(),
  issuedAt: 100,
});
expect(compiled).toMatchObject({
  planningTrace: {
    status: 'deterministic',
    source: 'deterministic',
    message: 'Built-in recovery drill strategic plan',
  },
});
expect(normalizeStrategicPlanCompilerOutput(await compiled).plan.branches[0]).toMatchObject({
  id: 'eat-recovery-drill',
});
```

Also assert `createLocalRuntimeTownProfileDefaults('smoke-25')` returns an empty object.

- [x] **Step 2: Run defaults tests to verify RED**

Run: `pnpm --filter @aivilization/server test -- localRuntimeTownProfileDefaults.test.ts`

Expected: FAIL because the module does not exist.

- [x] **Step 3: Implement defaults module**

Create `createLocalRuntimeTownProfileDefaults(profileId)` returning a `LocalRuntimeTownProfileDefaults` object with optional `strategicPlanCompiler`, `replanningPolicy`, and `minimumFullReplanMaterializationCount`. Export it from `apps/server/src/index.ts`.

- [x] **Step 4: Run defaults tests to verify GREEN**

Run: `pnpm --filter @aivilization/server test -- localRuntimeTownProfileDefaults.test.ts`

Expected: PASS.

### Task 3: Runner And Gate Default Wiring

**Files:**

- Modify: `apps/server/src/localRuntimeTownProfileRunner.ts`
- Test: `apps/server/src/localRuntimeTownProfileRunner.test.ts`
- Modify: `apps/server/src/localRuntimeTownProfileGate.ts`
- Test: `apps/server/src/localRuntimeTownProfileGate.test.ts`

- [x] **Step 1: Write failing runner integration test**

Add a test:

```typescript
const summary = await runLocalRuntimeTownDaemonScenarioProfile({
  profileId: 'recovery-drill-25',
  rootDir,
  cycleCount: 1,
  requestedAt: 220,
});
expect(summary.agentCycleDiagnostics.fullReplanMaterializationCount).toBeGreaterThan(0);
expect(summary.agentCycleDiagnostics.fullReplanMaterializationRatio).toBeGreaterThan(0);
```

- [x] **Step 2: Write failing gate default test**

Assert:

```typescript
expect(createLocalRuntimeTownProfileGateCriteria('recovery-drill-25')).toMatchObject({
  criteriaId: 'aivilization-recovery-drill-25:profile-run-gate',
  minimumFullReplanMaterializationCount: 1,
});
expect(
  createLocalRuntimeTownProfileGateCriteria('recovery-drill-25', {
    minimumFullReplanMaterializationCount: 0,
  }),
).toMatchObject({ minimumFullReplanMaterializationCount: 0 });
```

- [x] **Step 3: Run runner and gate tests to verify RED**

Run:

- `pnpm --filter @aivilization/server test -- localRuntimeTownProfileRunner.test.ts`
- `pnpm --filter @aivilization/server test -- localRuntimeTownProfileGate.test.ts`

Expected: FAIL because profile defaults are not wired into runner or gate criteria.

- [x] **Step 4: Implement runner and gate wiring**

In runner, compute `const profileDefaults = createLocalRuntimeTownProfileDefaults(input.profileId)` after the scenario profile is resolved. Use explicit caller inputs first, then LLM/config compilers, then profile defaults:

```typescript
input.strategicPlanCompiler ??
  createLocalRuntimeTownProfileStrategicPlanCompiler(input.llmPlanning) ??
  profileDefaults.strategicPlanCompiler;
```

Pass `input.replanningPolicy ?? profileDefaults.replanningPolicy` into the profile agent provider.

In gate criteria, use `input.minimumFullReplanMaterializationCount ?? profileDefaults.minimumFullReplanMaterializationCount ?? 0`.

- [x] **Step 5: Run runner and gate tests to verify GREEN**

Run:

- `pnpm --filter @aivilization/server test -- localRuntimeTownProfileRunner.test.ts`
- `pnpm --filter @aivilization/server test -- localRuntimeTownProfileGate.test.ts`

Expected: PASS.

### Task 4: Suite And CLI Profile Exposure

**Files:**

- Modify: `apps/server/src/localRuntimeTownProfileGateSuite.ts`
- Test: `apps/server/src/localRuntimeTownProfileGateSuite.test.ts`
- Modify: `apps/server/src/localRuntimeTownProfileGateSuiteCli.test.ts`
- Modify: `apps/server/src/localRuntimeTownProfileRunnerCli.ts`
- Test: `apps/server/src/localRuntimeTownProfileRunnerCli.test.ts`

- [x] **Step 1: Write failing suite and CLI tests**

Update suite default order to:

```typescript
['smoke-25', 'default-100', 'headless-stress-1000', 'recovery-drill-25'];
```

Add CLI parse tests proving both profile runner CLI and gate suite CLI accept `recovery-drill-25`.

- [x] **Step 2: Run suite and CLI tests to verify RED**

Run:

- `pnpm --filter @aivilization/server test -- localRuntimeTownProfileGateSuite.test.ts localRuntimeTownProfileGateSuiteCli.test.ts localRuntimeTownProfileRunnerCli.test.ts`

Expected: FAIL until the profile id allowlists and suite defaults include `recovery-drill-25`.

- [x] **Step 3: Implement suite and CLI exposure**

Add `recovery-drill-25` to `localRuntimeTownProfileGateSuiteDefaultProfileIds` and the single profile runner CLI `profileIds` set. Gate suite CLI inherits supported ids from the default suite list.

- [x] **Step 4: Run suite and CLI tests to verify GREEN**

Run:

- `pnpm --filter @aivilization/server test -- localRuntimeTownProfileGateSuite.test.ts localRuntimeTownProfileGateSuiteCli.test.ts localRuntimeTownProfileRunnerCli.test.ts`

Expected: PASS.

### Task 5: Verification And Commit

**Files:**

- Verify this plan, design doc, and all changed server files.

- [x] **Step 1: Run focused tests**

Run:

- `pnpm --filter @aivilization/server test -- localRuntimeTownScenarioProfile.test.ts localRuntimeTownProfileDefaults.test.ts localRuntimeTownProfileRunner.test.ts localRuntimeTownProfileGate.test.ts localRuntimeTownProfileGateSuite.test.ts localRuntimeTownProfileGateSuiteCli.test.ts localRuntimeTownProfileRunnerCli.test.ts`

- [x] **Step 2: Run type and format checks**

Run:

- `pnpm --filter @aivilization/server typecheck`
- `pnpm exec prettier --check docs/superpowers/specs/2026-06-25-recovery-drill-profile-design.md docs/superpowers/plans/2026-06-25-recovery-drill-profile-slice.md apps/server/src/localRuntimeTownScenarioProfile.ts apps/server/src/localRuntimeTownScenarioProfile.test.ts apps/server/src/localRuntimeTownProfileDefaults.ts apps/server/src/localRuntimeTownProfileDefaults.test.ts apps/server/src/localRuntimeTownProfileRunner.ts apps/server/src/localRuntimeTownProfileRunner.test.ts apps/server/src/localRuntimeTownProfileGate.ts apps/server/src/localRuntimeTownProfileGate.test.ts apps/server/src/localRuntimeTownProfileGateSuite.ts apps/server/src/localRuntimeTownProfileGateSuite.test.ts apps/server/src/localRuntimeTownProfileGateSuiteCli.test.ts apps/server/src/localRuntimeTownProfileRunnerCli.ts apps/server/src/localRuntimeTownProfileRunnerCli.test.ts apps/server/src/index.ts`

- [x] **Step 3: Run full repository verification**

Run:

- `pnpm check`
- `git diff --check`

- [x] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-06-25-recovery-drill-profile-design.md docs/superpowers/plans/2026-06-25-recovery-drill-profile-slice.md apps/server/src/localRuntimeTownScenarioProfile.ts apps/server/src/localRuntimeTownScenarioProfile.test.ts apps/server/src/localRuntimeTownProfileDefaults.ts apps/server/src/localRuntimeTownProfileDefaults.test.ts apps/server/src/localRuntimeTownProfileRunner.ts apps/server/src/localRuntimeTownProfileRunner.test.ts apps/server/src/localRuntimeTownProfileGate.ts apps/server/src/localRuntimeTownProfileGate.test.ts apps/server/src/localRuntimeTownProfileGateSuite.ts apps/server/src/localRuntimeTownProfileGateSuite.test.ts apps/server/src/localRuntimeTownProfileGateSuiteCli.test.ts apps/server/src/localRuntimeTownProfileRunnerCli.ts apps/server/src/localRuntimeTownProfileRunnerCli.test.ts apps/server/src/index.ts
git commit -m "feat(profile): 增加 recovery drill 后端验收场景"
```
