# Runtime Reaction Planning Wiring Design

## Goal

Let local runtime profile runs configure and use a traceable LLM reaction evaluator for ambient
social observations.

## Context

The backend now has a `ReactionEvaluator` seam in `@aivilization/agent-runtime`, and worker ticks can
accept an injected evaluator through `ambientObservationMemory.reactionEvaluator`. The missing piece
is runtime wiring: profile runs can configure LLM strategic planning and daily planning, but cannot
yet configure reaction evaluation. That leaves paper-style "observe, evaluate, react" behavior
available only in tests or hand-written worker calls.

This slice makes reaction evaluation a first-class profile runtime capability. It does not add UI,
Godot integration, or persistent reaction trace storage.

## Architecture

Follow the existing strategic and daily planning pattern:

```text
profile runtime config
  -> reactionPlanning node
  -> createLocalRuntimeTownProfileReactionEvaluator(...)
  -> LocalSimulationRuntimeWiringInput.ambientObservationMemory
  -> runLocalWorldRuntimeStep(...)
  -> runWorkerSimulationTick(...)
  -> createSocialObservationScheduledIntentions(...)
  -> ReactionEvaluator
```

`apps/server` owns profile-specific provider config and request ids. `apps/worker` owns generic
runtime wiring and tick execution. `@aivilization/agent-runtime` remains the owner of reaction
decision semantics.

## Config Contract

Add an optional `reactionPlanning` node to the same runtime config file that already supports
`llmPlanning` and `dailyPlanning`.

```json
{
  "reactionPlanning": {
    "kind": "traceable-llm-reaction-evaluator",
    "model": "reaction-model",
    "provider": {
      "kind": "openai-compatible",
      "providerId": "reaction-provider",
      "endpoint": "https://llm.example.test/v1/chat/completions",
      "apiKey": { "env": "AIVILIZATION_LLM_KEY" }
    },
    "maxAttempts": 2,
    "timeoutMs": 30000,
    "pricing": {
      "inputTokenCostMicros": 2,
      "outputTokenCostMicros": 8
    }
  },
  "profiles": {
    "smoke-25": {
      "reactionPlanning": null
    }
  }
}
```

Top-level config applies by default. A profile-specific node overrides it. `null` disables it for
that profile.

## Runtime Wiring

Add `ambientObservationMemory?: WorkerTickAmbientObservationMemoryInput` to local runtime manifest
wiring so host/registry/lifecycle/loop/step can carry worker tick observation configuration
without special-casing profile runner.

When `runLocalRuntimeTownDaemonScenarioProfile` receives reaction planning config, it builds a
traceable LLM reaction evaluator and passes:

```ts
ambientObservationMemory: {
  enabled: true,
  reactionEvaluator,
}
```

If no reaction evaluator is configured, the existing default remains unchanged: local runtime steps
still enable ambient observations and worker policy uses the deterministic evaluator.

## Request Ids

Profile reaction requests use:

```text
profile-llm-reaction:{profileId}:{agentId}:{memoryId}:{issuedAt}
```

That makes provider logs correlate with the agent, source memory, and tick time.

## Testing

- Runtime config tests parse top-level and profile-specific `reactionPlanning`, resolve secrets, and
  support profile-level disabling.
- Factory tests prove `createLocalRuntimeTownProfileReactionEvaluator` forwards memory context to
  the structured provider and produces the expected traceable request id.
- Worker runtime wiring tests prove `ambientObservationMemory` survives manifest registration and
  reaches `runLocalWorldRuntimeStep`.
- Profile runner tests prove configured LLM reaction planning can ignore an otherwise deterministic
  social follow-up while still preserving ambient observation memory.

## Out Of Scope

- Storing reaction traces in a repository.
- Exposing reaction traces through HTTP APIs.
- Adding new reaction kinds such as defer or immediate command.
- Godot/frontend reaction inspectors.
