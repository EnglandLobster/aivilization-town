# Local Runtime Agent Cycle Trace API Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire persisted local runtime agent cycle traces into the running local HTTP gateway.

**Architecture:** `apps/server` composes the already-existing `AgentCycleTraceApiService` with each partition backend's `agentCycleTraceRepository`. `apps/api` keeps request parsing and `@aivilization/observability` keeps durable trace storage.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, `@aivilization/api`, `@aivilization/observability`, `apps/server`, `apps/worker`.

---

## Scope

- Add `agentCycleTracesApi` to `LocalRuntimeTownApi`.
- Create the service in `createLocalRuntimeTownApi`.
- Inject the service into `createTownHttpApiHandler`.
- Add an integration test that records a trace into real local storage and reads it through HTTP.

## Task 1: Server Integration Red Test

**Files:**

- Modify: `apps/server/src/localRuntimeTownServer.test.ts`

- [x] **Step 1: Write failing gateway test**

Extend the local HTTP gateway integration test with:

```ts
await runtime.host.registry
  .getBackend({ simulationId: 'sim-1', partitionKey: 'world-main' })
  .storage.agentCycleTraceRepository.record(createAgentCycleTrace({
    traceId: 'cycle-trace-agent-1-350',
    simulationId: 'sim-1',
    agentId: 'agent-1',
    cycleStartedAt: 350,
    selectedBranch: 'recovery',
    simulatorResult: { status: 'repaired', reason: 'buy Apple before eating' },
    simulatorEvents: [
      {
        actionId: 'eat-apple-1',
        attempt: 'original',
        status: 'rejected',
        reason: 'insufficient Apple',
        events: [
          { type: 'ActionRejected', sequence: 10, summary: 'insufficient Apple' },
        ],
      },
      {
        actionId: 'buy-apple-1',
        attempt: 'repair',
        status: 'accepted',
        events: [
          { type: 'TradeExecuted', sequence: 11, summary: 'buy Apple 1' },
        ],
      },
    ],
    // include the required trace fields shown in the test fixture
  }));
```

Then assert:

- `GET /simulations/sim-1/partitions/world-main/agent-cycle-traces?agentId=agent-1&limit=1`
  returns the trace.
- `GET /simulations/sim-1/partitions/world-main/agent-cycle-traces/cycle-trace-agent-1-350`
  returns nested `simulatorEvents`.

Run:

```bash
pnpm --filter @aivilization/server test -- localRuntimeTownServer.test.ts
```

Expected: FAIL because the local server does not inject `agentCycleTraces`.

Observed: FAIL, the HTTP gateway returned `404` for `/agent-cycle-traces`.

## Task 2: Server Wiring

**Files:**

- Modify: `apps/server/src/localRuntimeTownServer.ts`

- [x] **Step 2: Create and expose the API service**

Import `createAgentCycleTraceApiService` from `@aivilization/api`.

Create:

```ts
const agentCycleTracesApi = createAgentCycleTraceApiService({
  traces: {
    getTrace: async (request) =>
      host.registry
        .getBackend({
          simulationId: request.simulationId,
          partitionKey: request.partitionKey,
        })
        .storage.agentCycleTraceRepository.get(request.traceId),
    queryTraces: async (request) =>
      host.registry
        .getBackend({
          simulationId: request.simulationId,
          partitionKey: request.partitionKey,
        })
        .storage.agentCycleTraceRepository.query(request),
  },
});
```

Add `agentCycleTracesApi` to `LocalRuntimeTownApi` and inject it into `createTownHttpApiHandler`.

- [x] **Step 3: Run focused checks**

Run:

```bash
pnpm --filter @aivilization/server test -- localRuntimeTownServer.test.ts
pnpm --filter @aivilization/server typecheck
```

Observed:

- `pnpm --filter @aivilization/server test -- localRuntimeTownServer.test.ts`: PASS, 13 test files and 46 tests.
- `pnpm --filter @aivilization/server typecheck`: PASS.

## Task 3: Verification And Commit

**Files:**

- Modify: this plan file.

- [x] **Step 4: Run full verification**

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

- [x] **Step 5: Inspect diff**

Confirm changes are limited to local server API wiring, its integration test, and this slice's docs.

- [x] **Step 6: Commit**

Commit with:

```bash
git add docs/superpowers/specs/2026-06-25-local-runtime-agent-cycle-trace-api-wiring-design.md docs/superpowers/plans/2026-06-25-local-runtime-agent-cycle-trace-api-wiring-slice.md apps/server/src/localRuntimeTownServer.ts apps/server/src/localRuntimeTownServer.test.ts
git commit -m "feat: wire local runtime agent cycle trace api"
```
