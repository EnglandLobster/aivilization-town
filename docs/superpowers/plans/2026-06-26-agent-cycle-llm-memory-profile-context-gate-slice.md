# Agent-Cycle LLM Memory Profile Context Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make runtime profile gates prove that agent-cycle LLM stages received the paper-required STM and LTM context, not only complete world state.

**Architecture:** Add a small reusable agent-runtime cognitive-context trace helper, then stamp each agent-cycle LLM stage trace with `shortTermMemoryContext` and `longTermProfileContext` metadata. Preserve those fields through worker-to-observability mapping and durable trace repositories, summarize them in runtime profile diagnostics, and add profile gate criteria derived from runtime config.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, `@aivilization/agent-runtime`, `@aivilization/worker`, `@aivilization/observability`, server profile gates.

---

### Task 1: Trace LLM STM/LTM Context At The Agent-Runtime Boundary

**Files:**
- Create: `packages/agent-runtime/src/llmContextTrace.ts`
- Modify: `packages/agent-runtime/src/index.ts`
- Modify: `packages/agent-runtime/src/subtaskPrioritization.ts`
- Modify: `packages/agent-runtime/src/actionSequenceGeneration.ts`
- Modify: `packages/agent-runtime/src/socialDialogueGeneration.ts`
- Modify: `packages/agent-runtime/src/globalSynthesis.ts`
- Modify: `packages/agent-runtime/src/actionRepair.ts`
- Modify: `packages/agent-runtime/src/replanning.ts`
- Modify: `packages/agent-runtime/src/llmSubtaskPrioritizer.ts`
- Modify: `packages/agent-runtime/src/llmActionSequenceGenerator.ts`
- Modify: `packages/agent-runtime/src/llmSocialDialogueGenerator.ts`
- Modify: `packages/agent-runtime/src/llmGlobalSynthesizer.ts`
- Modify: `packages/agent-runtime/src/llmReactiveCorrector.ts`
- Modify: `packages/agent-runtime/src/llmReplanningDecider.ts`
- Test: existing `packages/agent-runtime/src/llm*.test.ts`

- [x] **Step 1: Write failing LLM trace assertions**

Add or extend focused tests for at least contextual prioritization and replanning decision:

```ts
expect(result.trace.shortTermMemoryContext).toEqual({ recordCount: 1 });
expect(result.trace.longTermProfileContext).toEqual({ entryCount: 1 });
```

Use existing test helpers that already pass `shortTermMemoryContext` and `longTermProfile`.

- [x] **Step 2: Verify RED**

Run:

```bash
pnpm vitest run packages/agent-runtime/src/llmSubtaskPrioritizer.test.ts packages/agent-runtime/src/llmReplanningDecider.test.ts --reporter=basic
```

Expected: fail because trace types and mapper output do not yet expose STM/LTM context metadata.

- [x] **Step 3: Implement trace helper and stage mapping**

Create `createLlmCognitiveContextTrace(input)`:

```ts
export function createLlmCognitiveContextTrace(input: {
  readonly shortTermMemoryContext?: readonly ShortTermMemoryRecord[];
  readonly longTermProfile?: LongTermAgentProfile;
}): LlmCognitiveContextTrace {
  return {
    ...(input.shortTermMemoryContext === undefined
      ? {}
      : { shortTermMemoryContext: { recordCount: input.shortTermMemoryContext.length } }),
    ...(input.longTermProfile === undefined
      ? {}
      : { longTermProfileContext: { entryCount: countLongTermProfileEntries(input.longTermProfile) } }),
  };
}
```

Add `shortTermMemoryContext?: { recordCount: number }` and `longTermProfileContext?: { entryCount: number }` to all six agent-cycle LLM trace types. Spread `createLlmCognitiveContextTrace(...)` in every LLM accepted and fallback trace mapper.

- [x] **Step 4: Verify GREEN**

Run:

