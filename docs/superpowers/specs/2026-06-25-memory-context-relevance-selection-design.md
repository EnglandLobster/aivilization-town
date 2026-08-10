# Memory Context Relevance Selection Design

## Purpose

The worker can now route short-term memory into agent cycles, but the retrieval boundary is still
too blunt for a paper-style town. A large multi-agent world will accumulate many action,
observation, and social memories. Pulling the top-N records by global importance can hide the
records that are relevant to the current plan, which weakens the perceive -> remember -> retrieve
-> plan loop.

This slice adds a worker-level relevance selection policy for the STM context sent into
`runAgentPlanningCycle`.

## Architecture

Keep the responsibility split:

- `@aivilization/memory` stores and returns bounded candidate records by repository filters.
- `apps/worker` selects the cycle context from those candidates using the current plan and signals.
- `@aivilization/agent-runtime` scores subtasks from the selected context using existing
  `memoryAffinityTags` and `scoreMemoryInfluence`.

```text
runWorkerAgentCycle
  -> resolve branch plan
  -> retrieve candidate STM window
  -> selectRelevantShortTermMemoryContext(plan, signals, records)
  -> runAgentPlanningCycle(shortTermMemoryContext)
```

The selection policy reuses existing affinity semantics. It collects memory affinity tags from
branch-plan subtasks plus current signal keys, scores each candidate record with
`scoreMemoryInfluence`, orders positive matches first, and fills any remaining slots with the
repository's importance order. When a plan has no affinity tags and no signals, behavior falls back
to current importance ordering.

## Candidate Window

`memoryRetrievalLimit` remains the final context size. The worker retrieves a wider candidate
window before ranking, defaulting to `memoryRetrievalLimit * 4`. Callers may set
`memoryRetrievalCandidateLimit` when they need a stricter or wider window. Candidate limits must be
greater than or equal to final limits.

This gives the current file/in-memory repository a deterministic, cheap approximation of semantic
recall without introducing embeddings prematurely.

## Observability

No trace schema change is required. `AgentCycleTrace.memoryContextIds` already records the selected
context after ranking. Subtask candidate traces already expose `memoryInfluenceScore`, and
selection evidence records the memory ids that influenced the winning subtask.

## Invariants

- Relevance selection never mutates memory records.
- Positive affinity matches outrank unrelated records even if the unrelated records have higher
  global importance within the candidate window.
- Unmatched slots are filled deterministically by importance, recency, then id.
- Omitted memory retrieval still means no STM context.
- Candidate limit validation fails at the worker boundary before repository access.

## Out Of Scope

- Vector search, embeddings, or cross-agent shared semantic memory.
- New trace fields for rejected memory candidates.
- LLM summarization of selected memory context.
- Changing the planner's existing memory influence scoring formula.
