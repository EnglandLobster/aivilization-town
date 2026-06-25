# LLM Replanning Decision Seam Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a bounded LLM seam for memory-guided replanning decisions after simulator failures, preserving deterministic fallback and the existing full-replan policy.

**Architecture:** `packages/agent-runtime/src/replanning.ts` owns the decision contract, deterministic fallback, validation, and trace type. `packages/agent-runtime/src/llmReplanningDecider.ts` compiles structured LLM proposals into validated `ReplanningDecision` results. `packages/agent-runtime/src/cycle.ts` accepts an optional async replanning decider only on the async cycle path, keeping the existing synchronous deterministic cycle unchanged.

**Tech Stack:** TypeScript, Vitest, `@aivilization/llm` structured gateway, agent-runtime planning cycle.

---

### Task 1: LLM Replanning Decision Contract

**Files:**
- Modify: `packages/agent-runtime/src/replanning.ts`
- Create: `packages/agent-runtime/src/llmReplanningDecider.ts`
- Modify: `packages/agent-runtime/src/index.ts`
- Test: `packages/agent-runtime/src/llmReplanningDecider.test.ts`

- [x] **Step 1: Write failing tests**

Add tests proving that the LLM replanning decider:
- accepts a memory-guided correction proposal grounded in current failures, STM evidence, and world decision context;
- falls back to deterministic replanning when a proposal references evidence outside the supplied STM context;
- exposes a traceable factory compatible with async cycle injection.

- [x] **Step 2: Verify RED**

Run:

```bash
pnpm vitest run packages/agent-runtime/src/llmReplanningDecider.test.ts
```

Expected: fail because `llmReplanningDecider.ts` and its exports do not exist.

- [x] **Step 3: Implement minimal contract and compiler**

Add `ReplanningDeciderInput`, `ReplanningDecisionTrace`, `ReplanningDecisionResult`, `ReplanningDecider`, and `createDeterministicReplanningDecisionResult` to `replanning.ts`. Implement `proposeReplanningDecisionWithLlm` and `createTraceableLlmReplanningDecider` using structured LLM requests, strict schema parsing, bounded validation against current failed actions and supplied STM evidence, and deterministic fallback on failure.

- [x] **Step 4: Verify GREEN**

Run:

```bash
pnpm vitest run packages/agent-runtime/src/llmReplanningDecider.test.ts packages/agent-runtime/src/replanning.test.ts
```

Expected: pass.

### Task 2: Async Cycle Wiring

**Files:**
- Modify: `packages/agent-runtime/src/cycle.ts`
- Test: `packages/agent-runtime/src/cycle.test.ts`

- [x] **Step 1: Write failing cycle test**

Add a test where deterministic replanning would escalate to `full-replan`, but an injected `replanningDecider` returns an accepted `memory-guided-correction` trace. Assert `result.replanningDecision` and `result.replanningTrace`.

- [x] **Step 2: Verify RED**

Run:

```bash
pnpm vitest run packages/agent-runtime/src/cycle.test.ts -t "uses an async replanning decider"
```

Expected: fail because the cycle ignores or does not accept `replanningDecider`.

- [x] **Step 3: Implement minimal async wiring**

Add optional `replanningDecider` to `AgentPlanningCycleWithPrioritizationInput`. Route async cycles through an async finalizer when the decider is present, while leaving `runAgentPlanningCycle` synchronous and deterministic.

- [x] **Step 4: Verify GREEN**

Run:

```bash
pnpm vitest run packages/agent-runtime/src/cycle.test.ts packages/agent-runtime/src/llmReplanningDecider.test.ts packages/agent-runtime/src/replanning.test.ts
```

Expected: pass.

### Task 3: Stage Review And Commit

**Files:**
- Modify: `docs/superpowers/plans/2026-06-26-llm-replanning-decision-seam-slice.md`

- [x] **Step 1: Run focused regression**

Run:

```bash
pnpm vitest run packages/agent-runtime/src/cycle.test.ts packages/agent-runtime/src/llmReplanningDecider.test.ts packages/agent-runtime/src/replanning.test.ts
```

Expected: pass.

- [x] **Step 2: Inspect diff**

Run:

```bash
git diff -- packages/agent-runtime/src/replanning.ts packages/agent-runtime/src/llmReplanningDecider.ts packages/agent-runtime/src/llmReplanningDecider.test.ts packages/agent-runtime/src/cycle.ts packages/agent-runtime/src/cycle.test.ts packages/agent-runtime/src/index.ts docs/superpowers/plans/2026-06-26-llm-replanning-decision-seam-slice.md
```

Expected: diff is limited to the replanning LLM seam, async cycle injection, tests, exports, and this plan.

- [x] **Step 3: Commit**

Stage only the files from this slice, excluding untracked paper/report artifacts:

```bash
git add docs/superpowers/plans/2026-06-26-llm-replanning-decision-seam-slice.md packages/agent-runtime/src/replanning.ts packages/agent-runtime/src/llmReplanningDecider.ts packages/agent-runtime/src/llmReplanningDecider.test.ts packages/agent-runtime/src/cycle.ts packages/agent-runtime/src/cycle.test.ts packages/agent-runtime/src/index.ts
git commit
```

Commit message:

```text
feat(agent-runtime): 增加 LLM 记忆引导重规划决策 seam

- 为论文中的 memory-guided correction 补齐结构化 LLM 决策边界，避免只依赖 STM 关键词匹配
- 在 agent-runtime 中新增 replanning decision trace、deterministic fallback 和 LLM 编译器
- 将可选 replanningDecider 接入异步 agent cycle，保留同步 deterministic 路径不变
- LLM 决策被限制在当前失败动作和已提供 STM 证据内，失败时回退到既有重规划策略
- 已通过 replanning、LLM replanning decider 和 cycle 聚焦回归测试
```

---

### Self-Review

- Spec coverage: covers the current highest-risk paper gap, memory-guided correction, without changing server config or production profile defaults in the same slice.
- Placeholder scan: no placeholder steps remain.
- Type consistency: `ReplanningDecider` returns `ReplanningDecisionResult`, and cycle exposes the accepted trace as `replanningTrace`.
- Verification:
  - `pnpm vitest run packages/agent-runtime/src/replanning.test.ts packages/agent-runtime/src/llmReplanningDecider.test.ts packages/agent-runtime/src/cycle.test.ts`
  - `pnpm --filter @aivilization/agent-runtime typecheck`
  - `pnpm --filter @aivilization/agent-runtime test`
  - `pnpm --filter @aivilization/agent-runtime build`
  - `pnpm lint`
  - `git diff --check`
