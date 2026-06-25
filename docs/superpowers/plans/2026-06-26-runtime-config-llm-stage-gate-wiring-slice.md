# Runtime Config LLM Stage Gate Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire profile runtime LLM configuration into profile gate criteria so configured agent-cycle LLM stages must prove at least one accepted LLM trace.

**Architecture:** Keep stage derivation in the server profile gate boundary, because it already owns scenario-profile-to-observability criteria translation. Both the profile gate suite and the single profile runner CLI should reuse this mapping so backend entrypoints cannot disagree. Only agent-cycle LLM stages map to `RuntimeProfileAgentCycleLlmStageName`; strategic, daily, reaction, reflection, and social-model stages remain outside this specific gate until their own durable diagnostics are added.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, existing `@aivilization/server` and `@aivilization/observability` packages.

---

### Task 1: Profile Gate Stage Mapping

**Files:**

- Modify: `apps/server/src/localRuntimeTownProfileGate.test.ts`
- Modify: `apps/server/src/localRuntimeTownProfileGate.ts`

- [x] **Step 1: Write failing criteria mapping test**

Add a test showing that a runtime config containing `subtaskPrioritization`, `actionSequenceGeneration`, `socialDialogue`, `globalSynthesis`, and `reactiveCorrection` derives these required gate stages:

```ts
[
  'contextualPrioritization',
  'actionSequenceGeneration',
  'socialDialogueGeneration',
  'globalSynthesis',
  'reactiveCorrection',
];
```

Run:

```bash
pnpm --filter @aivilization/server test -- localRuntimeTownProfileGate.test.ts
```

Expected: FAIL because profile gate criteria does not consume runtime config yet.

- [x] **Step 2: Implement mapping**

Extend `LocalRuntimeTownProfileGateCriteriaInput` with `runtimeConfig?: LocalRuntimeTownProfileRuntimeConfig` and optional `requiredAgentCycleLlmAcceptedStages`.

Derive required stages from runtime config fields:

- `subtaskPrioritization` -> `contextualPrioritization`
- `actionSequenceGeneration` -> `actionSequenceGeneration`
- `socialDialogue` -> `socialDialogueGeneration`
- `globalSynthesis` -> `globalSynthesis`
- `reactiveCorrection` -> `reactiveCorrection`

- [x] **Step 3: Verify focused GREEN**

Run:

```bash
pnpm --filter @aivilization/server test -- localRuntimeTownProfileGate.test.ts
```

Expected: PASS.

### Task 2: Suite And CLI Wiring

**Files:**

- Modify: `apps/server/src/localRuntimeTownProfileGateSuite.test.ts`
- Modify: `apps/server/src/localRuntimeTownProfileGateSuite.ts`
- Modify: `apps/server/src/localRuntimeTownProfileRunnerCli.test.ts`
- Modify: `apps/server/src/localRuntimeTownProfileRunnerCli.ts`

- [x] **Step 1: Write failing suite and CLI tests**

Add tests proving:

- profile gate suite fails when runtime config enables an agent-cycle LLM stage but the report has no accepted LLM trace for that stage;
- single profile CLI with `--require-gate` and `--runtime-config` returns exit code `2` for the same missing accepted trace.

Run:

```bash
pnpm --filter @aivilization/server test -- localRuntimeTownProfileGateSuite.test.ts localRuntimeTownProfileRunnerCli.test.ts
```

Expected: FAIL because both entrypoints still create gate criteria without runtime config.

- [x] **Step 2: Wire runtime config into gate criteria**

Pass each profile's parsed runtime config into `createLocalRuntimeTownProfileGateCriteria(...)` in the suite and CLI gate paths.

Update existing full-stage forwarding fixtures to include accepted `llmStageDiagnostics` when the runtime config enables agent-cycle LLM stages and the expected gate status is pass.

- [x] **Step 3: Verify focused GREEN**

Run:

```bash
pnpm --filter @aivilization/server test -- localRuntimeTownProfileGateSuite.test.ts localRuntimeTownProfileRunnerCli.test.ts
```

Expected: PASS.

### Task 3: Verification And Commit

**Files:**

- Modify all files above plus this plan.

- [x] **Step 1: Format touched files**

Run:

```bash
pnpm exec prettier --write docs/superpowers/plans/2026-06-26-runtime-config-llm-stage-gate-wiring-slice.md apps/server/src/localRuntimeTownProfileGate.ts apps/server/src/localRuntimeTownProfileGate.test.ts apps/server/src/localRuntimeTownProfileGateSuite.ts apps/server/src/localRuntimeTownProfileGateSuite.test.ts apps/server/src/localRuntimeTownProfileRunnerCli.ts apps/server/src/localRuntimeTownProfileRunnerCli.test.ts
```

- [x] **Step 2: Run full verification**

Run:

```bash
pnpm check
pnpm exec prettier --check docs/superpowers/plans/2026-06-26-runtime-config-llm-stage-gate-wiring-slice.md apps/server/src/localRuntimeTownProfileGate.ts apps/server/src/localRuntimeTownProfileGate.test.ts apps/server/src/localRuntimeTownProfileGateSuite.ts apps/server/src/localRuntimeTownProfileGateSuite.test.ts apps/server/src/localRuntimeTownProfileRunnerCli.ts apps/server/src/localRuntimeTownProfileRunnerCli.test.ts
git diff --check
```

Expected: all commands exit 0.

- [x] **Step 3: Commit**

Stage only this plan and the server files changed in this slice, then commit with a detailed Conventional Commit message.
