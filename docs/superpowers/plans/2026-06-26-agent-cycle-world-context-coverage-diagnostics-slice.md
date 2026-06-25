# Agent-Cycle World Context Coverage Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every configured agent-cycle LLM stage prove that it was invoked with `worldDecisionContext`.

**Architecture:** Add compact `WorldDecisionContextTrace` coverage metadata to the five agent-cycle LLM trace surfaces: contextual prioritization, action sequence generation, social dialogue generation, global synthesis, and reactive correction. Preserve the metadata through durable agent-cycle trace repositories, summarize it in runtime profile diagnostics, and require it in profile gates whenever the corresponding LLM runtime config is enabled.

**Tech Stack:** TypeScript, Vitest, `@aivilization/agent-runtime`, `@aivilization/observability`, local runtime profile runner/gate infrastructure.

---

### Task 1: Record context coverage in agent-cycle LLM traces

**Files:**
- Modify: `packages/agent-runtime/src/subtaskPrioritization.ts`
- Modify: `packages/agent-runtime/src/actionSequenceGeneration.ts`
- Modify: `packages/agent-runtime/src/socialDialogueGeneration.ts`
- Modify: `packages/agent-runtime/src/globalSynthesis.ts`
- Modify: `packages/agent-runtime/src/actionRepair.ts`
- Modify: `packages/agent-runtime/src/llmSubtaskPrioritizer.ts`
- Modify: `packages/agent-runtime/src/llmActionSequenceGenerator.ts`
- Modify: `packages/agent-runtime/src/llmSocialDialogueGenerator.ts`
- Modify: `packages/agent-runtime/src/llmGlobalSynthesizer.ts`
- Modify: `packages/agent-runtime/src/llmReactiveCorrector.ts`
- Test: `packages/agent-runtime/src/llmSubtaskPrioritizer.test.ts`
- Test: `packages/agent-runtime/src/llmActionSequenceGenerator.test.ts`
- Test: `packages/agent-runtime/src/llmSocialDialogueGenerator.test.ts`
- Test: `packages/agent-runtime/src/llmGlobalSynthesizer.test.ts`
- Test: `packages/agent-runtime/src/llmReactiveCorrector.test.ts`

- [x] **Step 1: Write failing trace coverage assertions**

In the accepted LLM tests that already pass `worldDecisionContext: createWorldDecisionContext()`, extend the expected `trace` object to include:

```ts
worldDecisionContext: {
  agentId,
  hasPhysiology: true,
  hasBalance: true,
  hasEducationScore: true,
  hasResidentialTier: true,
  inventoryItemCount: 1,
  marketSpotPriceCount: 1,
  hasLatestPriceIndex: true,
}
```

Use the exact expected counts from each fixture. The prioritizer/action/social fixtures currently have two inventory entries (`Fish` plus `Transistor`), global synthesis has two (`Fish` plus `Widget`), and reactive correction has one (`Fish`).

- [x] **Step 2: Verify RED for agent-runtime traces**

Run:

```bash
pnpm vitest run packages/agent-runtime/src/llmSubtaskPrioritizer.test.ts packages/agent-runtime/src/llmActionSequenceGenerator.test.ts packages/agent-runtime/src/llmSocialDialogueGenerator.test.ts packages/agent-runtime/src/llmGlobalSynthesizer.test.ts packages/agent-runtime/src/llmReactiveCorrector.test.ts
```

Expected: FAIL because the prompt contains `worldDecisionContext`, but the returned trace does not include compact coverage metadata.

- [x] **Step 3: Implement compact coverage metadata on trace surfaces**

Add optional `worldDecisionContext?: WorldDecisionContextTrace` to the five trace types. Import `createWorldDecisionContextTrace` and attach the compact metadata in both accepted and deterministic-fallback LLM traces when the LLM input has `worldDecisionContext`.

- [x] **Step 4: Verify GREEN for agent-runtime traces**

Run the same five-file Vitest command. Expected: all five test files pass.

### Task 2: Preserve context coverage through durable agent-cycle traces

**Files:**
- Modify: `packages/observability/src/agentCycleTrace.ts`
- Modify: `packages/observability/src/agentCycleTraceRepository.ts`
- Test: `packages/observability/src/agentCycleTraceRepository.test.ts`
- Test: `packages/observability/src/agentCycleTrace.test.ts`

