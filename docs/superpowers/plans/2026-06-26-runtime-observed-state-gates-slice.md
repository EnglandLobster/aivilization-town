# Runtime Observed State Gates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make runtime profile reports and gates prove that LLM cognition stages received `observedStateSummary`.

**Architecture:** Stage traces carry the compact observed agent state summary as first-class evidence. Observability aggregates this into `observedStateSummaryCount` per LLM stage, and runtime gates can require that every accepted LLM trace for selected stages has that state evidence.

**Tech Stack:** TypeScript, Vitest, existing agent-runtime trace types, observability report/gate infrastructure.

---

### Task 1: Agent-Cycle Stage Diagnostics

**Files:**
- Modify: `packages/observability/src/runtimeProfileRunReport.test.ts`
- Modify: `packages/observability/src/runtimeProfileRunReport.ts`
- Modify: `packages/observability/src/agentCycleTrace.ts`
- Modify: `packages/agent-runtime/src/subtaskPrioritization.ts`
- Modify: `packages/agent-runtime/src/actionSequenceGeneration.ts`
- Modify: `packages/agent-runtime/src/socialDialogueGeneration.ts`
- Modify: `packages/agent-runtime/src/globalSynthesis.ts`
- Modify: `packages/agent-runtime/src/actionRepair.ts`
- Modify: `packages/agent-runtime/src/replanning.ts`

- [x] **Step 1: Write failing diagnostics assertions**

In `runtimeProfileRunReport.test.ts`, add `observedStateSummary` to representative accepted/fallback stage traces and assert `observedStateSummaryCount` in every returned stage diagnostic.

- [x] **Step 2: Run RED**

Run:

```bash
pnpm vitest run packages/observability/src/runtimeProfileRunReport.test.ts
```

Expected: fails because `observedStateSummaryCount` is missing.

- [x] **Step 3: Implement minimal trace and aggregation support**

Add optional `observedStateSummary?: string` to agent-cycle LLM stage trace types and count non-empty summaries in `recordStageTrace`.

- [x] **Step 4: Run GREEN**

Run the same focused test and expect pass.

### Task 2: Cognition Stage Diagnostics

**Files:**
- Modify: `packages/observability/src/runtimeProfileRunReport.test.ts`
- Modify: `packages/observability/src/runtimeProfileRunReport.ts`
- Modify: `packages/observability/src/objectiveRenewalTraceRepository.ts`
- Modify: `packages/observability/src/dailyPlanRenewalTraceRepository.ts`
- Modify: `packages/observability/src/reactionEvaluationTraceRepository.ts`
- Modify: `apps/worker/src/objectiveRenewal.ts`
- Modify: `apps/worker/src/dailyRoutineSchedule.ts`
- Modify: `apps/worker/src/socialObservationIntentions.ts`
- Modify: `packages/agent-runtime/src/strategicPlanning.ts`
- Modify: `packages/agent-runtime/src/dailyPlanning.ts`
- Modify: `packages/agent-runtime/src/reactionEvaluation.ts`
- Modify: `packages/memory/src/reflection.ts`
- Modify: `packages/memory/src/socialModelSynthesis.ts`

- [x] **Step 1: Write failing cognition diagnostics assertions**

Add `observedStateSummary` to strategic, daily, reaction, reflection, and social-model provider traces in the existing cognition diagnostics test and assert per-stage counts.

- [x] **Step 2: Run RED**

Run:

```bash
pnpm vitest run packages/observability/src/runtimeProfileRunReport.test.ts
```

Expected: fails because cognition diagnostics ignore or drop `observedStateSummary`.

- [x] **Step 3: Implement trace propagation**

Add optional `observedStateSummary?: string` to non-cycle compilation/synthesis trace types, observability repositories, worker trace cloning, and runtime report cognition provider traces.

- [x] **Step 4: Run GREEN**

Run the same focused test and expect pass.

### Task 3: Runtime Gate Criteria

**Files:**
- Modify: `packages/observability/src/runtimeProfileRunGate.test.ts`
- Modify: `packages/observability/src/runtimeProfileRunGate.ts`

- [x] **Step 1: Write failing gate tests**

Add tests for `requiredAgentCycleLlmObservedStateStages` and `requiredCognitionLlmObservedStateStages`. Each test should fail when accepted LLM traces exist but `observedStateSummaryCount` is lower than accepted count.

- [x] **Step 2: Run RED**

Run:

```bash
pnpm vitest run packages/observability/src/runtimeProfileRunGate.test.ts
```

Expected: fails because criteria fields are unsupported.

- [x] **Step 3: Implement gate criteria**

Add criteria fields, stage failure helpers, and clear failure codes:

- `agent-cycle-llm-stage-observed-state-count-too-low`
- `cognition-llm-stage-observed-state-count-too-low`

- [x] **Step 4: Run GREEN**

Run the focused gate test and expect pass.

### Task 4: Verification And Commit

**Files:**
- All touched files above.

- [x] **Step 1: Run focused tests**

```bash
pnpm vitest run packages/observability/src/runtimeProfileRunReport.test.ts packages/observability/src/runtimeProfileRunGate.test.ts
```

- [x] **Step 2: Run full verification**

```bash
pnpm test
pnpm typecheck
pnpm lint
git diff --check
```

- [ ] **Step 3: Commit**

Use a detailed Conventional Commit message describing why this runtime gate matters for paper-aligned LLM cognition verification.
