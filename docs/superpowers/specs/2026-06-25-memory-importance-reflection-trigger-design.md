# Memory Importance Reflection Trigger Design

## Purpose

The project already has deterministic reflection: short-term memories can synthesize into
long-term profile entries through `runWorkerMemoryConsolidationSchedule`. What is still missing
from the paper loop is the trigger. In Generative Agents, reflection is not just a fixed periodic
batch job; it is triggered when the accumulated importance of recent observations exceeds a
threshold. This lets ordinary low-signal events wait while meaningful experience quickly produces
higher-level inferences.

This slice adds an optional importance gate to scheduled worker memory consolidation.

## Architecture

Keep reflection generation where it already belongs:

- `packages/memory` owns deterministic reflection rules and LTM patch conversion.
- `apps/worker/src/memoryConsolidation.ts` owns orchestration, cursoring, and now the trigger gate.
- lifecycle/supervisor callers continue to treat memory consolidation as an optional scheduled
  backend job.

```text
runWorkerMemoryConsolidationSchedule
  -> read agent cursor
  -> retrieve pending STM after cursor, oldest-first
  -> sum pending importanceScore
  -> if below threshold: report skipped, do not advance cursor
  -> if threshold met: run existing consolidation/reflection, apply patches, advance cursor
```

The trigger is optional. Existing schedules without a trigger keep their current eager behavior.

## Trigger Contract

Add:

```ts
reflectionTrigger?: {
  readonly minimumImportanceScore: number;
}
```

to scheduled memory consolidation inputs. The threshold is a domain score over the repository's
normalized `importanceScore` values. The paper uses a much larger raw 1-10 cumulative threshold;
this backend stores importance in `[0, 1]`, so callers choose an equivalent normalized threshold.

## Cursor Semantics

When an agent is skipped because pending importance is below threshold, the cursor is not advanced.
Those memories remain pending and can contribute to the next scheduled run. This preserves the
paper's "accumulated since last reflection" behavior.

When the threshold is met, the existing consolidation result determines the cursor from processed
records exactly as before.

## Observability

Scheduled results include skipped-agent metadata:

- `agentId`
- `pendingRecordCount`
- `pendingImportanceScore`
- `minimumImportanceScore`
- `reason: "importance-threshold-not-met"`

Existing `results`, `cursors`, and `patchCount` keep their current meanings: actual consolidation
work that ran.

## Invariants

- No trigger configured means no behavior change.
- Invalid thresholds fail at the worker boundary.
- Below-threshold skips never mutate LTM profiles.
- Below-threshold skips never advance cursors.
- At-threshold-or-above runs existing consolidation and cursoring unchanged.

## Out Of Scope

- LLM-based question generation for reflection.
- A durable skipped-trigger repository.
- Adaptive thresholds by personality or scenario.
- Re-scaling all existing `importanceScore` values.
