# Recovery Drill Profile Design

## Context

The backend can now configure and execute adaptive replanning policies, materialize full replans, summarize materialization diagnostics, and require those diagnostics in profile gates. The remaining gap is repeatability: recovery evidence still requires callers to combine profile ids, runtime config, and gate thresholds manually. A backend-grade simulation stack needs named operational profiles that can be run locally or in CI without bespoke wiring.

The Aivilization paper treats adaptive re-planning as part of the core agent loop: local correction handles minor failures, while repeated failures or major context shifts trigger a costly but robust full re-plan. A named recovery drill profile should exercise that pipeline end to end.

## Design

Add a new `recovery-drill-25` scenario profile:

- single partition, 25 agents, headless execution
- manifest id `aivilization-recovery-drill-25`
- command consumer prefix `recovery-drill-worker`
- small run queue and scheduler settings matching smoke-scale execution

Add `apps/server/src/localRuntimeTownProfileDefaults.ts` to hold profile-specific runtime and gate defaults. This module returns:

- for `recovery-drill-25`, an `AdaptiveReplanningPolicy` with a `majorContextShift`
- a deterministic `StrategicPlanCompiler` that creates an eat-without-inventory branch plan
- a default minimum full-replan materialization count of `1`

The profile runner merges explicit caller inputs over defaults, so tests and operators can still override strategic compilers or replanning policies. Profile gates use the default full-replan threshold only when the caller does not supply an explicit threshold. The gate suite default profile list includes `recovery-drill-25`, making the standard backend suite cover smoke, default, stress, and recovery evidence.

## Boundaries

- `@aivilization/agent-runtime` remains unchanged; this is an operational profile preset.
- Scenario profile owns population and manifest shape.
- Profile defaults own deterministic runtime behavior and gate defaults.
- Runner, gate, and suite stay orchestration layers and do not inspect re-planning internals.

## Testing

- Scenario profile tests verify `recovery-drill-25` manifest shape and agent count.
- Defaults tests verify the recovery drill compiler and policy.
- Runner integration tests verify the named profile produces full-replan materialization without injected policy/compiler.
- Gate tests verify `recovery-drill-25` defaults to requiring materialization evidence.
- Suite and CLI tests verify the recovery drill profile is accepted in default and explicit suite runs.
