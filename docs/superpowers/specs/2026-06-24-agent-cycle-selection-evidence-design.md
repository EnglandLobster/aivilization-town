# Agent Cycle Selection Evidence Design

## Purpose

Expose why an agent selected a concrete branch subtask during a planning cycle. Previous slices made
reflection update long-term profile, and made objective renewal traceable. The next gap is the
action loop: `runAgentPlanningCycle` uses intention, STM, and LTM profile influence to select a
subtask, but the returned result and worker trace do not show the evidence behind that selection.

This slice makes the actual action cycle auditable without changing simulation rules.

## Current Gap

`runAgentPlanningCycle` computes influence maps for intention state, short-term memory, and
long-term profile. It passes those maps into `selectPrioritizedSubtask`, but discards them after
selection.

`AgentCycleTrace` currently records selected branch, candidate actions, simulator result, replanning
decision, memory context ids, and memory write ids. It does not expose profile entry keys or
profile provenance record ids, so a reflection-derived profile entry can influence action choice
without appearing in the observable trace.

## Design Goals

- Keep planner selection deterministic.
- Return evidence for the selected subtask from `runAgentPlanningCycle`.
- Include STM/LTM evidence in worker `AgentCycleTrace`.
- Preserve low payload size by tracing only the selected subtask's influence evidence.
- Add profile provenance ids so reflection-derived profile entries can be traced back to STM.
- Avoid adding a durable trace repository in this slice.

## Proposed Architecture

Add a runtime selection evidence object:

```text
runAgentPlanningCycle
  computes intention/memory/profile influence maps
  selects subtask
  returns AgentCycleSelectionEvidence for selectedSubtask.subtaskId

runWorkerAgentCycle
  records selected evidence in AgentCycleTrace
```

`AgentCycleSelectionEvidence` should include:

- `selectedSubtaskId`
- `intentionInfluenceScore`
- `memoryInfluenceScore`
- `profileInfluenceScore`
- `memoryEvidenceRecordIds`
- `profileEntryKeys`
- `profileEvidenceRecordIds`

`ProfileInfluenceEntryMatch` should include `provenanceRecordIds`. The scorer already has access
to the profile entry, so this keeps provenance in the domain where it is known.

## Trace Shape

Extend `AgentCycleTrace` with:

- `selectionEvidence`

The worker should map the runtime evidence directly into the trace. Existing `memoryContextIds`
continues to list retrieved STM context ids. `selectionEvidence.memoryEvidenceRecordIds` is the
subset that actually influenced the selected subtask.

## Failure Model

- Missing intention, memory, or profile inputs produce zero scores and empty evidence lists.
- Profile entries with no provenance produce empty `profileEvidenceRecordIds`.
- Existing callers of `runAgentPlanningCycle` get a new result field but no new required input.
- Trace creation remains strict about candidate actions, but selection evidence itself may be empty.

## Test Strategy

Use TDD at three levels:

- `profileInfluence` includes profile provenance record ids in matches.
- `runAgentPlanningCycle` returns selected subtask evidence with profile and memory evidence.
- `createAgentCycleTrace` accepts and preserves selection evidence.
- `runWorkerAgentCycle` records selection evidence into traces.

## Future Extensions

This design leaves room for:

- full candidate scoring traces for experiments;
- UI panels showing why one branch beat another;
- replay comparisons across proposer or planner versions;
- LLM planner rationales attached beside deterministic influence evidence.
