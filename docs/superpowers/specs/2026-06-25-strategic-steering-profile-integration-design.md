# Strategic Steering Profile Integration Design

## Purpose

AIvilization treats human long-horizon steering as a persistent strategic signal, not as a
one-off command. The paper says strategic steering should become a top-level long-term goal and be
integrated into Long-Term Memory so later branch planning, contextual prioritization, and synthesis
can be biased by the human's durable intent.

The current backend already persists strategic steering into `AgentIntentionState` and optional
branch plans, but it does not leave memory provenance. This slice adds the missing memory path:
each `SetLongHorizonObjective` creates a traceable Short-Term Memory record, and local runtime
steering applies an optional Long-Term Profile patch through the existing profile repository.

## Current Boundary

- `apps/api` emits steering commands as durable command envelopes.
- `apps/worker/src/steering.ts` parses `SetLongHorizonObjective`, updates intentions, and can save
  a branch plan record.
- `packages/memory` already owns STM records, LTM profile patches, and profile repositories.
- `apps/worker/src/localCommandDrain.ts` already passes local runtime repositories into the
  steering handler and records steering traces from handler results.
- Existing profile-aware scheduling and daily planning already read long-term profiles.

## Design

The steering handler will create one strategic STM record for every accepted
`SetLongHorizonObjective`.

Record semantics:

1. `kind: human-command`, because the input is a steering command.
2. `status: observed`, because setting the objective records intent rather than a completed world
   action.
3. Stable id derived from command id, so traces and LTM provenance can point at the command-backed
   memory row.
4. Tags include `steering`, `strategic`, `long-horizon-objective`, and objective affinity tags.
5. `source.commandId` preserves command-envelope provenance.

When a `LongTermProfileRepository` is available, the handler will also apply one
`LongTermMemoryPatch`:

1. `section: values`, because a human-set strategic objective should bias future goal selection and
   prioritization as a value-like preference.
2. `key: human-objective:<objectiveId>`, so repeated updates for the same objective replace the
   same profile entry instead of creating unrelated facts.
3. `provenanceRecordIds` references the strategic STM record.
4. Confidence is high for human commands and slightly lower for system/experiment-driven commands.

This keeps ownership clean: steering produces command-derived intent and provenance; memory owns
profile mutation; downstream planners continue to consume profiles through their existing seams.

## Non-Goals

- Do not add UI or Godot integration.
- Do not change reactive steering semantics.
- Do not introduce a new planner or scheduler dependency.
- Do not infer semantic quality of strategic objectives.
- Do not make the observability metric responsible for creating memory.

## Verification

- Worker steering tests prove strategic commands now append STM records.
- Worker steering tests prove an available profile repository receives a values patch with STM
  provenance.
- Local command drain tests prove durable runtime drains persist profile evidence and steering
  traces include the strategic STM record id.
- Full workspace checks remain the phase gate.
