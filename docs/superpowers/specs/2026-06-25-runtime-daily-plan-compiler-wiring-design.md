# Runtime Daily Plan Compiler Wiring Design

## Goal

Make profile-driven local runtime runs able to use the traceable LLM daily planner for daily
intention renewal, while preserving deterministic fallback behavior when no daily planner is
configured.

## Context

The project already has three pieces:

- `packages/agent-runtime` exposes `createTraceableLlmDailyPlanCompiler`.
- `apps/worker/src/dailyRoutineSchedule.ts` can renew scheduled intentions from an injected
  `DailyPlanCompiler`.
- `apps/server/src/localRuntimeTownProfileLlmPlanning.ts` creates traceable strategic compilers
  from profile runtime LLM config.

The missing link is runtime wiring. Profile runs can configure LLM strategic planning, but daily
planning is still deterministic because the worker active-plan tick and profile agent provider do
not accept or pass a daily compiler.

## Architecture

Use the existing strategic-planner wiring pattern instead of creating a second provider subsystem.
Profile runtime config gains an optional `dailyPlanning` node alongside the existing
`llmPlanning` strategic node. The server factory turns that node into a `DailyPlanCompiler`; the
profile runner passes it into the profile agent provider; the provider renews daily plans before
objective renewal so active scheduled intentions can drive autonomous objectives.

The worker package remains provider-agnostic. It only receives a `DailyPlanCompiler` and never
knows whether the implementation is deterministic, scripted, OpenAI-compatible, or another future
provider.

## Components

- `apps/server/src/localRuntimeTownProfileLlmPlanning.ts`
  - Add `LocalRuntimeTownProfileDailyPlanningConfig`.
  - Add `createLocalRuntimeTownProfileDailyPlanCompiler`.
  - Reuse `createLlmStructuredProviderFromConfig`.

- `apps/server/src/localRuntimeTownProfileRuntimeConfig.ts`
  - Parse optional `dailyPlanning` from top-level or profile-specific config.
  - Keep the existing `llmPlanning` loader API compatible by returning only strategic config.
  - Add a combined runtime config loader for callers that need both strategic and daily compilers.

- `apps/server/src/localRuntimeTownProfileRunner.ts`
  - Accept optional `dailyPlanCompiler` or runtime `dailyPlanning` config.
  - Build the compiler from config when no explicit compiler is injected.
  - Pass the compiler into `createLocalRuntimeTownProfileAgentProvider`.

- `apps/worker/src/canonicalActivePlanTick.ts`
  - Accept optional `DailyPlanCompiler`.
  - Use `renewDailyPlanScheduledIntentions` when a daily compiler is supplied.
  - Preserve existing deterministic daily routine behavior when no compiler is supplied.

## Data Flow

```text
profile runtime config
  -> parse dailyPlanning
  -> createLocalRuntimeTownProfileDailyPlanCompiler
  -> runLocalRuntimeTownDaemonScenarioProfile
  -> createLocalRuntimeTownProfileAgentProvider
  -> renewDailyPlanScheduledIntentions
  -> intentionRepository scheduled intentions
  -> renewMissingActiveObjectives
  -> buildWorkerTickAgentsFromActivePlans
```

## Error Handling

Invalid daily planner config should fail during config load or compiler creation, before runtime
cycles start. Missing config means deterministic daily routine behavior stays unchanged.

## Testing

- Server compiler factory test proves scripted daily planner config creates a traceable compiler.
- Runtime config tests prove `dailyPlanning` loads from profile-specific and top-level config,
  resolves env secrets, and can be disabled per profile.
- Profile runner test proves injected daily compiler scheduled intentions influence autonomous
  objective renewal.
- Worker active-plan tick test proves the injected daily compiler is used before objective renewal.

## Out Of Scope

- Persisting daily plan traces into a durable observability repository.
- Replacing strategic `llmPlanning` field names.
- Frontend, UI, Godot integration, or visual debugging.
