# Cognition World Context Coverage Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make strategic planning, daily planning, and reaction evaluation LLM traces prove that they were produced with `worldDecisionContext`.

**Architecture:** Add compact world-context coverage metadata at the agent-runtime LLM trace boundary. Preserve that metadata through observability repositories and worker mapping functions, then reuse runtime profile `worldDecisionContextCount` and profile gates to verify coverage for all configured cognition LLM stages.

**Tech Stack:** TypeScript, Vitest, `@aivilization/agent-runtime`, `@aivilization/observability`, worker/server profile runner infrastructure.

---

### Task 1: Record context coverage in cognition LLM traces

**Files:**
- Modify: `packages/agent-runtime/src/worldDecisionContext.ts`
- Modify: `packages/agent-runtime/src/strategicPlanning.ts`
- Modify: `packages/agent-runtime/src/dailyPlanning.ts`
- Modify: `packages/agent-runtime/src/reactionEvaluation.ts`
- Modify: `packages/agent-runtime/src/llmStrategicPlanner.ts`
- Modify: `packages/agent-runtime/src/llmDailyPlanner.ts`
- Modify: `packages/agent-runtime/src/llmReactionEvaluator.ts`
- Test: `packages/agent-runtime/src/llmStrategicPlanner.test.ts`
- Test: `packages/agent-runtime/src/llmDailyPlanner.test.ts`
- Test: `packages/agent-runtime/src/llmReactionEvaluator.test.ts`

- [x] **Step 1: Write failing agent-runtime trace tests**

Extend the existing traceable LLM tests to pass `worldDecisionContext: createWorldDecisionContext()` and assert the returned trace includes:

```ts
worldDecisionContext: {
  agentId,
  hasPhysiology: true,
  hasBalance: true,
  hasEducationScore: true,
  hasResidentialTier: true,
  inventoryItemCount: 2,
  marketSpotPriceCount: 1,
  hasLatestPriceIndex: true,
}
```

- [x] **Step 2: Run agent-runtime tests to verify RED**

Run:
`pnpm vitest run packages/agent-runtime/src/llmStrategicPlanner.test.ts packages/agent-runtime/src/llmDailyPlanner.test.ts packages/agent-runtime/src/llmReactionEvaluator.test.ts`

Expected: FAIL because trace objects do not include `worldDecisionContext`.

- [x] **Step 3: Implement compact context coverage metadata**

Add `WorldDecisionContextTrace` and `createWorldDecisionContextTrace(context)` in `packages/agent-runtime/src/worldDecisionContext.ts`. Add optional `worldDecisionContext` fields to `StrategicPlanCompilationTrace`, `DailyPlanCompilationTrace`, and `ReactionEvaluationTrace`. Populate it from traceable LLM accepted and fallback paths in `llmStrategicPlanner.ts`, `llmDailyPlanner.ts`, and `llmReactionEvaluator.ts`.

- [x] **Step 4: Run agent-runtime tests to verify GREEN**

Run:
`pnpm vitest run packages/agent-runtime/src/llmStrategicPlanner.test.ts packages/agent-runtime/src/llmDailyPlanner.test.ts packages/agent-runtime/src/llmReactionEvaluator.test.ts`

Expected: all three test files pass.

### Task 2: Preserve context coverage through observability repositories

**Files:**
- Modify: `packages/observability/src/objectiveRenewalTraceRepository.ts`
- Modify: `packages/observability/src/dailyPlanRenewalTraceRepository.ts`
- Modify: `packages/observability/src/reactionEvaluationTraceRepository.ts`
- Test: `packages/observability/src/objectiveRenewalTraceRepository.test.ts`
- Test: `packages/observability/src/dailyPlanRenewalTraceRepository.test.ts`
- Test: `packages/observability/src/reactionEvaluationTraceRepository.test.ts`

- [x] **Step 1: Write failing repository persistence tests**

Extend repository tests so strategic, daily, and reaction provider traces each contain a `worldDecisionContext` object and verify it survives record/get/query cloning.

- [x] **Step 2: Run repository tests to verify RED**

Run:
`pnpm vitest run packages/observability/src/objectiveRenewalTraceRepository.test.ts packages/observability/src/dailyPlanRenewalTraceRepository.test.ts packages/observability/src/reactionEvaluationTraceRepository.test.ts`

Expected: FAIL because repository clone functions drop `worldDecisionContext`.

