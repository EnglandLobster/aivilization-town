# Runtime Agent-Cycle LLM Stage Wiring Design

## Paper Anchor

The paper's agent loop does not stop at strategic planning. Section 2.1.1 and 2.1.2 require
LLM-backed reasoning inside the cycle: Contextual Prioritization, Action Sequence Generation,
Global Synthesis, and Reactive Correction after simulator rejection. The backend now has seam-level
implementations for these stages, and their prompts can receive `WorldDecisionContext`, memory, and
profile context. The remaining gap is production runtime construction and injection.

## Scope

This slice wires existing agent-cycle LLM stages into the headless runtime profile backend:

- `subtaskPrioritization`: creates a traceable LLM Contextual Prioritization module.
- `actionSequenceGeneration`: creates a traceable LLM Action Sequence Generation module.
- `globalSynthesis`: creates a traceable LLM Global Synthesis module.
- `reactiveCorrection`: creates a traceable LLM Reactive Correction module.

The same runtime config document and profile override rules used by strategic, daily, reaction, and
replanning config continue to apply:

- top-level config is the default;
- `profiles[profileId][nodeName]` overrides top-level config;
- `null` disables a stage for that profile;
- provider secrets can reference environment variables;
- live runtime config accepts OpenAI-compatible providers only;
- unit tests can still use scripted provider config through lower-level factory functions.

## Non-Goals

- Do not change the LLM prompt schemas in this slice.
- Do not make LLM stages default-on without explicit runtime config.
- Do not replace canonical deterministic micro-planners.
- Do not weaken simulator, action synthesis, command policy, or replanning validation.
- Do not add frontend, Godot, or UI behavior.

## Architecture

`apps/server` owns runtime config parsing and provider construction. It will add typed config
aliases and factory functions in `localRuntimeTownProfileLlmPlanning.ts`, then extend
`localRuntimeTownProfileRuntimeConfig.ts` to parse four new nodes. Each factory constructs a fresh
provider from config and returns the corresponding traceable agent-runtime compiler/corrector.

`apps/worker` remains provider-agnostic. `CanonicalWorkerRuntimeResolverConfig` gains optional
stage hooks and copies them into each `WorkerAgentRuntimeBinding`. The worker still constructs
world decision context from projection, retrieves memory/profile context, runs action synthesis and
simulator validation, and records traces.

`apps/server/src/localRuntimeTownProfileRunner.ts` becomes the runtime composition point:

```text
runtime config -> server factory functions -> profile agent provider
  -> canonical worker runtime resolver -> WorkerAgentRuntimeBinding
  -> runWorkerAgentCycle -> runAgentPlanningCycleWithPrioritization
```

This keeps LLM provider concerns outside the game backend execution core while making the runtime
path capable of exercising paper-faithful LLM reasoning.

## Config Shape

```json
{
  "subtaskPrioritization": {
    "kind": "traceable-llm-subtask-prioritizer",
    "model": "planner-model",
    "provider": {
      "kind": "openai-compatible",
      "providerId": "planner-provider",
      "endpoint": "https://llm.example.test/v1/chat/completions",
      "apiKey": { "env": "AIVILIZATION_LLM_API_KEY" }
    }
  },
  "actionSequenceGeneration": {
    "kind": "traceable-llm-action-sequence-generator",
    "model": "planner-model",
    "provider": {
      "kind": "openai-compatible",
      "providerId": "planner-provider",
      "endpoint": "https://llm.example.test/v1/chat/completions",
      "apiKey": { "env": "AIVILIZATION_LLM_API_KEY" }
    }
  },
  "globalSynthesis": {
    "kind": "traceable-llm-global-synthesizer",
    "model": "planner-model",
    "provider": {
      "kind": "openai-compatible",
      "providerId": "planner-provider",
      "endpoint": "https://llm.example.test/v1/chat/completions",
      "apiKey": { "env": "AIVILIZATION_LLM_API_KEY" }
    }
  },
  "reactiveCorrection": {
    "kind": "traceable-llm-reactive-corrector",
    "model": "planner-model",
    "provider": {
      "kind": "openai-compatible",
      "providerId": "planner-provider",
      "endpoint": "https://llm.example.test/v1/chat/completions",
      "apiKey": { "env": "AIVILIZATION_LLM_API_KEY" }
    }
  },
  "profiles": {
    "smoke-25": {
      "globalSynthesis": null,
      "reactiveCorrection": null
    }
  }
}
```

Each node supports `maxAttempts`, `timeoutMs`, and `pricing` with the same validation semantics as
existing planning nodes.

## Request IDs

Runtime traceability needs stable stage-specific request ids:

- subtask prioritization:
  `profile-llm-subtask-priority:{profileId}:{agentId}:{issuedAt}`
- action sequence generation:
  `profile-llm-action-sequence:{profileId}:{agentId}:{branchId}:{subtaskId}:{issuedAt}`
- global synthesis:
  `profile-llm-global-synthesis:{profileId}:{agentId}:{issuedAt}`
- reactive correction:
  `profile-llm-reactive-correction:{profileId}:{agentId}:{rejectedActionId}:{issuedAt}`

These ids should surface in existing agent-cycle traces through the already implemented trace
mapping.

## Test Strategy

- Runtime config tests prove profile-specific parsing, env secret resolution, null overrides, and
  kind/provider validation for the four new nodes.
- Server LLM planning factory tests prove each new factory constructs a traceable stage from a
  scripted provider and emits the expected request id and provider/model metadata.
- Worker resolver tests prove canonical runtime bindings preserve all four stage hooks.
- Server profile runner tests prove injected direct hooks and config-created hooks reach the
  generated profile agent provider.
- Full workspace verification remains the phase gate.

## Architecture Review

After this slice, the statement "LLM seam exists but production code never constructs a provider for
it" should no longer apply to the agent-cycle LLM stages. LLM execution still remains explicit
configuration, which is intentional for reproducibility and cost control. The next remaining paper
gaps will be richer semantic domain catalogs, natural language dialogue generation, LLM reflection
synthesis, and replacing memory-guided correction's deterministic matching with a reasoning seam.
