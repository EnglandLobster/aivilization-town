# Deterministic Reflection Insights Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic reflection layer that synthesizes recurring unhinted short-term memories into long-term profile patches.

**Architecture:** `@aivilization/memory` owns reflection domain types, insight synthesis, and conversion to `LongTermMemoryPatch`. `apps/worker` remains the orchestration layer: it retrieves STM records, asks memory to propose hint-based patches and reflective insights, applies the combined patches, and exposes insight evidence in the consolidation result.

**Tech Stack:** TypeScript, Vitest, `@aivilization/memory`, `apps/worker`.

---

## Scope

This slice adds reflection without adding LLM calls or new durable stores:

- Add `ReflectiveInsightRecord` and `ReflectiveInsightKind`.
- Add `proposeReflectiveInsights`.
- Add `convertReflectiveInsightsToLongTermMemoryPatches`.
- Export the reflection module from `@aivilization/memory`.
- Make worker memory consolidation include reflective patches and return `reflectiveInsights`.
- Preserve existing hint-based consolidation behavior.

It does not add vector search, prompt-based reflection, cross-agent reflection, or a reflection
repository.

## File Structure

- Add `packages/memory/src/reflection.test.ts`: TDD coverage for insight synthesis and conversion.
- Add `packages/memory/src/reflection.ts`: reflection domain types and deterministic proposer.
- Modify `packages/memory/src/index.ts`: export reflection.
- Modify `apps/worker/src/memoryConsolidation.test.ts`: integration coverage for unhinted STM -> LTM through worker consolidation.
- Modify `apps/worker/src/memoryConsolidation.ts`: include reflective insights and patches.
- Modify this plan file as tasks complete.

## Task 1: Memory Reflection Tests

**Files:**

- Add: `packages/memory/src/reflection.test.ts`

- [ ] **Step 1: Write failing tests for deterministic reflective insights**

Create tests that require:

- three successful study records without `consolidationHint` produce one `habit` insight with
  `topicKey: 'study-routine'`;
- two failed work/energy records produce one `caution` insight with
  `topicKey: 'work-energy-risk'`;
- records for other agents are ignored;
- insights are sorted by kind and topic key for stable output.

Run:

```bash
pnpm test -- packages/memory/src/reflection.test.ts
```

Expected before implementation: fail because `proposeReflectiveInsights` and
`ReflectiveInsightRecord` are not exported.

- [ ] **Step 2: Write failing tests for insight-to-patch conversion**

Add tests that require:

- `habit` insights convert to `LongTermMemoryPatch.section = 'habits'`;
- `caution` insights convert to `LongTermMemoryPatch.section = 'beliefs'` with a
  `caution:` key prefix;
- evidence ids become `provenanceRecordIds`.

Run:

```bash
pnpm test -- packages/memory/src/reflection.test.ts
```

Expected before implementation: fail because conversion is missing.

## Task 2: Memory Reflection Implementation

**Files:**

- Add: `packages/memory/src/reflection.ts`
- Modify: `packages/memory/src/index.ts`

- [ ] **Step 3: Implement reflection domain types and proposer**

Add:

```ts
export type ReflectiveInsightKind = 'habit' | 'caution';

export type ReflectiveInsightRecord = {
  readonly id: string;
  readonly agentId: AgentId;
  readonly kind: ReflectiveInsightKind;
  readonly topicKey: string;
  readonly statement: string;
  readonly confidence: number;
  readonly evidenceRecordIds: readonly MemoryRecordId[];
  readonly generatedAt: SimulationTimestamp;
  readonly tags: readonly string[];
};
```

`proposeReflectiveInsights(input)` should:

- validate `minEvidenceCount` as a positive integer and `generatedAt` as finite;
- filter records to the requested agent;
- recognize repeated successful study memories from tags or summary;
- recognize repeated failed work/energy memories from tags or summary;
- create stable ids using `reflection-${agentId}-${kind}-${topicKey}-${generatedAt}`;
- set confidence to average importance rounded to six decimals.

- [ ] **Step 4: Implement conversion to long-term memory patches**

`convertReflectiveInsightsToLongTermMemoryPatches(input)` should map insights to patch ids:

- `ltm-patch-${agentId}-reflection-habit-${topicKey}-${generatedAt}`;
- `ltm-patch-${agentId}-reflection-belief-${topicKey}-${generatedAt}`.

Export `./reflection` from `packages/memory/src/index.ts`.

- [ ] **Step 5: Verify memory package**

Run:

```bash
pnpm --filter @aivilization/memory test
pnpm --filter @aivilization/memory typecheck
```

Expected after implementation: pass.

## Task 3: Worker Integration Tests

**Files:**

- Modify: `apps/worker/src/memoryConsolidation.test.ts`

- [ ] **Step 6: Write failing worker integration tests**

Add a test that appends three unhinted successful study memories, runs
`runWorkerMemoryConsolidation`, and expects:

- `result.reflectiveInsights` contains the `study-routine` habit insight;
- `result.patches` contains a reflection-derived habit patch;
- `result.profile.habits` contains the reflection-derived habit entry.

Run:

```bash
pnpm test -- apps/worker/src/memoryConsolidation.test.ts
```

Expected before worker implementation: fail because `reflectiveInsights` is missing and unhinted
records do not update LTM.

## Task 4: Worker Integration Implementation

**Files:**

- Modify: `apps/worker/src/memoryConsolidation.ts`

- [ ] **Step 7: Include reflective insights in consolidation**

Modify `WorkerMemoryConsolidationResult` to include:

```ts
readonly reflectiveInsights: readonly ReflectiveInsightRecord[];
```

In `runWorkerMemoryConsolidation`:

- call `proposeReflectiveInsights` with the same records, agent id, min pattern count, and proposed
  time;
- convert insights to patches;
- apply `[...hintPatches, ...reflectivePatches]`;
- return combined patches and `reflectiveInsights`.

- [ ] **Step 8: Preserve schedule and batch callers**

Batch and scheduled consolidation should keep using `patchCount` from combined patch results. No
caller should need a separate code path for hint-derived versus reflection-derived patches.

## Task 5: Verification And Commit

**Files:**

- Modify: this plan file

- [ ] **Step 9: Run focused verification**

Run:

```bash
pnpm test -- packages/memory/src/reflection.test.ts apps/worker/src/memoryConsolidation.test.ts
pnpm --filter @aivilization/memory test
pnpm --filter @aivilization/worker test
pnpm --filter @aivilization/memory typecheck
pnpm --filter @aivilization/worker typecheck
```

- [ ] **Step 10: Run repo verification**

Run:

```bash
pnpm check
pnpm build
```

- [ ] **Step 11: Commit implementation**

Commit command:

```bash
git add docs/superpowers/plans/2026-06-24-deterministic-reflection-insights-slice.md packages/memory/src/reflection.test.ts packages/memory/src/reflection.ts packages/memory/src/index.ts apps/worker/src/memoryConsolidation.test.ts apps/worker/src/memoryConsolidation.ts
git commit -m "feat: synthesize reflective memory insights"
```
