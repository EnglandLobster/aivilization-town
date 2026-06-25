# Social Reflection Observation API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this
> plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose durable social reflection observations through backend API and local HTTP routes.

**Architecture:** Keep social reflection observations as an observability read model. Add a thin API
service for normalization/delegation, route it through the existing HTTP handler, and wire the local
runtime server to file-backed partition storage.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, `@aivilization/observability`,
`@aivilization/api`, `@aivilization/server`.

---

### Task 1: Observability Lookup Support

**Files:**

- Modify: `packages/observability/src/socialReflectionObservationRepository.test.ts`
- Modify: `packages/observability/src/socialReflectionObservationRepository.ts`

- [x] **Step 1: Write failing repository lookup test**

Add assertions that `get('observation-1')` returns a cloned row, unknown ids return
`undefined`, and `query({ simulationId, observationId })` filters to that exact observation.

- [x] **Step 2: Run RED**

Run:

```bash
pnpm --filter @aivilization/observability test -- socialReflectionObservationRepository.test.ts
```

Expected: FAIL because the repository contract does not expose `get` or `observationId` query.

- [x] **Step 3: Implement lookup support**

Add `get(observationId)` to the repository interface and both implementations. Add optional
`observationId` to query validation and filtering.

- [x] **Step 4: Run GREEN**

Run:

```bash
pnpm --filter @aivilization/observability test -- socialReflectionObservationRepository.test.ts
pnpm --filter @aivilization/observability typecheck
```

Expected: PASS.

### Task 2: API Service

**Files:**

- Create: `apps/api/src/socialReflectionObservationApi.ts`
- Create: `apps/api/src/socialReflectionObservationApi.test.ts`
- Modify: `apps/api/src/index.ts`

- [x] **Step 1: Write failing API service tests**

Add tests for lookup/query normalization and invalid `observationId`, `fromGeneratedAt`, and
`limit` rejection before delegation.

- [x] **Step 2: Run RED**

Run:

```bash
pnpm --filter @aivilization/api test -- socialReflectionObservationApi.test.ts
```

Expected: FAIL because the API service module does not exist.

- [x] **Step 3: Implement API service**

Create the lookup/query request types, query port, service factory, and normalization helpers.
Export the module from `apps/api/src/index.ts`.

- [x] **Step 4: Run GREEN**

Run:

```bash
pnpm --filter @aivilization/api test -- socialReflectionObservationApi.test.ts
pnpm --filter @aivilization/api typecheck
```

Expected: PASS.

### Task 3: HTTP Routing

**Files:**

- Modify: `apps/api/src/httpApi.test.ts`
- Modify: `apps/api/src/httpApi.ts`

- [x] **Step 1: Write failing HTTP route tests**

Add tests that route query and lookup requests for
`/social-reflection-observations`, validate parsed query fields, and return 400 for `limit=0`.

- [x] **Step 2: Run RED**

Run:

```bash
pnpm --filter @aivilization/api test -- httpApi.test.ts
```

Expected: FAIL because the optional service and route are not wired.

- [x] **Step 3: Implement HTTP routing**

Add `socialReflectionObservations` to `TownHttpApiServices`, parse route segments, create lookup and
query request helpers, and delegate to the optional API service.

- [x] **Step 4: Run GREEN**

Run:

```bash
pnpm --filter @aivilization/api test -- httpApi.test.ts
pnpm --filter @aivilization/api typecheck
```

Expected: PASS.

### Task 4: Local Runtime Server Wiring

**Files:**

- Modify: `apps/server/src/localRuntimeTownServer.test.ts`
- Modify: `apps/server/src/localRuntimeTownServer.ts`

- [x] **Step 1: Write failing server integration test**

Record a `SocialReflectionObservation` in local partition storage and assert the local HTTP gateway
serves both filtered query and exact lookup routes.

- [x] **Step 2: Run RED**

Run:

```bash
pnpm --filter @aivilization/server test -- localRuntimeTownServer.test.ts
```

Expected: FAIL because the local server does not expose the optional API service.

- [x] **Step 3: Wire local server**

Create `socialReflectionObservationsApi` in `createLocalRuntimeTownApi()` and pass it into
`createTownHttpApiHandler()`.

- [x] **Step 4: Run GREEN**

Run:

```bash
pnpm --filter @aivilization/server test -- localRuntimeTownServer.test.ts
pnpm --filter @aivilization/server typecheck
```

Expected: PASS.

### Task 5: Final Verification And Commit

- [x] **Step 1: Run verification**

Run:

```bash
pnpm exec prettier --check docs/superpowers/specs/2026-06-25-social-reflection-observation-api-design.md docs/superpowers/plans/2026-06-25-social-reflection-observation-api-slice.md packages/observability/src/socialReflectionObservationRepository.ts packages/observability/src/socialReflectionObservationRepository.test.ts apps/api/src/socialReflectionObservationApi.ts apps/api/src/socialReflectionObservationApi.test.ts apps/api/src/index.ts apps/api/src/httpApi.ts apps/api/src/httpApi.test.ts apps/server/src/localRuntimeTownServer.ts apps/server/src/localRuntimeTownServer.test.ts
pnpm check
git diff --check
```

- [x] **Step 2: Commit**

Stage only this slice and commit with a Conventional Commit message in Chinese.