- [x] **Step 1: Write failing repository persistence tests**

Extend the agent-cycle trace fixture so contextual prioritization, action sequence generation, social dialogue generation, global synthesis, and reactive correction traces each include a `worldDecisionContext` object. Mutate the read copy and assert the repository still returns the original object.

- [x] **Step 2: Verify RED for repository clone support**

Run:

```bash
pnpm vitest run packages/observability/src/agentCycleTraceRepository.test.ts packages/observability/src/agentCycleTrace.test.ts
```

Expected: FAIL because clone functions drop the newly asserted metadata.

- [x] **Step 3: Implement observability type and clone preservation**

Import `WorldDecisionContextTrace` and `cloneWorldDecisionContextTrace` from `packages/observability/src/worldDecisionContextTrace.ts`. Add optional `worldDecisionContext` fields to the five durable agent-cycle stage trace types and copy them in every relevant clone function.

- [x] **Step 4: Verify GREEN for repository clone support**

Run the same two-file Vitest command. Expected: both files pass.

### Task 3: Summarize and gate agent-cycle world context coverage

**Files:**
- Modify: `packages/observability/src/runtimeProfileRunReport.ts`
- Modify: `packages/observability/src/runtimeProfileRunGate.ts`
- Modify: `apps/server/src/localRuntimeTownProfileGate.ts`
- Test: `packages/observability/src/runtimeProfileRunReport.test.ts`
- Test: `packages/observability/src/runtimeProfileRunGate.test.ts`
- Test: `apps/server/src/localRuntimeTownProfileGate.test.ts`
- Test: `apps/server/src/localRuntimeTownProfileGateSuite.test.ts`

- [x] **Step 1: Write failing report and gate tests**

Update agent-cycle LLM diagnostics expectations with `worldDecisionContextCount`. Add report fixtures with world context on contextual prioritization, action sequence generation, social dialogue generation, global synthesis, and reactive correction. Add a gate test requiring `requiredAgentCycleLlmWorldContextStages`.

- [x] **Step 2: Verify RED for report and gate diagnostics**

Run:

```bash
pnpm vitest run packages/observability/src/runtimeProfileRunReport.test.ts packages/observability/src/runtimeProfileRunGate.test.ts apps/server/src/localRuntimeTownProfileGate.test.ts apps/server/src/localRuntimeTownProfileGateSuite.test.ts
```

Expected: FAIL because agent-cycle diagnostics do not expose or gate world context coverage.

- [x] **Step 3: Implement diagnostics and criteria support**

Add `worldDecisionContextCount` to `RuntimeProfileAgentCycleLlmStageDiagnostics`, count traces whose `worldDecisionContext` is present, validate the count, add `requiredAgentCycleLlmWorldContextStages` to gate criteria, and derive it from runtime config for subtask prioritization, action sequence generation, social dialogue, global synthesis, and reactive correction.

- [x] **Step 4: Verify GREEN for report and gate diagnostics**

Run the same four-file Vitest command. Expected: all four files pass.

### Task 4: Final verification and commit

**Files:**
- All modified files from Tasks 1-3.

- [x] **Step 1: Run targeted tests**

Run:

```bash
pnpm vitest run packages/agent-runtime/src/llmSubtaskPrioritizer.test.ts packages/agent-runtime/src/llmActionSequenceGenerator.test.ts packages/agent-runtime/src/llmSocialDialogueGenerator.test.ts packages/agent-runtime/src/llmGlobalSynthesizer.test.ts packages/agent-runtime/src/llmReactiveCorrector.test.ts packages/observability/src/agentCycleTraceRepository.test.ts packages/observability/src/agentCycleTrace.test.ts packages/observability/src/runtimeProfileRunReport.test.ts packages/observability/src/runtimeProfileRunGate.test.ts apps/server/src/localRuntimeTownProfileGate.test.ts apps/server/src/localRuntimeTownProfileGateSuite.test.ts
```

- [x] **Step 2: Run project checks**

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test
git diff --check
```

- [x] **Step 3: Commit**

Commit only this slice and leave existing untracked paper/report directories untouched.
