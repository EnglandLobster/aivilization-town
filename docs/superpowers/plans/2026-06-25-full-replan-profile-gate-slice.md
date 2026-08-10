# Full Replan Profile Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Turn full-replan materialization from a passive diagnostic into an optional runtime profile gate criterion.

**Architecture:** `packages/observability` owns the generic report gate contract and failure evidence. `apps/server` owns local AIvilization profile defaults and allows selected profiles or suite callers to opt into a minimum full-replan materialization count. Runtime runners still only produce reports; they do not decide whether a replan recovery signal is required.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, runtime profile reports, observability gate evaluator, local profile gate suite.

---

### Task 1: Observability Gate Criterion

**Files:**

- Modify: `packages/observability/src/runtimeProfileRunGate.ts`
- Test: `packages/observability/src/runtimeProfileRunGate.test.ts`

- [x] **Step 1: Write failing gate evaluator test**

Add a test that evaluates a healthy report with:

```typescript
const result = evaluateRuntimeProfileRunReport(
  createRuntimeProfileRunReport({
    ...createReport(),
    agentCycleDiagnostics: {
      ...createAgentCycleDiagnostics(5),
      fullReplanMaterializationCount: 0,
      fullReplanMaterializationRatio: 0,
    },
  }),
  {
    ...createCriteria(),
    minimumFullReplanMaterializationCount: 1,
  },
);

expect(result.status).toBe('fail');
expect(result.failures).toContainEqual({
  code: 'full-replan-materialization-count-too-low',
  message: 'fullReplanMaterializationCount must be at least 1',
  evidence: {
    actual: 0,
    minimum: 1,
  },
});
```

- [x] **Step 2: Run observability gate test to verify RED**

Run: `pnpm --filter @aivilization/observability test -- runtimeProfileRunGate.test.ts`

Expected: FAIL because `RuntimeProfileRunGateCriteria` has no `minimumFullReplanMaterializationCount` and evaluator does not inspect `agentCycleDiagnostics.fullReplanMaterializationCount`.

- [x] **Step 3: Implement criterion and failure evidence**

Add `readonly minimumFullReplanMaterializationCount: number;` to `RuntimeProfileRunGateCriteria`, then call `addMinimumFailure` with:

```typescript
addMinimumFailure(failures, {
  code: 'full-replan-materialization-count-too-low',
  label: 'fullReplanMaterializationCount',
  actual: report.agentCycleDiagnostics.fullReplanMaterializationCount,
  minimum: criteria.minimumFullReplanMaterializationCount,
});
```

- [x] **Step 4: Run observability gate test to verify GREEN**

Run: `pnpm --filter @aivilization/observability test -- runtimeProfileRunGate.test.ts`

Expected: PASS.

### Task 2: Local Profile Gate Policy

**Files:**

- Modify: `apps/server/src/localRuntimeTownProfileGate.ts`
- Test: `apps/server/src/localRuntimeTownProfileGate.test.ts`

- [x] **Step 1: Write failing local criteria test**

Extend `createLocalRuntimeTownProfileGateCriteria` tests with:

```typescript
expect(createLocalRuntimeTownProfileGateCriteria('smoke-25')).toMatchObject({
  minimumFullReplanMaterializationCount: 0,
});
expect(
  createLocalRuntimeTownProfileGateCriteria('smoke-25', {
    minimumFullReplanMaterializationCount: 1,
  }),
).toMatchObject({
  minimumFullReplanMaterializationCount: 1,
});
```

- [x] **Step 2: Run local criteria test to verify RED**

Run: `pnpm --filter @aivilization/server test -- localRuntimeTownProfileGate.test.ts`

Expected: FAIL because local gate criteria input cannot configure full-replan materialization.

- [x] **Step 3: Implement local criteria input**

Add:

```typescript
readonly minimumFullReplanMaterializationCount?: number;
```

to `LocalRuntimeTownProfileGateCriteriaInput`, then set:

```typescript
minimumFullReplanMaterializationCount:
  input.minimumFullReplanMaterializationCount ?? 0,
```

on the returned `RuntimeProfileRunGateCriteria`.

- [x] **Step 4: Run local criteria test to verify GREEN**

Run: `pnpm --filter @aivilization/server test -- localRuntimeTownProfileGate.test.ts`

Expected: PASS.

### Task 3: Gate Suite Strategy Wiring

**Files:**

- Modify: `apps/server/src/localRuntimeTownProfileGateSuite.ts`
- Test: `apps/server/src/localRuntimeTownProfileGateSuite.test.ts`
- Fixture sync: any server or worker tests constructing `RuntimeProfileRunGateCriteria` directly.

- [x] **Step 1: Write failing suite wiring test**

Extend `LocalRuntimeTownProfileGateSuiteInput` test coverage with an injected summary that has zero materializations and a suite input:

```typescript
minimumFullReplanMaterializationCount: 1,
```

Assert:

```typescript
expect(result.status).toBe('fail');
expect(result.profiles[0]?.gate.failures.map((failure) => failure.code)).toContain(
  'full-replan-materialization-count-too-low',
);
```

- [x] **Step 2: Run suite test to verify RED**

Run: `pnpm --filter @aivilization/server test -- localRuntimeTownProfileGateSuite.test.ts`

Expected: FAIL because suite input does not expose or forward the minimum materialization requirement.

- [x] **Step 3: Implement suite input forwarding**

Add `readonly minimumFullReplanMaterializationCount?: number;` to `LocalRuntimeTownProfileGateSuiteInput`. Pass it into `createLocalRuntimeTownProfileGateCriteria(profileId, { minimumCompletedCycleCount: cycleCount, minimumFullReplanMaterializationCount: input.minimumFullReplanMaterializationCount })`, omitting the property when undefined to preserve exact optional property semantics.

- [x] **Step 4: Run suite test to verify GREEN**

Run: `pnpm --filter @aivilization/server test -- localRuntimeTownProfileGateSuite.test.ts`

Expected: PASS.

### Task 4: Verification And Commit

**Files:**

- Verify all files changed in Tasks 1-3 plus this plan document.

- [x] **Step 1: Run focused tests**

Run:

- `pnpm --filter @aivilization/observability test -- runtimeProfileRunGate.test.ts`
- `pnpm --filter @aivilization/server test -- localRuntimeTownProfileGate.test.ts localRuntimeTownProfileGateSuite.test.ts`

- [x] **Step 2: Run type and format checks**

Run:

- `pnpm --filter @aivilization/observability typecheck`
- `pnpm --filter @aivilization/server typecheck`
- `pnpm exec prettier --check docs/superpowers/plans/2026-06-25-full-replan-profile-gate-slice.md packages/observability/src/runtimeProfileRunGate.ts packages/observability/src/runtimeProfileRunGate.test.ts apps/server/src/localRuntimeTownProfileGate.ts apps/server/src/localRuntimeTownProfileGate.test.ts apps/server/src/localRuntimeTownProfileGateSuite.ts apps/server/src/localRuntimeTownProfileGateSuite.test.ts`

- [x] **Step 3: Run full repository verification**

Run:

- `pnpm check`
- `git diff --check`

- [x] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-06-25-full-replan-profile-gate-slice.md packages/observability/src/runtimeProfileRunGate.ts packages/observability/src/runtimeProfileRunGate.test.ts apps/server/src/localRuntimeTownProfileGate.ts apps/server/src/localRuntimeTownProfileGate.test.ts apps/server/src/localRuntimeTownProfileGateSuite.ts apps/server/src/localRuntimeTownProfileGateSuite.test.ts
git commit -m "feat(validation): 增加 full replan 物化验收门槛"
```
