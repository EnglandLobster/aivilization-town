# Durable Agent Cycle Traces Design

## Purpose

Persist `AgentCycleTrace` records behind an observability-owned repository contract. The action loop
now records selected-subtask evidence, simulator results, replanning decisions, emitted command ids,
and memory evidence, but those traces only live in return values or optional in-process sinks.

This slice makes traces restart-safe for local runtimes and creates the adapter boundary needed for
Postgres, ClickHouse, object storage, or experiment analysis stores later.

## Current Gap

`runWorkerAgentCycle` and `runWorkerSimulationTick` can emit traces to a `WorkerAgentCycleTraceSink`.
The local runtime storage creates file-backed repositories for events, snapshots, memory, plans, and
plan progress, but does not provide a durable trace repository. A local restart can recover world
state and memory, but not the agent-cycle audit trail.

## Design Goals

- Keep observability state out of `agent-runtime` and world packages.
- Make trace persistence idempotent by `traceId` so worker retries do not duplicate records.
- Preserve immutable trace records at repository boundaries through cloning.
- Support small but useful queries: get by trace id, query by simulation, optional agent, optional
  time window, and optional latest-record limit.
- Use JSONL for the local adapter to match existing file-backed repository patterns.
- Expose the file-backed repository through local runtime storage so it can be passed as
  `traceSink`.

## Proposed Architecture

Add `packages/observability/src/agentCycleTraceRepository.ts`:

- `AgentCycleTraceQuery`
- `AgentCycleTraceRepository`
- `InMemoryAgentCycleTraceRepository`
- `FileAgentCycleTraceRepository`

The repository contract uses `record(trace)` rather than `append(trace)`. The method is idempotent:
if the same `traceId` already exists, the repository keeps the first durable record. This matches
worker retry semantics better than an append-only duplicate log.

`query` returns traces sorted by descending `cycleStartedAt`, then descending `traceId`. `limit`
applies after filtering and sorting, which makes the default query useful for dashboard and recent
debug views.

Local runtime storage adds:

- `observabilityDir` under each simulation partition.
- `agentCycleTraceRepository` as a top-level storage field.

Callers can pass `traceSink: storage.agentCycleTraceRepository` into worker tick entrypoints because
the repository exposes the same `record(trace)` method required by `WorkerAgentCycleTraceSink`.

## Data Flow

```text
runWorkerAgentCycle
  -> createAgentCycleTrace(...)
  -> traceSink.record(trace)
  -> FileAgentCycleTraceRepository.record(trace)
  -> observability/agent-cycle-traces.jsonl
```

On restart:

```text
createLocalWorldRuntimeStorage(...)
  -> FileAgentCycleTraceRepository
  -> query({ simulationId, agentId?, limit? })
```

## Failure Model

- Empty `rootDir` is rejected when constructing a file repository.
- Duplicate `traceId` records are ignored, preserving first-write idempotency.
- Query with `limit <= 0` throws, matching existing repository validation style.
- Missing trace files behave as empty repositories.
- Malformed JSONL remains a hard failure; local storage should not silently hide corrupt audit logs.

## Test Strategy

- Observability repository tests cover in-memory cloning, idempotent record behavior, filtering, time
  windows, latest-first ordering, and file persistence across repository instances.
- Local runtime storage tests verify it exposes `observabilityDir`, creates a file-backed trace
  repository, and persists worker tick traces when used as `traceSink`.
- Existing worker tests continue to exercise the trace content itself.

## Future Extensions

- Dedicated trace projection tables for UI filtering.
- Candidate-score trace records for experiment analysis.
- Batch trace export for offline replay comparisons.
- Storage adapters with retention, compression, and partition-aware trace sharding.
