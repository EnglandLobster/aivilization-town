# Profile Simulator Rollout Gate Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make local runtime profile gates automatically require Action Simulator counterfactual rollout evidence.

**Architecture:** Keep rollout measurement in `@aivilization/observability`; `apps/server` should only derive and forward criteria. Profile defaults provide the baseline rollout coverage threshold, profile gate criteria materializes it, and the gate suite forwards explicit overrides into every evaluated profile.

**Tech Stack:** TypeScript, Vitest, pnpm workspace, `@aivilization/observability`, `@aivilization/server`.

---

### Task 1: Profile Gate Rollout Coverage Criteria

**Files:**
- Modify: `apps/server/src/localRuntimeTownProfileDefaults.ts`
- Modify: `apps/server/src/localRuntimeTownProfileDefaults.test.ts`
- Modify: `apps/server/src/localRuntimeTownProfileGate.ts`
- Modify: `apps/server/src/localRuntimeTownProfileGate.test.ts`
- Modify: `apps/server/src/localRuntimeTownProfileGateSuite.ts`
- Modify: `apps/server/src/localRuntimeTownProfileGateSuite.test.ts`
- Modify: `apps/server/src/localRuntimeTownProfileGateSuiteCli.ts`
- Modify: `apps/server/src/localRuntimeTownProfileGateSuiteCli.test.ts`

- [x] **Step 1: Write failing defaults and criteria tests**

Add expectations that ordinary profile defaults include:

```ts
minimumSimulatorRolloutCoverageRatio: 1
```

Add expectations that `createLocalRuntimeTownProfileGateCriteria('smoke-25')` includes the same field, and that callers can override it to `0.5`.

- [x] **Step 2: Verify criteria RED**

Run:

```bash
pnpm vitest run apps/server/src/localRuntimeTownProfileDefaults.test.ts apps/server/src/localRuntimeTownProfileGate.test.ts
```

Expected: FAIL because server profile defaults and criteria do not expose rollout coverage.

- [x] **Step 3: Implement defaults and criteria wiring**

Add `minimumSimulatorRolloutCoverageRatio?: number` to `LocalRuntimeTownProfileDefaults` and `LocalRuntimeTownProfileGateCriteriaInput`.

Set ordinary backend profile defaults to `1`, keep recovery drill defaults inheriting the same baseline, and materialize the value into `RuntimeProfileRunGateCriteria.minimumSimulatorRolloutCoverageRatio`.

- [x] **Step 4: Write failing suite forwarding test**

Add a gate suite test that overrides:

```ts
minimumSimulatorRolloutCoverageRatio: 0.5
```

with an injected summary whose diagnostics have `simulatorRolloutCoverageRatio: 0.75`; assert the suite passes, proving the override is forwarded instead of using the default threshold.

- [x] **Step 5: Verify suite RED**

Run:

```bash
pnpm vitest run apps/server/src/localRuntimeTownProfileGateSuite.test.ts -t "simulator rollout"
```

Expected: FAIL because the suite does not forward the rollout criterion yet.

- [x] **Step 6: Implement suite forwarding**

Add `minimumSimulatorRolloutCoverageRatio?: number` to `LocalRuntimeTownProfileGateSuiteInput` and forward it into `createLocalRuntimeTownProfileGateCriteria`.

- [x] **Step 7: Add CLI override support**

Add `--minimum-simulator-rollout-coverage-ratio` to the profile gate suite CLI and validate the value is between `0` and `1`.

- [x] **Step 8: Verify focused and full checks**

Run:

```bash
pnpm vitest run apps/server/src/localRuntimeTownProfileDefaults.test.ts apps/server/src/localRuntimeTownProfileGate.test.ts apps/server/src/localRuntimeTownProfileGateSuite.test.ts apps/server/src/localRuntimeTownProfileGateSuiteCli.test.ts
pnpm lint
pnpm typecheck
pnpm test
git diff --check
```

- [x] **Step 9: Commit**

Commit only this stage's plan and server/observability-adjacent wiring files. Leave unrelated untracked paper/report directories untouched.
