# Memory Context Influence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make retrieved short-term memory a first-class input to agent planning so recent, important, relevant experiences can influence subtask selection and appear in cycle traces.

**Architecture:** `@aivilization/memory` remains the source of STM records and retrieval. `@aivilization/agent-runtime` owns deterministic scoring of already-retrieved memory context against subtask affinity tags. `apps/worker` owns repository access and trace wiring.

**Tech Stack:** TypeScript, Vitest, `@aivilization/agent-runtime`, `@aivilization/memory`, `@aivilization/observability`, `apps/worker`.

---

## Scope

This slice adds retrieval-enhanced planning without introducing a vector store or LLM semantic search:

- Add `memoryAffinityTags` to planner subtasks.
- Add deterministic STM influence scoring based on tag relevance, summary relevance, importance, status, and recency.
- Allow `runAgentPlanningCycle` to receive short-term memory context and include memory influence in subtask selection.
- Let `runWorkerAgentCycle` retrieve STM context before planning.
- Add `memoryContextIds` to agent cycle traces.

It does not add embeddings, hybrid search, cross-agent memory sharing, reflection prompts, or vector persistence.

## File Structure

- Add `packages/agent-runtime/src/memoryInfluence.test.ts`: TDD coverage for STM scoring.
- Add `packages/agent-runtime/src/memoryInfluence.ts`: deterministic memory influence scorer.
- Modify `packages/agent-runtime/src/planner.ts`: add `memoryAffinityTags` and `memoryInfluence`.
- Modify `packages/agent-runtime/src/cycle.ts`: pass memory influence into planner selection.
- Modify `packages/agent-runtime/src/cycle.test.ts`: prove STM context can flip subtask selection.
- Modify `packages/agent-runtime/src/index.ts`: export memory influence.
- Modify `packages/observability/src/agentCycleTrace.ts`: trace memory context ids.
- Modify `packages/observability/src/agentCycleTrace.test.ts`: cover trace shape.
- Modify `apps/worker/src/agentCycleRunner.ts`: retrieve STM context and trace ids.
- Modify `apps/worker/src/agentCycleRunner.test.ts`: prove worker retrieves memory before planning.
- Modify this plan file as tasks complete.

## Task 1: Memory Influence Tests

**Files:**

- Add: `packages/agent-runtime/src/memoryInfluence.test.ts`

- [ ] **Step 1: Write failing tests for STM influence scoring**

Create tests that require:

- Relevant memory tags or summaries match subtask affinity tags.
- Contributions include importance, status weight, and recency.
- Matches are deterministic and empty affinity tags score zero.

Run:

```bash
pnpm --filter @aivilization/agent-runtime test
```

Expected before implementation: tests fail because memory influence scoring is missing.

## Task 2: Agent Runtime Planning Tests

**Files:**

- Modify: `packages/agent-runtime/src/cycle.test.ts`
- Modify: `packages/agent-runtime/src/planner.ts`

- [ ] **Step 2: Write failing tests for memory-aware subtask selection**

Create tests that require:

- A recent high-importance failure memory can lift a safer subtask above a higher-base-priority risky subtask.
- Existing cycles without memory context keep the current behavior.

Run:

```bash
pnpm --filter @aivilization/agent-runtime test
```

Expected before implementation: tests fail because subtasks do not accept memory affinity and cycles ignore STM context.

## Task 3: Worker Trace Tests

**Files:**

- Modify: `apps/worker/src/agentCycleRunner.test.ts`
- Modify: `packages/observability/src/agentCycleTrace.test.ts`

- [ ] **Step 3: Write failing tests for worker memory context wiring**

Create tests that require:

- Worker retrieves STM context before planning when `memoryRetrievalLimit` is provided.
- The retrieved memory ids are included in `AgentCycleTrace.memoryContextIds`.

Run:

```bash
pnpm --filter @aivilization/worker test
pnpm --filter @aivilization/observability test
```

Expected before implementation: tests fail because worker does not retrieve planning memory and traces do not expose memory context ids.

## Task 4: Implementation

**Files:**

- Add: `packages/agent-runtime/src/memoryInfluence.ts`
- Modify: `packages/agent-runtime/src/index.ts`
- Modify: `packages/agent-runtime/src/planner.ts`
- Modify: `packages/agent-runtime/src/cycle.ts`
- Modify: `packages/observability/src/agentCycleTrace.ts`
- Modify: `apps/worker/src/agentCycleRunner.ts`

- [ ] **Step 4: Implement memory-aware planning context**

Behavior:

- `PlannerSubtask.memoryAffinityTags` is optional and copied defensively.
- `scoreMemoryInfluence` normalizes tags, matches against `record.tags` and `record.summary`, and returns sorted matches.
- `runAgentPlanningCycle` builds memory influence scores by subtask when STM context is provided.
- `runWorkerAgentCycle` retrieves `{ agentId, limit: memoryRetrievalLimit }` before planning when the limit is provided.
- Trace includes `memoryContextIds` for auditability.

## Task 5: Verification

**Files:**

- Modify: this plan file

- [ ] **Step 5: Run focused and full verification**

Run:

```bash
pnpm --filter @aivilization/agent-runtime test
pnpm --filter @aivilization/worker test
pnpm --filter @aivilization/observability test
pnpm --filter @aivilization/agent-runtime typecheck
pnpm --filter @aivilization/worker typecheck
pnpm --filter @aivilization/observability typecheck
pnpm check
pnpm build
```

Commit the implementation and update this plan when the checks pass.
