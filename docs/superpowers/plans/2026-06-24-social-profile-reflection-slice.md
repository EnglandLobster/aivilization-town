# Social Profile Reflection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote repeated positive social memories into long-term `values` and `personality` profile entries while preserving existing social record consolidation.

**Architecture:** Keep social profile adaptation inside `packages/memory` reflection. Worker consolidation remains orchestration: retrieve STM, ask memory for hint and reflection patches, then apply `LongTermMemoryPatch` records. World commands, event shapes, and planners do not change in this slice.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, `@aivilization/memory`, `apps/worker`.

---

### Task 1: Memory-Domain Social Profile Reflection

**Files:**

- Modify: `packages/memory/src/reflection.test.ts`
- Modify: `packages/memory/src/reflection.ts`
- Modify: this plan file

- [x] **Step 1: Write failing reflection tests**

Add tests to `packages/memory/src/reflection.test.ts` proving:

- social-interaction STM records with `consolidationHint.kind = 'social'` and at least two distinct target agents produce both `value:community-cooperation` and `personality:sociable` insights;
- repeated social records with one target still avoid profile-wide value/personality insights;
- hinted pattern records are still ignored by study/caution reflection.

Use records like:

```ts
createShortTermMemoryRecord({
  id: 'social-agent-2-1',
  agentId,
  kind: 'social-interaction',
  status: 'succeeded',
  summary: 'Talked with agent-2 about community routines.',
  occurredAt: 1,
  importanceScore: 0.8,
  source: { eventIds: [] },
  tags: ['conversation', 'community', 'agent-2'],
  consolidationHint: {
    kind: 'social',
    targetAgentId: asAgentId('agent-2'),
    relationDelta: 1,
    attitudeDelta: 1,
    summary: 'Talked with agent-2 about community routines.',
  },
})
```

Expected profile-wide insights at `generatedAt: 500`:

```ts
[
  {
    id: 'reflection-agent-1-personality-sociable-500',
    agentId,
    kind: 'personality',
    topicKey: 'sociable',
    statement:
      'Repeated positive social interactions with multiple agents suggest a sociable disposition.',
    confidence: 0.7,
    evidenceRecordIds: ['social-agent-2-1', 'social-agent-3-2'],
    generatedAt: 500,
    tags: ['social', 'personality', 'sociable'],
  },
  {
    id: 'reflection-agent-1-value-community-cooperation-500',
    agentId,
    kind: 'value',
    topicKey: 'community-cooperation',
    statement:
      'Repeated positive social interactions suggest the agent values cooperative community routines.',
    confidence: 0.7,
    evidenceRecordIds: ['social-agent-2-1', 'social-agent-3-2'],
    generatedAt: 500,
    tags: ['social', 'community', 'cooperation', 'value'],
  },
]
```

- [x] **Step 2: Run focused memory test to verify red**

Run:

```bash
pnpm --filter @aivilization/memory test -- reflection.test.ts
```

Expected: FAIL because `ReflectiveInsightKind` does not include `value` or `personality`, and social-hinted records are filtered before reflection.

- [x] **Step 3: Implement social profile insight rules**

Update `packages/memory/src/reflection.ts`:

- extend `ReflectiveInsightKind` to `'habit' | 'caution' | 'value' | 'personality'`;
- keep study and work-caution builders on unhinted records only;
- feed all agent-owned records to social builders;
- add `createSocialProfileInsights()` that filters successful social records, requires at least `minEvidenceCount` records and two distinct target agents, then emits `personality:sociable` and `value:community-cooperation`;
- sort output with existing `compareInsights`.

- [x] **Step 4: Verify focused memory tests**

Run:

```bash
pnpm --filter @aivilization/memory test -- reflection.test.ts
pnpm --filter @aivilization/memory typecheck
```

Expected: PASS.

### Task 2: Long-Term Patch Conversion

**Files:**

- Modify: `packages/memory/src/reflection.test.ts`
- Modify: `packages/memory/src/reflection.ts`
- Modify: this plan file

- [x] **Step 1: Write failing conversion test**

Extend the existing conversion test in `packages/memory/src/reflection.test.ts` with two insights:

