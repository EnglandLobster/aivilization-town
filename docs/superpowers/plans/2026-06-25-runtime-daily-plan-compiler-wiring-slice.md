# Runtime Daily Plan Compiler Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire traceable LLM daily planning from runtime profile config into worker daily intention
renewal.

**Architecture:** Keep provider construction in `apps/server`, scheduling orchestration in
`apps/worker`, and planner algorithms in `packages/agent-runtime`. Server config produces an
optional `DailyPlanCompiler`; worker receives only the compiler interface and uses it before
autonomous objective renewal.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces.

---

## Task 1: Worker Active-Plan Tick Compiler Injection

**Files:**

- Modify: `apps/worker/src/canonicalActivePlanTick.test.ts`
- Modify: `apps/worker/src/canonicalActivePlanTick.ts`

- [x] **Step 1: Add failing worker test**

Add a test proving `runCanonicalWorkerActivePlanTick` uses an injected `DailyPlanCompiler` before
objective renewal. The injected compiler should return a daily plan item active at `issuedAt`, and
the resulting objective renewal trace should select that scheduled intention.

Run:

```bash
pnpm --filter @aivilization/worker test -- canonicalActivePlanTick.test.ts
```

Expected: FAIL because the active-plan tick input has no daily compiler field.

Observed: failed because the captured `compilerInput` stayed undefined.

- [x] **Step 2: Implement worker wiring**

Import `DailyPlanCompiler` and `renewDailyPlanScheduledIntentions`. Add
`dailyPlanCompiler?: DailyPlanCompiler` to `CanonicalWorkerActivePlanTickBaseInput`. When supplied,
call `renewDailyPlanScheduledIntentions` before `renewMissingActiveObjectives`; otherwise keep the
existing routine renewal path.

Run:

```bash
pnpm --filter @aivilization/worker test -- canonicalActivePlanTick.test.ts
pnpm --filter @aivilization/worker typecheck
```

Expected: PASS.

Observed:

- `pnpm --filter @aivilization/worker test -- canonicalActivePlanTick.test.ts` passed.
- `pnpm --filter @aivilization/worker typecheck` passed.

## Task 2: Server Daily Compiler Factory

**Files:**

- Modify: `apps/server/src/localRuntimeTownProfileLlmPlanning.test.ts`
- Modify: `apps/server/src/localRuntimeTownProfileLlmPlanning.ts`

- [x] **Step 3: Add failing factory test**

Add a scripted provider test for `createLocalRuntimeTownProfileDailyPlanCompiler`. Assert the
compiled plan has the scripted daily plan item and the planning trace request id includes profile id,
agent id, and issued time.

Run:

```bash
pnpm --filter @aivilization/server test -- localRuntimeTownProfileLlmPlanning.test.ts
```

Expected: FAIL because the daily compiler factory does not exist.

Observed: failed because `createLocalRuntimeTownProfileDailyPlanCompiler` was not a function.

- [x] **Step 4: Implement daily compiler factory**

Add daily planning config types and create the compiler with
`createTraceableLlmDailyPlanCompiler`.

Run:

```bash
pnpm --filter @aivilization/server test -- localRuntimeTownProfileLlmPlanning.test.ts
pnpm --filter @aivilization/server typecheck
```

Expected: PASS.

Observed:

- `pnpm --filter @aivilization/server test -- localRuntimeTownProfileLlmPlanning.test.ts`
  passed.
- `pnpm --filter @aivilization/server typecheck` passed.

## Task 3: Runtime Config Loader

**Files:**

- Modify: `apps/server/src/localRuntimeTownProfileRuntimeConfig.test.ts`
- Modify: `apps/server/src/localRuntimeTownProfileRuntimeConfig.ts`

- [x] **Step 5: Add failing config tests**

Add tests for loading a combined runtime config with profile-specific `dailyPlanning`, top-level
fallback, and profile-level `dailyPlanning: null` disablement. Keep the existing
`loadLocalRuntimeTownProfileLlmPlanningConfig` behavior compatible.

Run:

```bash
pnpm --filter @aivilization/server test -- localRuntimeTownProfileRuntimeConfig.test.ts
```

