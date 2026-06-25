# Profile Gate LLM Stage Config Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure runtime profile gate suites forward every parsed LLM cognition-stage config into profile runners.

**Architecture:** Keep `LocalRuntimeTownProfileRuntimeConfig` as the single parsed config contract and make the gate-suite runner-input adapter exhaustive over that contract. This preserves the existing runner boundary while preventing profile gate validation from silently exercising deterministic fallbacks when subtask prioritization, action generation, synthesis, repair, dialogue, or memory synthesis LLM stages are configured.

**Tech Stack:** TypeScript, Vitest, existing `apps/server` local runtime profile APIs.

---

### Task 1: Prove Gate Suite Drops Agent-Cycle LLM Config

**Files:**

- Modify: `apps/server/src/localRuntimeTownProfileGateSuite.test.ts`
- Modify: `apps/server/src/localRuntimeTownProfileGateSuite.ts`

- [x] **Step 1: Write the failing test**

Add a test in `apps/server/src/localRuntimeTownProfileGateSuite.test.ts` that:

- writes a runtime config file with profile-specific `llmPlanning`, `dailyPlanning`, `reactionPlanning`, `subtaskPrioritization`, `actionSequenceGeneration`, `socialDialogue`, `globalSynthesis`, `reactiveCorrection`, `reflectionSynthesis`, and `socialModelSynthesis`;
- runs `runLocalRuntimeTownProfileGateSuite` with an injected `runProfile`;
- captures the `LocalRuntimeTownProfileRunnerInput`;
- expects each parsed config to be present on the captured runner input.

- [x] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @aivilization/server test -- localRuntimeTownProfileGateSuite.test.ts
```

Expected: FAIL because `createProfileRunnerInput` forwards only strategic/daily/reaction/replanning config.

- [x] **Step 3: Implement complete wiring**

In `apps/server/src/localRuntimeTownProfileGateSuite.ts`, extend `createProfileRunnerInput` so it forwards:

- `subtaskPrioritization`
- `actionSequenceGeneration`
- `socialDialogue`
- `globalSynthesis`
- `reactiveCorrection`
- `reflectionSynthesis`
- `socialModelSynthesis`

Do not instantiate providers in the gate suite. Keep provider construction inside `runLocalRuntimeTownDaemonScenarioProfile`.

- [x] **Step 4: Run focused tests**

Run:

```bash
pnpm --filter @aivilization/server test -- localRuntimeTownProfileGateSuite.test.ts localRuntimeTownProfileRuntimeConfig.test.ts localRuntimeTownProfileRunner.test.ts localRuntimeTownProfileLlmPlanning.test.ts
```

Expected: PASS.

### Task 2: Verify And Commit

- [x] **Step 1: Run full checks**

Run:

```bash
pnpm check
pnpm exec prettier --check docs/superpowers/plans/2026-06-25-profile-gate-llm-stage-config-wiring-slice.md apps/server/src/localRuntimeTownProfileGateSuite.ts apps/server/src/localRuntimeTownProfileGateSuite.test.ts
git diff --check
```

- [x] **Step 2: Commit**

Commit only this slice:

```bash
git add docs/superpowers/plans/2026-06-25-profile-gate-llm-stage-config-wiring-slice.md apps/server/src/localRuntimeTownProfileGateSuite.ts apps/server/src/localRuntimeTownProfileGateSuite.test.ts
git commit -m "fix(server): 补齐 profile gate 的 LLM 阶段配置透传"
```

### Self-Review

- Spec coverage: closes a server integration gap where parsed LLM cognition-stage config could be omitted before reaching the profile runner.
- Placeholder scan: no placeholders remain.
- Scope check: deliberately limited to runtime config propagation; provider factories, prompt contracts, and worker execution semantics stay in their existing modules.
