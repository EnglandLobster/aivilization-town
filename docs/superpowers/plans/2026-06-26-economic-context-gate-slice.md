# Economic Context Gate Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make agent-cycle LLM stage diagnostics and profile gates prove that economic decision context reaches BTP stages such as contextual prioritization.

**Architecture:** Extend the existing world-decision-context trace contract with explicit economic completeness fields, aggregate them into runtime profile LLM stage diagnostics, and add gate criteria that can require those fields per stage. This is observability/gating only: it does not replace LLM ranking or add deterministic planner behavior.

**Tech Stack:** TypeScript, Vitest, `@aivilization/agent-runtime`, `@aivilization/observability`, server profile gates.

---

### Task 1: Trace Economic Context Completeness

**Files:**

- Modify: `packages/agent-runtime/src/worldDecisionContext.ts`
- Test: `packages/agent-runtime/src/llmSubtaskPrioritizer.test.ts`

- [ ] **Step 1: Write failing trace assertions**

Assert that accepted contextual prioritization traces include `hasEconomicState`, `hasMarketPrices`, and `completeEconomicContext` in `worldDecisionContext`.

- [ ] **Step 2: Run the focused test**

Run: `pnpm vitest run packages/agent-runtime/src/llmSubtaskPrioritizer.test.ts`

- [ ] **Step 3: Implement trace fields**

Add the economic fields to `WorldDecisionContextTrace` and compute them from balance, inventory, market spot prices, and latest price index.

- [ ] **Step 4: Re-run the focused test**

Run: `pnpm vitest run packages/agent-runtime/src/llmSubtaskPrioritizer.test.ts`

### Task 2: Aggregate And Gate Economic Context

**Files:**

- Modify: `packages/observability/src/runtimeProfileRunReport.ts`
- Modify: `packages/observability/src/runtimeProfileRunGate.ts`
- Test: `packages/observability/src/runtimeProfileRunReport.test.ts`
- Test: `packages/observability/src/runtimeProfileRunGate.test.ts`

- [ ] **Step 1: Write failing diagnostics and gate tests**

Assert `economicContextCount` and `completeEconomicContextCount` are aggregated per LLM stage, and gate criteria can require complete economic context.

- [ ] **Step 2: Run focused tests**

Run: `pnpm vitest run packages/observability/src/runtimeProfileRunReport.test.ts packages/observability/src/runtimeProfileRunGate.test.ts`

- [ ] **Step 3: Implement diagnostics and gate criteria**

Extend report types, validation, clone/defaulting, diagnostic aggregation, and gate failure reporting.

- [ ] **Step 4: Run full verification**

Run: `pnpm typecheck`, `pnpm test`, `pnpm lint`, `git diff --check`.
