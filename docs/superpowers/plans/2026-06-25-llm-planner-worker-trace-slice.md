# LLM Planner Worker Trace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve LLM strategic planning accepted/fallback evidence when worker objective renewal compiles durable branch plans.

**Architecture:** Keep provider calls and schema parsing inside `@aivilization/agent-runtime` plus `@aivilization/llm`. Evolve the strategic compiler contract so existing deterministic compilers may still return `BranchPlan`, while traceable compilers may return `{ plan, planningTrace }`. `apps/worker` normalizes either shape and attaches the optional planning trace to objective renewal decision traces without depending on LLM provider APIs.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, `@aivilization/agent-runtime`, `@aivilization/worker`, `@aivilization/llm`.

---

### Task 1: Traceable Strategic Compiler Contract

**Files:**

- Modify: `packages/agent-runtime/src/strategicPlanning.ts`
- Modify: `packages/agent-runtime/src/llmStrategicPlanner.ts`
- Modify: `packages/agent-runtime/src/llmStrategicPlanner.test.ts`

- [x] **Step 1: Write failing traceable LLM compiler tests**

Add tests proving:

- `createTraceableLlmStrategicPlanCompiler` returns `{ plan, planningTrace }` for accepted LLM plans;
- fallback results return deterministic fallback plans plus `planningTrace.status = 'fallback'`;
- the trace includes request id, provider id, model, attempts, usage, and failure reason/message when present;
- existing `createLlmStrategicPlanCompiler` remains `StrategicPlanCompiler` compatible and still resolves to a plain `BranchPlan`.

- [x] **Step 2: Run agent-runtime LLM planner tests and verify RED**

Run:

```bash
pnpm --filter @aivilization/agent-runtime test -- llmStrategicPlanner.test.ts
```

Expected before implementation: FAIL because `createTraceableLlmStrategicPlanCompiler` and the compiler result types do not exist.

- [x] **Step 3: Implement traceable strategic compiler output**

Add:

- `StrategicPlanCompilationUsage`
- `StrategicPlanCompilationAttemptTrace`
- `StrategicPlanCompilationTrace`
- `StrategicPlanCompilationResult`
- `StrategicPlanCompilerOutput`
- `normalizeStrategicPlanCompilerOutput(output)`
- `createTraceableLlmStrategicPlanCompiler(input)`

Rules:

- do not make `strategicPlanning.ts` depend on `@aivilization/llm`;
- preserve old compilers returning plain `BranchPlan`;
- map LLM accepted/fallback results into serializable generic planning trace objects;
- preserve `createLlmStrategicPlanCompiler` as a plan-only compatibility wrapper.

- [x] **Step 4: Verify agent-runtime GREEN**

Run:

```bash
pnpm --filter @aivilization/agent-runtime test -- llmStrategicPlanner.test.ts
pnpm --filter @aivilization/agent-runtime typecheck
```

Expected: PASS.

### Task 2: Worker Objective Renewal Planning Trace

**Files:**

- Modify: `apps/worker/src/objectiveRenewal.ts`
- Modify: `apps/worker/src/objectiveRenewal.test.ts`
- Modify: `apps/worker/src/steering.ts`

- [x] **Step 1: Write failing worker planning trace tests**

Add tests proving:

- `renewMissingActiveObjectives` accepts a traceable strategic compiler output;
- the saved branch plan uses `output.plan`;
- the returned `decisionTrace` includes `strategicPlan`;
- `objectiveRenewalTraceSink.record()` receives the same enriched trace.

- [x] **Step 2: Run worker objective renewal tests and verify RED**

Run:

```bash
pnpm --filter @aivilization/worker test -- src/objectiveRenewal.test.ts
```

Expected before implementation: FAIL because objective renewal assumes compilers return plain `BranchPlan` and does not preserve planning trace evidence.

- [x] **Step 3: Implement worker normalization and trace attachment**

Use `normalizeStrategicPlanCompilerOutput` inside `createStrategicPlanRecord`. Return both the saved `BranchPlanRecord` and optional `planningTrace`, then attach it to `ObjectiveRenewalDecisionTrace.strategicPlan` before recording/pushing renewal results. Also normalize steering-created strategic plan records so traceable compilers remain safe for human-set objective commands.

- [x] **Step 4: Verify worker GREEN**

Run:

```bash
pnpm --filter @aivilization/worker test -- src/objectiveRenewal.test.ts
pnpm --filter @aivilization/worker typecheck
```

Expected: PASS.

### Task 3: Verification And Commit

**Files:**

- Modify all files above plus this plan file.

- [x] **Step 1: Format touched files**

Run:

```bash
pnpm exec prettier --write docs/superpowers/plans/2026-06-25-llm-planner-worker-trace-slice.md packages/agent-runtime/src/strategicPlanning.ts packages/agent-runtime/src/llmStrategicPlanner.ts packages/agent-runtime/src/llmStrategicPlanner.test.ts apps/worker/src/objectiveRenewal.ts apps/worker/src/objectiveRenewal.test.ts apps/worker/src/steering.ts
```

- [x] **Step 2: Run focused and full verification**

Run:

```bash
pnpm --filter @aivilization/agent-runtime test -- llmStrategicPlanner.test.ts
pnpm --filter @aivilization/worker test -- src/objectiveRenewal.test.ts
pnpm --filter @aivilization/agent-runtime typecheck
pnpm --filter @aivilization/worker typecheck
pnpm lint
pnpm typecheck
pnpm test
git diff --check
```

Expected: all commands exit 0.

- [x] **Step 3: Commit**

Run:

```bash
git add docs/superpowers/plans/2026-06-25-llm-planner-worker-trace-slice.md packages/agent-runtime/src/strategicPlanning.ts packages/agent-runtime/src/llmStrategicPlanner.ts packages/agent-runtime/src/llmStrategicPlanner.test.ts apps/worker/src/objectiveRenewal.ts apps/worker/src/objectiveRenewal.test.ts apps/worker/src/steering.ts
git commit -m "feat: trace llm strategic planning in worker"
```
