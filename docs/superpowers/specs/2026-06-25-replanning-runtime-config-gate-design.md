# Replanning Runtime Config Gate Design

## Context

The backend already supports `AdaptiveReplanningPolicy` inside `@aivilization/agent-runtime`, worker agent scheduling, canonical runtime resolution, and local profile runner execution. Runtime profile reports and gates also already track `fullReplanMaterializationCount`. The remaining gap is operational: a profile suite or CLI run cannot load a named replanning policy from runtime configuration and combine it with a recovery gate without custom test-only injection.

The Aivilization paper describes adaptive re-planning as a first-class recovery mechanism: lightweight correction handles local failures, while repeated failures or major context shifts escalate to full re-planning. The backend should expose that behavior as configurable profile semantics, not as hard-coded runner behavior.

## Design

Runtime profile config gains a `replanningPolicy` node with the same semantic shape as `AdaptiveReplanningPolicy`:

```json
{
  "replanningPolicy": {
    "consecutiveFailureThreshold": 2,
    "failureTags": ["eat", "inventory"],
    "majorContextShift": {
      "key": "profile-recovery-drill",
      "reason": "profile recovery drill requires a replacement plan"
    }
  }
}
```

Profile-specific config overrides top-level config through the existing `profiles.<profileId>` selection mechanism. `null` disables the policy for that profile. The config loader validates numeric thresholds, tag arrays, and major-context-shift fields before runner construction.

The single profile runner CLI keeps backward compatibility with `--llm-planning-config` but introduces `--runtime-config` as the clearer name. Both load the same combined runtime config and forward `llmPlanning`, `dailyPlanning`, `reactionPlanning`, and `replanningPolicy` to the profile runner.

The profile gate suite accepts the same runtime config path and loads it per profile. It forwards all loaded runtime config fields into each profile run. The suite CLI adds `--runtime-config` and `--minimum-full-replan-materializations`, allowing CI to run a recovery profile with a policy that deterministically triggers full-replan materialization and a gate that requires the signal.

## Boundaries

- `@aivilization/agent-runtime` remains the owner of replanning decision semantics.
- `apps/server` owns local profile config loading, CLI parsing, and suite orchestration.
- Gate evaluation remains in `@aivilization/observability`; this slice only feeds existing criteria.
- Runtime config describes profile behavior. Runners and suites load and pass dependencies; they do not inspect or reinterpret replanning decisions.

## Testing

- Runtime config loader tests cover top-level, profile-specific, disabled, and invalid replanning policy documents.
- Runner CLI tests prove config-loaded policies reach `LocalRuntimeTownProfileRunnerInput`.
- Gate suite tests prove per-profile config is loaded and forwarded, while existing full-replan gate criteria still fail when evidence is missing.
- Gate suite CLI tests cover the new flags and ensure parsed values reach the suite input.
