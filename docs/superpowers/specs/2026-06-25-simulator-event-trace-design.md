# Simulator Event Trace Design

## Purpose

The canonical dry-run simulator now validates action sequences against a counterfactual projection,
but the agent-cycle trace still records only the final simulator status. For a large AI town
backend, that is too opaque: a branch-level planner, experiment report, or production diagnosis
needs to see which counterfactual world facts the Action Simulator observed before allowing or
rejecting a candidate action.

This slice adds a domain-agnostic simulator event trace. `agent-runtime` carries small event
summaries returned by simulators, `apps/worker` maps them into `AgentCycleTrace`, and
`@aivilization/observability` persists them defensively.

## Design Goals

- Keep `agent-runtime` independent from world event types.
- Preserve the existing `ActionSimulationResult` and `AgentCycleTrace` status surfaces.
- Trace both accepted and rejected dry-run attempts.
- Preserve repair attempt visibility by distinguishing `original` and `repair` attempts.
- Keep traces compact: record event type, sequence, and a short summary rather than full payloads.
- Preserve legacy trace readability by normalizing missing simulator event traces to an empty list.

## Proposed Architecture

Add a generic runtime trace event:

```ts
export type ActionSimulationTraceEvent = {
  readonly type: string;
  readonly sequence?: number;
  readonly summary?: string;
};
```

`ActionSimulationResult` may include `traceEvents`. `simulateActionWithRepair` carries those events
into accepted, repaired, and needs-replan results. Repaired results retain separate
`originalTraceEvents` and `repairedTraceEvents`.

Add observability trace types:

```ts
export type AgentCycleSimulatorEventTrace = {
  readonly actionId: string;
  readonly attempt: 'original' | 'repair';
  readonly status: 'accepted' | 'rejected';
  readonly reason?: string;
  readonly events: readonly AgentCycleSimulatorTraceEvent[];
};
```

`runWorkerAgentCycle` maps `cycleResult.simulationResults` into `AgentCycleTrace.simulatorEvents`.
The canonical world dry-run simulator converts each emitted `WorldEvent` into a compact
`ActionSimulationTraceEvent`.

## Data Flow

```text
world dry-run dispatch
  -> WorldEvent[]
  -> compact ActionSimulationTraceEvent[]
  -> ActionSimulationResult.traceEvents
  -> ActionWithRepairResult trace fields
  -> Worker AgentCycleTrace.simulatorEvents
  -> trace repository / validation reports / future debugger
```

## Failure Model

- A rejected dry-run includes the `ActionRejected` trace event and the rejection reason.
- A simulator exception remains a rejected simulation result and may have no events.
- Missing simulator event traces in old JSONL files normalize to `[]`.
- Full event payloads remain outside this trace to avoid growing trace size and coupling
  observability DTOs to world internals.

## Test Strategy

- Runtime test: `simulateActionWithRepair` preserves trace events on rejected original and repaired
  attempts.
- Worker dry-run test: `createWorldCommandDryRunSimulator` returns compact event summaries for an
  accepted `AgentEat`.
- Worker cycle test: `runWorkerAgentCycle` maps simulator event summaries into the persisted trace.
- Observability repository test: simulator events are cloned defensively and legacy traces normalize
  missing `simulatorEvents` to `[]`.
- Run focused tests, focused typechecks, then full lint/typecheck/test/build and `git diff --check`.
