# Reactive Correction Sequential Simulation

## Goal

Align the agent-cycle Action Simulator with the paper's counterfactual sequence-validation semantics when reactive correction is enabled.

## Diagnosis

The deterministic cycle path simulates candidate actions in array order, and the worker dry-run simulator can roll accepted events into later counterfactual actions through its closure state. The reactive-correction path currently uses `Promise.all(candidateActions.map(...))`. When a rejected action needs an async reactive correction, later actions can be simulated before the corrected action is revalidated, which weakens sequence-level validation.

## Plan

1. Add a failing runtime test where action 1 is repaired asynchronously into a state-changing action and action 2 must observe that repaired state.
2. Replace the reactive-correction candidate simulation fan-out with an explicit sequential loop.
3. Verify focused tests, then run the repo validation set.
4. Commit this stage with a paper-aligned Conventional Commit message.

## Non-Goals

- Do not change world command semantics.
- Do not alter deterministic fallback scoring or LLM prompt content in this stage.
- Do not introduce a new simulator abstraction unless the test exposes a broader interface gap.
