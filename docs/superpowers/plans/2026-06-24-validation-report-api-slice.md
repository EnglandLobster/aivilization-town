# Validation Report API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose durable experiment validation reports through the existing simulation API and HTTP
router.

**Architecture:** `apps/api` owns the transport-neutral simulation query contract and HTTP parsing.
`apps/worker` adapts local partition storage to that contract. The HTTP route stays partition-scoped
so future database, sharded worker, or Godot clients can reuse the same service boundary.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, JSON over local Node HTTP.

---

## Scope

This slice adds read-only API access for validation reports:

- collection query route:
  `/simulations/:simulationId/partitions/:partitionKey/validation-reports`
- single run route:
  `/simulations/:simulationId/partitions/:partitionKey/validation-reports/:runId`
- query fields: `runId`, `fromGeneratedAt`, `toGeneratedAt`, `limit`
- local backend adapter backed by `storage.experimentValidationReportRepository`

It does not add report generation scheduling, mutation routes, dashboard rendering, database
adapters, or Godot integration.

## Runtime Semantics

- `queryExperimentValidationReports(request)` requires the request to match the target local
  partition and returns latest-first reports from the repository.
- `getExperimentValidationReport(request)` returns the report for that run id only when it belongs
  to the requested simulation; otherwise it returns `undefined`.
- HTTP GET collection returns a JSON array.
- HTTP GET item returns the report JSON or `undefined` for a missing run; no special 404 shape is
  introduced in this slice because the service boundary remains a pure read model.
- Invalid numeric query parameters are rejected at the HTTP boundary with `400 bad_request`.

## File Structure

- Modify `apps/api/src/simulationApi.ts`: add report query request types, port, service methods, and
  service factory input.
- Modify `apps/api/src/simulationApi.test.ts`: prove service delegates report collection and item
  queries to the injected port.
- Modify `apps/api/src/httpApi.ts`: add collection/item route matching and query parsing.
- Modify `apps/api/src/httpApi.test.ts`: prove HTTP routes and invalid query handling.
- Modify `apps/worker/src/localSimulationBackend.ts`: add local report query port backed by storage.
- Modify `apps/worker/src/localSimulationBackend.test.ts`: prove reports are queryable through the
  local backend API.
- Modify `apps/worker/src/localSimulationBackendRegistry.ts`: route report queries to the correct
  partition backend.
- Modify `apps/worker/src/localSimulationBackendRegistry.test.ts`: prove registry routing rejects
  unknown partitions before touching storage.
- Modify `apps/server/src/localRuntimeTownServer.test.ts`: prove the Node HTTP gateway exposes the
  new route from a manifest-bootstrapped runtime.

## Tasks

### Task 1: API Service Tests

**Files:**

- Modify: `apps/api/src/simulationApi.test.ts`

- [x] **Step 1: Add failing report delegation assertions**

Extend `delegates projection, event feed, and lifecycle controls to injected ports` with a
`validationReportRequests` array, a `validationReports` port, and assertions for:

```ts
await expect(
  service.queryExperimentValidationReports({
    simulationId: 'sim-1',
    partitionKey: 'world-main',
    fromGeneratedAt: 100,
    toGeneratedAt: 200,
    limit: 2,
  }),
).resolves.toEqual([{ run: { runId: 'validation-2' } }]);

await expect(
  service.getExperimentValidationReport({
    simulationId: 'sim-1',
    partitionKey: 'world-main',
    runId: 'validation-2',
  }),
).resolves.toEqual({ run: { runId: 'validation-2' } });
```

- [x] **Step 2: Run the API service test red**

Run:

```bash
pnpm --filter @aivilization/api test -- simulationApi.test.ts
```

Expected: FAIL because `validationReports`, `queryExperimentValidationReports`, and
`getExperimentValidationReport` do not exist yet.

### Task 2: HTTP Router Tests

**Files:**

- Modify: `apps/api/src/httpApi.test.ts`

- [x] **Step 1: Add failing route assertions**

Extend the simulation routing test to call:

```ts
handler({
  method: 'GET',
  path: '/simulations/sim-1/partitions/world-main/validation-reports',
  query: { fromGeneratedAt: '100', toGeneratedAt: '200', limit: '2' },
});

handler({
  method: 'GET',
  path: '/simulations/sim-1/partitions/world-main/validation-reports/validation-2',
});
```

Assert the calls reach `queryExperimentValidationReports` and `getExperimentValidationReport` with
decoded path fields and parsed query numbers.

- [x] **Step 2: Add invalid query assertion**

Assert `limit=0` on `/validation-reports` returns:

