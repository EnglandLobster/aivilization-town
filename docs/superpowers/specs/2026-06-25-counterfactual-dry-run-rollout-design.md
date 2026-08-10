# Counterfactual Dry-Run Rollout Design

## Purpose

AIvilization's Action Simulator is described as validating an action sequence by prospectively
evolving the agent's current state before committing actions to the environment. The current
canonical world dry-run simulator validates each action against the original projection, so two
actions that are individually feasible can both pass even when the first action consumes the
resource required by the second.

This slice makes canonical dry-run simulation sequence-aware. Accepted dry-run events are replayed
into an internal counterfactual projection, and the next candidate action is validated against that
projection. The live world projection and event store remain untouched.

## Design Goals

- Keep command/event determinism as the source of truth.
- Reuse existing `dispatchWorldCommand` and `applyWorldEvent` instead of adding parallel domain
  prediction logic.
- Apply accepted dry-run events only inside the simulator closure.
- Preserve current rejection behavior and error handling.
- Keep the public `CycleActionSimulator` contract stable for existing runtimes.

## Proposed Architecture

`createWorldCommandDryRunSimulator` keeps a local `rolloutProjection` initialized from
`config.projection`.

For each simulated action:

1. Resolve world command policies against `rolloutProjection`.
2. Dispatch the command against `rolloutProjection`.
3. If dispatch emits `ActionRejected`, return the existing rejected simulation result and do not
   mutate `rolloutProjection`.
4. If accepted, replay emitted events through `applyWorldEvent` into `rolloutProjection`.
5. Return the existing accepted simulation result.

This keeps the dry-run simulator as the canonical world-model adapter while allowing runtime action
sequences to be validated cumulatively.

## Data Flow

```text
candidate action sequence
  -> dry-run action A against projection P0
  -> accepted events replayed into P1
  -> dry-run action B against P1
  -> reject if A consumed B's resource
  -> accepted command drafts still emitted only by worker dispatch
```

## Failure Model

- Rejected dry-runs do not affect the rollout projection.
- Exceptions still become rejected simulator results.
- Repaired actions use the same simulator closure, so an original rejected action does not mutate
  the rollout, while an accepted repaired action does.
- The authoritative projection remains unchanged until real command dispatch succeeds.

## Test Strategy

- Add a direct `createWorldCommandDryRunSimulator` test with one agent holding a single Apple.
- Simulate `AgentEat` twice through the same simulator.
- Assert the first dry-run is accepted.
- Assert the second dry-run is rejected because the counterfactual projection no longer has the
  Apple.
- Run focused worker tests and full repository verification.
