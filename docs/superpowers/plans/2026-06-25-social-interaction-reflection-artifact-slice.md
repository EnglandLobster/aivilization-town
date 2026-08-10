# Social Interaction Reflection Artifact Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add immediate, provenance-preserving post-interaction social reflection artifacts for
single social STM records.

**Architecture:** `packages/memory` owns the pure social reflection proposer. Worker consolidation
adds the reflection artifacts to its result while preserving existing long-term patch semantics.
World commands, planner scoring, objective renewal, and repositories do not change in this slice.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, `@aivilization/memory`, `apps/worker`.

---

### Task 1: Memory-Domain Social Reflection Artifact

**Files:**

- Create: `packages/memory/src/socialReflection.ts`
- Create: `packages/memory/src/socialReflection.test.ts`
- Modify: `packages/memory/src/index.ts`

- [x] **Step 1: Write failing memory tests**

Add tests proving:

- one successful `social-interaction` STM record with `consolidationHint.kind = 'social'` creates
  one deterministic `SocialInteractionReflectionRecord`;
- failed social records are ignored;
- records for another agent are ignored;
- ordinary action records are ignored.

Use this expected reflection:

```ts
{
  id: 'social-reflection-agent-1-agent-2-social-1-100',
  agentId: asAgentId('agent-1'),
  targetAgentId: asAgentId('agent-2'),
  statement:
    'Interaction with agent-2 changed relation by 0.25 and attitude by 0.5: Shared food after work.',
  relationDelta: 0.25,
  attitudeDelta: 0.5,
  confidence: 0.8,
  evidenceRecordIds: ['social-1'],
  generatedAt: 100,
  tags: [
    'social',
    'post-interaction-reflection',
    'agent-2',
    'conversation',
    'community',
  ],
}
```

- [x] **Step 2: Run memory test to verify RED**

Run:

```bash
pnpm --filter @aivilization/memory test -- socialReflection.test.ts
```

Expected: FAIL because `socialReflection.ts` does not exist.

- [x] **Step 3: Implement memory social reflection proposer**

Create `proposeSocialInteractionReflections(input)`:

```ts
export function proposeSocialInteractionReflections(input: {
  readonly agentId: AgentId;
  readonly records: readonly ShortTermMemoryRecord[];
  readonly generatedAt: SimulationTimestamp;
}): SocialInteractionReflectionRecord[];
```

Implementation requirements:

- validate `generatedAt` is finite;
- filter to matching `agentId`;
- require `kind: 'social-interaction'`, `status: 'succeeded'`, and social consolidation hints;
- sort records by `occurredAt` then id;
- create deterministic ids `social-reflection-<agentId>-<targetAgentId>-<recordId>-<generatedAt>`;
- clone evidence ids and tags;
- export the module from `packages/memory/src/index.ts`.

- [x] **Step 4: Run memory test to verify GREEN**

Run:

```bash
pnpm --filter @aivilization/memory test -- socialReflection.test.ts
pnpm --filter @aivilization/memory typecheck
```

Expected: PASS.

### Task 2: Worker Consolidation Integration

**Files:**

- Modify: `apps/worker/src/memoryConsolidation.ts`
- Modify: `apps/worker/src/memoryConsolidation.test.ts`

- [x] **Step 1: Write failing worker integration test**

Add a test to `apps/worker/src/memoryConsolidation.test.ts` that appends one successful
social-interaction STM record and runs `runWorkerMemoryConsolidation()` with `minPatternCount: 3`.

Assert:

- `result.socialReflections` contains exactly one reflection artifact;
- `result.patches` still contains the existing `socialRecords` patch;
- `result.reflectiveInsights` is empty, proving the single interaction did not infer broad values
  or personality.

- [x] **Step 2: Run worker test to verify RED**

Run:

```bash
pnpm --filter @aivilization/worker test -- memoryConsolidation.test.ts
```

Expected: FAIL because `WorkerMemoryConsolidationResult` has no `socialReflections` field.

- [x] **Step 3: Wire social reflections into worker consolidation**

In `apps/worker/src/memoryConsolidation.ts`:

- import `proposeSocialInteractionReflections` and `SocialInteractionReflectionRecord`;
- add `readonly socialReflections: readonly SocialInteractionReflectionRecord[]` to
  `WorkerMemoryConsolidationResult`;
- compute social reflections from the same retrieved records before patch application;
- include `socialReflections` in the returned result.

- [x] **Step 4: Run worker test to verify GREEN**

Run:

```bash
pnpm --filter @aivilization/worker test -- memoryConsolidation.test.ts
pnpm --filter @aivilization/worker typecheck
```

Expected: PASS.

### Task 3: Verification And Commit

**Files:**

- Verify all files touched in this slice.

- [x] **Step 1: Run focused tests**

Run:

```bash
pnpm --filter @aivilization/memory test -- socialReflection.test.ts reflection.test.ts consolidation.test.ts
pnpm --filter @aivilization/worker test -- memoryConsolidation.test.ts
```

- [x] **Step 2: Run type and format checks**

Run:

```bash
pnpm --filter @aivilization/memory typecheck
pnpm --filter @aivilization/worker typecheck
pnpm exec prettier --check docs/superpowers/specs/2026-06-25-social-interaction-reflection-artifact-design.md docs/superpowers/plans/2026-06-25-social-interaction-reflection-artifact-slice.md packages/memory/src/socialReflection.ts packages/memory/src/socialReflection.test.ts packages/memory/src/index.ts apps/worker/src/memoryConsolidation.ts apps/worker/src/memoryConsolidation.test.ts
```

- [x] **Step 3: Run repository verification**

Run:

```bash
pnpm check
git diff --check
```

- [x] **Step 4: Commit**

Stage only this slice:

```bash
git add docs/superpowers/specs/2026-06-25-social-interaction-reflection-artifact-design.md docs/superpowers/plans/2026-06-25-social-interaction-reflection-artifact-slice.md packages/memory/src/socialReflection.ts packages/memory/src/socialReflection.test.ts packages/memory/src/index.ts apps/worker/src/memoryConsolidation.ts apps/worker/src/memoryConsolidation.test.ts
git commit -m "feat(memory): 增加社交互动即时反思产物"
```
