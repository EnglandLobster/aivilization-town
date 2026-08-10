# Objective Renewal Trace Repository Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist and expose objective-renewal decision traces, including LLM strategic planning evidence, so autonomous goals and profile-level LLM plans are observable like agent-cycle traces.

**Architecture:** `@aivilization/observability` owns the durable trace contract and repository adapters. `apps/worker` wires the repository into local runtime storage and passes it as the existing `objectiveRenewalTraceSink`; `apps/api` and `apps/server` expose query/read ports without moving worker or LLM details into HTTP routing.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, `@aivilization/observability`, `@aivilization/worker`, `@aivilization/api`, `@aivilization/server`.

---

### Task 1: Observability Trace Repository

**Files:**

- Create: `packages/observability/src/objectiveRenewalTraceRepository.test.ts`
- Create: `packages/observability/src/objectiveRenewalTraceRepository.ts`
- Modify: `packages/observability/src/index.ts`
- Modify: this plan file

- [x] **Step 1: Write failing repository tests**

Add tests proving:

- `InMemoryObjectiveRenewalTraceRepository` records one trace per `traceId`;
- duplicate records with the same `traceId` are idempotent;
- query filters by `simulationId`, `partitionKey`, `agentId`, time window, and `limit`;
- query returns latest traces first;
- `FileObjectiveRenewalTraceRepository` persists JSONL traces across restarts.

- [x] **Step 2: Run observability tests and verify RED**

Run:

```bash
pnpm --filter @aivilization/observability test -- objectiveRenewalTraceRepository.test.ts
```

Expected before implementation: FAIL because `./objectiveRenewalTraceRepository` does not exist.

- [x] **Step 3: Implement trace repository**

Add:

- `ObjectiveRenewalTrace`
- `ObjectiveRenewalStrategicPlanTrace`
- `ObjectiveRenewalTraceQuery`
- `ObjectiveRenewalTraceRepository`
- `InMemoryObjectiveRenewalTraceRepository`
- `FileObjectiveRenewalTraceRepository`

Rules:

- trace ids are deterministic and non-empty;
- repository `record` is idempotent by `traceId`;
- file adapter writes JSONL under `objective-renewal-traces.jsonl`;
- clones preserve optional strategic plan attempt/usage details;
- observability remains independent from worker internals.

- [x] **Step 4: Verify observability GREEN**

Run:

```bash
pnpm --filter @aivilization/observability test -- objectiveRenewalTraceRepository.test.ts
pnpm --filter @aivilization/observability typecheck
```

Expected: PASS.

### Task 2: Worker Storage And Profile Runner Wiring

**Files:**

- Modify: `apps/worker/src/localRuntimeStorage.ts`
- Modify: `apps/worker/src/localRuntimeStorage.test.ts`
- Modify: `apps/server/src/localRuntimeTownProfileRunner.ts`
- Modify: `apps/server/src/localRuntimeTownProfileRunner.test.ts`
- Modify: this plan file

- [x] **Step 1: Write failing worker/server integration tests**

Add tests proving:

- local runtime storage restarts with a durable objective-renewal trace repository;
- profile runner records objective-renewal traces for autonomous objective creation;
- LLM planning metadata from `llmPlanning` is present in the persisted objective-renewal trace.

- [x] **Step 2: Run integration tests and verify RED**

Run:

```bash
pnpm --filter @aivilization/worker test -- localRuntimeStorage.test.ts
pnpm --filter @aivilization/server test -- localRuntimeTownProfileRunner.test.ts
```

Expected before wiring: FAIL because local storage has no objective-renewal trace repository and profile runner does not pass a sink.

- [x] **Step 3: Implement storage and runner wiring**

Update:

- `LocalWorldRuntimeStorage` gains `objectiveRenewalTraceRepository`;
- `createLocalWorldRuntimeStorage` creates `FileObjectiveRenewalTraceRepository` under `observabilityDir`;
- `createLocalRuntimeTownProfileAgentProvider` passes a mapped sink to `renewMissingActiveObjectives`;
- trace id format is `<simulationId>:<partitionKey>:<agentId>:<objectiveId>:<issuedAt>`;
- profile runner tests query the persisted file repository instead of relying on in-memory side effects.

- [x] **Step 4: Verify integration GREEN**

Run:

```bash
pnpm --filter @aivilization/worker test -- localRuntimeStorage.test.ts
pnpm --filter @aivilization/server test -- localRuntimeTownProfileRunner.test.ts
pnpm --filter @aivilization/server typecheck
```

Expected: PASS.

### Task 3: API And Server Exposure

