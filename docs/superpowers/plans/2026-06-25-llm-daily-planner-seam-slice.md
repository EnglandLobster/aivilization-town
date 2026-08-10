# LLM Daily Planner Seam Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a structured LLM seam for high-level daily plans with deterministic fallback and trace data.

**Architecture:** Keep LLM access inside `packages/agent-runtime`, not worker orchestration. The
LLM proposes a `DailyPlan`, `createDailyPlan` validates it, and failures fall back to
`compileDeterministicDailyPlan`. Trace fields mirror strategic planning so observability remains
consistent across planner types.

**Tech Stack:** TypeScript, Vitest, `@aivilization/llm` structured gateway.

---

## Task 1: Compiler Types And LLM Tests

**Files:**

- Modify: `packages/agent-runtime/src/dailyPlanning.ts`
- Create: `packages/agent-runtime/src/llmDailyPlanner.test.ts`

- [x] **Step 1: Add failing accepted/fallback/schema tests**

Write tests for:

- accepting a structured LLM daily plan proposal after schema and `createDailyPlan` validation;
- falling back to deterministic daily planning when LLM output is invalid;
- rejecting invalid plan item windows inside the schema parser;
- creating a traceable compiler that returns `planningTrace` with attempts and usage.

Run:

```bash
pnpm --filter @aivilization/agent-runtime test -- llmDailyPlanner.test.ts
```

Expected: FAIL because `llmDailyPlanner` and compiler trace types do not exist.

Observed: failed because `./llmDailyPlanner` did not exist.

## Task 2: Daily Plan Compiler Types

**Files:**

- Modify: `packages/agent-runtime/src/dailyPlanning.ts`

- [x] **Step 2: Add compiler and trace types**

Add `DailyPlanCompilerInput`, `DailyPlanCompilationUsage`,
`DailyPlanCompilationAttemptTrace`, `DailyPlanCompilationTrace`, `DailyPlanCompilationResult`,
`DailyPlanCompilerOutput`, `DailyPlanCompiler`, and `normalizeDailyPlanCompilerOutput`.

Run:

```bash
pnpm --filter @aivilization/agent-runtime typecheck
```

Expected: FAIL until `llmDailyPlanner.ts` exists, then PASS after Task 3.

## Task 3: LLM Daily Planner Implementation

**Files:**

- Create: `packages/agent-runtime/src/llmDailyPlanner.ts`
- Modify: `packages/agent-runtime/src/index.ts`

- [x] **Step 3: Implement schema parser and provider request**

Create `llmDailyPlanSchema`, `proposeDailyPlanWithLlm`, the tool contract, and request messages.
Parse unknown JSON through reader helpers and `createDailyPlan`.

- [x] **Step 4: Implement fallback and traceable compiler factories**

Add `createLlmDailyPlanCompiler`, `createTraceableLlmDailyPlanCompiler`, fallback compilation, and
trace mapping from `LlmStructuredResult<DailyPlan>`.

- [x] **Step 5: Export module and run focused checks**

Run:

```bash
pnpm --filter @aivilization/agent-runtime test -- llmDailyPlanner.test.ts
pnpm --filter @aivilization/agent-runtime typecheck
```

Expected: PASS.

Observed:

- `pnpm --filter @aivilization/agent-runtime test -- llmDailyPlanner.test.ts` passed.
- `pnpm --filter @aivilization/agent-runtime typecheck` passed.
- `pnpm lint` passed after removing an unsafe asymmetric matcher assignment from the test.

## Task 4: Full Verification And Commit

- [x] **Step 6: Full checks**

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
- `pnpm test` passed with 144 test files and 705 tests.
- `pnpm build` passed.
- `git diff --check` passed.

- [x] **Step 7: Inspect and commit**

Confirm the diff is limited to the LLM daily planner seam, daily plan compiler trace types, tests,
and this slice's docs.

Observed: diff is limited to the LLM daily planner seam, daily plan compiler trace types, tests,
and this slice's docs.

Commit with:

```bash
git add docs/superpowers/specs/2026-06-25-llm-daily-planner-seam-design.md docs/superpowers/plans/2026-06-25-llm-daily-planner-seam-slice.md packages/agent-runtime/src/dailyPlanning.ts packages/agent-runtime/src/llmDailyPlanner.ts packages/agent-runtime/src/llmDailyPlanner.test.ts packages/agent-runtime/src/index.ts
git commit -m "feat: add traceable llm daily planner"
```
