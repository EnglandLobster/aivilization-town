# Objective Renewal Evidence Trace Design

## Purpose

Make autonomous objective renewal explainable. The previous slices made short-term memory influence
new objectives and added deterministic reflection from STM into LTM profile entries. The next gap is
observability: when an agent creates a new long-horizon objective, the backend should expose which
memory and profile evidence shaped that choice.

This is a small but important step toward the paper-faithful agent loop: memory stream, reflection,
long-term profile, goal formation, planning, action, and new memory should form an auditable chain.

## Current Gap

`renewMissingActiveObjectives` currently returns only `agentId`, `objectiveId`, and `planId`.
`createDefaultAutonomousObjective` internally scores candidates, but the selected candidate id,
rationale, profile evidence, and STM context are discarded.

That makes the system harder to debug and less ready for later LLM-backed proposers. A future UI or
experiment runner should be able to answer: why did this agent decide to recover, study, work, or
maintain a profile-aligned routine?

## Design Goals

- Keep `LongHorizonObjective` as the durable memory state, not a trace container.
- Preserve compatibility with custom proposers that return a plain objective.
- Add an optional richer proposer output that carries decision evidence.
- Keep evidence in worker results and optional trace sinks, not in world events.
- Include both short-term memory context ids and long-term profile provenance ids.
- Keep the default proposer deterministic and testable.

## Proposed Architecture

Extend the objective proposer seam:

```text
AutonomousObjectiveProposerInput
  -> AutonomousObjectiveProposal
       objective: LongHorizonObjective
       decision: ObjectiveRenewalDecision
  -> renewMissingActiveObjectives
       persists objective + branch plan
       returns RenewedActiveObjectiveResult with decision trace
```

`AutonomousObjectiveProposer` should accept either return shape:

- `LongHorizonObjective` for existing custom proposers;
- `AutonomousObjectiveProposal` for proposers that can explain the decision.

The default proposer should produce the richer shape internally. `createDefaultAutonomousObjective`
can remain as a compatibility helper that returns only the objective.

## Decision Evidence Shape

Use a worker-level decision object:

- `selectedCandidateId`
- `rationale`
- `score`
- `shortTermMemoryContextIds`
- `profileEntryKeys`
- `profileEvidenceRecordIds`

Candidate scoring should attach evidence while scoring:

- recovery from recent failed STM cites matching STM record ids;
- profile-aligned routine cites profile entry keys and provenance record ids;
- education, income, and physiology candidates can provide a world-state rationale with no memory
  evidence.

## Worker Result And Trace Sink

`RenewedActiveObjectiveResult` should include `decisionTrace`.

`renewMissingActiveObjectives` should also accept an optional trace sink:

```ts
type WorkerObjectiveRenewalTraceSink = {
  readonly record: (trace: ObjectiveRenewalDecisionTrace) => void | Promise<void>;
};
```

`runCanonicalWorkerActivePlanTick` should pass this through as
`objectiveRenewalTraceSink?: WorkerObjectiveRenewalTraceSink`.

This keeps the trace optional and avoids coupling objective renewal to a specific persistence or UI
implementation.

## Failure Model

- Plain-objective custom proposers should still work and receive a fallback decision trace with
  `selectedCandidateId: 'custom-proposer'`.
- If a trace sink throws, renewal should fail visibly; a broken observability sink should not create
  untraceable objectives.
- Missing profile provenance simply results in an empty `profileEvidenceRecordIds` list.
- Existing objective skip behavior remains unchanged.

## Test Strategy

Use TDD around the seam:

- default proposer returns a decision trace for recent failed memory recovery;
- default proposer returns profile provenance for a profile-aligned routine;
- plain custom proposers still renew objectives with a fallback trace;
- `renewMissingActiveObjectives` returns and emits traces through the optional sink;
- canonical active-plan tick passes the trace sink through renewal.

## Future Extensions

This design leaves room for:

- durable objective-decision trace repositories;
- UI inspection of goal rationale;
- LLM-backed proposers returning richer natural-language rationales;
- experiment exports that correlate reflection evidence with objective choice;
- replay validation that compares objective choices across proposer versions.