**Files:**

- Create: `apps/api/src/objectiveRenewalTraceApi.test.ts`
- Create: `apps/api/src/objectiveRenewalTraceApi.ts`
- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/src/httpApi.ts`
- Modify: `apps/api/src/httpApi.test.ts`
- Modify: `apps/server/src/localRuntimeTownServer.ts`
- Modify: `apps/server/src/localRuntimeTownServer.test.ts`
- Modify: this plan file

- [x] **Step 1: Write failing API tests**

Add tests proving:

- API service validates lookup/query inputs;
- HTTP `GET /simulations/:simulationId/partitions/:partitionKey/objective-renewal-traces` queries traces;
- HTTP `GET /simulations/:simulationId/partitions/:partitionKey/objective-renewal-traces/:traceId` reads one trace;
- local town server wires the registry-backed trace service into the HTTP handler.

- [x] **Step 2: Run API/server tests and verify RED**

Run:

```bash
pnpm --filter @aivilization/api test -- objectiveRenewalTraceApi.test.ts httpApi.test.ts
pnpm --filter @aivilization/server test -- localRuntimeTownServer.test.ts
```

Expected before implementation: FAIL because the API service and routes do not exist.

- [x] **Step 3: Implement API/server exposure**

Add:

- `createObjectiveRenewalTraceApiService`;
- HTTP simulation routes for objective-renewal traces;
- registry query port backed by each partition's `objectiveRenewalTraceRepository`;
- local server handler wiring.

- [x] **Step 4: Verify API/server GREEN**

Run:

```bash
pnpm --filter @aivilization/api test -- objectiveRenewalTraceApi.test.ts httpApi.test.ts
pnpm --filter @aivilization/server test -- localRuntimeTownServer.test.ts
pnpm --filter @aivilization/api typecheck
pnpm --filter @aivilization/server typecheck
```

Expected: PASS.

### Task 4: Verification And Commit

**Files:**

- All files above.

- [x] **Step 1: Format touched files**

Run:

```bash
pnpm exec prettier --write docs/superpowers/plans/2026-06-25-objective-renewal-trace-repository-slice.md packages/observability/src/objectiveRenewalTraceRepository.ts packages/observability/src/objectiveRenewalTraceRepository.test.ts packages/observability/src/index.ts apps/worker/src/localRuntimeStorage.ts apps/worker/src/localRuntimeStorage.test.ts apps/server/src/localRuntimeTownProfileRunner.ts apps/server/src/localRuntimeTownProfileRunner.test.ts apps/api/src/objectiveRenewalTraceApi.ts apps/api/src/objectiveRenewalTraceApi.test.ts apps/api/src/index.ts apps/api/src/httpApi.ts apps/api/src/httpApi.test.ts apps/server/src/localRuntimeTownServer.ts apps/server/src/localRuntimeTownServer.test.ts
```

- [x] **Step 2: Run focused and full verification**

Run:

```bash
pnpm --filter @aivilization/observability test -- objectiveRenewalTraceRepository.test.ts
pnpm --filter @aivilization/worker test -- localRuntimeStorage.test.ts
pnpm --filter @aivilization/api test -- objectiveRenewalTraceApi.test.ts httpApi.test.ts
pnpm --filter @aivilization/server test -- localRuntimeTownProfileRunner.test.ts localRuntimeTownServer.test.ts
pnpm --filter @aivilization/observability typecheck
pnpm --filter @aivilization/worker typecheck
pnpm --filter @aivilization/api typecheck
pnpm --filter @aivilization/server typecheck
pnpm lint
pnpm typecheck
pnpm test
git diff --check
```

Expected: all commands exit 0.

- [x] **Step 3: Commit**

Run:

```bash
git add docs/superpowers/plans/2026-06-25-objective-renewal-trace-repository-slice.md packages/observability/src/objectiveRenewalTraceRepository.ts packages/observability/src/objectiveRenewalTraceRepository.test.ts packages/observability/src/index.ts apps/worker/src/localRuntimeStorage.ts apps/worker/src/localRuntimeStorage.test.ts apps/server/src/localRuntimeTownProfileRunner.ts apps/server/src/localRuntimeTownProfileRunner.test.ts apps/api/src/objectiveRenewalTraceApi.ts apps/api/src/objectiveRenewalTraceApi.test.ts apps/api/src/index.ts apps/api/src/httpApi.ts apps/api/src/httpApi.test.ts apps/server/src/localRuntimeTownServer.ts apps/server/src/localRuntimeTownServer.test.ts
git commit -m "feat: persist objective renewal traces"
```
