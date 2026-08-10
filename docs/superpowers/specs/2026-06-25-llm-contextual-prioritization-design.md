# LLM Contextual Prioritization Design

## Purpose

The paper's Contextual Prioritization and Selection step evaluates every active subtask across
parallel branches against real-time internal state, inventory, market prices, world rules, long-term
goal alignment, personality, and values. The current runtime already computes deterministic
candidate scores, and the previous slice made `WorldDecisionContext` available, but the actual
subtask ranking is still deterministic.

This slice adds an LLM-compatible prioritization seam without discarding deterministic behavior. It
lets the LLM rank the already-validated candidate subtasks, while agent-runtime preserves branch
plan invariants, selectable-subtask filtering, fallback safety, and traceability.

## Scope

- Add a contextual subtask prioritizer contract in `@aivilization/agent-runtime`.
- Add a structured LLM prioritizer that ranks existing candidates rather than inventing subtasks.
- Add an async cycle path used by worker execution when a prioritizer is configured.
- Pass intention state, short-term memory, long-term profile, `WorldDecisionContext`, deterministic
  candidate scores, and the active plan into the LLM prompt.
- Persist prioritization trace data in agent cycle traces.

## Architecture

`planner.ts` remains the deterministic candidate generator and invariant owner. It produces the
candidate set after progress and dependency filtering. A new prioritization layer consumes that
candidate set and may reorder or rescore it. This keeps the LLM in a policy seam, not inside the
core branch-plan data model.

`llmSubtaskPrioritizer.ts` owns provider interaction. Its structured schema only accepts a complete
ranking of existing `(branchId, subtaskId)` pairs with finite priority scores and rationales. Invalid
or incomplete output falls back to deterministic ordering, so an LLM cannot delete feasible work,
skip dependency rules, or route execution to an unknown subtask.

`cycle.ts` keeps the existing synchronous `runAgentPlanningCycle` as deterministic compatibility.
It adds an async `runAgentPlanningCycleWithPrioritization` wrapper for worker paths. The wrapper
builds deterministic scores first, awaits the optional prioritizer, then runs the existing execution
pipeline over the ranked candidates.

`worker` only composes the policy. It accepts an optional `subtaskPrioritizer` in tick and cycle
inputs and passes the previously-built world decision context through. Provider construction remains
outside this slice; this slice creates the backend seam and default pass-through.

## Observability

Agent cycle traces gain an optional `contextualPrioritization` record with:

- source: deterministic, llm, or deterministic-fallback;
- accepted/fallback status;
- request/provider/model metadata when applicable;
- ranked choices and rationales;
- attempt usage and failure reason when applicable.

Subtask candidate traces preserve the existing deterministic breakdown and may include
`contextualReasoningScore` when an LLM rescores a candidate.

## Non-Goals

- Do not enable a production provider by default.
- Do not implement LLM micro-planners, global synthesis, or repair in this slice.
- Do not let LLM output create, remove, or mutate branch-plan subtasks.
- Do not change deterministic fallback semantics.

## Verification

- RED/GREEN tests prove the LLM prioritizer can flip selection based on world context while
  receiving inventory, balance, education, residential tier, and market prices.
- Tests prove invalid LLM rankings fall back to deterministic ordering.
- Cycle and worker tests prove configured prioritizers drive execution.
- Observability tests prove prioritization traces survive in-memory and file-backed repositories.
- Full `pnpm check` remains the phase gate.
