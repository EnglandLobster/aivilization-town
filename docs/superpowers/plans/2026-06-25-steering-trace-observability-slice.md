# Steering Trace Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist and expose human/Godot steering command traces so external interventions can be audited from command ingestion through objective planning or reactive action routing.

**Architecture:** Keep the trace schema and file repository in `@aivilization/observability`. Worker storage owns the concrete file repository, and local command drain records a trace after each successfully handled steering command. API and server layers expose query/lookup routes without depending on worker internals.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, existing local JSONL repositories, existing simulation HTTP route pattern.

---

## File Structure

- Create `packages/observability/src/steeringTraceRepository.ts`: `SteeringTrace`, query type, in-memory/file repositories.
- Create `packages/observability/src/steeringTraceRepository.test.ts`: idempotency, filters, latest-first sorting, defensive clones, file restart.
- Modify `packages/observability/src/index.ts`: export the repository.
- Modify `apps/worker/src/localRuntimeStorage.ts`: add `steeringTraceRepository`.
- Modify `apps/worker/src/localRuntimeStorage.test.ts`: prove restart preserves steering traces.
- Modify `apps/worker/src/localCommandDrain.ts`: record steering traces from handled command records.
- Modify `apps/worker/src/localCommandDrain.test.ts`: prove objective and reactive command drains create queryable traces.
- Create `apps/api/src/steeringTraceApi.ts`: normalize lookup/query requests.
- Create `apps/api/src/steeringTraceApi.test.ts`: validate delegation and invalid input.
- Modify `apps/api/src/httpApi.ts`: add `/steering-traces` routes.
- Modify `apps/api/src/httpApi.test.ts`: prove query and lookup routes.
- Modify `apps/api/src/index.ts`: export the API service.
- Modify `apps/server/src/localRuntimeTownServer.ts`: wire local runtime storage repository into API service.
- Modify `apps/server/src/localRuntimeTownServer.test.ts`: prove local HTTP gateway serves steering traces.

## Trace Shape

```ts
export type SteeringTrace = {
  readonly traceId: string;
  readonly simulationId: string;
  readonly partitionKey: string;
  readonly commandId: string;
  readonly commandType: string;
  readonly source: string;
  readonly agentId: string;
  readonly resultKind: 'long-horizon-objective-set' | 'reactive-command-routed';
  readonly objectiveId?: string;
  readonly planId?: string;
  readonly reactiveCommandId?: string;
  readonly selectedPlannerDomain?: string;
  readonly candidateActionCount: number;
  readonly commandDraftCount: number;
  readonly shortTermMemoryRecordIds: readonly string[];
  readonly strategicPlan?: SteeringStrategicPlanTrace;
  readonly issuedAt: number;
  readonly recordedAt: number;
};
```

`traceId` for local drains is deterministic: `${simulationId}:${partitionKey}:${sequence}:${commandId}`. This keeps retries idempotent while preserving the command-stream sequence that processed the intervention.

## Task 1: Observability Repository

**Files:**

- Create: `packages/observability/src/steeringTraceRepository.ts`
- Test: `packages/observability/src/steeringTraceRepository.test.ts`
- Modify: `packages/observability/src/index.ts`

- [x] **Step 1: Write failing repository tests**

Test:

```ts
await repository.record(createTrace({ traceId: 'trace-1', commandId: 'cmd-1', issuedAt: 100 }));
await repository.record(
  createTrace({ traceId: 'trace-1', commandId: 'cmd-1-duplicate', issuedAt: 200 }),
);
await repository.record(createTrace({ traceId: 'trace-2', commandId: 'cmd-2', issuedAt: 300 }));

await expect(
  repository.query({
    simulationId: 'sim-1',
    partitionKey: 'world-main',
    agentId: 'agent-1',
    limit: 1,
  }),
).resolves.toEqual([expect.objectContaining({ traceId: 'trace-2' })]);
await expect(repository.get('trace-1')).resolves.toMatchObject({ commandId: 'cmd-1' });
```

Also prove a file-backed repository returns the same trace after restart.

- [x] **Step 2: Verify RED**

Run:

```bash
pnpm --filter @aivilization/observability test -- steeringTraceRepository.test.ts
```

Expected before implementation: FAIL because the module does not exist.

- [x] **Step 3: Implement repository**

Follow the `objectiveRenewalTraceRepository` pattern: JSONL file `steering-traces.jsonl`, idempotent `record`, `get`, `query`, validation, latest-first sorting, and clone helpers for strategic-plan attempts and usage.

- [x] **Step 4: Verify GREEN**

Run:

```bash
pnpm --filter @aivilization/observability test -- steeringTraceRepository.test.ts
```

## Task 2: Worker Storage and Drain Recording

**Files:**

- Modify: `apps/worker/src/localRuntimeStorage.ts`
- Modify: `apps/worker/src/localRuntimeStorage.test.ts`
- Modify: `apps/worker/src/localCommandDrain.ts`
- Modify: `apps/worker/src/localCommandDrain.test.ts`

- [x] **Step 1: Write failing worker tests**

Add assertions that:

```ts
await storage.steeringTraceRepository.get('sim-1:world-main:1:cmd-objective-study');
```