- [x] **Step 3: Add observability trace metadata types and clone support**

Add a structurally compatible `WorldDecisionContextTrace` type to observability repository modules, or a shared local type if extracted inside observability. Copy `worldDecisionContext` in `cloneStrategicPlan`, `clonePlanningTrace`, and `cloneProviderTrace`.

- [x] **Step 4: Run repository tests to verify GREEN**

Run:
`pnpm vitest run packages/observability/src/objectiveRenewalTraceRepository.test.ts packages/observability/src/dailyPlanRenewalTraceRepository.test.ts packages/observability/src/reactionEvaluationTraceRepository.test.ts`

Expected: all three repository test files pass.

### Task 3: Wire profile diagnostics and gates for cognition context coverage

**Files:**
- Modify: `apps/worker/src/dailyRoutineSchedule.ts`
- Modify: `apps/worker/src/localCommandDrain.ts`
- Modify: `apps/server/src/localRuntimeTownProfileGate.ts`
- Modify: `apps/server/src/localRuntimeTownProfileGate.test.ts`
- Modify: `apps/server/src/localRuntimeTownProfileGateSuite.test.ts`
- Modify: `apps/server/src/localRuntimeTownProfileRunner.test.ts`
- Test: `apps/server/src/localRuntimeTownProfileRunner.test.ts`
- Test: `packages/observability/src/runtimeProfileRunReport.test.ts`
- Test: `packages/observability/src/runtimeProfileRunGate.test.ts`

- [x] **Step 1: Write failing profile diagnostics tests**

Extend profile runner tests for strategic, daily, and reaction LLM stages to assert their `cognitionLlmStageDiagnostics[*].worldDecisionContextCount` is greater than zero when the corresponding LLM stage is configured with runtime world context.

- [x] **Step 2: Extend gate default expectations**

Update local profile gate criteria tests so runtime config with `strategicPlanning`, `dailyPlanning`, `reactionPlanning`, `reflectionSynthesis`, and `socialModelSynthesis` derives `requiredCognitionLlmWorldContextStages` for all five cognition LLM stages.

- [x] **Step 3: Run profile tests to verify RED**

Run:
`pnpm vitest run apps/server/src/localRuntimeTownProfileGate.test.ts apps/server/src/localRuntimeTownProfileGateSuite.test.ts apps/server/src/localRuntimeTownProfileRunner.test.ts`

Expected: FAIL because strategic/daily/reaction context metadata is not yet preserved into stored traces and gates only require memory synthesis stages.

- [x] **Step 4: Preserve metadata through worker mapping and gate derivation**

Copy `worldDecisionContext` in `apps/worker/src/dailyRoutineSchedule.ts` and `apps/worker/src/localCommandDrain.ts`. Update `deriveRequiredCognitionLlmWorldContextStagesFromRuntimeConfig` to include `strategicPlanning`, `dailyPlanning`, and `reactionEvaluation` when their LLM configs are enabled.

- [x] **Step 5: Run profile tests to verify GREEN**

Run:
`pnpm vitest run apps/server/src/localRuntimeTownProfileGate.test.ts apps/server/src/localRuntimeTownProfileGateSuite.test.ts apps/server/src/localRuntimeTownProfileRunner.test.ts packages/observability/src/runtimeProfileRunReport.test.ts packages/observability/src/runtimeProfileRunGate.test.ts`

Expected: all listed tests pass.

### Task 4: Final verification and commit

**Files:**
- All modified files from Tasks 1-3.

- [x] **Step 1: Run targeted tests**

Run:
`pnpm vitest run packages/agent-runtime/src/llmStrategicPlanner.test.ts packages/agent-runtime/src/llmDailyPlanner.test.ts packages/agent-runtime/src/llmReactionEvaluator.test.ts packages/observability/src/objectiveRenewalTraceRepository.test.ts packages/observability/src/dailyPlanRenewalTraceRepository.test.ts packages/observability/src/reactionEvaluationTraceRepository.test.ts apps/server/src/localRuntimeTownProfileGate.test.ts apps/server/src/localRuntimeTownProfileGateSuite.test.ts apps/server/src/localRuntimeTownProfileRunner.test.ts`

- [x] **Step 2: Run project checks**

Run:
`pnpm lint`
`pnpm typecheck`
`pnpm test`
`git diff --check`

- [x] **Step 3: Commit**

Commit only this slice and leave existing untracked paper/report directories untouched.
