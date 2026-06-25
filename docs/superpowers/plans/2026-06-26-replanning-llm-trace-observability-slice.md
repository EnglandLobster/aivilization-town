# Replanning LLM Trace Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist `ReplanningDecisionTrace` on agent-cycle traces and include it in runtime profile LLM-stage diagnostics/gates so profile runs can prove LLM replanning was actually used with world context.

**Architecture:** Keep `@aivilization/agent-runtime` as the source of `replanningTrace`. `apps/worker` maps it into `@aivilization/observability` `AgentCycleTrace`. `packages/observability` stores/clones the trace and reports it as an agent-cycle LLM stage named `replanningDecision`. `apps/server` derives required gate stages from `runtimeConfig.replanningDecision`.

**Tech Stack:** TypeScript, Vitest, `@aivilization/agent-runtime` replanning trace, `@aivilization/observability` runtime profile diagnostics, local runtime profile gate criteria.

---

### Task 1: Agent-Cycle Trace Contract

**Files:**
- Modify: `packages/observability/src/agentCycleTrace.ts`
- Modify: `packages/observability/src/agentCycleTraceRepository.ts`
- Modify: `packages/observability/src/agentCycleTraceRepository.test.ts`

- [x] **Step 1: Write the failing repository test**

Add a test that records an `AgentCycleTrace` with:

```ts
replanningDecisionTrace: {
  status: 'accepted',
  source: 'llm',
  requestId: 'replanning-trace-1',
  providerId: 'scripted-replanning',
  model: 'replanning-model',
  decision: {
    kind: 'memory-guided-correction',
    trigger: 'simulator-rejection',
    reason: 'Use memory evidence before full replan.',
    failedActionIds: ['work-hungry'],
    evidenceRecordIds: ['memory-work-hungry'],
  },
  worldDecisionContext: {
    agentId: 'agent-1',
    hasPhysiology: true,
    hasBalance: true,
    hasEducationScore: true,
    hasResidentialTier: true,
    inventoryItemCount: 1,
    marketSpotPriceCount: 1,
    hasLatestPriceIndex: false,
  },
}
```

Then read it back from both in-memory and file-backed repositories and assert the trace is preserved and cloned.

- [x] **Step 2: Verify RED**

Run:

```bash
pnpm vitest run packages/observability/src/agentCycleTraceRepository.test.ts -t "replanning decision trace"
```

Expected: fail because `AgentCycleTrace` has no `replanningDecisionTrace` field and repositories do not clone it.

Observed RED: the trace fixture contained `replanningDecisionTrace`, but the repository clone/readback omitted it.

- [x] **Step 3: Implement trace contract**

In `agentCycleTrace.ts`, add `AgentCycleReplanningDecisionTrace` with the same provider trace shape as `ReplanningDecisionTrace`, using string evidence IDs and `WorldDecisionContextTrace`.

Add optional `replanningDecisionTrace?: AgentCycleReplanningDecisionTrace` to `AgentCycleTrace`.

In `agentCycleTraceRepository.ts`, clone and persist `replanningDecisionTrace`, including attempts, usage, decision, and world decision context.

- [x] **Step 4: Verify GREEN**

Run:

```bash
pnpm vitest run packages/observability/src/agentCycleTraceRepository.test.ts -t "replanning decision trace"
```

Expected: pass.

### Task 2: Worker Trace Mapping

**Files:**
- Modify: `apps/worker/src/agentCycleRunner.test.ts`
- Modify: `apps/worker/src/agentCycleRunner.ts`

- [x] **Step 1: Write the failing worker trace test**

Extend the existing `passes replanning decider into the planning cycle and trace` test to assert:

```ts
expect(result.trace.replanningDecisionTrace).toMatchObject({
  status: 'accepted',
  source: 'llm',
  requestId: 'replanning-decision-cycle-worker',
  worldDecisionContext: {
    hasPhysiology: true,
    hasBalance: true,
    hasEducationScore: true,
    hasResidentialTier: true,
  },
});
```

Ensure the test provides a projection/worldDecisionContext with at least one inventory item and market price so the trace can prove economic context coverage.

- [x] **Step 2: Verify RED**

Run:

```bash
pnpm vitest run apps/worker/src/agentCycleRunner.test.ts -t "passes replanning decider"
```

Expected: fail because worker traces currently drop `cycleResult.replanningTrace`.

Observed RED: `runWorkerAgentCycle` invoked the decider, but `result.trace.replanningDecisionTrace` was absent.

- [x] **Step 3: Implement worker mapping**

In `agentCycleRunner.ts`, add `mapReplanningDecisionTrace` and set:

```ts
...(cycleResult.replanningTrace === undefined
  ? {}
  : { replanningDecisionTrace: mapReplanningDecisionTrace(cycleResult.replanningTrace) })
```

The mapping must preserve status, source, requestId, provider/model, failure/message, decision, attempts, usage, and worldDecisionContext.

- [x] **Step 4: Verify GREEN**

Run:

```bash
pnpm vitest run apps/worker/src/agentCycleRunner.test.ts -t "passes replanning decider"
```

Expected: pass.

### Task 3: Runtime Profile Diagnostics And Gate