returns a long-horizon objective trace with `objectiveId`, `planId`, and strategic plan provenance when the command uses a traceable compiler, and that a reactive command trace records `reactiveCommandId`, `selectedPlannerDomain`, `candidateActionCount`, `commandDraftCount`, and STM record ids.

- [x] **Step 2: Verify RED**

Run:

```bash
pnpm --filter @aivilization/worker test -- localRuntimeStorage.test.ts localCommandDrain.test.ts
```

Expected before implementation: FAIL because storage has no `steeringTraceRepository` and drain does not record traces.

- [x] **Step 3: Implement storage and trace recording**

Add `FileSteeringTraceRepository` to `createLocalWorldRuntimeStorage`. In both drain functions, after `handleWorkerSteeringCommand` succeeds, record a trace using command record sequence, command metadata, result kind, plan/route metadata, STM ids, and `checkpointUpdatedAt` as `recordedAt`.

- [x] **Step 4: Verify GREEN**

Run:

```bash
pnpm --filter @aivilization/worker test -- localRuntimeStorage.test.ts localCommandDrain.test.ts
```

## Task 3: API and Server Routes

**Files:**

- Create: `apps/api/src/steeringTraceApi.ts`
- Create: `apps/api/src/steeringTraceApi.test.ts`
- Modify: `apps/api/src/httpApi.ts`
- Modify: `apps/api/src/httpApi.test.ts`
- Modify: `apps/api/src/index.ts`
- Modify: `apps/server/src/localRuntimeTownServer.ts`
- Modify: `apps/server/src/localRuntimeTownServer.test.ts`

- [x] **Step 1: Write failing API/server tests**

Add API service tests for normalization. Add HTTP router tests for:

```text
GET /simulations/sim-1/partitions/world-main/steering-traces?agentId=agent-1&commandId=cmd-objective-study&limit=1
GET /simulations/sim-1/partitions/world-main/steering-traces/sim-1%3Aworld-main%3A1%3Acmd-objective-study
```

Add local server test that records a trace into backend storage and fetches it through the HTTP gateway.

- [x] **Step 2: Verify RED**

Run:

```bash
pnpm --filter @aivilization/api test -- steeringTraceApi.test.ts httpApi.test.ts
pnpm --filter @aivilization/server test -- localRuntimeTownServer.test.ts
```

Expected before implementation: FAIL because API service and routes are missing.

- [x] **Step 3: Implement API and server wiring**

Mirror objective-renewal trace wiring: service interface, optional `steeringTraces` service in `TownHttpApiServices`, route matching, request normalization, server `createSteeringTraceApiService`, and local backend storage calls.

- [x] **Step 4: Verify GREEN**

Run:

```bash
pnpm --filter @aivilization/api test -- steeringTraceApi.test.ts httpApi.test.ts
pnpm --filter @aivilization/server test -- localRuntimeTownServer.test.ts
```

## Task 4: Verification and Commit

- [x] **Step 1: Format changed files**

Run:

```bash
pnpm exec prettier --write docs/superpowers/plans/2026-06-25-steering-trace-observability-slice.md packages/observability/src/steeringTraceRepository.ts packages/observability/src/steeringTraceRepository.test.ts packages/observability/src/index.ts apps/worker/src/localRuntimeStorage.ts apps/worker/src/localRuntimeStorage.test.ts apps/worker/src/localCommandDrain.ts apps/worker/src/localCommandDrain.test.ts apps/api/src/steeringTraceApi.ts apps/api/src/steeringTraceApi.test.ts apps/api/src/httpApi.ts apps/api/src/httpApi.test.ts apps/api/src/index.ts apps/server/src/localRuntimeTownServer.ts apps/server/src/localRuntimeTownServer.test.ts
```

- [x] **Step 2: Run focused tests**

Run:

```bash
pnpm --filter @aivilization/observability test -- steeringTraceRepository.test.ts
pnpm --filter @aivilization/worker test -- localRuntimeStorage.test.ts localCommandDrain.test.ts
pnpm --filter @aivilization/api test -- steeringTraceApi.test.ts httpApi.test.ts
pnpm --filter @aivilization/server test -- localRuntimeTownServer.test.ts
```

- [x] **Step 3: Run package and repo checks**

Run:

```bash
pnpm --filter @aivilization/observability typecheck
pnpm --filter @aivilization/worker typecheck
pnpm --filter @aivilization/api typecheck
pnpm --filter @aivilization/server typecheck
pnpm lint
pnpm typecheck
pnpm test
git diff --check
```

- [x] **Step 4: Commit**

Run:

```bash
git add docs/superpowers/plans/2026-06-25-steering-trace-observability-slice.md packages/observability/src/steeringTraceRepository.ts packages/observability/src/steeringTraceRepository.test.ts packages/observability/src/index.ts apps/worker/src/localRuntimeStorage.ts apps/worker/src/localRuntimeStorage.test.ts apps/worker/src/localCommandDrain.ts apps/worker/src/localCommandDrain.test.ts apps/api/src/steeringTraceApi.ts apps/api/src/steeringTraceApi.test.ts apps/api/src/httpApi.ts apps/api/src/httpApi.test.ts apps/api/src/index.ts apps/server/src/localRuntimeTownServer.ts apps/server/src/localRuntimeTownServer.test.ts
git commit -m "feat: expose steering command traces"
```
