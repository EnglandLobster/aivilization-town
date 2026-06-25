# LLM Action Sequence Generation Design

## Paper Anchor

AIvilization Section 2.1.1 places Action Sequence Generation after contextual subtask
selection and before pre-execution simulation. The selected abstract subtask must be translated by
a domain-specific micro-planner into a concrete sequence of atomic actions. The current backend has
the right micro-planner port, but canonical worker domains still encode that translation as
deterministic closures, token matching, and static default payloads.

This slice adds the missing LLM seam for that translation layer without weakening world-command
validation.

## Scope

In scope:

- Add an async, traceable action-sequence generation port to `@aivilization/agent-runtime`.
- Add an LLM compiler that receives the selected subtask, deterministic fallback actions, world
  decision context, memory, profile, plan, progress, and active signals.
- Validate LLM output before action synthesis: non-empty actions, unique ids, known command types,
  JSON-serializable payloads, finite priorities, and finite resource estimates.
- Fall back to deterministic micro-planner output when the provider fails or emits invalid actions.
- Route the seam through the existing async planning cycle and worker tick path.
- Persist action sequence generation evidence in agent cycle traces.

Out of scope for this slice:

- Replacing every canonical domain rule with a fully semantic prompt.
- Production default provider wiring.
- Global Synthesis LLM orchestration.
- Local Repair / Reactive Correction LLM reasoning.
- Natural-language dialogue generation and reflection synthesis.

## Architecture

`DomainMicroPlanner` remains the deterministic, synchronous baseline and still produces safe
fallback action proposals. The new `ActionSequenceGenerator` is an optional async compiler used
only by `runAgentPlanningCycleWithPrioritization`. For each selected synthesis subtask, the cycle
first asks the deterministic micro-planner for fallback actions, then lets the optional generator
replace that sequence with a validated LLM sequence.

The LLM compiler is intentionally bounded:

1. It can translate the selected subtask into a concrete action sequence.
2. It can change ids, descriptions, priorities, payloads, resource estimates, and ordering.
3. It cannot select subtasks, mutate branch plans, bypass action synthesis, bypass simulator
   validation, or emit command types outside the allowed command set.

This keeps the planner stack aligned with the paper's hierarchy while preserving a game-backend
style invariant boundary:

```text
branch plan -> contextual prioritization -> action sequence generation
  -> global synthesis -> simulator/repair -> command dispatch
```

## Data Flow

```text
runWorkerAgentCycle
  -> resolve memory/profile/progress/worldDecisionContext
  -> runAgentPlanningCycleWithPrioritization
       -> deterministic subtask candidates
       -> optional LLM contextual prioritizer
       -> deterministic micro-planner fallback actions
       -> optional LLM action sequence generator
       -> action synthesis
       -> simulator and repair policy
       -> command drafts
  -> createAgentCycleTrace(actionSequenceGeneration)
```

The prompt input must include:

- `selectedSubtask`
- `plan`
- `signals`
- `progress`
- `intentionState`
- `shortTermMemoryContext`
- `longTermProfile`
- `worldDecisionContext`
- `deterministicActions`
- `constraints`

The trace must include:

- status: `deterministic`, `accepted`, or `fallback`
- source: `deterministic`, `llm`, or `deterministic-fallback`
- selected subtask identity
- request/provider/model where available
- emitted action ids, command types, and rationales
- attempts and usage where available
- fallback reason and message when invalid or failed

## Interfaces

New agent-runtime files:

- `packages/agent-runtime/src/actionSequenceGeneration.ts`
  - domain types and validation for generated action sequences
  - deterministic result helper
  - `applyActionSequenceProposal`
- `packages/agent-runtime/src/llmActionSequenceGenerator.ts`
  - structured LLM schema and prompt compiler
  - fallback mapping and trace mapping
  - `createTraceableLlmActionSequenceGenerator`

Modified files:

- `packages/agent-runtime/src/cycle.ts`
  - accepts optional `actionSequenceGenerator` on the async cycle input
  - records per-subtask action sequence traces in `AgentCycleResult`
- `apps/worker/src/agentCycleRunner.ts`
  - accepts optional generator and chooses async cycle when prioritizer or generator exists
  - maps traces into observability
- `apps/worker/src/tickRunner.ts` and `apps/worker/src/agentScheduling.ts`
  - pass generator through runtime bindings
- `packages/observability/src/agentCycleTrace.ts`
  - adds durable action sequence generation trace shape

## Failure Semantics

- Provider failure, timeout, content filtering, parse failure, and semantic validation failure all
  produce deterministic fallback actions.
- Unknown command types are rejected before synthesis.
- Empty LLM sequences are rejected before synthesis.
- Invalid resource estimates are rejected before synthesis.
- The simulator remains the authority for world-state validity.

## Test Strategy

- Agent-runtime unit tests prove the LLM compiler:
  - receives world decision context and memory/profile input;
  - accepts a valid generated action sequence;
  - rejects unknown command types and falls back;
  - rejects invalid resource estimates and falls back;
  - exposes a traceable generator compatible with async cycles.
- Cycle tests prove async cycles use generated actions before synthesis while sync cycles remain
  deterministic.
- Worker tests prove `runWorkerAgentCycle` and tick scheduling pass the generator through and
  persist trace evidence.
- Observability tests prove action sequence traces survive create/clone repository boundaries.

## Architecture Review

This slice closes one paper P0 seam: Action Sequence Generation becomes LLM-capable. It deliberately
does not claim that canonical domains are now fully paper-faithful because many domain prompts still
need richer semantic catalogs, production provider wiring, and validation experiments.
