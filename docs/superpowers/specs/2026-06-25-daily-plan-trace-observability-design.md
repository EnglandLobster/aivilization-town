# Daily Plan Trace Observability Design

## Goal

Persist every runtime daily-plan renewal as a durable, queryable trace so LLM daily planning can be
debugged, compared, and cost-audited during headless profile runs.

## Context

Daily planning now has the core runtime path:

- `packages/agent-runtime` can compile deterministic or traceable LLM daily plans.
- `apps/worker/src/dailyRoutineSchedule.ts` renews scheduled intentions from a `DailyPlanCompiler`.
- `apps/server/src/localRuntimeTownProfileRunner.ts` wires profile config into worker daily plan
  renewal.

The missing piece is observability. `planningTrace` is returned from the renewal call, but runtime
hosts do not persist it. That means LLM provider failures, fallback behavior, token usage, and
selected daily agenda items are invisible after a profile run finishes.

## Architecture

Follow the existing trace pattern:

- `packages/observability` owns trace types, validation, clone semantics, in-memory repository, and
  file-backed JSONL repository.
- `apps/api` owns lookup/query request normalization and HTTP routing.
- `apps/worker` owns runtime storage and records traces at the daily renewal boundary.
- `apps/server` exposes the repository through the local runtime town API and verifies profile-run
  persistence.

The worker remains provider-agnostic. It records only normalized daily-plan renewal output and
evidence IDs; it does not know whether the compiler was deterministic, scripted, or
OpenAI-compatible.

## Trace Shape

`DailyPlanRenewalTrace` should contain:

- `traceId`: stable idempotency key, scoped by simulation, partition, agent, daily plan id, and
  issued time.
- `simulationId`, `partitionKey`, `agentId`.
- `dailyPlanId`, `scheduledIntentionIds`.
- `shortTermMemoryContextIds`, `profileEntryKeys`, `profileEvidenceRecordIds`.
- Optional `planningTrace` copied from the daily plan compiler output.
- `issuedAt`.

The trace should not persist full prompt text or secrets. Future richer planner artifacts can add a
separate redacted prompt/candidate store if needed.

## Data Flow

```text
DailyPlanCompiler
  -> renewDailyPlanScheduledIntentions
  -> DailyPlanRenewalResult
  -> DailyPlanRenewalTraceSink.record(...)
  -> FileDailyPlanRenewalTraceRepository
  -> LocalRuntimeTown API
  -> HTTP GET /simulations/:id/partitions/:partition/daily-plan-renewal-traces
```

## Error Handling

Repository writes are idempotent by `traceId`. Invalid traces fail close to the record call. Query
inputs are normalized at the API edge and validated again in the repository.

## Testing

- Observability repository tests cover idempotent writes, query filters, clone behavior, validation,
  and file persistence.
- API service tests cover normalization and invalid input rejection.
- HTTP tests cover query and lookup routes.
- Worker tests prove daily plan renewal records a trace when a trace sink is supplied.
- Profile runner tests prove file-backed daily plan traces survive a runtime run.

## Out Of Scope

- Full prompt/response archival.
- Planner quality scoring.
- Godot/UI trace views.