Expected: FAIL because the combined loader and `dailyPlanning` parsing do not exist.

Observed: failed because `loadLocalRuntimeTownProfileRuntimeConfig` was not a function.

- [x] **Step 6: Implement combined runtime config parsing**

Add `loadLocalRuntimeTownProfileRuntimeConfig` returning `{ strategicPlanning, dailyPlanning }`.
Parse `dailyPlanning.kind === "traceable-llm-daily-planner"` with the same provider, pricing,
attempt, timeout, and secret validation helpers used by strategic planning.

Run:

```bash
pnpm --filter @aivilization/server test -- localRuntimeTownProfileRuntimeConfig.test.ts
pnpm --filter @aivilization/server typecheck
```

Expected: PASS.

Observed:

- `pnpm --filter @aivilization/server test -- localRuntimeTownProfileRuntimeConfig.test.ts`
  passed.
- `pnpm --filter @aivilization/server typecheck` passed.

## Task 4: Profile Runner Wiring

**Files:**

- Modify: `apps/server/src/localRuntimeTownProfileRunner.test.ts`
- Modify: `apps/server/src/localRuntimeTownProfileRunner.ts`
- Modify: `apps/server/src/localRuntimeTownProfileRunnerCli.ts`

- [x] **Step 7: Add failing profile runner test**

Add a test proving an injected `dailyPlanCompiler` is used during a profile run and that its
scheduled intention can be selected by autonomous objective renewal.

Run:

```bash
pnpm --filter @aivilization/server test -- localRuntimeTownProfileRunner.test.ts
```

Expected: FAIL because the profile runner input cannot accept or forward `dailyPlanCompiler`.

Observed:

- Profile runner test failed because `compiledAgentIds` stayed empty.
- CLI test failed because `receivedInput.dailyPlanning` stayed undefined.

- [x] **Step 8: Implement profile runner and CLI wiring**

Accept explicit `dailyPlanCompiler` and config-backed `dailyPlanning`. Pass it into the profile
agent provider. Update CLI config loading to use the combined runtime config while preserving the
same `--llm-planning-config` flag.

Run:

```bash
pnpm --filter @aivilization/server test -- localRuntimeTownProfileRunner.test.ts localRuntimeTownProfileRunnerCli.test.ts
pnpm --filter @aivilization/server typecheck
```

Expected: PASS.

Observed:

- `pnpm --filter @aivilization/server test -- localRuntimeTownProfileRunner.test.ts localRuntimeTownProfileRunnerCli.test.ts`
  passed.
- `pnpm --filter @aivilization/server typecheck` passed.

## Task 5: Full Verification And Commit

- [x] **Step 9: Full checks**

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

Observed:

- `pnpm lint` passed.
- `pnpm typecheck` passed.
- `pnpm test` passed: 144 test files, 712 tests.
- `pnpm build` passed.
- `git diff --check` passed.

- [x] **Step 10: Inspect and commit**

Confirm the diff is limited to runtime daily planner wiring, tests, and this slice's docs.

Observed: `git status --short` showed only server runtime daily planner wiring files, worker
active-plan tick daily compiler wiring files, and this slice's docs before staging.

Commit with:

```bash
git add docs/superpowers/specs/2026-06-25-runtime-daily-plan-compiler-wiring-design.md docs/superpowers/plans/2026-06-25-runtime-daily-plan-compiler-wiring-slice.md apps/worker/src/canonicalActivePlanTick.ts apps/worker/src/canonicalActivePlanTick.test.ts apps/server/src/localRuntimeTownProfileLlmPlanning.ts apps/server/src/localRuntimeTownProfileLlmPlanning.test.ts apps/server/src/localRuntimeTownProfileRuntimeConfig.ts apps/server/src/localRuntimeTownProfileRuntimeConfig.test.ts apps/server/src/localRuntimeTownProfileRunner.ts apps/server/src/localRuntimeTownProfileRunner.test.ts apps/server/src/localRuntimeTownProfileRunnerCli.ts apps/server/src/localRuntimeTownProfileRunnerCli.test.ts
git commit -m "feat: wire runtime daily plan compiler"
```
