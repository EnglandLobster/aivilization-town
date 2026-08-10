# Social Interaction Reflection Artifact Design

## Purpose

Move social interaction handling closer to the AIvilization paper's post-interaction reflection
phase. The backend already records social STM and aggregates repeated social memories into
long-term profile entries. This slice adds an immediate, provenance-preserving reflection artifact
for each authoritative social interaction memory so a single interaction is explainable before it
becomes a repeated long-term pattern.

## Paper Alignment

Section 2.2.1 states that each social event triggers a post-interaction reflection phase that
updates internal social models and feeds memory systems. Existing `SocialInteractionCompleted`
events update world relationship projections, and existing STM consolidation updates
`socialRecords`. The remaining gap is observability and explicitness: consolidation applies social
patches, but it does not expose an artifact that explains which interaction was reflected, which
target it affected, and how relation and attitude changed.

## Design Goals

- Keep social reflection in `packages/memory`, because it is a memory/profile interpretation
  concern.
- Keep worker consolidation as orchestration: retrieve records, ask memory for reflections and
  patches, apply patches.
- Preserve existing `proposeLongTermMemoryPatches` behavior and `socialRecords` patches.
- Add deterministic, provenance-preserving social reflection records for single interactions.
- Leave a clean seam for later LLM-backed post-interaction reflection without changing worker
  contracts again.

## Non-Goals

- Do not change world command payloads, event shapes, or social relation projection semantics.
- Do not add a durable social-reflection repository in this slice.
- Do not introduce LLM or embedding dependencies.
- Do not change planner scoring or objective renewal.
- Do not infer broad values or personality from a single interaction.

## Proposed Architecture

Add `packages/memory/src/socialReflection.ts` with:

- `SocialInteractionReflectionRecord`
- `proposeSocialInteractionReflections(input)`

The pure function consumes STM records and returns one reflection artifact per eligible
`social-interaction` record with `consolidationHint.kind = 'social'`.

Eligibility:

- record belongs to `agentId`;
- record kind is `social-interaction`;
- record status is `succeeded`;
- record has a social consolidation hint;
- generated time is finite.

Worker consolidation result grows a read-only `socialReflections` field. The existing patch path
remains:

```text
ShortTermMemoryRecord[]
  -> proposeSocialInteractionReflections()
  -> proposeLongTermMemoryPatches()
  -> proposeReflectiveInsights()
  -> LongTermProfileRepository.applyPatches()
```

## Artifact Contract

Each reflection record is deterministic:

```ts
type SocialInteractionReflectionRecord = {
  readonly id: string;
  readonly agentId: AgentId;
  readonly targetAgentId: AgentId;
  readonly statement: string;
  readonly relationDelta: number;
  readonly attitudeDelta: number;
  readonly confidence: number;
  readonly evidenceRecordIds: readonly MemoryRecordId[];
  readonly generatedAt: SimulationTimestamp;
  readonly tags: readonly string[];
};
```

`statement` should name the target and summarize the reflected interaction. The first deterministic
statement is:

```text
Interaction with <targetAgentId> changed relation by <relationDelta> and attitude by <attitudeDelta>: <summary>
```

`confidence` is the source record's `importanceScore`. `evidenceRecordIds` contains the STM record
id. Tags include `social`, `post-interaction-reflection`, target agent id, and source record tags.

## Testing

- Memory unit tests prove a single successful social-interaction memory creates one reflection
  artifact with stable id, deltas, confidence, tags, and provenance.
- Memory unit tests prove non-social records, other agents' records, and failed social records are
  ignored.
- Worker consolidation integration tests prove `runWorkerMemoryConsolidation()` returns the
  reflection artifact while preserving the existing `socialRecords` patch.

## Future Extensions

- Store social reflection artifacts durably in observability once profile replay panels need them.
- Add LLM-backed reflection behind the same memory-domain contract.
- Add negative or mixed-valence social reflection summaries once harmful interactions are modeled.
- Feed social reflection artifacts into evaluation reports for social-coherence metrics.
