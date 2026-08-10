# Runtime Profile LLM Fallback Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make runtime profile gates fail when a configured LLM stage silently uses deterministic fallback, so LLM-enabled cognition and agent-cycle profiles prove zero fallback for the required stages instead of only proving that an accepted LLM trace happened at least once.

**Architecture:** Extend `RuntimeProfileRunGateCriteria` with explicit no-fallback stage requirements for agent-cycle and cognition LLM diagnostics. Keep `@aivilization/observability` generic by letting callers choose the strict stages, then make the local runtime town server derive those no-fallback requirements from the same runtime config that already derives accepted/context coverage requirements.

**Tech Stack:** TypeScript, Vitest, pnpm workspace packages, existing runtime profile reports and local runtime profile gate criteria.

---

### Task 1: Observability No-Fallback Gate

**Files:**
- Modify: `packages/observability/src/runtimeProfileRunGate.ts`
- Test: `packages/observability/src/runtimeProfileRunGate.test.ts`

- [x] **Step 1: Write the failing tests**

Add one agent-cycle gate test and one cognition gate test:
- agent-cycle: `contextualPrioritization` has `llmAcceptedCount: 1` and `deterministicFallbackCount: 1`; criteria requires `requiredAgentCycleLlmNoFallbackStages: ['contextualPrioritization']`; result must fail with `agent-cycle-llm-stage-deterministic-fallback-present`.
- cognition: `strategicPlanning` has `llmAcceptedCount: 1` and `deterministicFallbackCount: 1`; criteria requires `requiredCognitionLlmNoFallbackStages: ['strategicPlanning']`; result must fail with `cognition-llm-stage-deterministic-fallback-present`.

- [x] **Step 2: Run RED**

Run:

```bash
pnpm test -- packages/observability/src/runtimeProfileRunGate.test.ts
```

Expected: fails because the criteria fields and gate checks do not exist.

- [x] **Step 3: Implement minimal gate extension**

In `packages/observability/src/runtimeProfileRunGate.ts`:
- Add `requiredAgentCycleLlmNoFallbackStages?: readonly RuntimeProfileAgentCycleLlmStageName[]`.
- Add `requiredCognitionLlmNoFallbackStages?: readonly RuntimeProfileCognitionLlmStageName[]`.
- Add failure checks that require `deterministicFallbackCount === 0` for each configured stage.
- Include failure evidence with `stageName`, `actual`, and `maximum: 0`.

- [x] **Step 4: Run GREEN**

Run:

```bash
pnpm test -- packages/observability/src/runtimeProfileRunGate.test.ts
```

Expected: test passes.

### Task 2: Local Runtime Profile Criteria Wiring

**Files:**
- Modify: `apps/server/src/localRuntimeTownProfileGate.ts`
- Test: `apps/server/src/localRuntimeTownProfileGate.test.ts`

- [x] **Step 1: Write the failing test**

Extend the existing runtime-config derivation test so a full LLM runtime config also expects:
- `requiredAgentCycleLlmNoFallbackStages` equals the six configured agent-cycle LLM stages.
- `requiredCognitionLlmNoFallbackStages` equals the five configured cognition LLM stages.

- [x] **Step 2: Run RED**

Run:

```bash
pnpm test -- apps/server/src/localRuntimeTownProfileGate.test.ts
```

Expected: fails because local profile criteria do not derive no-fallback stage requirements.

- [x] **Step 3: Implement criteria derivation**

In `apps/server/src/localRuntimeTownProfileGate.ts`:
- Add optional input overrides for both no-fallback criteria arrays.
- Derive agent-cycle no-fallback stages from `deriveRequiredAgentCycleLlmAcceptedStagesFromRuntimeConfig`.
- Derive cognition no-fallback stages from `deriveRequiredCognitionLlmAcceptedStagesFromRuntimeConfig`.
- Include non-empty arrays in returned criteria.

- [x] **Step 4: Run GREEN**

Run:

```bash
pnpm test -- apps/server/src/localRuntimeTownProfileGate.test.ts
```

Expected: test passes.

### Task 3: Verification and Commit

**Files:**
- All files changed in Tasks 1-2.

- [x] **Step 1: Run focused tests**

```bash
pnpm test -- packages/observability/src/runtimeProfileRunGate.test.ts apps/server/src/localRuntimeTownProfileGate.test.ts
```

Expected: all focused tests pass.

- [x] **Step 2: Run full verification**

```bash
pnpm lint
pnpm typecheck
pnpm test
git diff --check
```

Expected: all commands pass.

- [x] **Step 3: Commit**

Stage only the relevant code/tests/plan file and commit with a detailed Chinese Conventional Commit message.
