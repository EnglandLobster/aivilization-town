# Cognition Economic Context Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend runtime profile diagnostics and gates so cognition-side LLM stages prove complete economic context, matching the paper's requirement that internal attributes and world/economic state feed planning and reflection.

**Architecture:** Keep LLM behavior unchanged and strengthen the observability boundary. Reuse the agent-cycle economic-context semantics for cognition diagnostics so profile gates can fail when a strategic, daily, reaction, reflection, or social-model LLM trace has world context but lacks balance/inventory or market price/index evidence.

**Tech Stack:** TypeScript, Vitest, pnpm workspace, existing `@aivilization/observability`, `@aivilization/server`, and `@aivilization/agent-runtime` trace types.

---

### Task 1: RED Tests For Cognition Economic Diagnostics

**Files:**

- Modify: `packages/observability/src/runtimeProfileRunReport.test.ts`
- Modify: `packages/observability/src/runtimeProfileRunGate.test.ts`
- Modify: `apps/server/src/localRuntimeTownProfileGate.test.ts`
- Modify: `apps/server/src/localRuntimeTownProfileGateSuite.test.ts`

- [ ] **Step 1: Write failing report diagnostics expectations**

Add `economicContextCount` and `completeEconomicContextCount` expectations to cognition LLM stage diagnostics in `runtimeProfileRunReport.test.ts`. The strategic/daily/reaction/reflection/social-model traces that carry `createWorldDecisionContextTrace()` should count as complete; the legacy missing inventory/job/location fixture should count as economic context present but not complete.

- [ ] **Step 2: Write failing gate behavior**

Add a test in `runtimeProfileRunGate.test.ts` requiring `requiredCognitionLlmEconomicContextStages: ['dailyPlanning']` and asserting a failure with code `cognition-llm-stage-complete-economic-context-count-too-low` when `completeEconomicContextCount` is lower than accepted LLM traces.

- [ ] **Step 3: Write failing server criteria expectations**

Add expectations in `localRuntimeTownProfileGate.test.ts` that runtime config derives `requiredCognitionLlmEconomicContextStages` for every enabled cognition LLM stage. Update gate-suite fixtures so accepted cognition LLM diagnostics include economic counts.

- [ ] **Step 4: Verify RED**

Run:

```bash
pnpm vitest run packages/observability/src/runtimeProfileRunReport.test.ts packages/observability/src/runtimeProfileRunGate.test.ts apps/server/src/localRuntimeTownProfileGate.test.ts apps/server/src/localRuntimeTownProfileGateSuite.test.ts
```

Expected: FAIL because cognition diagnostics, criteria, and gates do not yet know economic context fields.

### Task 2: Add Cognition Economic Context Diagnostics

**Files:**

- Modify: `packages/observability/src/worldDecisionContextTrace.ts`
- Modify: `packages/observability/src/runtimeProfileRunReport.ts`

- [ ] **Step 1: Extend trace type**

Add optional-compatible fields to `WorldDecisionContextTrace`: `hasEconomicState`, `hasMarketPrices`, and `completeEconomicContext`. Keep clone behavior structural.

- [ ] **Step 2: Extend cognition stage diagnostics**

Add optional `economicContextCount` and `completeEconomicContextCount` to `RuntimeProfileCognitionLlmStageDiagnostics`, default them in report cloning, initialize them to zero, increment them in `recordCognitionProviderTrace`, and validate their non-negative/count-bound invariants.

- [ ] **Step 3: Verify GREEN for report tests**

Run:

```bash
pnpm vitest run packages/observability/src/runtimeProfileRunReport.test.ts
```

Expected: PASS.

### Task 3: Add Cognition Economic Context Gate

**Files:**

- Modify: `packages/observability/src/runtimeProfileRunGate.ts`
- Modify: `apps/server/src/localRuntimeTownProfileGate.ts`

- [ ] **Step 1: Extend gate criteria**

Add `requiredCognitionLlmEconomicContextStages` to `RuntimeProfileRunGateCriteria`.

- [ ] **Step 2: Evaluate cognition economic context failures**

Add gate evaluation mirroring the agent-cycle economic context gate, with failure code `cognition-llm-stage-complete-economic-context-count-too-low` and evidence containing `stageName`, `actual`, `economicContextCount`, `llmAcceptedCount`, and `minimum`.

- [ ] **Step 3: Derive server criteria from runtime config**

Add `deriveRequiredCognitionLlmEconomicContextStagesFromRuntimeConfig` and include it in `createLocalRuntimeTownProfileGateCriteria`.

- [ ] **Step 4: Verify focused suite**

Run:

```bash
pnpm vitest run packages/observability/src/runtimeProfileRunGate.test.ts apps/server/src/localRuntimeTownProfileGate.test.ts apps/server/src/localRuntimeTownProfileGateSuite.test.ts
```

Expected: PASS.

### Task 4: Full Verification And Commit

**Files:**

- All touched files from Tasks 1-3

- [ ] **Step 1: Format touched files**

Run:

```bash
pnpm prettier --write packages/observability/src/worldDecisionContextTrace.ts packages/observability/src/runtimeProfileRunReport.ts packages/observability/src/runtimeProfileRunReport.test.ts packages/observability/src/runtimeProfileRunGate.ts packages/observability/src/runtimeProfileRunGate.test.ts apps/server/src/localRuntimeTownProfileGate.ts apps/server/src/localRuntimeTownProfileGate.test.ts apps/server/src/localRuntimeTownProfileGateSuite.test.ts docs/superpowers/plans/2026-06-26-cognition-economic-context-gate.md
```

- [ ] **Step 2: Run full verification**

Run:

```bash
pnpm typecheck
pnpm lint
pnpm test
git diff --check
```

Expected: all exit 0.

- [ ] **Step 3: Commit**

Stage only touched files and commit with a Conventional Commit message explaining the paper-alignment reason, module boundaries, gate semantics, user-visible effect, and actual verification commands.
