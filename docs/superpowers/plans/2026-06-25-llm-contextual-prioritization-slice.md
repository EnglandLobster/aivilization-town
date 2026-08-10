# LLM Contextual Prioritization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an LLM-capable Contextual Prioritization seam that ranks active branch subtasks using
world state, memory, profile, and market context.

**Architecture:** Keep deterministic candidate generation in `planner.ts`, add a policy layer that
can reorder and rescore only those candidates, then expose an async cycle path for worker execution.
The LLM seam is structured-output only and falls back to deterministic ordering on invalid provider
output.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, `@aivilization/agent-runtime`,
`@aivilization/llm`, `@aivilization/worker`, `@aivilization/observability`.

---

### Task 1: Agent Runtime Prioritizer Contract and LLM Seam

**Files:**

- Create: `packages/agent-runtime/src/subtaskPrioritization.ts`
- Create: `packages/agent-runtime/src/llmSubtaskPrioritizer.ts`
- Test: `packages/agent-runtime/src/llmSubtaskPrioritizer.test.ts`
- Modify: `packages/agent-runtime/src/planner.ts`
- Modify: `packages/agent-runtime/src/index.ts`

- [x] **Step 1: Write failing LLM prioritizer tests**

Add tests that:

- Build deterministic candidates where `work` has a higher base score than `eat`.
- Pass `worldDecisionContext` with low satiety, current inventory, balance, education,
  residential tier, and Fish spot price.
- Script an LLM response ranking `eat` above `work` with rationales.
- Assert the provider request contains `worldDecisionContext`, `"satiety":30`,
  `"balance":191696904`, `"Fish":46`, and `"spotPrice":304.5`.
- Assert accepted candidates are ordered `eat`, `work`, and `eat.scoreBreakdown` includes
  `contextualReasoningScore`.
- Add invalid-ranking fallback coverage where the LLM references an unknown subtask and the result
  returns deterministic ordering.

Run:

```bash
pnpm --filter @aivilization/agent-runtime test -- llmSubtaskPrioritizer.test.ts
```

Expected RED: compile fails because the prioritizer module does not exist.

- [x] **Step 2: Implement prioritization contracts**

Add:

- `SubtaskPrioritizer`
- `SubtaskPrioritizerInput`
- `SubtaskPrioritizationResult`
- `SubtaskPrioritizationTrace`
- `applySubtaskPrioritizationChoices`

The choice applier must require complete, duplicate-free coverage of the deterministic candidate
set and reject unknown `(branchId, subtaskId)` pairs.

- [x] **Step 3: Implement structured LLM prioritizer**

Add `proposeSubtaskPrioritizationWithLlm` and `createTraceableLlmSubtaskPrioritizer`. The prompt
must include active plan, deterministic candidates, signals, intention state, STM context,
long-term profile, and world decision context. The schema must parse:

```ts
{
  rankedSubtasks: [
    { branchId: string, subtaskId: string, priorityScore: number, rationale: string },
  ];
}
```

Invalid schema or invariant failure must return deterministic fallback candidates with a trace.

- [x] **Step 4: Verify green**

Run:

```bash
pnpm --filter @aivilization/agent-runtime test -- llmSubtaskPrioritizer.test.ts
```

Expected GREEN.

### Task 2: Async Cycle Integration

**Files:**

- Modify: `packages/agent-runtime/src/cycle.ts`
- Test: `packages/agent-runtime/src/cycle.test.ts`

- [x] **Step 1: Write failing cycle test**

Add a test for `runAgentPlanningCycleWithPrioritization` where:

- deterministic scoring would select `work`;
- an injected async prioritizer ranks `eat` first;
- the micro-planner and simulator receive `eat`;
- `result.prioritizationTrace.source` reflects the injected policy.

Run:

```bash
pnpm --filter @aivilization/agent-runtime test -- cycle.test.ts
```

Expected RED: async cycle entrypoint does not exist.

- [x] **Step 2: Refactor cycle execution around prepared candidates**

Keep `runAgentPlanningCycle` deterministic and synchronous. Extract shared execution over a prepared
candidate list, then add `runAgentPlanningCycleWithPrioritization` that awaits an optional
`subtaskPrioritizer`.

- [x] **Step 3: Verify green**

Run:

```bash
pnpm --filter @aivilization/agent-runtime test -- cycle.test.ts llmSubtaskPrioritizer.test.ts
```

Expected GREEN.

### Task 3: Worker Wiring and Observability

**Files:**

- Modify: `apps/worker/src/agentCycleRunner.ts`
- Modify: `apps/worker/src/tickRunner.ts`
- Test: `apps/worker/src/agentCycleRunner.test.ts`
- Test: `apps/worker/src/tickRunner.test.ts`
- Modify: `packages/observability/src/agentCycleTrace.ts`
- Modify: `packages/observability/src/agentCycleTraceRepository.ts`
- Test: `packages/observability/src/agentCycleTrace.test.ts`
- Test: `packages/observability/src/agentCycleTraceRepository.test.ts`

