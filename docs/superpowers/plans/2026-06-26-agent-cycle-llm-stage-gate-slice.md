# Agent Cycle LLM Stage Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let runtime profile gates explicitly require proof that selected agent-cycle LLM stages produced at least one accepted LLM trace.

**Architecture:** Keep the check inside `@aivilization/observability` and derive it only from durable `RuntimeProfileRunReport.agentCycleDiagnostics.llmStageDiagnostics`. This slice does not change worker execution, profile defaults, or trace collection.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, existing observability package.

---

### Task 1: Gate Contract

**Files:**

- Modify: `packages/observability/src/runtimeProfileRunGate.test.ts`
- Modify: `packages/observability/src/runtimeProfileRunGate.ts`

- [x] **Step 1: Write failing gate test**

Add a test that passes `requiredAgentCycleLlmAcceptedStages` in gate criteria and proves a run fails when one required stage has `llmAcceptedCount === 0`.

Run:

```bash
pnpm --filter @aivilization/observability test -- runtimeProfileRunGate.test.ts
```

Expected: FAIL because the gate ignores the new criteria.

- [x] **Step 2: Implement optional criteria**

Extend `RuntimeProfileRunGateCriteria` with `requiredAgentCycleLlmAcceptedStages?: readonly RuntimeProfileAgentCycleLlmStageName[]`.

Evaluate each required stage by finding its `llmStageDiagnostics` entry and requiring `llmAcceptedCount >= 1`.

Failure evidence should include the stage name, actual accepted count, and minimum accepted count.

- [x] **Step 3: Verify focused GREEN**

Run:

```bash
pnpm --filter @aivilization/observability test -- runtimeProfileRunGate.test.ts
```

Expected: PASS.

### Task 2: Verification And Commit

**Files:**

- Modify all files above plus this plan.

- [x] **Step 1: Format touched files**

Run:

```bash
pnpm exec prettier --write docs/superpowers/plans/2026-06-26-agent-cycle-llm-stage-gate-slice.md packages/observability/src/runtimeProfileRunGate.ts packages/observability/src/runtimeProfileRunGate.test.ts
```

- [x] **Step 2: Run full verification**

Run:

```bash
pnpm check
pnpm exec prettier --check docs/superpowers/plans/2026-06-26-agent-cycle-llm-stage-gate-slice.md packages/observability/src/runtimeProfileRunGate.ts packages/observability/src/runtimeProfileRunGate.test.ts
git diff --check
```

Expected: all commands exit 0.

- [x] **Step 3: Commit**

Stage only the plan, gate implementation, and gate test.

Commit with a detailed Conventional Commit message.
