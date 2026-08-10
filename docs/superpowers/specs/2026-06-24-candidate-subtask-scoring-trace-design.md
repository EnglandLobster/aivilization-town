# Candidate Subtask Scoring Trace Design

## Purpose

Expose every selectable subtask candidate and its deterministic score breakdown during an agent
planning cycle. The current action loop can explain the selected subtask through
`selectionEvidence`, but it still cannot answer why the selected subtask beat other runnable
alternatives.

This slice makes planner selection auditable at the candidate ranking layer without changing world
rules, micro-planner behavior, or simulator validation.

## Current Gap

`selectPrioritizedSubtask` builds candidate subtasks inside `packages/agent-runtime/src/planner.ts`,
sorts them, and returns only the first candidate. The score is a single number made from:

- base subtask priority;
- explicit context signal weights;
- intention influence;
- short-term memory influence;
- long-term profile influence.

`runAgentPlanningCycle` then returns the selected subtask and selected-subtask evidence, while
`AgentCycleTrace` records selected branch and candidate action descriptions. The trace does not
show the full selectable subtask list or how each candidate's final score was composed.

## Approaches Considered

### A. Keep Selected-Only Evidence

This is the current state after the previous slice. It is compact, but it cannot explain why a
different runnable branch lost.

### B. Trace Selectable Subtask Candidates With Score Breakdown

Expose a sorted `subtaskCandidates` list from `agent-runtime`, and copy it into
`AgentCycleTrace`. Each candidate includes branch id, subtask id, description, final score, and a
score breakdown. This is the recommended approach because it keeps scoring owned by the planner and
keeps observability payloads bounded to selectable subtasks.

### C. Persist Full Experiment-Level Candidate Graphs

Record full candidate trees, gated-out subtasks, domain-planner action proposals, and simulator
attempts in a separate experiment trace. This is useful later, but it is too broad for the current
slice and would mix planner scoring with simulator analysis.

## Design Goals

- Keep planner scoring deterministic and single-sourced in `@aivilization/agent-runtime`.
- Preserve the existing `selectPrioritizedSubtask` API for callers that only need the selected item.
- Add a separate candidate scoring API for callers that need auditability.
- Trace only subtasks that are selectable after progress/dependency gating.
- Keep trace records serializable and small enough for frequent worker cycles.
- Avoid LLM rationales or natural-language explanations in this slice; the trace is deterministic
  evidence.

## Proposed Architecture

Add planner candidate scoring types:

```ts
export type PrioritizedSubtaskScoreBreakdown = {
  readonly basePriorityScore: number;
  readonly signalInfluenceScore: number;
  readonly intentionInfluenceScore: number;
  readonly memoryInfluenceScore: number;
  readonly profileInfluenceScore: number;
};

export type PrioritizedSubtaskCandidate = PrioritizedSubtask & {
  readonly scoreBreakdown: PrioritizedSubtaskScoreBreakdown;
};
```

Add `scorePrioritizedSubtaskCandidates(input)` in `planner.ts`. It accepts the same scoring inputs
as `selectPrioritizedSubtask`, applies the same progress/dependency gating, and returns sorted
candidate subtasks. `selectPrioritizedSubtask` should call this function and return the first
candidate without adding `scoreBreakdown` to the public `PrioritizedSubtask` shape, preserving
existing exact-equality tests and call sites.

`runAgentPlanningCycle` should compute influence maps once, call
`scorePrioritizedSubtaskCandidates`, use the first candidate as the selected subtask, and return the
candidate list in `AgentCycleResult`.

`AgentCycleTrace` should add:

```ts
readonly subtaskCandidates: readonly AgentCycleSubtaskCandidateTrace[];
```

The worker maps `cycleResult.subtaskCandidates` directly into trace records. Observability should
define the serializable trace type without depending on `agent-runtime`.

## Data Flow

```text
runAgentPlanningCycle
  -> builds intention/memory/profile influence maps once
  -> scorePrioritizedSubtaskCandidates(...)
  -> selectedSubtask = first candidate
  -> returns selectedSubtask + subtaskCandidates + selectionEvidence

runWorkerAgentCycle
  -> createAgentCycleTrace({ subtaskCandidates: cycleResult.subtaskCandidates, ... })
```

## Failure Model

- If progress/dependency gating leaves no selectable subtasks, the existing
  `branch plan produced no selectable subtasks` failure remains.
- Missing influence inputs contribute zero in the breakdown.
- Context signals still validate non-empty keys and finite weights.
- Candidate order uses the same deterministic tie-breakers as selection: score descending, branch id
  ascending, subtask id ascending.
- Trace creation should reject empty `subtaskCandidates`, just as it rejects empty action candidate
  descriptions.

## Test Strategy

- Planner tests cover candidate scoring breakdown, sorted order, and progress gating.
- Cycle tests assert `runAgentPlanningCycle` returns the sorted subtask candidates and still selects
  the same subtask.
- Observability tests assert `createAgentCycleTrace` preserves `subtaskCandidates`.
- Worker tests assert traces include candidate scoring data from the runtime result.
- Existing full verification remains `pnpm check` and `pnpm build`.

## Future Extensions

- Trace gated-out subtasks with explicit gate reasons.
- Add candidate action simulator attempts and repair paths.
- Build UI panels that show score breakdowns and evidence links.
- Compare candidate rankings across planner versions in experiment runs.