- [x] **Step 1: Write failing worker and trace tests**

Add tests proving:

- `runWorkerAgentCycle` accepts a `subtaskPrioritizer` and executes the prioritized subtask.
- `runWorkerSimulationTick` passes each tick agent's prioritizer into the cycle runner.
- Agent cycle traces include contextual prioritization source and rationales.
- File-backed trace repositories round-trip the new trace fields.

Run:

```bash
pnpm --filter @aivilization/worker test -- agentCycleRunner.test.ts tickRunner.test.ts
pnpm --filter @aivilization/observability test -- agentCycleTrace.test.ts agentCycleTraceRepository.test.ts
```

Expected RED: worker input and trace fields do not exist.

- [x] **Step 2: Implement worker and trace pass-through**

Wire `subtaskPrioritizer` through tick and cycle inputs, call
`runAgentPlanningCycleWithPrioritization`, map prioritization traces into observability, and clone
the new fields in repositories.

- [x] **Step 3: Verify green**

Run:

```bash
pnpm --filter @aivilization/worker test -- agentCycleRunner.test.ts tickRunner.test.ts
pnpm --filter @aivilization/observability test -- agentCycleTrace.test.ts agentCycleTraceRepository.test.ts
```

Expected GREEN.

### Task 4: Final Verification and Commit

**Files:**

- Verify all changed files.

- [x] **Step 1: Format changed files**

Run Prettier on all changed files:

```bash
pnpm exec prettier --write docs/superpowers/specs/2026-06-25-llm-contextual-prioritization-design.md docs/superpowers/plans/2026-06-25-llm-contextual-prioritization-slice.md packages/agent-runtime/src/subtaskPrioritization.ts packages/agent-runtime/src/llmSubtaskPrioritizer.ts packages/agent-runtime/src/llmSubtaskPrioritizer.test.ts packages/agent-runtime/src/planner.ts packages/agent-runtime/src/cycle.ts packages/agent-runtime/src/cycle.test.ts packages/agent-runtime/src/index.ts packages/observability/src/agentCycleTrace.ts packages/observability/src/agentCycleTrace.test.ts packages/observability/src/agentCycleTraceRepository.ts packages/observability/src/agentCycleTraceRepository.test.ts apps/worker/src/agentCycleRunner.ts apps/worker/src/agentCycleRunner.test.ts apps/worker/src/tickRunner.ts apps/worker/src/tickRunner.test.ts
```

- [x] **Step 2: Run focused checks**

```bash
pnpm --filter @aivilization/agent-runtime test -- llmSubtaskPrioritizer.test.ts cycle.test.ts
pnpm --filter @aivilization/worker test -- agentCycleRunner.test.ts tickRunner.test.ts
pnpm --filter @aivilization/observability test -- agentCycleTrace.test.ts agentCycleTraceRepository.test.ts
```

- [x] **Step 3: Run full checks**

```bash
pnpm check
git diff --check
```

- [x] **Step 4: Commit**

Stage only this slice's files and commit with a detailed Chinese Conventional Commit message.

## Observed Verification

- RED agent-runtime LLM seam:
  `pnpm --filter @aivilization/agent-runtime test -- llmSubtaskPrioritizer.test.ts` failed
  because `./llmSubtaskPrioritizer` did not exist.
- GREEN agent-runtime LLM seam:
  `pnpm --filter @aivilization/agent-runtime test -- llmSubtaskPrioritizer.test.ts` passed 19
  files / 101 tests.
- RED async cycle:
  `pnpm --filter @aivilization/agent-runtime test -- cycle.test.ts` failed because
  `runAgentPlanningCycleWithPrioritization` did not exist.
- GREEN async cycle:
  `pnpm --filter @aivilization/agent-runtime test -- cycle.test.ts llmSubtaskPrioritizer.test.ts`
  passed 19 files / 102 tests.
- RED worker/observability:
  worker focused tests selected deterministic `work`, and observability repository tests dropped
  `contextualPrioritization`.
- GREEN worker/observability:
  `pnpm --filter @aivilization/worker test -- agentCycleRunner.test.ts tickRunner.test.ts` passed
  52 files / 292 tests.
- GREEN observability:
  `pnpm --filter @aivilization/observability test -- agentCycleTrace.test.ts agentCycleTraceRepository.test.ts`
  passed 12 files / 39 tests.
- FULL workspace:
  `pnpm check` passed lint, typecheck, and 157 files / 806 tests.
- DIFF hygiene: `git diff --check` passed.