```ts
{
  id: 'reflection-agent-1-value-community-cooperation-500',
  agentId,
  kind: 'value',
  topicKey: 'community-cooperation',
  statement:
    'Repeated positive social interactions suggest the agent values cooperative community routines.',
  confidence: 0.7,
  evidenceRecordIds: [asMemoryRecordId('social-agent-2-1'), asMemoryRecordId('social-agent-3-2')],
  generatedAt: 500,
  tags: ['social', 'community', 'cooperation', 'value'],
}
```

and:

```ts
{
  id: 'reflection-agent-1-personality-sociable-500',
  agentId,
  kind: 'personality',
  topicKey: 'sociable',
  statement:
    'Repeated positive social interactions with multiple agents suggest a sociable disposition.',
  confidence: 0.7,
  evidenceRecordIds: [asMemoryRecordId('social-agent-2-1'), asMemoryRecordId('social-agent-3-2')],
  generatedAt: 500,
  tags: ['social', 'personality', 'sociable'],
}
```

Expected patches include:

```ts
{
  id: 'ltm-patch-agent-1-reflection-personality-sociable-500',
  agentId,
  section: 'personality',
  key: 'sociable',
  statement:
    'Repeated positive social interactions with multiple agents suggest a sociable disposition.',
  confidence: 0.7,
  provenanceRecordIds: ['social-agent-2-1', 'social-agent-3-2'],
  proposedAt: 500,
}
```

and:

```ts
{
  id: 'ltm-patch-agent-1-reflection-value-community-cooperation-500',
  agentId,
  section: 'values',
  key: 'community-cooperation',
  statement:
    'Repeated positive social interactions suggest the agent values cooperative community routines.',
  confidence: 0.7,
  provenanceRecordIds: ['social-agent-2-1', 'social-agent-3-2'],
  proposedAt: 500,
}
```

- [x] **Step 2: Run focused memory test to verify red**

Run:

```bash
pnpm --filter @aivilization/memory test -- reflection.test.ts
```

Expected: FAIL until conversion maps `value` and `personality` to LTM sections.

- [x] **Step 3: Implement conversion mapping**

Update `convertReflectiveInsightsToLongTermMemoryPatches()` so:

- `habit` maps to `section: 'habits'`, `key: topicKey`, id segment `habit`;
- `caution` maps to `section: 'beliefs'`, `key: caution:<topicKey>`, id segment `belief`;
- `value` maps to `section: 'values'`, `key: topicKey`, id segment `value`;
- `personality` maps to `section: 'personality'`, `key: topicKey`, id segment `personality`.

- [x] **Step 4: Verify focused memory tests**

Run:

```bash
pnpm --filter @aivilization/memory test -- reflection.test.ts
pnpm --filter @aivilization/memory typecheck
```

Expected: PASS.

### Task 3: Worker Consolidation Integration

**Files:**

- Modify: `apps/worker/src/memoryConsolidation.test.ts`
- Modify: this plan file

- [x] **Step 1: Write worker integration test**

Add a test to `apps/worker/src/memoryConsolidation.test.ts` that appends two social-interaction STM records for the same agent and two distinct targets. Run `runWorkerMemoryConsolidation()` with `minPatternCount: 2`.

Assert:

- `result.reflectiveInsights.map((insight) => insight.kind)` equals `['personality', 'value']`;
- `result.patches` includes two `socialRecords` patches plus `personality` and `values` patches;
- `result.profile.socialRecords` contains one entry per target, and `result.profile.personality` plus `result.profile.values` each contain one entry.

- [x] **Step 2: Run worker test**

Run:

```bash
pnpm --filter @aivilization/worker test -- memoryConsolidation.test.ts
```

Observed: PASS because Task 1 and Task 2 already implemented the memory-domain behavior and worker consolidation is a thin orchestration layer.

- [x] **Step 3: Verify integration after memory implementation**

Run:

```bash
pnpm --filter @aivilization/worker test -- memoryConsolidation.test.ts
pnpm --filter @aivilization/worker typecheck
```

Expected: PASS.

### Task 4: Full Verification And Commit

**Files:**

- Review: all changed files.
- Modify: this plan file.

- [x] **Step 1: Run full verification**

Run:

```bash
pnpm check
pnpm build
git diff --check
```

Expected: all commands pass.

- [x] **Step 2: Commit**

Run:

```bash
git add docs/superpowers/plans/2026-06-24-social-profile-reflection-slice.md packages/memory/src/reflection.test.ts packages/memory/src/reflection.ts apps/worker/src/memoryConsolidation.test.ts
git commit -m "feat: reflect social memories into adaptive profiles"
```
