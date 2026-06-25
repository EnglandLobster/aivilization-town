# Steering Validation Metric Design

## Purpose

AIvilization v0 treats human steering as a first-class hybrid-autonomy mechanism, not as brittle
prompt override. The paper separates two pathways: long-horizon objectives should enter the
hierarchical planning stack, while temporary commands should use a lightweight route and propagate
through Short-Term Memory.

The current backend already records durable steering traces, but experiment validation does not yet
check whether a run exercised these pathways. This slice adds a validation metric that can answer:
did human steering enter durable backend state through plan records and memory-backed reactive
execution?

## Current Boundary

- `apps/api` submits long-horizon and reactive steering commands as command envelopes.
- `apps/worker` handles long-horizon objectives by updating intentions and optionally saving a
  branch plan record.
- `apps/worker` handles reactive commands by routing localized planning, simulator validation, and
  STM writes.
- `packages/observability` persists `SteeringTrace` rows, but `experimentValidation` currently
  ignores them.
- `apps/worker` local validation schedules can query durable market, profile, and social reflection
  evidence, but not steering traces.

## Design

Add a new `steering-memory-propagation` metric in
`packages/observability/src/experimentValidation.ts`. The metric consumes a narrow
`SteeringValidationTrace` DTO so validation remains independent from repository implementation
details.

The metric evaluates human steering quality at run level:

1. Human steering traces exist.
2. Steering traces cover a configurable share of expected validation agents.
3. Long-horizon steering traces are backed by objective and plan ids.
4. Reactive steering traces are backed by both command drafts and STM record ids.
5. The report records latest issued time and channel counts for diagnosis.

The metric returns `pass` when thresholds are met and `watch` otherwise. Invalid row shape still
throws before report emission because corrupt validation evidence should not be silently accepted.

## Worker Integration

`createWorkerExperimentValidationReport` accepts optional `steeringTraces` and forwards them into
observability. `runLocalExperimentValidationSchedule` adds an optional `steeringTraceSource` query.
When configured, it queries the current simulation and partition from
`storage.steeringTraceRepository`, maps durable trace rows into validation DTOs, and forwards the
bounded rows to the report.

## Non-Goals

- Do not change steering command semantics.
- Do not create new branch plans or STM records in validation.
- Do not add UI, Godot integration, or command submission endpoints.
- Do not judge semantic quality of human commands yet; this slice validates backend propagation.

## Verification

- Observability tests prove the metric passes for one long-horizon plan-backed trace and one
  STM-backed reactive trace, watches when steering traces are missing, and rejects invalid trace
  rows.
- Worker runner tests prove explicit steering validation traces flow into validation reports.
- Local schedule tests prove durable `SteeringTrace` rows can be queried into a validation report.
- Full `pnpm check` remains the final phase gate.
