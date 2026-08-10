# Runtime Profile Run Report API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose persisted runtime profile run reports through the backend API so headless profile artifacts are queryable by tooling, CI, and future operator UIs.

**Architecture:** Add a generic API service in `apps/api` that normalizes lookup/query requests and delegates to an injected report query port. Wire HTTP routes under `/runtime/profile-run-reports`; then let `apps/server` optionally inject a `RuntimeProfileRunReportRepository` into the local runtime handler without coupling API routing to storage details.

**Tech Stack:** TypeScript, Vitest, existing Town HTTP API router, observability runtime profile run report repository.

---

### Task 1: API Service Contract

**Files:**

- Create: `apps/api/src/runtimeProfileRunReportApi.test.ts`
- Create: `apps/api/src/runtimeProfileRunReportApi.ts`
- Modify: `apps/api/src/index.ts`

- [x] **Step 1: Write failing service tests**

Add tests for `createRuntimeProfileRunReportApiService` that assert:

```ts
await service.queryRuntimeProfileRunReports({
  profileId: 'smoke-25',
  fromGeneratedAt: 100,
  toGeneratedAt: 200,
  limit: 2,
});
await service.getRuntimeProfileRunReport({ runId: 'run-1' });
```

delegates normalized requests to an injected control port, and rejects empty `runId`, empty `profileId`, non-finite `fromGeneratedAt`, non-finite `toGeneratedAt`, and non-positive `limit`.

- [x] **Step 2: Run service tests and verify RED**

Run:

```bash
pnpm --filter @aivilization/api test -- runtimeProfileRunReportApi.test.ts
```

Expected: FAIL because the API service module is not implemented.

- [x] **Step 3: Implement API service**

Create `RuntimeProfileRunReportLookupRequest`, `RuntimeProfileRunReportQueryRequest`, `RuntimeProfileRunReportQueryPort<TReport>`, `RuntimeProfileRunReportApiService<TReport>`, and `createRuntimeProfileRunReportApiService`.

The service should normalize inputs before delegation and stay generic over the report payload type.

- [x] **Step 4: Export and verify GREEN**

Export the module from `apps/api/src/index.ts`, then run:

```bash
pnpm --filter @aivilization/api test -- runtimeProfileRunReportApi.test.ts
pnpm --filter @aivilization/api typecheck
```

Expected: PASS.

### Task 2: HTTP Runtime Routes

**Files:**

- Modify: `apps/api/src/httpApi.test.ts`
- Modify: `apps/api/src/httpApi.ts`

- [x] **Step 1: Write failing HTTP route tests**

Add a runtime profile report test that builds a handler with `runtimeProfileRunReports` and asserts:

```ts
GET /runtime/profile-run-reports?profileId=smoke-25&fromGeneratedAt=100&toGeneratedAt=200&limit=2
GET /runtime/profile-run-reports/aivilization-smoke-25%3Aprofile-run%3A100
```

return JSON bodies and call the service with decoded/parsed request values.

Also add an invalid query assertion:

```ts
GET /runtime/profile-run-reports?limit=0
```

returns `400` with `limit must be a positive integer`.

- [x] **Step 2: Run HTTP tests and verify RED**

Run:

```bash
pnpm --filter @aivilization/api test -- httpApi.test.ts
```

Expected: FAIL because the router does not know the route.

- [x] **Step 3: Implement HTTP routing**

Extend `TownHttpApiServices` with optional `runtimeProfileRunReports`. In `routeRuntimeRequest`, add:

- `GET /runtime/profile-run-reports`
- `GET /runtime/profile-run-reports/:runId`

Both should 404 when the optional service is absent and should use the same structured error style as existing routes.

- [x] **Step 4: Run HTTP tests and verify GREEN**

Run:

```bash
pnpm --filter @aivilization/api test -- httpApi.test.ts
pnpm --filter @aivilization/api typecheck
```

Expected: PASS.

### Task 3: Local Server Adapter

**Files:**

- Modify: `apps/server/src/localRuntimeTownServer.test.ts`
- Modify: `apps/server/src/localRuntimeTownServer.ts`
- Modify: `apps/server/src/localRuntimeTownProfileRunner.ts`

- [x] **Step 1: Write failing server integration test**

Add a local HTTP gateway test that supplies `new InMemoryRuntimeProfileRunReportRepository()` as `runtimeProfileRunReports`, records a report, starts the node server, and verifies:

```ts
GET /runtime/profile-run-reports?profileId=smoke-25
GET /runtime/profile-run-reports/run-server-1
```

return the recorded artifact.

- [x] **Step 2: Run server tests and verify RED**

Run:

```bash
pnpm --filter @aivilization/server test -- localRuntimeTownServer.test.ts
```

Expected: FAIL because local server input does not wire profile report API.

- [x] **Step 3: Wire optional repository**

Add `runtimeProfileRunReports?: RuntimeProfileRunReportRepository` to `LocalRuntimeTownServerInput`, create a `RuntimeProfileRunReportApiService` when present, and pass it to `createTownHttpApiHandler`.

Update `runLocalRuntimeTownDaemonScenarioProfile` to pass `profileRunReportRepository` into `createLocalRuntimeTownApi` when supplied, so a headless runtime handler and reporter can share the same artifact store.

- [x] **Step 4: Run server tests and verify GREEN**

Run:

```bash
pnpm --filter @aivilization/server test -- localRuntimeTownServer.test.ts localRuntimeTownProfileRunner.test.ts
pnpm --filter @aivilization/server typecheck
```

Expected: PASS.

### Task 4: Verification And Commit

**Files:**

- Modify all files above.

- [x] **Step 1: Format touched files**

Run:

```bash
pnpm exec prettier --write docs/superpowers/plans/2026-06-25-runtime-profile-run-report-api-slice.md apps/api/src/runtimeProfileRunReportApi.ts apps/api/src/runtimeProfileRunReportApi.test.ts apps/api/src/index.ts apps/api/src/httpApi.ts apps/api/src/httpApi.test.ts apps/server/src/localRuntimeTownServer.ts apps/server/src/localRuntimeTownServer.test.ts apps/server/src/localRuntimeTownProfileRunner.ts
```

- [x] **Step 2: Run focused and full verification**

Run:

```bash
pnpm --filter @aivilization/api typecheck && pnpm --filter @aivilization/api test -- runtimeProfileRunReportApi.test.ts httpApi.test.ts && pnpm --filter @aivilization/server typecheck && pnpm --filter @aivilization/server test -- localRuntimeTownServer.test.ts localRuntimeTownProfileRunner.test.ts && pnpm lint && pnpm typecheck && pnpm test && git diff --check
```

Expected: all commands exit 0.

- [x] **Step 3: Commit**

Run:

```bash
git add docs/superpowers/plans/2026-06-25-runtime-profile-run-report-api-slice.md apps/api/src/runtimeProfileRunReportApi.ts apps/api/src/runtimeProfileRunReportApi.test.ts apps/api/src/index.ts apps/api/src/httpApi.ts apps/api/src/httpApi.test.ts apps/server/src/localRuntimeTownServer.ts apps/server/src/localRuntimeTownServer.test.ts apps/server/src/localRuntimeTownProfileRunner.ts
git commit -m "feat: expose profile run report api"
```
