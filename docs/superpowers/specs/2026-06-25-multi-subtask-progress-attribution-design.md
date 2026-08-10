# Multi-Subtask Progress Attribution Design

## Purpose

The runtime can now collect actions from multiple prioritized subtasks before Global Synthesis, but
cycle completion still treats the selected top subtask as the only progress owner. That creates an
architectural mismatch: execution can interleave active branches, while plan progress still advances
only one branch.

This slice makes progress updates follow the action provenance already attached during synthesis.
Accepted or repaired actions can complete the subtask that produced them, so the persistent branch
plan state remains aligned with multi-branch execution.

## Current Gap

`runAgentPlanningCycle` currently resolves a producer subtask for simulation and repair, but
`finalizeAgentCycleResult` then runs one completion decision over all simulation results:

```text
accepted actions from N subtasks
  -> simulation uses per-action producer subtask
  -> completion/progress still uses top selected subtask only
```

If a cycle accepts `income/work` and `development/study`, only `work` can be marked completed. A
later prioritization pass may keep selecting `study` even though its action already executed.

## Design Goals

- Keep `planProgress.ts` as a small immutable state-update module.
- Keep `replanning.ts` responsible for the existing single-subtask failure escalation semantics.
- Put multi-action attribution in `cycle.ts`, where action synthesis context and simulator results
  are both available.
- Preserve `AgentCycleResult.selectedSubtask` and `subtaskCompletionDecision` for compatibility.
- Add explicit per-subtask completion decisions for observability and future trace extensions.
- Preserve existing default behavior for single-subtask cycles.

## Proposed Architecture

Add an additive result field:

```ts
export type AgentCycleSubtaskCompletionDecision = {
  readonly selectedSubtask: PrioritizedSubtask;
  readonly decision: SubtaskCompletionDecision;
};

export type AgentCycleResult = {
  readonly subtaskCompletionDecision: SubtaskCompletionDecision;
  readonly subtaskCompletionDecisions: readonly AgentCycleSubtaskCompletionDecision[];
};
```

`cycle.ts` will group simulation results by the action's producer subtask. The producer subtask is
resolved from `synthesisContext.branchId/subtaskId`, falling back to the top selected subtask when
context is absent or no selected synthesis candidate matches.

For each grouped subtask:

1. Pass only that subtask's simulation results to the existing `CycleSubtaskCompletionPolicy`.
2. If a group contains `needs-replan`, mark that group `in-progress`.
3. If the group is completed and the global replanning decision is `none`, mark that subtask
   completed in `BranchPlanProgress`.

Full replanning remains conservative in this slice: the existing selected-subtask blocking behavior
stays in place. Branch-specific failure propagation needs its own slice because it changes memory
evidence lookup and replan scope semantics.

## Data Flow

```text
top-N prioritized subtasks
  -> micro-planner proposals
  -> action synthesis attaches branch/subtask context
  -> simulator validates each accepted action
  -> group simulation results by producer subtask
  -> completion policy per group
  -> progress marks completed subtasks for completed groups
```

## Failure Model

- If an action has no synthesis context, its progress falls back to the top selected subtask.
- If a repaired action changes context, progress follows the repaired action because that is the
  action that was accepted by simulation.
- If any simulation result needs replanning, global `needsReplan` stays true and the existing
  `replanningDecision` determines whether the selected subtask is blocked.
- Subtask groups with `in-progress` completion decisions do not update progress.

## Test Strategy

- Add a runtime cycle test where `work` and `study` actions are both accepted in one cycle and
  progress records both subtasks as completed.
- Add a runtime cycle test where a completion policy keeps one producer subtask in progress while
  completing the other.
- Add a worker integration test proving repository-backed progress saves both completed subtasks
  after a multi-subtask cycle.
- Run focused runtime and worker tests, focused typechecks, then full lint/typecheck/test/build and
  `git diff --check`.