```bash
pnpm vitest run packages/agent-runtime/src/llmSubtaskPrioritizer.test.ts packages/agent-runtime/src/llmActionSequenceGenerator.test.ts packages/agent-runtime/src/llmSocialDialogueGenerator.test.ts packages/agent-runtime/src/llmGlobalSynthesizer.test.ts packages/agent-runtime/src/llmReactiveCorrector.test.ts packages/agent-runtime/src/llmReplanningDecider.test.ts --reporter=basic
```

### Task 2: Preserve STM/LTM Trace Metadata Through Worker And Observability

**Files:**
- Modify: `packages/observability/src/agentCycleTrace.ts`
- Modify: `packages/observability/src/agentCycleTraceRepository.ts`
- Modify: `apps/worker/src/agentCycleRunner.ts`
- Test: `packages/observability/src/agentCycleTrace.test.ts`
- Test: `apps/worker/src/agentCycleRunner.test.ts`

- [x] **Step 1: Write failing repository/worker assertions**

Extend an existing rich trace test to assert cloned traces preserve:

```ts
shortTermMemoryContext: { recordCount: 1 },
longTermProfileContext: { entryCount: 1 },
```

for contextual prioritization and at least one async stage trace.

- [x] **Step 2: Verify RED**

Run:

```bash
pnpm vitest run packages/observability/src/agentCycleTrace.test.ts apps/worker/src/agentCycleRunner.test.ts --reporter=basic
```

Expected: fail because observability trace types and worker mappers drop these fields.

- [x] **Step 3: Implement trace preservation**

Add matching context metadata fields to observability agent-cycle LLM trace types. Add a clone helper in `agentCycleTraceRepository.ts`, and spread it from every stage clone function and every worker trace mapper.

- [x] **Step 4: Verify GREEN**

Run the same focused command. Expected: pass.

### Task 3: Add Runtime Profile Diagnostics And Gates

**Files:**
- Modify: `packages/observability/src/runtimeProfileRunReport.ts`
- Modify: `packages/observability/src/runtimeProfileRunReport.test.ts`
- Modify: `packages/observability/src/runtimeProfileRunGate.ts`
- Modify: `packages/observability/src/runtimeProfileRunGate.test.ts`
- Modify: `apps/server/src/localRuntimeTownProfileGate.ts`
- Modify: `apps/server/src/localRuntimeTownProfileGate.test.ts`
- Modify: `apps/server/src/localRuntimeTownProfileGateSuite.test.ts`

- [x] **Step 1: Write failing diagnostics and gate tests**

Extend `RuntimeProfileAgentCycleLlmStageDiagnostics` expectations with:

```ts
shortTermMemoryContextCount: 1,
longTermProfileContextCount: 1,
```

Add gate criteria:

```ts
requiredAgentCycleLlmMemoryContextStages
requiredAgentCycleLlmProfileContextStages
```

and failing tests for stages whose LLM trace is accepted but missing STM or LTM context.

- [x] **Step 2: Verify RED**

Run:

```bash
pnpm vitest run packages/observability/src/runtimeProfileRunReport.test.ts packages/observability/src/runtimeProfileRunGate.test.ts apps/server/src/localRuntimeTownProfileGate.test.ts --reporter=basic
```

Expected: fail because diagnostics and gates do not yet know STM/LTM context counts.

- [x] **Step 3: Implement diagnostics and gate criteria**

Add required counts to `RuntimeProfileAgentCycleLlmStageDiagnostics`, initialize/clone/validate them, and increment them from stage traces. Add gate failures:

```ts
agent-cycle-llm-stage-memory-context-count-too-low
agent-cycle-llm-stage-profile-context-count-too-low
```

Server profile gate derivation should require STM/LTM context for the same configured agent-cycle LLM stages that require accepted traces.

- [x] **Step 4: Verify GREEN**

Run the same focused command. Expected: pass.

### Task 4: Regression And Commit

**Files:**
- Modify all files above and this plan.

- [x] **Step 1: Focused regression**

Run:

