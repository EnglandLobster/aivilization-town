# Agent Cycle Trace API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose durable agent cycle traces, including simulator event evidence, through the backend API.

**Architecture:** `apps/api` owns request normalization and HTTP routing only. Trace storage stays behind an injected port so `@aivilization/observability` remains the durable trace owner.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, `apps/api`, `@aivilization/observability`.

---

## Scope

- Add `AgentCycleTraceApiService` and request types.
- Add optional `agentCycleTraces` service to the town HTTP API handler.
- Add `/agent-cycle-traces` collection and lookup routes under simulation partitions.
- Preserve nested simulator event traces in response bodies.
- Export the new API module.

## Task 1: Agent Cycle Trace API Service

**Files:**

- Create: `apps/api/src/agentCycleTraceApi.ts`
- Create: `apps/api/src/agentCycleTraceApi.test.ts`
- Modify: `apps/api/src/index.ts`

- [x] **Step 1: Write failing service tests**

Add tests equivalent to:

```ts
await service.getAgentCycleTrace({
  simulationId: 'sim-1',
  partitionKey: 'world-main',
  traceId: 'cycle-trace-1',
});

await service.queryAgentCycleTraces({
  simulationId: 'sim-1',
  partitionKey: 'world-main',
  traceId: 'cycle-trace-1',
  agentId: 'agent-1',
  fromCycleStartedAt: 100,
  toCycleStartedAt: 200,
  limit: 3,
});
```

Invalid cases:

- blank `traceId` rejects with `traceId must not be empty`;
- `limit: 0` rejects with `limit must be a positive integer`;
- non-finite cycle times reject with `fromCycleStartedAt must be finite`.

Run:

```bash
pnpm --filter @aivilization/api test -- agentCycleTraceApi.test.ts
```

Expected: FAIL because the module does not exist.

Observed: FAIL, `./agentCycleTraceApi` was missing.

- [x] **Step 2: Implement the service**

Create a service matching the existing `AgentProfileApiService` and `SteeringTraceApiService`
patterns:

```ts
export type AgentCycleTraceApiService<TTrace> = {
  readonly getAgentCycleTrace: (
    request: AgentCycleTraceLookupRequest,
  ) => Promise<TTrace | undefined>;
  readonly queryAgentCycleTraces: (
    request: AgentCycleTraceQueryRequest,
  ) => Promise<readonly TTrace[]>;
};
```

Normalize non-empty ids, finite time filters, and positive integer limits before delegating.

- [x] **Step 3: Export the service**

Add:

```ts
export * from './agentCycleTraceApi';
```

to `apps/api/src/index.ts`.

## Task 2: HTTP Routing

**Files:**

- Modify: `apps/api/src/httpApi.ts`
- Modify: `apps/api/src/httpApi.test.ts`

- [x] **Step 4: Write failing router tests**

Add a `TestAgentCycleTrace` fixture with nested simulator events:

```ts
{
  traceId: 'cycle-trace-1',
  agentId: 'agent-1',
  simulatorEvents: [
    {
      actionId: 'eat-1',
      attempt: 'original',
      status: 'rejected',
      reason: 'insufficient Apple',
      events: [
        { type: 'ActionRejected', sequence: 10, summary: 'insufficient Apple' },
      ],
    },
  ],
}
```

Assert:

- `GET /simulations/sim-1/partitions/world-main/agent-cycle-traces?...` returns the list.
- `GET /simulations/sim-1/partitions/world-main/agent-cycle-traces/cycle-trace-1` returns the
  trace.
- `limit=0` returns the existing `400 bad_request` shape.
- Calls are delegated with decoded route params and numeric filters.

Run:

```bash
pnpm --filter @aivilization/api test -- httpApi.test.ts
```

Expected: FAIL because the router does not know the new service or path.

Observed: FAIL, `GET /agent-cycle-traces` returned `405 method_not_allowed` before the route was
registered.

- [x] **Step 5: Implement router support**

Add:

- `agentCycleTraces?: AgentCycleTraceApiService<unknown>` to `TownHttpApiServices`;
- route injection into `routeSimulationRequest`;
- `agent-cycle-traces` collection and lookup matching in `matchSimulationRoute`;
- `createAgentCycleTraceLookupRequest`;
- `createAgentCycleTraceQueryRequest`.

Use `optionalQueryNumber` for `fromCycleStartedAt` and `toCycleStartedAt`, and
`optionalQueryInteger(..., { min: 1 })` for `limit`.

## Task 3: Verification And Commit

**Files:**

- Modify: this plan file.

- [x] **Step 6: Run focused checks**

Run:

```bash
pnpm --filter @aivilization/api test -- agentCycleTraceApi.test.ts httpApi.test.ts
pnpm --filter @aivilization/api typecheck
```

Observed:

- `pnpm --filter @aivilization/api test -- agentCycleTraceApi.test.ts httpApi.test.ts`: PASS.
- `pnpm --filter @aivilization/api typecheck`: PASS.

- [x] **Step 7: Run full verification**

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

Observed:

- `pnpm lint`: PASS.
- `pnpm typecheck`: PASS across 13 workspace projects.
- `pnpm test`: PASS, 140 test files and 683 tests.
- `pnpm build`: PASS across 13 workspace projects.
- `git diff --check`: PASS.

- [x] **Step 8: Inspect diff**

Confirm changes are limited to API trace service/routing/tests and this slice's docs.

- [x] **Step 9: Commit**

Commit with:

```bash
git add docs/superpowers/specs/2026-06-25-agent-cycle-trace-api-design.md docs/superpowers/plans/2026-06-25-agent-cycle-trace-api-slice.md apps/api/src/agentCycleTraceApi.ts apps/api/src/agentCycleTraceApi.test.ts apps/api/src/httpApi.ts apps/api/src/httpApi.test.ts apps/api/src/index.ts
git commit -m "feat: expose agent cycle trace api"
```
