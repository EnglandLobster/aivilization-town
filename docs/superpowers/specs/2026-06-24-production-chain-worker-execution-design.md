# Production Chain Worker Execution Design

## Purpose

Connect the pure production-chain planner to canonical worker execution without corrupting durable
branch-plan progress.

The previous slice added `planProductionChain`, which can expand a target commodity such as `Book`
into upstream steps like `Wood -> Book`. The worker can now use this to choose the next executable
production action. However, the existing agent-runtime progress rule marks a selected subtask
complete after any accepted action. For chain execution that would be wrong: producing `Wood` for a
`produce Book` subtask is progress, not completion.

## Source Requirement

The paper emphasizes multi-tier production chains, non-substitutable inputs, residential barriers,
and efficient chip production. A faithful town needs agents that can follow upstream recipe
dependencies across planning cycles while preserving long-horizon objective state.

## Architecture

Add an optional `CycleSubtaskCompletionPolicy` to `@aivilization/agent-runtime`.

Default behavior stays unchanged: if simulator validation succeeds and no re-planning is needed, a
progress-tracked subtask is completed.

Runtime bindings may override that default. The policy receives the selected subtask and simulation
results and returns either:

- `completed`
- `in-progress` with a reason

`applyReplanningDecisionToProgress` remains the single place that turns cycle decisions into
progress updates. It will only mark completion when re-planning is `none` and the completion
decision is `completed`.

## Worker Data Flow

```text
active production plan
  -> canonical production micro-planner calls planProductionChain
  -> proposal targets first chain step, e.g. Wood
  -> dry-run validates Wood
  -> command dispatch produces Wood
  -> production completion policy sees action != target Book
  -> no completed progress update
  -> next tick sees Wood in projection
  -> planner proposes Book
  -> completion policy sees action == target Book
  -> progress marks subtask completed
```

## Production Domain Behavior

For configured `production: { commodityName: 'Book' }`:

- if the agent lacks `Wood`, propose `AgentProduce(Wood)`;
- if the agent has `Wood`, propose `AgentProduce(Book)`;
- resource estimates describe the proposed next step, not the whole chain;
- if the chain planner rejects, fall back to the direct target proposal so the existing world dry-run
  and memory rejection path remains observable.

## Boundary Decisions

- Do not encode production completion in world events. World only knows commands and facts.
- Do not make branch-plan progress inspect inventory. Runtime owns completion semantics because it
  knows the selected subtask and proposed action.
- Do not add hidden multi-command execution in one cycle. Current dry-run validates each action
  against the tick projection, so multi-step chains must advance through projection updates.

## Test Strategy

- Agent-runtime unit test: a completion policy returning `in-progress` prevents a successful action
  from marking a progress-tracked subtask complete.
- Worker unit test: the completion policy is forwarded through `runWorkerAgentCycle`.
- Canonical active-plan integration: with target `Book` and empty inventory, first tick produces
  `Wood` and leaves progress open; second tick hydrates from events, produces `Book`, and completes
  the objective.
- Existing study progress tests prove default completion remains intact.
