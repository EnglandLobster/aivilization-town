# Agent-Cycle LLM Memory Profile Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require every accepted agent-cycle LLM trace in configured profile runs to include STM and
long-term profile context.

**Architecture:** `packages/observability` owns runtime profile report gate semantics. The profile gate
already derives required LLM stages from runtime config; this slice only tightens the evidence rule for
memory/profile context from "at least one trace has it" to "all accepted LLM traces have it". Runtime
execution and prompt construction stay unchanged.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces.

---

## Scope

This slice adds:

- strict STM context gate semantics for configured agent-cycle LLM stages;
- strict long-term profile context gate semantics for configured agent-cycle LLM stages;
- RED/GREEN coverage for partial context loss across multiple accepted traces.

It does not add cognition-stage memory/profile counters, change prompt schemas, modify worker memory
retrieval defaults, or change runtime config parsing.

## File Structure

- Modify `packages/observability/src/runtimeProfileRunGate.test.ts`.
- Modify `packages/observability/src/runtimeProfileRunGate.ts`.

## Tasks

- [x] **Step 1: Add RED tests**

  Add two gate tests:

  - required `contextualPrioritization` has `llmAcceptedCount: 2` but
    `shortTermMemoryContextCount: 1`, and must fail with minimum `2`;
  - required `contextualPrioritization` has `llmAcceptedCount: 2` but
    `longTermProfileContextCount: 1`, and must fail with minimum `2`.

- [x] **Step 2: Verify RED**

  Run:

  ```bash
  pnpm test -- packages/observability/src/runtimeProfileRunGate.test.ts
  ```

  Expected before implementation: the new tests fail because the current gate only requires context
  count to be at least `1`.

  RED observed: both new tests returned `pass` before implementation, proving the gate did not enforce
  per-accepted-trace STM/LTM profile context coverage.

- [x] **Step 3: Implement strict gate semantics**

  Update `addRequiredAgentCycleLlmMemoryContextStageFailures` and
  `addRequiredAgentCycleLlmProfileContextStageFailures` to compute:

  ```ts
  const minimum = Math.max(1, stage?.llmAcceptedCount ?? 0);
  ```

  Fail when the corresponding context count is below `minimum`, and include `llmAcceptedCount` in
  failure evidence.

- [x] **Step 4: Verify GREEN**

  Run:

  ```bash
  pnpm test -- packages/observability/src/runtimeProfileRunGate.test.ts
  pnpm --filter @aivilization/observability typecheck
  git diff --check
  ```

  GREEN observed: `pnpm test -- packages/observability/src/runtimeProfileRunGate.test.ts` passed the
  full workspace test run (`170` files, `939` tests), plus observability typecheck and `git diff --check`.

- [x] **Step 5: Commit**

  Commit this slice with a detailed Conventional Commit message.

## Self-Review Notes

- Boundary review: observability gate owns acceptance criteria; runtime data collection is not changed.
- Data-flow review: runtime config -> required stage list -> report diagnostics -> strict per-accepted
  STM/LTM context coverage.
- Paper alignment: this protects contextual prioritization, action sequencing, synthesis, repair, and
  replanning LLM stages from silently losing memory/profile context on any accepted call.
