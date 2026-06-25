# Memory Context Relevance Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Select short-term memory context by current plan relevance before agent planning.

**Architecture:** Add a focused worker module that ranks repository candidate memories using
branch-plan `memoryAffinityTags` and current signal keys. Keep storage retrieval in memory
repositories and subtask scoring in agent-runtime.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, `apps/worker`, `apps/server`.

---

## Scope

- Create `apps/worker/src/memoryContextSelection.ts`.
- Add unit tests for affinity-first ordering and fallback ordering.
- Use the selector in `runWorkerAgentCycle`.
- Add optional candidate-window plumbing through tick scheduling and profile runner inputs.
- Preserve existing trace shape and final `memoryContextIds` behavior.

## Task 1: Failing Selector Tests

**Files:**

- Create: `apps/worker/src/memoryContextSelection.test.ts`
- Modify: `apps/worker/src/index.ts`

- [x] **Step 1: Test affinity-first memory context selection**

Create a test where a lower-importance `energy` failure outranks a higher-importance unrelated
market observation when the plan has a subtask with `memoryAffinityTags: ["energy"]`.

- [x] **Step 2: Test fallback ordering**

Create a test where a plan has no memory affinity tags and no signals. Assert the selected context
falls back to importance, recency, then id.

Run:

```bash
pnpm --filter @aivilization/worker test -- memoryContextSelection.test.ts
```

Expected: FAIL because the module does not exist.

Observed: failed because `./memoryContextSelection` did not exist.

## Task 2: Selector Implementation

**Files:**

- Create: `apps/worker/src/memoryContextSelection.ts`
- Modify: `apps/worker/src/index.ts`

- [x] **Step 3: Implement selector**

Export:

```ts
export function selectRelevantShortTermMemoryContext(input: {
  readonly records: readonly ShortTermMemoryRecord[];
  readonly plan: BranchPlan;
  readonly signals: readonly ContextSignal[];
  readonly issuedAt: SimulationTimestamp;
  readonly limit: number;
  readonly recencyWindow?: number;
}): readonly ShortTermMemoryRecord[]
```

The function should:

- validate `limit` is a positive integer;
- collect unique affinity tags from subtask `memoryAffinityTags` and signal keys;
- score each record via `scoreMemoryInfluence({ records: [record], affinityTags, at })`;
- rank positive scores before zero-score records;
- tie-break by importance, occurredAt, then id;
- fall back to importance ordering when no affinity tags exist.

- [x] **Step 4: Run selector test**

Run:

```bash
pnpm --filter @aivilization/worker test -- memoryContextSelection.test.ts
```

Expected: PASS.

Observed: selector tests passed after adding `memoryContextSelection.ts`.

## Task 3: Worker Cycle Integration

**Files:**

- Modify: `apps/worker/src/agentCycleRunner.ts`
- Modify: `apps/worker/src/agentCycleRunner.test.ts`

- [x] **Step 5: Write failing integration test**

Add a test to `agentCycleRunner.test.ts` where `memoryRetrievalLimit: 1` and the repository stores
a higher-importance unrelated record plus a lower-importance relevant `energy` failure. Assert the
trace selects the relevant memory id and the `sleep` subtask.

Observed: failed because the trace selected `market-shock`, the higher-importance unrelated
record.

- [x] **Step 6: Implement integration**

Resolve the branch plan before STM retrieval, retrieve `memoryRetrievalCandidateLimit` candidates
or `memoryRetrievalLimit * 4` by default, select the final context via
`selectRelevantShortTermMemoryContext`, and pass the selected context to `runAgentPlanningCycle`.

- [x] **Step 7: Run worker integration tests**

Run:

```bash
pnpm --filter @aivilization/worker test -- agentCycleRunner.test.ts memoryContextSelection.test.ts
pnpm --filter @aivilization/worker typecheck
```

Expected: PASS.

Observed:

- `pnpm --filter @aivilization/worker test -- agentCycleRunner.test.ts memoryContextSelection.test.ts` passed.
- `pnpm --filter @aivilization/worker typecheck` passed.

## Task 4: Candidate Window Plumbing

**Files:**

- Modify: `apps/worker/src/tickRunner.ts`
- Modify: `apps/worker/src/agentScheduling.ts`
- Modify: `apps/worker/src/agentScheduling.test.ts`
- Modify: `apps/worker/src/canonicalActivePlanTick.ts`
- Modify: `apps/server/src/localRuntimeTownProfileRunner.ts`

- [x] **Step 8: Expose candidate-window options**

Add optional `memoryRetrievalCandidateLimit` alongside `memoryRetrievalLimit` on worker tick agent
inputs and active-plan scheduling inputs. Pass it through canonical active-plan tick and profile
runner inputs. Keep profile defaults to `memoryRetrievalLimit` only so the cycle's default
multiplier remains central.

- [x] **Step 9: Run routing tests**

Run:

```bash
pnpm --filter @aivilization/worker test -- tickRunner.test.ts agentScheduling.test.ts canonicalActivePlanTick.test.ts
pnpm --filter @aivilization/server test -- localRuntimeTownProfileRunner.test.ts
```

Expected: PASS.

Observed:

- `pnpm --filter @aivilization/worker test -- agentCycleRunner.test.ts memoryContextSelection.test.ts tickRunner.test.ts agentScheduling.test.ts canonicalActivePlanTick.test.ts` passed.
- `pnpm --filter @aivilization/server test -- localRuntimeTownProfileRunner.test.ts` passed.
- `pnpm --filter @aivilization/server typecheck` passed.

## Task 5: Full Verification And Commit

- [x] **Step 10: Full checks**

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

Observed:

- `pnpm lint` passed.
- `pnpm typecheck` passed.
- `pnpm test` passed with 142 test files and 696 tests.
- `pnpm build` passed.
- `git diff --check` passed.

- [x] **Step 11: Inspect and commit**

Confirm the diff is limited to memory-context relevance selection, routing tests, worker/server
plumbing, and this slice's docs.

Observed: diff is limited to memory-context relevance selection, routing tests, worker/server
plumbing, and this slice's docs.

Commit with:

```bash
git add docs/superpowers/specs/2026-06-25-memory-context-relevance-selection-design.md docs/superpowers/plans/2026-06-25-memory-context-relevance-selection-slice.md apps/worker/src/memoryContextSelection.ts apps/worker/src/memoryContextSelection.test.ts apps/worker/src/index.ts apps/worker/src/agentCycleRunner.ts apps/worker/src/agentCycleRunner.test.ts apps/worker/src/tickRunner.ts apps/worker/src/agentScheduling.ts apps/worker/src/agentScheduling.test.ts apps/worker/src/canonicalActivePlanTick.ts apps/server/src/localRuntimeTownProfileRunner.ts
git commit -m "feat: select relevant memory context for agent cycles"
```
