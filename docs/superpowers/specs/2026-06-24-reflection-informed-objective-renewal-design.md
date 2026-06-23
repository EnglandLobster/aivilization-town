# Reflection-Informed Objective Renewal Design

## Purpose

Move autonomous objective renewal from a world-state threshold fallback toward an AIvilization-style
loop where recent experience, long-term profile, and current world state jointly shape the next
long-horizon objective.

This is still part of the complete rebuild. The older projects remain reference material only; this
design keeps the new backend on server-authoritative, testable, replaceable abstractions.

## Problem

`renewMissingActiveObjectives` currently creates a durable objective and branch plan for agents that
have no active objective. That solved lifecycle continuity, but the default proposer is still a
deterministic threshold policy:

- low physiology creates a maintenance objective;
- low education creates a study objective;
- low balance creates an income objective;
- otherwise it creates a routine objective.

That is acceptable as a bootstrap fallback, but it is not enough for the paper-faithful agent model.
In the target architecture, agents should use their lived traces and profile to decide what matters
next. A failed work attempt, a repeated hunger pattern, a learned value, or a completed recent goal
should change the next objective before the plan compiler runs.

## Design Goals

- Preserve `AutonomousObjectiveProposer` as the replaceable seam for future LLM/reflection systems.
- Make short-term memory a first-class proposer input, not an implicit global read.
- Keep memory retrieval in the worker orchestration layer so repositories do not leak into agent
  runtime policy.
- Keep the default proposer deterministic and unit-testable.
- Avoid coupling long-term objective generation to any specific LLM provider, vector store, or UI.
- Record enough objective tags and statements for traceability without adding opaque hidden state.

## Non-Goals

- Do not implement a full LLM reflection loop in this slice.
- Do not add vector search, embeddings, or cross-agent memory sharing yet.
- Do not introduce a separate reflection persistence model before the objective proposer actually
  needs one.
- Do not change world mutation rules or domain command validation.

## Proposed Architecture

Extend objective renewal as a worker-level orchestration pipeline:

```text
world projection
  + intention state
  + long-term profile
  + retrieved short-term memory context
  -> AutonomousObjectiveProposer
  -> LongHorizonObjective
  -> StrategicPlanCompiler
  -> durable active objective + branch plan
```

The boundary stays intentionally narrow:

- `@aivilization/memory` owns STM/LTM records and repositories.
- `apps/worker` owns repository access and renewal timing.
- `AutonomousObjectiveProposer` owns the policy that turns context into a proposed objective.
- `@aivilization/agent-runtime` owns compiling an accepted objective into a branch plan.
- world packages remain responsible only for validating and applying commands.

## Context Contract

`AutonomousObjectiveProposerInput` should include:

- `agentId`
- current `WorldAgentState`
- current `WorldProjection`
- current `AgentIntentionState`
- current `LongTermAgentProfile`
- retrieved `shortTermMemoryContext`
- `issuedAt`

`renewMissingActiveObjectives` should receive:

- the existing repositories;
- `shortTermMemoryRepository`;
- optional `memoryRetrievalLimit`, defaulting to a small bounded value;
- optional custom proposer and compiler.

The worker retrieves recent or important STM for each idle agent before calling the proposer. A
custom proposer can ignore this context, but it should not need to perform its own repository reads.

## Default Proposer Behavior

The deterministic default proposer should score a small set of candidate objectives:

1. Physiological recovery when energy, satiety, or health is risky.
2. Recovery or routine stabilization when recent failed memories indicate repeated blocked actions.
3. Education growth when the agent is under-qualified and no urgent recovery need exists.
4. Income stability when balance is low or recent work-related memories show economic pressure.
5. Profile-aligned routine when long-term values or habits suggest a stable preference.
6. Balanced routine as the final fallback.

The proposer should also reduce exact repetition when the same objective was just completed and
there is another viable candidate. This keeps agents from immediately re-creating a completed plan
when the world context no longer justifies it.

## Failure Model

- Missing STM repository data should degrade to an empty context, not block the whole tick.
- Invalid retrieval limits should fail fast during worker input validation.
- A proposer returning `undefined` means the agent remains idle for that renewal pass.
- Plan compilation failures should remain visible to the caller; the worker should not silently
  persist an objective without its durable branch plan.

## Test Strategy

Use TDD around the abstraction boundary:

- proposer receives STM context and can choose recovery over education after a relevant failed
  action;
- long-term profile can influence the default objective when hard survival/economy needs are absent;
- recently completed objectives are not immediately repeated when a viable alternative exists;
- `renewMissingActiveObjectives` retrieves STM context and passes it to custom proposers;
- canonical active-plan ticks can renew idle agents using memory-informed context before scheduling.

## Future Extensions

This design leaves room for:

- an explicit reflection job that periodically summarizes STM into reflective insights;
- LLM-backed proposers behind the same `AutonomousObjectiveProposer` interface;
- vector or hybrid memory retrieval behind the same repository contract;
- cross-agent social memory and collective plans;
- objective trace records that explain why a proposer selected a goal.
