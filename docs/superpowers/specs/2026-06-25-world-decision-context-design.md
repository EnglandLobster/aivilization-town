# World Decision Context Design

## Purpose

The paper's planner does not treat world state as trace-only metadata. Contextual Prioritization,
Action Sequence Generation, Global Synthesis, repair, and replanning are all supposed to reason over
internal state, inventory, market prices, world rules, short-term memory, and long-term profile.

The current backend already serializes a useful `observedStateSummary`, and several deterministic
policies read parts of `WorldProjection`. However, the agent-runtime planner contract and existing
LLM prompts do not have one shared, structured decision context. This makes every future LLM seam
tempting to wire differently.

This slice introduces a stable `WorldDecisionContext` contract and routes it through existing
decision seams before replacing deterministic reasoning modules.

## Scope

Build the context foundation only:

- Define `WorldDecisionContext` in `@aivilization/agent-runtime` without importing `world`.
- Add a worker builder that derives the context from `WorldProjection` for one agent.
- Thread the context through agent cycle inputs, full replanning, strategic planning, daily
  planning, and social reaction evaluation.
- Include the context in strategic, daily, and reaction LLM prompt payloads.

## Architecture

`agent-runtime` owns the portable decision input shape. It is intentionally plain data:

- `agent`: dynamic state required by the paper profile table: physiology, inventory, balance,
  residential tier, education score, job, and location.
- `market`: current AMM spot prices sorted by commodity plus the latest market price index when
  present.

`worker` owns projection adaptation. The helper `createWorldDecisionContextFromProjection` converts
the concrete `WorldProjection` and `WorldAgentState` into the portable agent-runtime shape. This
keeps `agent-runtime` reusable and prevents coupling its core cognitive contracts to world package
internals.

Existing deterministic behavior remains compatible. The context is optional in this slice, because
not every standalone unit test or custom caller has a projection yet. New tests pin the canonical
runtime path so default backend ticks provide it.

## Non-Goals

- Do not implement LLM contextual prioritization yet.
- Do not implement LLM domain micro-planners yet.
- Do not implement LLM global synthesis or repair yet.
- Do not change deterministic scoring semantics in this slice.
- Do not add UI or frontend behavior.

## Verification

- Agent-runtime LLM prompt tests prove strategic, daily, and reaction prompts include inventory,
  balance, education, residential tier, and market spot prices.
- Worker tests prove canonical scheduling and full replanning pass the constructed context into
  cycle and strategic compiler boundaries.
- Full workspace checks remain the phase gate.
