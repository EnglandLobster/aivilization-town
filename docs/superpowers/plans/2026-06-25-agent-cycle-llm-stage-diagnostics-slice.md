# Agent Cycle LLM Stage Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add runtime profile diagnostics that show whether agent-cycle LLM cognition stages actually ran as LLM, deterministic fallback, deterministic logic, or were absent.

**Architecture:** Extend `RuntimeProfileAgentCycleDiagnostics` in `@aivilization/observability` with an optional, generated `llmStageDiagnostics` array. Keep stage counting derived only from durable `AgentCycleTrace` data so profile run reports remain source-backed and do not depend on runtime config intent. Make the new field backward compatible for older persisted reports while ensuring `createRuntimeProfileAgentCycleDiagnostics()` always emits it for new runs.

**Tech Stack:** TypeScript, Vitest, existing observability runtime profile report model.

---

### Task 1: Prove LLM Stage Diagnostics Are Missing

**Files:**

- Modify: `packages/observability/src/runtimeProfileRunReport.test.ts`
- Modify: `packages/observability/src/runtimeProfileRunReport.ts`

- [x] **Step 1: Write the failing test**

Add a test in `packages/observability/src/runtimeProfileRunReport.test.ts` that calls `createRuntimeProfileAgentCycleDiagnostics()` with traces containing:

- contextual prioritization from `llm`;
- action sequence generation from `llm` and `deterministic-fallback`;
- social dialogue generation from `llm`;
- global synthesis from `deterministic-fallback`;
- reactive correction from `llm`;
- one cycle missing each optional LLM trace.

Expect the returned diagnostics to include one `llmStageDiagnostics` entry per agent-cycle LLM stage:

- `contextualPrioritization`
- `actionSequenceGeneration`
- `socialDialogueGeneration`
- `globalSynthesis`
- `reactiveCorrection`

Each entry should report `traceCount`, `llmAcceptedCount`, `deterministicFallbackCount`, `deterministicCount`, and `missingCycleCount`.

- [x] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @aivilization/observability test -- runtimeProfileRunReport.test.ts
```

Expected: FAIL because diagnostics currently do not expose LLM stage counts.

- [x] **Step 3: Implement generated diagnostics**

In `packages/observability/src/runtimeProfileRunReport.ts`:

- add `RuntimeProfileAgentCycleLlmStageName`;
- add `RuntimeProfileAgentCycleLlmStageDiagnostics`;
- add optional `llmStageDiagnostics` to `RuntimeProfileAgentCycleDiagnostics`;
- derive stage counts inside `createRuntimeProfileAgentCycleDiagnostics()`;
- clone and validate the optional field in `createRuntimeProfileRunReport()`.

- [x] **Step 4: Run focused tests**

Run:

```bash
pnpm --filter @aivilization/observability test -- runtimeProfileRunReport.test.ts runtimeProfileRunGate.test.ts
```

Expected: PASS.

### Task 2: Verify And Commit

- [x] **Step 1: Run full checks**

Run:

```bash
pnpm check
pnpm exec prettier --check docs/superpowers/plans/2026-06-25-agent-cycle-llm-stage-diagnostics-slice.md packages/observability/src/runtimeProfileRunReport.ts packages/observability/src/runtimeProfileRunReport.test.ts
git diff --check
```

- [x] **Step 2: Commit**

Commit only this slice:

```bash
git add docs/superpowers/plans/2026-06-25-agent-cycle-llm-stage-diagnostics-slice.md packages/observability/src/runtimeProfileRunReport.ts packages/observability/src/runtimeProfileRunReport.test.ts
git commit -m "feat(observability): 汇总 agent-cycle LLM 阶段运行诊断"
```

### Self-Review

- Spec coverage: creates source-backed evidence that configured agent-cycle LLM stages actually ran or fell back.
- Placeholder scan: no placeholders remain.
- Scope check: deliberately excludes memory-consolidation LLM synthesis, which belongs to lifecycle memory diagnostics rather than `AgentCycleTrace`.
