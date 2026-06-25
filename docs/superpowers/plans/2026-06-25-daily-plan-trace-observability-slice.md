# Daily Plan Trace Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist runtime daily plan renewal traces and expose them through local runtime APIs.

**Architecture:** Mirror existing objective-renewal and steering trace infrastructure. Put trace
validation and file-backed storage in `packages/observability`, request normalization in
`apps/api`, runtime storage/writes in `apps/worker`, and local server route wiring in `apps/server`.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, JSONL file repositories.

---

## Task 1: Observability Repository

**Files:**

- Create: `packages/observability/src/dailyPlanRenewalTraceRepository.test.ts`
- Create: `packages/observability/src/dailyPlanRenewalTraceRepository.ts`
- Modify: `packages/observability/src/index.ts`

- [x] **Step 1: Add failing repository tests**

Add tests for:

- in-memory idempotent recording and latest-first query by simulation, partition, agent, plan id,
  and issued time range;
- file-backed persistence across repository restarts;
- deep cloning of scheduled intention ids and planning trace attempt usage.

Run:

```bash
pnpm --filter @aivilization/observability test -- dailyPlanRenewalTraceRepository.test.ts
```

Expected: FAIL because the repository module does not exist.

Observed: failed because `./dailyPlanRenewalTraceRepository` did not exist.

- [x] **Step 2: Implement repository**

Implement `DailyPlanRenewalTrace`, query type, repository interface,
`InMemoryDailyPlanRenewalTraceRepository`, `FileDailyPlanRenewalTraceRepository`, validation, clone
helpers, and JSONL persistence. Export from `packages/observability/src/index.ts`.

Run:

```bash
pnpm --filter @aivilization/observability test -- dailyPlanRenewalTraceRepository.test.ts
pnpm --filter @aivilization/observability typecheck
```

Expected: PASS.

Observed:

- `pnpm --filter @aivilization/observability test -- dailyPlanRenewalTraceRepository.test.ts`
  passed.
- `pnpm --filter @aivilization/observability typecheck` passed.

## Task 2: API Service And HTTP Route

**Files:**

