# Memory Synthesis Context Coverage Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make profile reports and gates prove that memory synthesis LLM traces were produced with worldDecisionContext, not only that the LLM provider accepted.

**Architecture:** Add compact context-coverage metadata to memory synthesis traces when `worldDecisionContext` is present. Preserve that metadata through worker supervisor operation traces, aggregate it in runtime profile cognition diagnostics, and let profile gates require context coverage for configured memory synthesis LLM stages.

**Tech Stack:** TypeScript, Vitest, existing memory trace types, worker operation traces, runtime profile report/gate infrastructure.

---

### Task 1: Record context coverage in memory synthesis traces

**Files:**
- Modify: `packages/memory/src/worldContext.ts`
- Modify: `packages/memory/src/reflection.ts`
- Modify: `packages/memory/src/socialModelSynthesis.ts`
- Modify: `packages/memory/src/llmReflectionSynthesizer.ts`
- Modify: `packages/memory/src/llmSocialModelSynthesizer.ts`
- Test: `packages/memory/src/llmReflectionSynthesizer.test.ts`
- Test: `packages/memory/src/llmSocialModelSynthesizer.test.ts`

- [x] **Step 1: Write failing memory trace tests**

Extend the existing accepted LLM tests to assert:

```ts
expect(result.trace.worldDecisionContext).toMatchObject({
  agentId,
  hasPhysiology: true,
  hasBalance: true,
  hasEducationScore: true,
  hasResidentialTier: true,
  inventoryItemCount: 2,
  marketSpotPriceCount: 1,
  hasLatestPriceIndex: true,
});
```

- [x] **Step 2: Run memory tests to verify RED**

Run:
`pnpm vitest run packages/memory/src/llmReflectionSynthesizer.test.ts packages/memory/src/llmSocialModelSynthesizer.test.ts`

Expected: FAIL because trace objects do not include `worldDecisionContext`.

- [x] **Step 3: Implement compact trace metadata**

Add `MemorySynthesisWorldDecisionContextTrace` and `createMemorySynthesisWorldDecisionContextTrace(context)` to `packages/memory/src/worldContext.ts`. Add optional `worldDecisionContext` trace field to `ReflectiveInsightSynthesisTrace` and `SocialModelSynthesisTrace`, and populate it in both accepted and fallback LLM trace builders when input context exists.

- [x] **Step 4: Run memory tests to verify GREEN**

Run:
`pnpm vitest run packages/memory/src/llmReflectionSynthesizer.test.ts packages/memory/src/llmSocialModelSynthesizer.test.ts`

Expected: both files pass.

### Task 2: Preserve context coverage through worker operation traces

**Files:**
- Modify: `apps/worker/src/localSimulationRuntimeOperationTrace.ts`
- Modify: `apps/worker/src/localSimulationRuntimeSupervisor.ts`
- Test: `apps/worker/src/localSimulationRuntimeSupervisor.test.ts`

- [x] **Step 1: Write failing operation trace test**

Update `records memory synthesis provider traces in memory consolidation operation traces` to expect each `reflectionSynthesisTraces[0]` and `socialModelSynthesisTraces[0]` contains a compact `worldDecisionContext` object.

- [x] **Step 2: Run supervisor test to verify RED**

Run:
`pnpm vitest run apps/worker/src/localSimulationRuntimeSupervisor.test.ts`

Expected: FAIL because operation traces currently drop memory trace context metadata.

- [x] **Step 3: Preserve context metadata in operation trace mapping**

Extend `LocalSimulationRuntimeOperationMemorySynthesisProviderTrace` with optional `worldDecisionContext`, and copy it from memory synthesis traces in `createOperationMemorySynthesisProviderTrace`.

- [x] **Step 4: Run supervisor test to verify GREEN**

Run:
`pnpm vitest run apps/worker/src/localSimulationRuntimeSupervisor.test.ts`

Expected: all supervisor tests pass.

### Task 3: Aggregate and gate cognition context coverage

**Files:**
- Modify: `packages/observability/src/runtimeProfileRunReport.ts`
- Modify: `packages/observability/src/runtimeProfileRunReport.test.ts`
- Modify: `packages/observability/src/runtimeProfileRunGate.ts`
- Modify: `packages/observability/src/runtimeProfileRunGate.test.ts`
- Modify: `apps/server/src/localRuntimeTownProfileGate.ts`
- Modify: `apps/server/src/localRuntimeTownProfileGate.test.ts`
- Modify: `apps/server/src/localRuntimeTownProfileGateSuite.test.ts`
- Modify: `apps/server/src/localRuntimeTownProfileRunner.test.ts`

- [x] **Step 1: Write failing report diagnostics test**

Extend the cognition diagnostics test so `reflectionSynthesisTraces` with context yield `worldDecisionContextCount: 1`, while a fallback or deterministic trace without context yields `0`.

- [x] **Step 2: Write failing gate test**

Add a gate criteria test requiring `reflectionSynthesis` context coverage and assert a report with `llmAcceptedCount: 1` but `worldDecisionContextCount: 0` fails with code `cognition-llm-stage-world-context-count-too-low`.

- [x] **Step 3: Run observability tests to verify RED**

Run:
`pnpm vitest run packages/observability/src/runtimeProfileRunReport.test.ts packages/observability/src/runtimeProfileRunGate.test.ts`

Expected: FAIL because diagnostics and gate criteria do not yet support context coverage.

- [x] **Step 4: Implement diagnostics and gate support**

Add `worldDecisionContextCount` to `RuntimeProfileCognitionLlmStageDiagnostics`, increment it in `recordCognitionProviderTrace` when a trace has `worldDecisionContext`, validate it, and add `requiredCognitionLlmWorldContextStages` to gate criteria/evaluation.

- [x] **Step 5: Wire runtime config defaults**

In `apps/server/src/localRuntimeTownProfileGate.ts`, derive `requiredCognitionLlmWorldContextStages` from runtime config for `reflectionSynthesis` and `socialModelSynthesis`, matching the current implemented coverage.

- [x] **Step 6: Run report/gate tests to verify GREEN**

Run:
`pnpm vitest run packages/observability/src/runtimeProfileRunReport.test.ts packages/observability/src/runtimeProfileRunGate.test.ts apps/server/src/localRuntimeTownProfileGate.test.ts apps/server/src/localRuntimeTownProfileGateSuite.test.ts apps/server/src/localRuntimeTownProfileRunner.test.ts`

Expected: all listed tests pass.

### Task 4: Final verification and commit

**Files:**
- All modified files from Tasks 1-3.

- [x] **Step 1: Run targeted tests**

Run:
`pnpm vitest run packages/memory/src/llmReflectionSynthesizer.test.ts packages/memory/src/llmSocialModelSynthesizer.test.ts apps/worker/src/localSimulationRuntimeSupervisor.test.ts packages/observability/src/runtimeProfileRunReport.test.ts packages/observability/src/runtimeProfileRunGate.test.ts apps/server/src/localRuntimeTownProfileGate.test.ts apps/server/src/localRuntimeTownProfileGateSuite.test.ts apps/server/src/localRuntimeTownProfileRunner.test.ts`

- [x] **Step 2: Run project checks**

Run:
`pnpm lint`
`pnpm typecheck`
`pnpm test`
`git diff --check`

- [ ] **Step 3: Commit**

Commit only this slice and leave existing untracked paper/report directories untouched.