**Files:**
- Modify: `packages/observability/src/runtimeProfileRunReport.ts`
- Modify: `packages/observability/src/runtimeProfileRunReport.test.ts`
- Modify: `apps/server/src/localRuntimeTownProfileGate.ts`
- Modify: `apps/server/src/localRuntimeTownProfileGate.test.ts`
- Modify: `apps/server/src/localRuntimeTownProfileGateSuite.test.ts`

- [x] **Step 1: Write failing diagnostics/gate tests**

Add observability coverage proving `createRuntimeProfileAgentCycleDiagnostics` includes a stage:

```ts
{
  stageName: 'replanningDecision',
  traceCount: 1,
  llmAcceptedCount: 1,
  deterministicFallbackCount: 0,
  deterministicCount: 0,
  missingCycleCount: 0,
  worldDecisionContextCount: 1,
}
```

Add server gate coverage proving `runtimeConfig.replanningDecision` derives required accepted/world-context stages including `replanningDecision`.

Add gate suite coverage proving a profile config with `replanningDecision` fails when diagnostics are missing that LLM stage.

- [x] **Step 2: Verify RED**

Run:

```bash
pnpm vitest run packages/observability/src/runtimeProfileRunReport.test.ts apps/server/src/localRuntimeTownProfileGate.test.ts apps/server/src/localRuntimeTownProfileGateSuite.test.ts -t "replanningDecision|agent-cycle LLM"
```

Expected: fail because `replanningDecision` is not a runtime profile LLM stage.

Observed RED: diagnostics omitted `replanningDecision`, gate criteria did not derive it, and injected diagnostics with that stage were rejected as unsupported.

- [x] **Step 3: Implement diagnostics/gate support**

In `runtimeProfileRunReport.ts`:
- add `'replanningDecision'` to `RuntimeProfileAgentCycleLlmStageName`;
- add it to `AGENT_CYCLE_LLM_STAGE_NAMES`;
- record `trace.replanningDecisionTrace` in `createLlmStageDiagnostics`.

In `localRuntimeTownProfileGate.ts`, include `runtimeConfig.replanningDecision` in accepted and world-context agent-cycle LLM required stages.

Update test helpers that enumerate all agent-cycle stages.

- [x] **Step 4: Verify GREEN**

Run:

```bash
pnpm vitest run packages/observability/src/runtimeProfileRunReport.test.ts apps/server/src/localRuntimeTownProfileGate.test.ts apps/server/src/localRuntimeTownProfileGateSuite.test.ts -t "replanningDecision|agent-cycle LLM"
```

Expected: pass.

### Task 4: Regression And Commit

**Files:**
- Modify: `docs/superpowers/plans/2026-06-26-replanning-llm-trace-observability-slice.md`

- [x] **Step 1: Run regression**

Run:

```bash
pnpm vitest run packages/observability/src/agentCycleTraceRepository.test.ts packages/observability/src/runtimeProfileRunReport.test.ts packages/observability/src/runtimeProfileRunGate.test.ts apps/worker/src/agentCycleRunner.test.ts apps/server/src/localRuntimeTownProfileGate.test.ts apps/server/src/localRuntimeTownProfileGateSuite.test.ts apps/server/src/localRuntimeTownProfileRunner.test.ts
pnpm --filter @aivilization/observability typecheck
pnpm --filter @aivilization/worker typecheck
pnpm --filter @aivilization/server typecheck
pnpm lint
git diff --check
pnpm typecheck
pnpm test
```

Expected: all commands pass.

Observed GREEN: all listed commands passed. Full test suite passed with 167 files and 907 tests.

- [x] **Step 2: Stage and commit**

Stage only this slice:

```bash
git add docs/superpowers/plans/2026-06-26-replanning-llm-trace-observability-slice.md packages/observability/src/agentCycleTrace.ts packages/observability/src/agentCycleTraceRepository.ts packages/observability/src/agentCycleTraceRepository.test.ts packages/observability/src/runtimeProfileRunReport.ts packages/observability/src/runtimeProfileRunReport.test.ts apps/worker/src/agentCycleRunner.ts apps/worker/src/agentCycleRunner.test.ts apps/server/src/localRuntimeTownProfileGate.ts apps/server/src/localRuntimeTownProfileGate.test.ts apps/server/src/localRuntimeTownProfileGateSuite.test.ts
git commit
```

Commit message:

```text
feat(observability): 纳入 LLM 重规划决策运行诊断

- 为 replanningDecision trace 增加 agent-cycle 持久化字段，补齐上阶段只记录决策、不记录 provider trace 的可观测性断点
- 在 worker agent-cycle trace mapping 中承接 agent-runtime replanningTrace，保留 provider、usage、attempt 和 worldDecisionContext 摘要
- 将 replanningDecision 纳入 runtime profile agent-cycle LLM stage diagnostics 与 profile gate 派生要求
- 用户可见变化是开启 replanningDecision profile 配置后，报告和 gate 能证明 LLM 重规划阶段被接受且带有世界上下文
- 已通过 observability/worker/server 聚焦回归、全仓 typecheck、lint、全仓 test 和 diff 检查
```

---

### Self-Review

- Spec coverage: this slice makes the newly wired Memory-guided Correction LLM seam observable and gateable in profile runs.
- Placeholder scan: no TBD/TODO placeholders.
- Type consistency: use `replanningDecisionTrace` for provider trace metadata and keep existing `replanningDecision` as the semantic decision result.
- Boundary decision: this does not change LLM prompts or replanning semantics; it only preserves and reports the existing trace from `agent-runtime`.
