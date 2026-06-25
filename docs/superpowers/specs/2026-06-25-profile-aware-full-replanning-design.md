# Profile-Aware Full Replanning Design

## Purpose

AIvilization's paper describes Adaptive Re-planning as a tiered recovery mechanism. Minor failures
use Short-Term Memory for fast fixes, while repeated failures or major context shifts escalate to a
full top-down BTP re-plan. After the previous slice, initial strategic compilation can use
Long-Term Profile context, but full replanning still invokes the strategic compiler with only the
objective and timestamp.

That creates a semantic break: the initial plan can reflect the agent's identity, but a recovery
plan generated after disruption may forget the same values and habits. This slice preserves profile
context across full replanning.

## Current Boundary

- `runWorkerAgentCycle` already loads `intentionState`, `longTermProfile`, and the active plan at
  the beginning of each cycle.
- `materializeFullReplanForActiveObjective` owns replacing the durable branch plan and resetting
  plan progress.
- `StrategicPlanCompilerInput` already accepts optional `longTermProfile`.
- The replan materializer currently calls the compiler with `{ objective, issuedAt }` only.

## Design

Add optional `longTermProfile` to `WorkerFullReplanMaterializationInput` and forward it to the
strategic compiler.

`runWorkerAgentCycle` will pass the profile it has already loaded into
`materializeFullReplanForActiveObjective`. This keeps repository ownership stable:

1. `runWorkerAgentCycle` owns cycle context hydration.
2. `materializeFullReplanForActiveObjective` owns replan persistence.
3. `StrategicPlanCompiler` owns interpreting profile context for branch construction.

Standalone callers can omit `longTermProfile`; the behavior remains backward-compatible, and custom
compilers still receive a stable input contract.

## Non-Goals

- Do not change replanning trigger policy.
- Do not add a new profile repository dependency to `objectiveReplanning.ts`.
- Do not change trace shape in this slice.
- Do not implement profile-aware replanning observability metrics yet.

## Verification

- Direct replan materialization tests prove custom compilers receive an explicit profile context.
- Worker agent cycle tests prove the profile loaded for the cycle is passed into full replan
  materialization.
- Existing tick and canonical active-plan tests continue to cover the higher-level orchestration
  path.
- Full workspace checks remain the phase gate.
