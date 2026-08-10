# Social Reflection Validation Metric Design

## Purpose

Promote durable social reflection observations from a query-only debug surface into the experiment
validation layer. AIvilization v0 treats social interaction feedback as one of the mechanisms that
reshapes adaptive agent identity, so backend validation needs a paper-aligned signal that says
whether a run produced evidence-backed post-interaction reflection for the expected agent cohort.

## Current Boundary

- `packages/memory` creates `SocialInteractionReflectionRecord` values from successful social
  interaction STM.
- `apps/worker` records those reflections as durable `SocialReflectionObservation` rows during
  memory consolidation.
- `packages/observability` stores and queries the rows, but `experimentValidation` currently ignores
  them.
- `apps/worker` builds validation reports from projection, events, planner rows, market observations,
  and cycle traces, but it does not pass social reflection rows into the report.

## Design

Add a new `social-reflection-coverage` metric to `packages/observability/src/experimentValidation.ts`.
The metric consumes a narrow validation DTO instead of depending on repository implementation
details. The DTO carries only observation id, source agent, target agent, confidence, evidence ids,
tags, and generation time.

The metric evaluates four run-level qualities:

1. At least one social reflection observation exists.
2. A configurable share of expected validation agents produced reflection rows.
3. At least one directed agent-to-agent pair is represented.
4. Reflections are evidence-backed, tagged as `post-interaction-reflection`, and meet a minimum mean
   confidence.

The default status is `pass` when thresholds are met and `watch` otherwise. Invalid rows still throw
before report emission because corrupt validation evidence should not silently become a watch.

## Worker Integration

`createWorkerExperimentValidationReport` accepts optional `socialReflectionObservations` and passes
them into observability. `runLocalExperimentValidationSchedule` adds an optional
`socialReflectionObservationSource` query. When configured, it queries the durable
`socialReflectionObservationRepository` for the current simulation and partition and forwards the
bounded rows to the report.

## Non-Goals

- Do not generate new reflections in the validation layer.
- Do not couple `agent-runtime` to observability validation.
- Do not use this metric to judge language quality yet; that belongs in a later LLM/social cognition
  evaluation slice.

## Verification

- Observability unit tests prove the metric passes for cohort-covered, evidence-backed reflections,
  watches when no reflections exist, and rejects invalid self-targeted observations.
- Worker runner tests prove explicit social reflection rows flow into validation reports.
- Local schedule tests prove durable repository rows can be queried into a validation report.
- Full `pnpm check` remains the final phase gate.
