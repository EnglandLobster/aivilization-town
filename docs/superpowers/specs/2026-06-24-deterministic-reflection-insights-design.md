# Deterministic Reflection Insights Design

## Purpose

Add an explicit reflection layer between short-term memory and long-term profile updates. This moves
the memory system closer to the AIvilization target model: agents should not only store event traces
or consume pre-authored consolidation hints; they should synthesize recurring patterns into stable
beliefs and habits that later planning and objective renewal can use.

## Current Gap

The current memory consolidation path is durable and testable, but it only promotes STM records that
already carry a `consolidationHint`. That is useful for command outcomes and hand-authored domain
signals, but it leaves an important paper capability missing: periodic reflection over raw memory
streams.

The next slice should add deterministic reflection first. This creates the correct architecture slot
without binding the backend to an LLM provider, embedding store, or prompt format too early.

## Design Goals

- Make reflection a first-class memory-domain concept, not a worker-only heuristic.
- Keep reflection deterministic and unit-testable for the bootstrap implementation.
- Preserve provenance from every insight to the STM records that supported it.
- Convert accepted insights into existing `LongTermMemoryPatch` records so current profile
  repositories remain the durable write boundary.
- Keep worker consolidation as orchestration only: retrieve records, ask memory domain to propose
  patches, apply patches.
- Leave a stable seam for later LLM-backed reflection and vector retrieval.

## Non-Goals

- Do not call an LLM in this slice.
- Do not add a durable reflection repository yet; LTM patches are the durable output for now.
- Do not change short-term memory storage or retrieval contracts.
- Do not change planner or world command execution.

## Proposed Architecture

Add a memory-domain reflection module:

```text
ShortTermMemoryRecord[]
  -> proposeReflectiveInsights()
  -> ReflectiveInsightRecord[]
  -> convertReflectiveInsightsToLongTermMemoryPatches()
  -> LongTermProfileRepository.applyPatches()
```

`ReflectiveInsightRecord` is an intermediate domain object:

- `id`
- `agentId`
- `kind`: `habit` or `caution`
- `topicKey`
- `statement`
- `confidence`
- `evidenceRecordIds`
- `generatedAt`
- `tags`

The first deterministic proposer should recognize recurring unhinted patterns:

- repeated successful study records become a study habit insight;
- repeated failed work/energy records become an energy caution insight;
- repeated successful social records for one target become a social habit insight.

The conversion to LTM should map:

- `habit` insights to `LongTermMemoryPatch.section = 'habits'`;
- `caution` insights to `LongTermMemoryPatch.section = 'beliefs'`;
- evidence record ids to `provenanceRecordIds`;
- confidence and generated time directly to the patch.

## Worker Integration

`runWorkerMemoryConsolidation` should keep its existing behavior and add reflective patches after
hint-based patches. The result can remain `patches: LongTermMemoryPatch[]`; no worker caller needs
to know whether a patch came from a hint or reflection.

For observability and debugging, the worker result should also expose `reflectiveInsights`. That
lets tests and future UI surfaces inspect why new LTM entries were created without parsing patch
ids or statements.

## Failure Model

- Empty or insufficient STM context returns no insights and no reflective patches.
- Invalid minimum evidence count fails fast.
- Reflection only uses records belonging to the requested agent.
- If hint-based and reflection-based patches produce the same section/key, repository upsert keeps
  the latest patch while preserving provenance through the normal LTM patch flow.

## Test Strategy

Use TDD at two levels:

- `packages/memory` tests for deterministic reflection:
  - repeated successful study memories produce a habit insight;
  - repeated failed work/energy memories produce a caution insight;
  - records from other agents are ignored;
  - insights convert into LTM patches with stable ids and provenance.
- `apps/worker` tests for integration:
  - unhinted STM records can still update the LTM profile through scheduled consolidation;
  - `WorkerMemoryConsolidationResult.reflectiveInsights` exposes the generated insights.

## Future Extensions

This design leaves room for:

- an LLM-backed `ReflectiveInsightProposer` behind the same input/output contract;
- durable reflection-insight repositories if UI history needs to show insight lifecycles;
- vector/hybrid retrieval before reflection proposal;
- cross-agent reflection over shared social or market events;
- objective-renewal traces that cite insight ids directly.
