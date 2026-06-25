# Failed Subtask Replan Attribution Design

## Purpose

Multi-subtask Global Synthesis can now execute actions from multiple producer subtasks and update
completed progress for each producer. Failure handling still has a gap: when one synthesized action
needs a full replan, the cycle blocks the top selected subtask even if the failed action came from a
different branch.

This slice makes full-replan progress blocking follow failed action provenance. The goal is to keep
the branch plan's blocked state aligned with the subtask whose action failed during pre-execution
simulation.

## Current Gap

The current flow is:

```text
accepted actions from multiple producer subtasks
  -> simulator rejects one action
  -> replanningDecision becomes full-replan
  -> progress blocks top selected subtask
```

For example, if `income/work` is top selected but `development/study` fails due to low energy, the
runtime currently blocks `work`. That is structurally wrong: subsequent prioritization may suppress
the healthy branch and keep retrying the failed one.

## Design Goals

- Keep `ReplanningDecision` as the global cycle-level decision for compatibility.
- Reuse action `synthesisContext` as the producer-subtask source of truth.
- Make progress blocking deterministic and immutable.
- Preserve selected-subtask fallback for major context shifts and legacy actions without synthesis
  context.
- Avoid broadening this slice into branch-level strategic replan policy.

## Proposed Architecture

`cycle.ts` already owns both simulation results and the selected synthesis subtask map, so it should
own progress attribution for full-replan outcomes.

When `replanningDecision.kind === 'full-replan'`:

1. Extract all `needs-replan` simulation results.
2. Resolve each failed action's producer subtask from `synthesisContext.branchId/subtaskId`.
3. Deduplicate producer subtasks by `branchId/subtaskId`.
4. Mark each failed producer subtask blocked with the existing full-replan reason.
5. If there are no failed action producers, fall back to the existing selected-subtask blocking
   behavior.

`replanning.ts` remains the pure decision module. The existing `applyReplanningDecisionToProgress`
function remains available for single-subtask callers and fallback behavior, but multi-subtask
blocking is orchestrated in `cycle.ts`.

## Data Flow

```text
simulationResults
  -> needs-replan results
  -> failed action producer subtasks
  -> full-replan progress block updates
```

## Failure Model

- `memory-guided-correction` still does not update progress.
- `kind: none` still completes producer subtasks as implemented in the previous slice.
- `full-replan` caused by repeated simulator failure blocks the failed producer subtasks.
- `full-replan` caused by a major context shift with no failed action falls back to selected-subtask
  blocking.
- A failed action without synthesis context falls back to the selected subtask.

## Test Strategy

- Add a runtime cycle test where the top selected `work` action succeeds, the second `study` action
  fails, and progress blocks `study`, not `work`.
- Add a worker integration test proving repository-backed progress persists a blocked failed
  producer subtask from a multi-subtask cycle.
- Run focused runtime and worker tests, focused typechecks, then full lint/typecheck/test/build and
  `git diff --check`.
