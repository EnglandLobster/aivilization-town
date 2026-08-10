# Local Runtime Agent Cycle Trace API Wiring Design

## Purpose

The previous slice added a generic Agent Cycle Trace API to `apps/api`, but the local runtime HTTP
gateway still does not inject a real trace source. This leaves planner and simulator traces visible
only through direct repository access, which is not enough for a server-authoritative game backend or
future Godot debugging tools.

This slice wires the existing `agentCycleTraceRepository` from each local runtime partition into the
HTTP API composition layer.

## Design Goals

- Keep trace persistence owned by `@aivilization/observability`.
- Keep HTTP request parsing owned by `@aivilization/api`.
- Keep `apps/server` as composition glue between runtime backends and API ports.
- Support both trace list and single trace lookup through the running local HTTP gateway.
- Preserve nested simulator events and replanning evidence in the returned trace body.
- Avoid adding any new domain behavior, storage format, or duplicated query logic.

## Architecture

`createLocalRuntimeTownApi` already creates optional API services for agent profiles, objective
renewal traces, and steering traces by resolving the partition backend from
`host.registry.getBackend({ simulationId, partitionKey })`.

Agent cycle traces should use the same pattern:

```text
HTTP request
  -> Town HTTP router
  -> AgentCycleTraceApiService
  -> host.registry.getBackend(...)
  -> backend.storage.agentCycleTraceRepository
```

The server API object should expose `agentCycleTracesApi` for tests and future composition code.

## Data Flow

```text
worker agent cycle
  -> localRuntimeStep traceSink
  -> FileAgentCycleTraceRepository
  -> createAgentCycleTraceApiService query port
  -> GET /simulations/:simulationId/partitions/:partitionKey/agent-cycle-traces
```

## Failure Model

- Invalid query parameters remain handled by `apps/api`.
- Unknown simulation or partition ids keep using the existing backend registry error behavior.
- A missing trace id returns `undefined` from the repository and is serialized as `undefined` by the
  existing handler behavior.
- This slice does not create new trace records; it only exposes records already persisted by worker
  cycles or tests.

## Test Strategy

- Add an integration test to `apps/server/src/localRuntimeTownServer.test.ts`.
- Record an `AgentCycleTrace` into a real partition `agentCycleTraceRepository`.
- Fetch the collection route and verify filtering by `agentId` and `limit`.
- Fetch the lookup route and verify `simulatorEvents`, selected branch, and simulator status are
  preserved.
- Run focused server tests/typecheck, then full lint/typecheck/test/build and `git diff --check`.