```ts
{
  status: 400,
  headers: { 'content-type': 'application/json' },
  body: { error: { code: 'bad_request', message: 'limit must be a positive integer' } },
}
```

- [x] **Step 3: Run the HTTP router test red**

Run:

```bash
pnpm --filter @aivilization/api test -- httpApi.test.ts
```

Expected: FAIL because the router does not match validation report routes.

### Task 3: Local Backend Tests

**Files:**

- Modify: `apps/worker/src/localSimulationBackend.test.ts`
- Modify: `apps/worker/src/localSimulationBackendRegistry.test.ts`
- Modify: `apps/server/src/localRuntimeTownServer.test.ts`

- [x] **Step 1: Add local backend report query test**

Record two validation reports through `backend.storage.experimentValidationReportRepository`, then
assert `backend.api.queryExperimentValidationReports` returns the requested simulation reports and
`backend.api.getExperimentValidationReport` returns the single run.

- [x] **Step 2: Add registry routing test**

Record a report in one partition backend, query through `registry.api`, and assert the request is
routed to the matching partition. Query an unknown partition and assert the existing unknown backend
error is raised before a response is produced.

- [x] **Step 3: Add Node HTTP gateway test**

Record a validation report through `runtime.api.host.registry.getBackend(...)` in the server test and
fetch `/validation-reports` through Node HTTP.

- [x] **Step 4: Run worker/server tests red**

Run:

```bash
pnpm --filter @aivilization/worker test -- localSimulationBackend.test.ts localSimulationBackendRegistry.test.ts
pnpm --filter @aivilization/server test -- localRuntimeTownServer.test.ts
```

Expected: FAIL because the local backend and registry do not expose report query ports yet.

### Task 4: Implementation

**Files:**

- Modify: `apps/api/src/simulationApi.ts`
- Modify: `apps/api/src/httpApi.ts`
- Modify: `apps/worker/src/localSimulationBackend.ts`
- Modify: `apps/worker/src/localSimulationBackendRegistry.ts`

- [x] **Step 1: Add simulation API report port**

Add:

```ts
export type ExperimentValidationReportLookupRequest = {
  readonly simulationId: string;
  readonly partitionKey: PartitionKey;
  readonly runId: string;
};

export type ExperimentValidationReportQueryRequest = {
  readonly simulationId: string;
  readonly partitionKey: PartitionKey;
  readonly runId?: string;
  readonly fromGeneratedAt?: number;
  readonly toGeneratedAt?: number;
  readonly limit?: number;
};

export type ExperimentValidationReportQueryPort<TReport> = {
  readonly getReport: (
    request: ExperimentValidationReportLookupRequest,
  ) => Promise<TReport | undefined>;
  readonly queryReports: (
    request: ExperimentValidationReportQueryRequest,
  ) => Promise<readonly TReport[]>;
};
```

Thread it through `SimulationApiService` and `createSimulationApiService`.

- [x] **Step 2: Add HTTP routes**

Support 5-segment collection routes and 6-segment item routes. Parse `runId`,
`fromGeneratedAt`, `toGeneratedAt`, and positive-integer `limit`.

- [x] **Step 3: Add local backend adapter**

Create `createLocalExperimentValidationReportQueryPort` in `localSimulationBackend.ts`, assert the
request matches storage, and delegate to `storage.experimentValidationReportRepository`.

- [x] **Step 4: Add registry adapter**

Thread report methods through `createLocalSimulationBackendRegistry` just like projection/events/sync.

### Task 5: Verification And Commit

**Files:**

- All files touched in this plan.

- [x] **Step 1: Run targeted verification**

Run:

```bash
pnpm --filter @aivilization/api test -- simulationApi.test.ts httpApi.test.ts
pnpm --filter @aivilization/worker test -- localSimulationBackend.test.ts localSimulationBackendRegistry.test.ts
pnpm --filter @aivilization/server test -- localRuntimeTownServer.test.ts
pnpm --filter @aivilization/api typecheck
pnpm --filter @aivilization/worker typecheck
pnpm --filter @aivilization/server typecheck
```

- [x] **Step 2: Run full verification**

Run:

```bash
pnpm check
pnpm build
git diff --check
```

- [x] **Step 3: Commit**

Commit with:

```bash
git commit -m "feat: expose validation report api"
```

## Self-Review

- Boundary review: API owns transport-neutral ports and HTTP parsing; worker owns local repository
  adaptation.
- Data-flow review: reads go through API service before touching storage.
- Extension review: future DB, scheduler, dashboard, and Godot clients can depend on the service
  contract without changing validation math or local storage internals.
