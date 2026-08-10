# Profile Run Agent Cycle Diagnostics Design

## Purpose

AIvilization's paper validates the planner through long-horizon runs and ablations, but the current
runtime profile run report only records `totalAgentTraceCount`. It does not explain whether those
cycles were accepted, repaired, rejected, or replanned, nor whether the Action Simulator produced
useful event evidence. That makes profile reports less useful for planner debugging and future
Godot/ops inspection.

This slice adds compact agent-cycle diagnostics to `RuntimeProfileRunReport`.

## Design Goals

- Preserve full trace payloads in `AgentCycleTraceRepository`; keep profile reports compact.
- Summarize planner/simulator reliability using counts and ratios derived from existing traces.
- Make the summary durable through the existing runtime profile report repositories.
- Keep the summary independent of any UI or dashboard code.
- Avoid changing worker execution behavior.

## Report Shape

Add:

```ts
export type RuntimeProfileAgentCycleDiagnostics = {
  readonly traceCount: number;
  readonly acceptedSimulatorCount: number;
  readonly repairedSimulatorCount: number;
  readonly rejectedSimulatorCount: number;
  readonly replanningDecisionCount: number;
  readonly simulatorEventTraceCount: number;
  readonly simulatorEventCount: number;
  readonly commandEmittingCycleCount: number;
  readonly commandEmittingCycleRatio: number;
  readonly repairedSimulatorRatio: number;
  readonly rejectedSimulatorRatio: number;
  readonly replanningDecisionRatio: number;
};
```

Attach it to `RuntimeProfileRunReport` as `agentCycleDiagnostics`.

## Aggregation Rules

- `traceCount`: total number of agent cycle traces across all partitions.
- `acceptedSimulatorCount`, `repairedSimulatorCount`, `rejectedSimulatorCount`: counts by
  `trace.simulatorResult.status`.
- `replanningDecisionCount`: traces whose top-level `replanningDecision.kind !== 'none'`.
- `simulatorEventTraceCount`: total number of `trace.simulatorEvents` entries.
- `simulatorEventCount`: total nested event count across simulator event traces.
- `commandEmittingCycleCount`: traces with at least one emitted command.
- Ratio fields divide by `traceCount`, or return `0` when `traceCount === 0`.

## Data Flow

```text
partition agentCycleTraceRepository.query(...)
  -> aggregate RuntimeProfileAgentCycleDiagnostics
  -> createRuntimeProfileRunReport(...)
  -> profile run report repository / API / CLI
```

## Failure Model

- Report validation ensures counts are non-negative integers and ratios are finite numbers in
  `[0, 1]`.
- Existing reports without diagnostics are not a migration target in this slice; new reports must
  include diagnostics.
- Empty trace sets produce zero counts and zero ratios.

## Test Strategy

- Observability unit tests prove diagnostics are cloned and validated in in-memory/file repositories.
- Profile runner tests prove diagnostics are generated from real trace repositories.
- Focused observability/server tests and typechecks before full verification.
