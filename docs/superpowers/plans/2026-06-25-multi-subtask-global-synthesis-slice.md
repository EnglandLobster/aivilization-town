# Multi-Subtask Global Synthesis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each planning cycle collect action proposals from multiple prioritized subtasks before global synthesis, so active branches can be interleaved instead of only the top subtask contributing actions.

**Architecture:** Keep candidate scoring in `planner.ts`, proposal generation in domain micro-planners, and global action ranking in `actionSynthesis.ts`. `cycle.ts` becomes the orchestration boundary that selects top-N subtask candidates, asks supporting micro-planners for each selected candidate, attaches branch/subtask synthesis context, and sends the combined action pool through existing synthesis and simulator validation.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, `@aivilization/agent-runtime`, `apps/worker`.

---

## Scope

- Extend `ActionSynthesisPolicy` with `candidateSubtasks.maxSubtasks`.
- Preserve existing default behavior: without `candidateSubtasks`, only the top selected subtask proposes actions.
- Allow top-N selectable subtasks to propose actions when configured.
- Simulate each accepted action against the subtask that produced it.
- Preserve `AgentCycleResult.selectedSubtask` and selection evidence as the top candidate for backward compatibility.
- Keep multi-subtask progress completion for a later slice; this slice makes action proposal and execution branch-aware first.

## Task 1: Agent Runtime Multi-Subtask Proposals

**Files:**

- Modify: `packages/agent-runtime/src/cycle.test.ts`
- Modify: `packages/agent-runtime/src/actionSynthesis.test.ts`
- Modify: `packages/agent-runtime/src/actionSynthesis.ts`
- Modify: `packages/agent-runtime/src/cycle.ts`

- [x] **Step 1: Write failing cycle test**

Add a test proving:

- a plan has two selectable branches: `income/work` and `development/study`;
- `actionSynthesis.candidateSubtasks.maxSubtasks = 2`;
- both the work and study micro-planners produce actions in one cycle;
- simulation receives `work` for the work action and `study` for the study action;
- `actionSynthesisResult.acceptedActions` includes both branch contexts.

Run:

```bash
pnpm --filter @aivilization/agent-runtime test -- cycle.test.ts
```

Expected: FAIL because `runAgentPlanningCycle` only invokes the micro-planner for the top selected subtask.

Observed red: `simulatedActions` only contained `work-1:income/work`.

- [x] **Step 2: Implement candidate subtask policy**

Add to `ActionSynthesisPolicy`:

```ts
readonly candidateSubtasks?: {
  readonly maxSubtasks?: number;
};
```

Validate `maxSubtasks` as a positive integer when supplied. In `cycle.ts`, derive selected candidates:

- default: first candidate only;
- configured: first `maxSubtasks` candidates.

For each selected candidate, find a supporting micro-planner and collect actions. Attach branch/subtask context from the producing candidate. Preserve action-specified context fields when present.

- [x] **Step 3: Simulate using producer subtask context**

When simulating or repairing an accepted action, resolve the selected subtask from its `synthesisContext.branchId/subtaskId`. Fall back to the top selected subtask only if no matching context exists.

## Task 2: Worker Integration Trace

**Files:**

- Modify: `apps/worker/src/agentCycleRunner.test.ts`

- [x] **Step 1: Write failing worker integration test**

Add a worker cycle test that passes `actionSynthesis.candidateSubtasks.maxSubtasks = 2`, supplies sleep and study planners, and expects:

- both actions are simulated;
- trace accepted actions include `recovery/sleep` and `development/study` synthesis contexts;
- emitted command types include both `AgentSleep` and `AgentStudy`.

Run:

```bash
pnpm --filter @aivilization/worker test -- agentCycleRunner.test.ts
```

Expected: FAIL until runtime supports multi-subtask proposal collection.

Observed red: `simulatedActionIds` only contained `sleep-1:recovery/sleep`.

## Task 3: Verification

**Files:**

- Modify: this plan file

- [x] Run focused tests:

```bash
pnpm --filter @aivilization/agent-runtime test -- cycle.test.ts actionSynthesis.test.ts
pnpm --filter @aivilization/worker test -- agentCycleRunner.test.ts
```

- [x] Run focused typechecks:

```bash
pnpm --filter @aivilization/agent-runtime typecheck
pnpm --filter @aivilization/worker typecheck
```

- [x] Run full verification:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

- [x] Inspect `git diff`.
- [x] Commit as `feat: synthesize actions from multiple subtasks`.