- Create: `apps/api/src/dailyPlanRenewalTraceApi.test.ts`
- Create: `apps/api/src/dailyPlanRenewalTraceApi.ts`
- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/src/httpApi.test.ts`
- Modify: `apps/api/src/httpApi.ts`

- [x] **Step 3: Add failing API service tests**

Add tests proving lookup/query normalization for `daily-plan-renewal-traces` rejects empty ids and
invalid limits before delegation.

Run:

```bash
pnpm --filter @aivilization/api test -- dailyPlanRenewalTraceApi.test.ts
```

Expected: FAIL because the API service module does not exist.

Observed: failed because `./dailyPlanRenewalTraceApi` did not exist.

- [x] **Step 4: Implement API service**

Implement `createDailyPlanRenewalTraceApiService` with lookup and query request normalization.
Export it from `apps/api/src/index.ts`.

Run:

```bash
pnpm --filter @aivilization/api test -- dailyPlanRenewalTraceApi.test.ts
pnpm --filter @aivilization/api typecheck
```

Expected: PASS.

Observed:

- `pnpm --filter @aivilization/api test -- dailyPlanRenewalTraceApi.test.ts` passed.
- `pnpm --filter @aivilization/api typecheck` passed.

- [x] **Step 5: Add failing HTTP route tests**

Add `httpApi.test.ts` coverage for:

- `GET /simulations/:simulationId/partitions/:partitionKey/daily-plan-renewal-traces`;
- `GET /simulations/:simulationId/partitions/:partitionKey/daily-plan-renewal-traces/:traceId`.

Run:

```bash
pnpm --filter @aivilization/api test -- httpApi.test.ts
```

Expected: FAIL because the route is not wired.

Observed: failed with `405 method not allowed` because the route was not matched as a trace route.

- [x] **Step 6: Implement HTTP route**

Add daily-plan trace service to `TownHttpApiServices`, route matching, query construction, and 404
handling consistent with existing trace routes.

Run:

```bash
pnpm --filter @aivilization/api test -- httpApi.test.ts
pnpm --filter @aivilization/api typecheck
```

Expected: PASS.

Observed:

- `pnpm --filter @aivilization/api test -- httpApi.test.ts` passed.
- `pnpm --filter @aivilization/api typecheck` passed.

## Task 3: Worker Runtime Recording

**Files:**

- Modify: `apps/worker/src/localRuntimeStorage.ts`
- Modify: `apps/worker/src/dailyRoutineSchedule.test.ts`
- Modify: `apps/worker/src/dailyRoutineSchedule.ts`
- Modify: `apps/worker/src/canonicalActivePlanTick.test.ts`
- Modify: `apps/worker/src/canonicalActivePlanTick.ts`

- [x] **Step 7: Add failing worker trace sink tests**

Add tests proving `renewDailyPlanScheduledIntentions` calls a trace sink with daily plan id,
scheduled intention ids, memory context ids, profile entry keys/evidence ids, and planning trace.
Add a canonical active-plan tick test proving the sink receives simulation and partition-scoped
trace metadata.

Run:

```bash
pnpm --filter @aivilization/worker test -- dailyRoutineSchedule.test.ts canonicalActivePlanTick.test.ts
```

Expected: FAIL because no daily plan trace sink exists.

Observed: failed because `dailyPlanRenewalTraceSink` was not recorded by the daily-plan renewal
path and local runtime storage did not yet expose `dailyPlanRenewalTraceRepository`.

- [x] **Step 8: Implement worker trace sink wiring**

Add `DailyPlanRenewalTraceSink` to `dailyRoutineSchedule.ts`. Thread it through
`runCanonicalWorkerActivePlanTick`. Add `FileDailyPlanRenewalTraceRepository` to local runtime
storage.

Run:

```bash
pnpm --filter @aivilization/worker test -- dailyRoutineSchedule.test.ts canonicalActivePlanTick.test.ts localRuntimeStorage.test.ts
pnpm --filter @aivilization/worker typecheck
```

Expected: PASS.

Observed:

- `pnpm --filter @aivilization/worker test -- dailyRoutineSchedule.test.ts canonicalActivePlanTick.test.ts localRuntimeStorage.test.ts`
  passed.
- `pnpm --filter @aivilization/worker typecheck` passed.

## Task 4: Server Wiring

**Files:**

- Modify: `apps/server/src/localRuntimeTownServer.test.ts`
- Modify: `apps/server/src/localRuntimeTownServer.ts`
- Modify: `apps/server/src/localRuntimeTownProfileRunner.test.ts`
- Modify: `apps/server/src/localRuntimeTownProfileRunner.ts`

- [x] **Step 9: Add failing server integration tests**

Add tests proving local runtime server exposes daily plan traces and profile runner persists traces
from the file-backed repository after a run.

Run:

```bash
pnpm --filter @aivilization/server test -- localRuntimeTownServer.test.ts localRuntimeTownProfileRunner.test.ts
```

Expected: FAIL because server and profile runner do not expose/record daily plan traces.

Observed: failed before wiring because the local runtime server did not provide a
`dailyPlanRenewalTracesApi`, and profile-run daily plan renewal did not write to the file-backed
repository.

- [x] **Step 10: Implement server wiring**

Create `dailyPlanRenewalTracesApi` in `localRuntimeTownServer.ts`, wire it into the HTTP handler,
and record profile-run daily plan renewal results to storage's daily plan trace repository.

Run:

```bash
pnpm --filter @aivilization/server test -- localRuntimeTownServer.test.ts localRuntimeTownProfileRunner.test.ts
pnpm --filter @aivilization/server typecheck
```

Expected: PASS.

Observed:

- `pnpm --filter @aivilization/server test -- localRuntimeTownServer.test.ts localRuntimeTownProfileRunner.test.ts`
  passed.
- `pnpm --filter @aivilization/server typecheck` passed.

## Task 5: Full Verification And Commit

- [x] **Step 11: Full checks**

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
- `pnpm test` passed: 146 test files, 718 tests.
- `pnpm build` passed.
- `git diff --check` passed.

- [x] **Step 12: Inspect and commit**

Confirm the diff is limited to daily plan trace observability, tests, and this slice's docs.

Commit with:

```bash
git add docs/superpowers/specs/2026-06-25-daily-plan-trace-observability-design.md docs/superpowers/plans/2026-06-25-daily-plan-trace-observability-slice.md packages/observability/src/dailyPlanRenewalTraceRepository.ts packages/observability/src/dailyPlanRenewalTraceRepository.test.ts packages/observability/src/index.ts apps/api/src/dailyPlanRenewalTraceApi.ts apps/api/src/dailyPlanRenewalTraceApi.test.ts apps/api/src/httpApi.ts apps/api/src/httpApi.test.ts apps/api/src/index.ts apps/worker/src/localRuntimeStorage.ts apps/worker/src/dailyRoutineSchedule.ts apps/worker/src/dailyRoutineSchedule.test.ts apps/worker/src/canonicalActivePlanTick.ts apps/worker/src/canonicalActivePlanTick.test.ts apps/server/src/localRuntimeTownServer.ts apps/server/src/localRuntimeTownServer.test.ts apps/server/src/localRuntimeTownProfileRunner.ts apps/server/src/localRuntimeTownProfileRunner.test.ts
git commit -m "feat: persist daily plan renewal traces"
```

Observed: diff reviewed and limited to daily plan trace observability, tests, and this slice's docs.
