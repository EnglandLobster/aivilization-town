# LLM Strategic Planner Seam Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the first agent-runtime boundary that can ask the structured LLM gateway for Branch-Thinking plan proposals while preserving deterministic fallback and world-command validation boundaries.

**Architecture:** `@aivilization/agent-runtime` may depend on `@aivilization/llm`, but `@aivilization/llm` remains domain-agnostic. The new planner seam accepts an existing strategic objective, requests a structured branch-plan candidate, validates it through the existing `createBranchPlan` invariants, and returns either an accepted LLM plan or a deterministic fallback plan with LLM failure trace. LLM output never becomes a command and never mutates world state.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, `@aivilization/agent-runtime`, `@aivilization/llm`.

---

### Task 1: LLM Strategic Planner Contract

**Files:**

- Create: `packages/agent-runtime/src/llmStrategicPlanner.test.ts`
- Create: `packages/agent-runtime/src/llmStrategicPlanner.ts`
- Modify: `packages/agent-runtime/src/index.ts`
- Modify: `packages/agent-runtime/package.json`
- Modify: `pnpm-lock.yaml`

- [x] **Step 1: Write failing LLM strategic planner tests**

Add tests proving:

- a valid structured LLM response becomes a validated `BranchPlan`;
- the provider request uses the strategic branch-plan schema, carries objective context, and exposes a planner tool contract;
- malformed or schema-invalid LLM output falls back to `compileStrategicObjectiveToBranchPlan`;
- duplicate branch/subtask ids and dependency-order violations are rejected by the existing branch-plan invariants.

- [x] **Step 2: Run planner tests and verify RED**

Run:

```bash
pnpm --filter @aivilization/agent-runtime test -- llmStrategicPlanner.test.ts
```

Expected before implementation: FAIL because `./llmStrategicPlanner` does not exist or `@aivilization/llm` is not yet linked as an agent-runtime dependency.

- [x] **Step 3: Implement LLM strategic planner seam**

Add:

- `LlmStrategicBranchPlanProposal`
- `LlmStrategicPlanCompilerInput`
- `LlmStrategicPlanAcceptedResult`
- `LlmStrategicPlanFallbackResult`
- `LlmStrategicPlanResult`
- `llmStrategicBranchPlanSchema`
- `proposeStrategicBranchPlanWithLlm(input)`
- `createLlmStrategicPlanCompiler(input)`

Rules:

- call only `runStructuredLlmRequest` from `@aivilization/llm`;
- parse only branch-plan proposal data, not commands;
- validate accepted proposals through `createBranchPlan`;
- fallback through `compileStrategicObjectiveToBranchPlan` by default;
- preserve LLM attempt/usage trace on both accepted and fallback results;
- export the new seam from `packages/agent-runtime/src/index.ts`;
- add `@aivilization/llm` as a workspace dependency.

- [x] **Step 4: Verify GREEN**

Run:

```bash
pnpm --filter @aivilization/agent-runtime test -- llmStrategicPlanner.test.ts
pnpm --filter @aivilization/agent-runtime typecheck
```

Expected: PASS.

### Task 2: Verification And Commit

**Files:**

- Modify all files above.

- [x] **Step 1: Format touched files**

Run:

```bash
pnpm exec prettier --write docs/superpowers/plans/2026-06-25-llm-strategic-planner-seam-slice.md packages/agent-runtime/src/llmStrategicPlanner.ts packages/agent-runtime/src/llmStrategicPlanner.test.ts packages/agent-runtime/src/index.ts packages/agent-runtime/package.json pnpm-lock.yaml
```

- [x] **Step 2: Run focused and full verification**

Run:

```bash
pnpm --filter @aivilization/agent-runtime test -- llmStrategicPlanner.test.ts
pnpm --filter @aivilization/agent-runtime typecheck
pnpm lint
pnpm typecheck
pnpm test
git diff --check
```

Expected: all commands exit 0.

- [x] **Step 3: Commit**

Run:

```bash
git add docs/superpowers/plans/2026-06-25-llm-strategic-planner-seam-slice.md packages/agent-runtime/src/llmStrategicPlanner.ts packages/agent-runtime/src/llmStrategicPlanner.test.ts packages/agent-runtime/src/index.ts packages/agent-runtime/package.json pnpm-lock.yaml
git commit -m "feat: add llm strategic planner seam"
```
