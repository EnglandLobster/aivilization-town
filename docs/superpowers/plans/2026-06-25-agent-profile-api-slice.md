# Agent Profile API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose per-agent long-term adaptive profiles through a backend API surface so social reflection, values, personality, habits, and social records become queryable runtime state for future Godot/UI and planner inspection.

**Architecture:** Keep long-term profile storage in `packages/memory`, add an API-facing query contract in `apps/api`, and implement local adapters in `apps/worker` next to the existing projection/event/validation ports. The server wires the registry-level profile query service into the HTTP router without letting clients access file repositories directly.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, existing local runtime storage, memory repositories, and HTTP API router.

---

### Task 1: API Contract And Router

**Files:**

- Create: `apps/api/src/agentProfileApi.test.ts`
- Create: `apps/api/src/agentProfileApi.ts`
- Modify: `apps/api/src/httpApi.test.ts`
- Modify: `apps/api/src/httpApi.ts`
- Modify: `apps/api/src/index.ts`

- [x] **Step 1: Write failing API service and router tests**

Add `agentProfileApi.test.ts` for:

- `createAgentProfileApiService().getAgentProfile()` normalizes non-empty `simulationId`, `partitionKey`, and `agentId`;
- `queryAgentProfiles()` normalizes optional `agentId` and positive integer `limit`;
- empty ids and invalid limits throw before calling the port.

Extend `httpApi.test.ts` with:

- `GET /simulations/sim-1/partitions/world-main/agent-profiles?limit=2`;
- `GET /simulations/sim-1/partitions/world-main/agent-profiles/agent-1`;
- expected call records containing decoded path parts and parsed query values.

- [x] **Step 2: Run API tests and verify RED**

Run:

```bash
pnpm --filter @aivilization/api test -- agentProfileApi.test.ts httpApi.test.ts
```

Expected: FAIL because the agent profile service and routes do not exist.

- [x] **Step 3: Implement API service and route parsing**

Add:

- `AgentProfileLookupRequest`
- `AgentProfileQueryRequest`
- `AgentProfileQueryPort<TProfile>`
- `AgentProfileApiService<TProfile>`
- `createAgentProfileApiService`

Route `agent-profiles` under the existing simulation partition path. Return JSON `200` for both list and lookup. If the optional profile service is not wired, return the same `404 not_found` shape used by optional runtime services.

- [x] **Step 4: Export and verify GREEN**

Run:

```bash
pnpm --filter @aivilization/api test -- agentProfileApi.test.ts httpApi.test.ts
pnpm --filter @aivilization/api typecheck
```

Expected: PASS.

### Task 2: Local Runtime Profile Query Adapter

**Files:**

- Modify: `apps/worker/src/localSimulationBackend.test.ts`
- Modify: `apps/worker/src/localSimulationBackend.ts`
- Modify: `apps/worker/src/localSimulationBackendRegistry.test.ts`
- Modify: `apps/worker/src/localSimulationBackendRegistry.ts`

- [x] **Step 1: Write failing worker adapter tests**

Add backend tests proving:

- querying profiles returns one profile per projected agent, sorted by `agentId`;
- `limit` bounds the returned list;
- lookup returns `undefined` for an unknown projected agent and does not create a new profile.

Add registry tests proving:

- profile queries are routed to the requested partition backend;
- mismatched simulation or partition requests fail through the registry lookup path.

- [x] **Step 2: Run worker tests and verify RED**

Run:

```bash
pnpm --filter @aivilization/worker test -- localSimulationBackend.test.ts localSimulationBackendRegistry.test.ts
```

Expected: FAIL because local profile query ports are not exposed.

- [x] **Step 3: Implement local query ports**

Add `LocalAgentProfileQueryResult` and `agentProfiles` to `LocalSimulationBackend`.

Implementation rules:

- hydrate the current projection to discover authoritative agent ids;
- only call `longTermProfileRepository.getOrCreate(agentId)` for ids present in projection;
- sort ids lexicographically before applying `limit`;
- use request `agentId` filtering for list queries when supplied;
- return `undefined` for lookup of non-projected agents.

Add registry-level fan-out that delegates to the partition backend.

- [x] **Step 4: Verify GREEN**

Run:

```bash
pnpm --filter @aivilization/worker test -- localSimulationBackend.test.ts localSimulationBackendRegistry.test.ts
pnpm --filter @aivilization/worker typecheck
```

Expected: PASS.

### Task 3: Server HTTP Gateway Wiring

**Files:**

- Modify: `apps/server/src/localRuntimeTownServer.test.ts`
- Modify: `apps/server/src/localRuntimeTownServer.ts`

- [x] **Step 1: Write failing server gateway test**

Extend the local HTTP gateway test to:

- apply a long-term profile patch for `agent-1`;
- fetch `/simulations/sim-1/partitions/world-main/agent-profiles/agent-1`;
- fetch `/simulations/sim-1/partitions/world-main/agent-profiles?limit=1`;
- assert returned values/personality/socialRecords are from the profile repository.

- [x] **Step 2: Run server test and verify RED**

Run:

```bash
pnpm --filter @aivilization/server test -- localRuntimeTownServer.test.ts
```

Expected: FAIL because the HTTP gateway does not wire agent profile queries yet.

- [x] **Step 3: Wire server handler**

Pass `host.registry.agentProfiles` into `createTownHttpApiHandler`. Expose `agentProfilesApi` on `LocalRuntimeTownApi` for direct runtime use and tests.

- [x] **Step 4: Verify GREEN**

Run:

```bash
pnpm --filter @aivilization/server test -- localRuntimeTownServer.test.ts
pnpm --filter @aivilization/server typecheck
```

Expected: PASS.

### Task 4: Verification And Commit

**Files:**

- Modify all files above.

- [x] **Step 1: Format touched files**

Run:

```bash
pnpm exec prettier --write docs/superpowers/plans/2026-06-25-agent-profile-api-slice.md apps/api/src/agentProfileApi.ts apps/api/src/agentProfileApi.test.ts apps/api/src/httpApi.ts apps/api/src/httpApi.test.ts apps/api/src/index.ts apps/worker/src/localSimulationBackend.ts apps/worker/src/localSimulationBackend.test.ts apps/worker/src/localSimulationBackendRegistry.ts apps/worker/src/localSimulationBackendRegistry.test.ts apps/server/src/localRuntimeTownServer.ts apps/server/src/localRuntimeTownServer.test.ts
```

- [x] **Step 2: Run focused and full verification**

Run:

```bash
pnpm --filter @aivilization/api test -- agentProfileApi.test.ts httpApi.test.ts
pnpm --filter @aivilization/worker test -- localSimulationBackend.test.ts localSimulationBackendRegistry.test.ts
pnpm --filter @aivilization/server test -- localRuntimeTownServer.test.ts
pnpm --filter @aivilization/api typecheck
pnpm --filter @aivilization/worker typecheck
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
git add docs/superpowers/plans/2026-06-25-agent-profile-api-slice.md apps/api/src/agentProfileApi.ts apps/api/src/agentProfileApi.test.ts apps/api/src/httpApi.ts apps/api/src/httpApi.test.ts apps/api/src/index.ts apps/worker/src/localSimulationBackend.ts apps/worker/src/localSimulationBackend.test.ts apps/worker/src/localSimulationBackendRegistry.ts apps/worker/src/localSimulationBackendRegistry.test.ts apps/server/src/localRuntimeTownServer.ts apps/server/src/localRuntimeTownServer.test.ts
git commit -m "feat: expose agent profile api"
```
