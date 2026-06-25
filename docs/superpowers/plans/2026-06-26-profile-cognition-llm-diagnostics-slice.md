# Profile Cognition LLM Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add durable profile-run diagnostics and gate checks for non-agent-cycle LLM cognition stages: strategic planning, daily planning, and reaction evaluation.

**Architecture:** Reuse the existing durable trace repositories instead of adding a parallel telemetry path. `@aivilization/observability` will own a compact profile-level diagnostics shape, while `apps/server` will query partition storage during profile-run summarization and pass runtime-config-derived gate requirements through the existing profile gate criteria path. This keeps the boundary aligned with the large-game-backend pattern already used by agent-cycle diagnostics: traces remain detailed, reports stay compact, gates consume reports only.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, existing `@aivilization/observability`, `@aivilization/server`, and `@aivilization/worker` trace repositories.

---

### Task 1: Observability Diagnostics And Gate

**Files:**

- Modify: `packages/observability/src/runtimeProfileRunReport.test.ts`
- Modify: `packages/observability/src/runtimeProfileRunReport.ts`
- Modify: `packages/observability/src/runtimeProfileRunGate.test.ts`
- Modify: `packages/observability/src/runtimeProfileRunGate.ts`

- [x] **Step 1: Write failing report diagnostics tests**

Add tests proving:

- `createRuntimeProfileCognitionLlmStageDiagnostics(...)` summarizes objective renewal strategic plan traces, daily plan renewal traces, and reaction evaluation traces;
- `RuntimeProfileRunReport` clones and preserves `cognitionLlmStageDiagnostics`;
- invalid cognition stage diagnostics are rejected.

Run:

```bash
pnpm --filter @aivilization/observability test -- runtimeProfileRunReport.test.ts
```

Expected: FAIL because the profile report has no cognition LLM diagnostics yet.

- [x] **Step 2: Write failing gate test**

Add a test proving `requiredCognitionLlmAcceptedStages: ['strategicPlanning', 'dailyPlanning']` fails when one required stage has `llmAcceptedCount === 0`.

Run:

```bash
pnpm --filter @aivilization/observability test -- runtimeProfileRunGate.test.ts
```

Expected: FAIL because the gate has no required cognition LLM stages criteria yet.

- [x] **Step 3: Implement observability support**

Add:

- `RuntimeProfileCognitionLlmStageName`
- `RuntimeProfileCognitionLlmStageDiagnostics`
- `createRuntimeProfileCognitionLlmStageDiagnostics(...)`
- optional `RuntimeProfileRunReport.cognitionLlmStageDiagnostics`
- optional `RuntimeProfileRunGateCriteria.requiredCognitionLlmAcceptedStages`

Stage mapping:

- objective renewal `strategicPlan` -> `strategicPlanning`
- daily plan renewal `planningTrace` -> `dailyPlanning`
- reaction evaluation `reactionTrace` -> `reactionEvaluation`

Source counting:

- `traceCount`: number of durable stage opportunities;
- `llmAcceptedCount`: provider trace has `source === 'llm'` and `status === 'accepted'`;
- `deterministicFallbackCount`: provider trace has `source === 'deterministic-fallback'`;
- `deterministicCount`: provider trace has `source === 'deterministic'`;
- `missingProviderTraceCount`: durable trace exists but the provider trace is absent.

- [x] **Step 4: Verify observability GREEN**

Run:

```bash
pnpm --filter @aivilization/observability test -- runtimeProfileRunReport.test.ts runtimeProfileRunGate.test.ts
```

Expected: PASS.

### Task 2: Server Runner And Profile Gate Wiring

**Files:**

- Modify: `apps/server/src/localRuntimeTownProfileRunner.test.ts`
- Modify: `apps/server/src/localRuntimeTownProfileRunner.ts`
- Modify: `apps/server/src/localRuntimeTownProfileGate.test.ts`
- Modify: `apps/server/src/localRuntimeTownProfileGate.ts`
- Modify: `apps/server/src/localRuntimeTownProfileGateSuite.test.ts`

- [x] **Step 1: Write failing server tests**

Add tests proving:

- profile runner summaries include accepted strategic/daily/reaction cognition LLM diagnostics when those durable traces exist;
- `createLocalRuntimeTownProfileGateCriteria(...)` derives `requiredCognitionLlmAcceptedStages` from `strategicPlanning`, `dailyPlanning`, and `reactionPlanning` runtime config;
- profile gate suite fails when runtime config enables strategic planning but the report has no accepted strategic LLM trace.

Run:

```bash
pnpm --filter @aivilization/server test -- localRuntimeTownProfileRunner.test.ts localRuntimeTownProfileGate.test.ts localRuntimeTownProfileGateSuite.test.ts
```

Expected: FAIL because server reports and criteria do not wire cognition LLM diagnostics yet.

- [x] **Step 2: Implement server wiring**

During profile runner partition summarization, query:

- `objectiveRenewalTraceRepository`
- `dailyPlanRenewalTraceRepository`
- `reactionEvaluationTraceRepository`

Aggregate all partition traces through `createRuntimeProfileCognitionLlmStageDiagnostics(...)`.

Attach the result to `LocalRuntimeTownProfileRunnerSummary`, stored `RuntimeProfileRunReport`, and `createLocalRuntimeTownProfileRunReportFromSummary(...)`.

Update profile gate criteria derivation so runtime config maps:

- `strategicPlanning` -> `strategicPlanning`
- `dailyPlanning` -> `dailyPlanning`
- `reactionPlanning` -> `reactionEvaluation`

- [x] **Step 3: Verify server GREEN**

Run:

```bash
pnpm --filter @aivilization/server test -- localRuntimeTownProfileRunner.test.ts localRuntimeTownProfileGate.test.ts localRuntimeTownProfileGateSuite.test.ts
```

Expected: PASS.

### Task 3: Verification And Commit

**Files:**

- Modify all files above plus this plan.

- [x] **Step 1: Format touched files**

Run:

```bash
pnpm exec prettier --write docs/superpowers/plans/2026-06-26-profile-cognition-llm-diagnostics-slice.md packages/observability/src/runtimeProfileRunReport.ts packages/observability/src/runtimeProfileRunReport.test.ts packages/observability/src/runtimeProfileRunGate.ts packages/observability/src/runtimeProfileRunGate.test.ts apps/server/src/localRuntimeTownProfileRunner.ts apps/server/src/localRuntimeTownProfileRunner.test.ts apps/server/src/localRuntimeTownProfileGate.ts apps/server/src/localRuntimeTownProfileGate.test.ts apps/server/src/localRuntimeTownProfileGateSuite.test.ts
```

- [x] **Step 2: Run full verification**

Run:

```bash
pnpm check
pnpm exec prettier --check docs/superpowers/plans/2026-06-26-profile-cognition-llm-diagnostics-slice.md packages/observability/src/runtimeProfileRunReport.ts packages/observability/src/runtimeProfileRunReport.test.ts packages/observability/src/runtimeProfileRunGate.ts packages/observability/src/runtimeProfileRunGate.test.ts apps/server/src/localRuntimeTownProfileRunner.ts apps/server/src/localRuntimeTownProfileRunner.test.ts apps/server/src/localRuntimeTownProfileGate.ts apps/server/src/localRuntimeTownProfileGate.test.ts apps/server/src/localRuntimeTownProfileGateSuite.test.ts
git diff --check
```

Expected: all commands exit 0.

- [x] **Step 3: Commit**

Stage only this plan and the files changed in this slice, then commit with a detailed Conventional Commit message.
