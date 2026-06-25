# Agent Cycle Trace API Design

## Purpose

AIvilization's paper emphasizes a closed feedback loop between memory, planning, simulation,
execution, and learning. The backend now records durable agent cycle traces, including
counterfactual simulator events, but those traces are not yet available through the simulation API
surface. That makes planner debugging, future Godot inspection tools, and experiment replay
dependent on direct repository access.

This slice adds a read-only Agent Cycle Trace API. It exposes compact per-cycle cognition and
simulator evidence without moving observability storage into the API package.

## Design Goals

- Keep `apps/api` as a thin transport and request-normalization layer.
- Keep durable trace storage in `@aivilization/observability`.
- Query traces by simulation, partition, agent, cycle time window, and limit.
- Lookup a single trace by id.
- Preserve nested `simulatorEvents` in API results so rejected and repaired actions are
  externally explainable.
- Follow existing optional trace API patterns for objective renewal and steering traces.

## API Shape

Add a generic service in `apps/api/src/agentCycleTraceApi.ts`:

```ts
export type AgentCycleTraceLookupRequest = {
  readonly simulationId: string;
  readonly partitionKey: string;
  readonly traceId: string;
};

export type AgentCycleTraceQueryRequest = {
  readonly simulationId: string;
  readonly partitionKey: string;
  readonly traceId?: string;
  readonly agentId?: string;
  readonly fromCycleStartedAt?: number;
  readonly toCycleStartedAt?: number;
  readonly limit?: number;
};
```

The service delegates to an injected query port:

```ts
export type AgentCycleTraceQueryPort<TTrace> = {
  readonly getTrace: (request: AgentCycleTraceLookupRequest) => MaybePromise<TTrace | undefined>;
  readonly queryTraces: (request: AgentCycleTraceQueryRequest) => MaybePromise<readonly TTrace[]>;
};
```

HTTP routes:

- `GET /simulations/:simulationId/partitions/:partitionKey/agent-cycle-traces`
- `GET /simulations/:simulationId/partitions/:partitionKey/agent-cycle-traces/:traceId`

The route is optional: if the service is not injected, the HTTP layer returns the existing
`404 route not found` response.

## Data Flow

```text
worker records AgentCycleTrace
  -> AgentCycleTraceRepository
  -> AgentCycleTraceApiService normalizes lookup/query requests
  -> Town HTTP router maps simulation route params and query strings
  -> external debugger / Godot / experiment tooling reads planner and simulator evidence
```

## Failure Model

- Empty simulation, partition, trace, or agent ids fail before delegation.
- Non-finite time filters fail before delegation.
- Non-positive limits fail before delegation.
- HTTP query parsing returns `400 bad_request` for invalid numeric filters.
- Missing optional service returns `404 not_found`, matching other optional trace routes.

## Test Strategy

- Service tests prove lookup/query normalization and invalid input rejection.
- HTTP router tests prove list and lookup routes delegate correctly and preserve nested
  `simulatorEvents`.
- HTTP router tests prove invalid limit returns `400`.
- Focused API test/typecheck before full repo verification.
