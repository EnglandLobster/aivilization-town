# Action Synthesis Trace Design

## Purpose

Persist the runtime action synthesis decision in every agent cycle trace. The planner can now rank
and reject micro-planner proposals before simulation, but the observability record still only shows
the accepted candidate action descriptions. That means a replay or debugging UI cannot explain
which proposals were dropped by global budgets, nor why.

This slice makes action synthesis auditable without changing world command handling or simulator
validation.

## Current Gap

`runAgentPlanningCycle` returns `actionSynthesisResult`, including accepted and rejected action
proposals. `runWorkerAgentCycle` discards that structured result while creating `AgentCycleTrace`.
The trace stores:

```ts
readonly candidateActions: readonly string[];
```

Those strings are useful for quick scanning, but they cannot distinguish:

- proposals that were never accepted by global synthesis;
- accepted proposals that were later repaired by simulation;
- rejected proposals and their budget reasons;
- proposal priorities or resource estimates used by synthesis.

## Design Goals

- Keep action synthesis owned by `@aivilization/agent-runtime`.
- Keep trace schema owned by `@aivilization/observability`.
- Let worker map runtime decisions into serializable trace data without recomputing rankings.
- Preserve `candidateActions` as a compact accepted-action summary for existing readers.
- Add structured action synthesis evidence for accepted and rejected proposals.
- Expose optional `actionSynthesis` policy at `runWorkerAgentCycle` so worker-level orchestration can
  actually supply budgets to runtime.

## Proposed Trace Shape

Add serializable action trace types:

```ts
export type AgentCycleActionResourceEstimateTrace = {
  readonly actionSeconds?: number;
  readonly energyCost?: number;
  readonly satietyCost?: number;
  readonly currencyCost?: number;
  readonly inventoryCosts?: Readonly<Record<string, number>>;
};

export type AgentCycleActionProposalTrace = {
  readonly id: string;
  readonly description: string;
  readonly commandType: string;
  readonly priority?: number;
  readonly resourceEstimate?: AgentCycleActionResourceEstimateTrace;
};

export type AgentCycleActionSynthesisTrace = {
  readonly acceptedActions: readonly AgentCycleActionProposalTrace[];
  readonly rejectedActions: readonly {
    readonly action: AgentCycleActionProposalTrace;
    readonly reason: string;
  }[];
};
```

Then add:

```ts
readonly actionSynthesis: AgentCycleActionSynthesisTrace;
```

to `AgentCycleTrace`.

Payloads remain intentionally excluded from the trace action proposal shape. Command payloads can
grow large or include domain-specific details; trace synthesis only needs stable ids, descriptions,
command type, priorities, estimates, and rejection reasons. The existing command draft/event traces
remain the authority for emitted command payloads.

## Data Flow

```text
runWorkerAgentCycle(input.actionSynthesis)
  -> runAgentPlanningCycle({ actionSynthesis: input.actionSynthesis })
  -> cycleResult.actionSynthesisResult
  -> createAgentCycleTrace({ actionSynthesis: mapActionSynthesisTrace(...) })
  -> AgentCycleTraceRepository.record(trace)
```

`candidateActions` continues to be derived from `cycleResult.candidateActions.map(description)` and
therefore represents accepted synthesized candidates only.

## Failure Model

- `createAgentCycleTrace` rejects traces with zero `actionSynthesis.acceptedActions`.
- Rejected actions may be empty when no budget rejects anything.
- Resource estimates are copied defensively by repositories to prevent caller mutation.
- Worker policy input is optional; omitting it preserves current accept-all behavior.
- The trace mapper does not inspect command payloads.

## Test Strategy

- Observability tests prove `createAgentCycleTrace` preserves accepted and rejected synthesis
  evidence.
- Repository tests mutate returned synthesis evidence and prove stored traces are cloned.
- Worker tests pass an `actionSynthesis` policy, assert only accepted actions are simulated and
  dispatched, and assert rejected proposals appear in the trace.
- Full verification remains `pnpm check` and `pnpm build`.

## Future Extensions

- Add synthesis evidence panels to the web debug view.
- Add canonical worker budget factories that derive `actionSynthesis` from physiology, inventory,
  balance, world time, and active objective urgency.
- Add payload redaction hooks if future traces need safe payload excerpts.