```bash
pnpm vitest run packages/agent-runtime/src/llmSubtaskPrioritizer.test.ts packages/agent-runtime/src/llmActionSequenceGenerator.test.ts packages/agent-runtime/src/llmSocialDialogueGenerator.test.ts packages/agent-runtime/src/llmGlobalSynthesizer.test.ts packages/agent-runtime/src/llmReactiveCorrector.test.ts packages/agent-runtime/src/llmReplanningDecider.test.ts packages/observability/src/agentCycleTrace.test.ts packages/observability/src/runtimeProfileRunReport.test.ts packages/observability/src/runtimeProfileRunGate.test.ts apps/worker/src/agentCycleRunner.test.ts apps/server/src/localRuntimeTownProfileGate.test.ts apps/server/src/localRuntimeTownProfileGateSuite.test.ts --reporter=basic
pnpm --filter @aivilization/agent-runtime typecheck
pnpm --filter @aivilization/observability typecheck
```

- [x] **Step 2: Full repository verification**

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
git add docs/superpowers/plans/2026-06-26-agent-cycle-llm-memory-profile-context-gate-slice.md packages/agent-runtime/src/llmContextTrace.ts packages/agent-runtime/src/index.ts packages/agent-runtime/src/subtaskPrioritization.ts packages/agent-runtime/src/actionSequenceGeneration.ts packages/agent-runtime/src/socialDialogueGeneration.ts packages/agent-runtime/src/globalSynthesis.ts packages/agent-runtime/src/actionRepair.ts packages/agent-runtime/src/replanning.ts packages/agent-runtime/src/llmSubtaskPrioritizer.ts packages/agent-runtime/src/llmActionSequenceGenerator.ts packages/agent-runtime/src/llmSocialDialogueGenerator.ts packages/agent-runtime/src/llmGlobalSynthesizer.ts packages/agent-runtime/src/llmReactiveCorrector.ts packages/agent-runtime/src/llmReplanningDecider.ts packages/agent-runtime/src/llmSubtaskPrioritizer.test.ts packages/agent-runtime/src/llmReplanningDecider.test.ts packages/observability/src/agentCycleTrace.ts packages/observability/src/agentCycleTraceRepository.ts packages/observability/src/agentCycleTrace.test.ts packages/observability/src/runtimeProfileRunReport.ts packages/observability/src/runtimeProfileRunReport.test.ts packages/observability/src/runtimeProfileRunGate.ts packages/observability/src/runtimeProfileRunGate.test.ts apps/worker/src/agentCycleRunner.ts apps/worker/src/agentCycleRunner.test.ts apps/server/src/localRuntimeTownProfileGate.ts apps/server/src/localRuntimeTownProfileGate.test.ts apps/server/src/localRuntimeTownProfileGateSuite.test.ts
git commit
```

Commit message:

```text
feat(observability): 验真 agent-cycle LLM 记忆与画像上下文

- 为了对齐论文中 STM/LTM 共同驱动 agent cognition 的要求，补齐 agent-cycle LLM stage 的记忆与长期画像上下文诊断
- 新增 agent-runtime cognitive context trace helper，并让六个 agent-cycle LLM seam 在 accepted/fallback trace 中记录 STM/LTM 输入覆盖
- observability profile report 新增 STM/LTM context count，profile gate 可要求配置过的 LLM stage 必须带入这些上下文
- 用户可见变化是 profile gate 能阻止 LLM stage accepted 但没有拿到记忆或画像上下文的伪通过
- 验证覆盖 agent-runtime/worker/observability/server 聚焦测试、全仓 lint/typecheck/test 和 diff 检查
```

---

### Self-Review

- Spec coverage: this advances paper §2.1.1, §2.1.2, and §2.2 by making STM/LTM availability verifiable for the main agent-cycle LLM planning and repair stages.
- Placeholder scan: no TODO/TBD placeholders.
- Type consistency: `shortTermMemoryContext` and `longTermProfileContext` are trace metadata, while runtime profile diagnostics expose counts for gate evaluation.
