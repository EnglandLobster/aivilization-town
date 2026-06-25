# Subtask Replanning Trace Design

## Purpose

The runtime can now attribute successful progress and full-replan blocking to the producer subtask
of each synthesized action. The remaining observability gap is that `AgentCycleResult` and
`AgentCycleTrace` still expose only one global `replanningDecision`. A branch-level planner or
debugging tool cannot see which active branch had no replan need and which branch failed.

This slice adds per-producer-subtask replanning decisions as an additive trace surface. It does not
replace the existing global decision; it makes the branch-level facts explicit so later strategic
replanning can consume them safely.

## Current Gap

Today a cycle with `work` and `study` actions can produce:

```text
work action -> accepted
study action -> needs-replan
global replanningDecision -> full-replan
```

That global decision is correct enough for backward compatibility, but it hides that `work` did not
need replanning. The information is available inside `cycle.ts` because simulation results are
already grouped by producer subtask for completion/progress attribution.

## Design Goals

- Preserve `replanningDecision` as the existing cycle-level decision.
- Add `subtaskReplanningDecisions` to `AgentCycleResult`.
- Add `subtaskReplanningDecisions` to `AgentCycleTrace`.
- Keep the decision type identical to existing `ReplanningDecision` / `ReplanningTraceDecision`.
- Reuse producer grouping by action synthesis context.
- Keep repository cloning defensive for nested decision arrays.

## Proposed Architecture

Add runtime type:

```ts
export type AgentCycleSubtaskReplanningDecision = {
  readonly selectedSubtask: PrioritizedSubtask;
  readonly decision: ReplanningDecision;
};
```

`cycle.ts` computes this list by grouping simulation results by producer subtask and calling
`decideAdaptiveReplanning` for each group with the same memory context and replanning policy used
by the global decision. The global `replanningDecision` remains unchanged.

Add observability type:

```ts
export type AgentCycleSubtaskReplanningDecisionTrace = {
  readonly branchId: string;
  readonly subtaskId: string;
  readonly decision: ReplanningTraceDecision;
};
```

`runWorkerAgentCycle` maps runtime subtask decisions into trace records. Trace repositories clone
the nested decisions just like the global decision to avoid caller mutation.

## Data Flow

```text
simulation results
  -> group by producer subtask
  -> per-subtask decideAdaptiveReplanning(...)
  -> AgentCycleResult.subtaskReplanningDecisions
  -> AgentCycleTrace.subtaskReplanningDecisions
  -> trace repository / validation reports / future strategic replanner
```

## Failure Model

- A producer group with no failed actions records `{ kind: 'none' }`.
- A producer group with simulator failures records `memory-guided-correction` or `full-replan`
  based on the existing threshold and memory evidence logic.
- Major context shifts still appear in every producer group's decision because they are global
  environmental invalidations.
- Legacy actions without synthesis context fall back to the top selected subtask group.

## Test Strategy

- Add a runtime test proving accepted `work` and failed `study` actions yield separate subtask
  replan decisions: `work -> none`, `study -> full-replan`.
- Add an observability trace/repository test proving nested subtask decisions are captured and
  cloned defensively.
- Add a worker test proving `runWorkerAgentCycle` maps runtime subtask decisions into traces.
- Run focused runtime, observability, and worker tests, focused typechecks, then full
  lint/typecheck/test/build and `git diff --check`.
