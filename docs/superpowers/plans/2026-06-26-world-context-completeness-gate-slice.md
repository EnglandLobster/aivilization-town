# World Context Completeness Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade runtime profile LLM world-context gates from "context object exists" to "paper-critical world context is complete enough to prove the LLM saw agent state and market prices."

**Architecture:** Keep compact context truth in `WorldDecisionContextTrace`. Add completeness counting in `@aivilization/observability` report diagnostics and enforce the stronger count from profile gates. Server profile criteria can keep deriving the same required stages from runtime config; the gate semantics become stricter without changing runtime config shape.

**Tech Stack:** TypeScript, Vitest, `@aivilization/observability`, local runtime profile gate criteria.

---

### Task 1: Agent-Cycle LLM Context Completeness Diagnostics

**Files:**
- Modify: `packages/observability/src/runtimeProfileRunReport.test.ts`
- Modify: `packages/observability/src/runtimeProfileRunReport.ts`

- [x] **Step 1: Write failing diagnostics assertions**

Extend `summarizes agent-cycle LLM stage diagnostics from durable traces` so every expected stage includes:

```ts
completeWorldDecisionContextCount: 1
```

Then add an incomplete context trace fixture, for example a `globalSynthesis` trace with:

```ts
worldDecisionContext: {
  agentId: 'agent-missing-price',
  hasPhysiology: true,
  hasBalance: true,
  hasEducationScore: true,
  hasResidentialTier: true,
  inventoryItemCount: 0,
  marketSpotPriceCount: 0,
  hasLatestPriceIndex: false,
}
```

Expected: `worldDecisionContextCount` increases, but `completeWorldDecisionContextCount` does not.

- [x] **Step 2: Verify RED**

Run:

```bash
pnpm vitest run packages/observability/src/runtimeProfileRunReport.test.ts -t "agent-cycle LLM stage diagnostics"
```

Expected: fail because `RuntimeProfileAgentCycleLlmStageDiagnostics` has no `completeWorldDecisionContextCount`.

- [x] **Step 3: Implement diagnostics**

Add `completeWorldDecisionContextCount` to `RuntimeProfileAgentCycleLlmStageDiagnostics` and count traces whose `worldDecisionContext` has:

- `hasPhysiology === true`
- `hasBalance === true`
- `hasEducationScore === true`
- `hasResidentialTier === true`
- `marketSpotPriceCount > 0`

Inventory may be empty for a valid agent, so do not require `inventoryItemCount > 0`.

- [x] **Step 4: Verify GREEN**

Run the same focused Vitest command. Expected: pass.

### Task 2: Cognition LLM Context Completeness Diagnostics

**Files:**
- Modify: `packages/observability/src/runtimeProfileRunReport.test.ts`
- Modify: `packages/observability/src/runtimeProfileRunReport.ts`

- [x] **Step 1: Write failing cognition diagnostics assertions**

Extend `summarizes cognition LLM stage diagnostics from durable profile traces` so every expected stage includes `completeWorldDecisionContextCount`.

Add one incomplete cognition provider trace with `marketSpotPriceCount: 0` and assert it counts toward `worldDecisionContextCount` but not toward `completeWorldDecisionContextCount`.

- [x] **Step 2: Verify RED**

Run:

```bash
pnpm vitest run packages/observability/src/runtimeProfileRunReport.test.ts -t "cognition LLM stage diagnostics"
```

Expected: fail before the field exists.

- [x] **Step 3: Implement cognition diagnostics**

Add `completeWorldDecisionContextCount` to `RuntimeProfileCognitionLlmStageDiagnostics` and share the same completeness predicate with agent-cycle diagnostics.

- [x] **Step 4: Verify GREEN**

Run the same focused Vitest command. Expected: pass.

### Task 3: Gate On Complete Context, Not Mere Presence

**Files:**
- Modify: `packages/observability/src/runtimeProfileRunGate.test.ts`
- Modify: `packages/observability/src/runtimeProfileRunGate.ts`
- Modify: `apps/server/src/localRuntimeTownProfileGateSuite.test.ts`

- [x] **Step 1: Write failing gate tests**

Update gate fixtures to include `completeWorldDecisionContextCount`. Add tests proving:

- `requiredAgentCycleLlmWorldContextStages` fails when `worldDecisionContextCount` is 1 but `completeWorldDecisionContextCount` is 0.
- `requiredCognitionLlmWorldContextStages` fails under the same condition.

Expected failure code should distinguish completeness:

```ts
agent-cycle-llm-stage-complete-world-context-count-too-low
cognition-llm-stage-complete-world-context-count-too-low
```

- [x] **Step 2: Verify RED**

Run:

```bash
pnpm vitest run packages/observability/src/runtimeProfileRunGate.test.ts -t "world decision context"
```

Expected: fail because gates only inspect `worldDecisionContextCount`.

- [x] **Step 3: Implement stricter gate semantics**

Keep existing `required*WorldContextStages` criteria names for compatibility, but make them require `completeWorldDecisionContextCount >= 1`. Evidence should include both `actual` complete count and `worldDecisionContextCount` so operators can tell whether the context was absent or incomplete.

- [x] **Step 4: Verify GREEN**

Run the same focused Vitest command. Expected: pass.

### Task 4: Regression And Commit

**Files:**
- Modify all files above and this plan.

- [x] **Step 1: Run focused regression**

Run:

```bash
pnpm vitest run packages/observability/src/runtimeProfileRunReport.test.ts packages/observability/src/runtimeProfileRunGate.test.ts
pnpm --filter @aivilization/observability typecheck
```

- [x] **Step 2: Run repository verification**

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test
git diff --check
```

- [x] **Step 3: Commit**

Stage only this slice:

```bash
git add docs/superpowers/plans/2026-06-26-world-context-completeness-gate-slice.md packages/observability/src/runtimeProfileRunReport.ts packages/observability/src/runtimeProfileRunReport.test.ts packages/observability/src/runtimeProfileRunGate.ts packages/observability/src/runtimeProfileRunGate.test.ts apps/server/src/localRuntimeTownProfileGateSuite.test.ts
git commit
```

Commit message:

```text
feat(observability): 验真 LLM 世界上下文完整度

- 将 LLM worldDecisionContext gate 从存在性检查升级为关键状态与价格完整度检查
- 为 agent-cycle 和 cognition LLM stage diagnostics 增加 completeWorldDecisionContextCount
- gate 继续复用现有 required*WorldContextStages 配置，但要求完整上下文而非空壳 context
- 用户可见变化是 profile gate 能阻止缺少市场价格或关键 agent 状态的 LLM 运行伪通过
- 验证覆盖 observability 聚焦测试、全仓 typecheck、lint、test 和 diff 检查
```

---

### Self-Review

- Spec coverage: this directly closes the paper-alignment risk where LLM prompts may receive a context object but not the internal attributes and market prices called out in Section 2.1.1.
- Placeholder scan: no TODO/TBD placeholders.
- Type consistency: `completeWorldDecisionContextCount` is used for both agent-cycle and cognition diagnostics.
- Boundary decision: this does not change prompt payloads or runtime config shape; it strengthens observability and profile gates at the validation boundary.
