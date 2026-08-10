# Durable Social Reflection Observations Design

## Purpose

Make post-interaction social reflection durable and queryable without coupling future Godot/API
surfaces to memory consolidation internals. The previous slice creates
`SocialInteractionReflectionRecord` values during worker memory consolidation, but those records are
currently transient. This slice turns them into observability-owned read-model rows.

## Paper Alignment

The AIvilization paper treats social interaction as a loop: dialogue and interaction update an
agent's internal social model, then reflection feeds memory and later behavior. The backend already
records social STM, applies long-term social profile patches, and emits immediate social reflection
artifacts. The remaining backend gap is replayability: a large game backend needs those reflections
to survive process restarts and be queryable by simulation, partition, agent, target, and time.

## Design Goals

- Keep `packages/memory` as the owner of reflection synthesis.
- Keep `packages/observability` as the owner of durable diagnostic/read-model storage.
- Avoid making observability depend on memory types; map records at the worker boundary.
- Record social reflection observations idempotently during scheduled memory consolidation.
- Expose the file-backed repository through local runtime storage so future API/Godot surfaces can
  query the read model without touching memory repositories.

## Non-Goals

- Do not add HTTP endpoints in this slice.
- Do not add LLM-generated reflection text.
- Do not change social world events, relation projection, or long-term profile patch semantics.
- Do not infer extra values/personality beyond existing consolidation behavior.

## Proposed Architecture

Add an observability repository:

```ts
type SocialReflectionObservation = {
  readonly observationId: string;
  readonly simulationId: string;
  readonly partitionKey: string;
  readonly reflectionId: string;
  readonly agentId: string;
  readonly targetAgentId: string;
  readonly statement: string;
  readonly relationDelta: number;
  readonly attitudeDelta: number;
  readonly confidence: number;
  readonly evidenceRecordIds: readonly string[];
  readonly generatedAt: number;
  readonly tags: readonly string[];
  readonly source: 'memory-consolidation';
};
```

`packages/observability` provides in-memory and JSONL file-backed implementations with idempotent
`record()` and query filters for simulation, partition, agent, target, and generated-at window.

Worker scheduled consolidation accepts an optional sink:

```ts
socialReflectionObservationSink?: {
  repository: SocialReflectionObservationRepository;
  simulationId: string;
  partitionKey: PartitionKey;
}
```

When present, the scheduler maps each memory-domain reflection to a social reflection observation
and records it after all agent consolidation results are known. Lifecycle wiring passes the local
runtime storage repository automatically.

## Testing

- Observability repository tests cover idempotent writes, cloned query results, filtering, stable
  chronological ordering, file persistence, and validation errors.
- Worker consolidation tests prove scheduled consolidation writes observations and reports the
  observation count without changing patch/profile behavior.
- Local runtime storage tests prove the file-backed social reflection observation repository
  survives storage restart.

## Future Extensions

- Add API query ports and HTTP endpoints for social reflection observations.
- Feed social reflection observations into social-coherence validation metrics.
- Add LLM-backed reflection behind the same memory-domain contract.
- Add cross-agent/group reflection aggregation once group social events exist.
