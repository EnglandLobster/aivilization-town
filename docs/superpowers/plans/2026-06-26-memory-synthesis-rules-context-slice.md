# Memory Synthesis Rules Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route occupation and production rules into reflection and social-model memory synthesis LLM contexts, then make profile gates prove that enabled memory synthesis LLM stages saw those rules.

**Architecture:** Extend `@aivilization/memory` with a local `MemorySynthesisWorldDecisionRulesContext` shape that mirrors the stable worker world-decision rules contract without importing `@aivilization/agent-runtime`. Reuse the existing worker `createWorldDecisionContextFromProjection` output structurally, and expand observability diagnostics/gates so memory synthesis stages can require complete rules context just like agent-cycle and cognition stages.

**Tech Stack:** TypeScript, Vitest, pnpm workspace packages, existing world-decision context builders, observability runtime profile gates.

---

### Task 1: Memory Synthesis Context Trace Contract

**Files:**
- Modify: `packages/memory/src/worldContext.ts`
- Test: `packages/memory/src/worldContext.test.ts`

- [x] **Step 1: Write the failing test**

Create `packages/memory/src/worldContext.test.ts` with a test that builds a `MemorySynthesisWorldDecisionContext` containing:
- `rules.criticalThresholds`
- one occupation rule
- one production rule

Expect `createMemorySynthesisWorldDecisionContextTrace(context)` to include:
- `occupationRuleCount: 1`
- `eligibleOccupationRuleCount: 1`
- `productionRuleCount: 1`
- `producibleCommodityRuleCount: 1`

- [x] **Step 2: Run RED**

Run:

```bash
pnpm test -- packages/memory/src/worldContext.test.ts
```

Expected: fails because `MemorySynthesisWorldDecisionContext` and its trace do not expose rule fields.

- [x] **Step 3: Implement minimal context extension**

In `packages/memory/src/worldContext.ts`, add memory-owned rule types:
- `MemorySynthesisWorldDecisionOccupationApplicationQuota`
- `MemorySynthesisWorldDecisionOccupationRule`
- `MemorySynthesisWorldDecisionProductionRule`
- `MemorySynthesisWorldDecisionRulesContext`

Add optional `rules?: MemorySynthesisWorldDecisionRulesContext` to `MemorySynthesisWorldDecisionContext`.

Add the four rule counters to `MemorySynthesisWorldDecisionContextTrace` and compute them from `context.rules`.

- [x] **Step 4: Run GREEN**

Run:

```bash
pnpm test -- packages/memory/src/worldContext.test.ts
```

Expected: test passes.

### Task 2: Lifecycle Memory Consolidation Policy Routing

**Files:**
- Modify: `apps/worker/src/localSimulationLifecycle.ts`
- Test: `apps/worker/src/localSimulationLifecycle.test.ts`

- [x] **Step 1: Write the failing test**

Extend the existing memory consolidation context test in `apps/worker/src/localSimulationLifecycle.test.ts` so the captured `worldDecisionContext` passed into the injected reflective synthesizer is expected to include:
- `rules.criticalThresholds` from lifecycle policies
- non-empty occupation rules
- non-empty production rules

- [x] **Step 2: Run RED**

Run:

```bash
pnpm test -- apps/worker/src/localSimulationLifecycle.test.ts
```

Expected: fails because `createMemoryConsolidationWorldDecisionContext` currently calls `createWorldDecisionContextFromProjection` without policies.

- [x] **Step 3: Implement minimal lifecycle wiring**

In `apps/worker/src/localSimulationLifecycle.ts`:
- import `resolveWorldCommandPolicies`
- add `policies` to `createMemoryConsolidationWorldDecisionContext`
- resolve policies from `input.controllerInput.policies` and current `projection`
- pass resolved policies into `createWorldDecisionContextFromProjection`

- [x] **Step 4: Run GREEN**

Run:

```bash
pnpm test -- apps/worker/src/localSimulationLifecycle.test.ts
```

Expected: test passes.

### Task 3: Profile Gate Memory Synthesis Rules Coverage

**Files:**
- Modify: `apps/server/src/localRuntimeTownProfileGate.ts`
- Modify: `apps/server/src/localRuntimeTownProfileGate.test.ts`

- [x] **Step 1: Write the failing test**

In `apps/server/src/localRuntimeTownProfileGate.test.ts`, when runtime config enables `reflectionSynthesis` and `socialModelSynthesis`, expect `requiredCognitionLlmRulesContextStages` to include:
- `strategicPlanning`
- `dailyPlanning`
- `reactionEvaluation`
- `reflectionSynthesis`
- `socialModelSynthesis`

- [x] **Step 2: Run RED**

Run:

```bash
pnpm test -- apps/server/src/localRuntimeTownProfileGate.test.ts
```

Expected: fails because rules-context requirements currently exclude memory synthesis stages.

- [x] **Step 3: Implement minimal gate derivation**

In `apps/server/src/localRuntimeTownProfileGate.ts`, update `deriveRequiredCognitionLlmRulesContextStagesFromRuntimeConfig` to append:
- `reflectionSynthesis` when `runtimeConfig.reflectionSynthesis` exists
- `socialModelSynthesis` when `runtimeConfig.socialModelSynthesis` exists

- [x] **Step 4: Run GREEN**

Run:

```bash
pnpm test -- apps/server/src/localRuntimeTownProfileGate.test.ts
```

Expected: test passes.

### Task 4: Verification and Commit

**Files:**
- All files changed in Tasks 1-3.

- [x] **Step 1: Run focused tests**

```bash
pnpm test -- packages/memory/src/worldContext.test.ts apps/worker/src/localSimulationLifecycle.test.ts apps/server/src/localRuntimeTownProfileGate.test.ts packages/observability/src/runtimeProfileRunReport.test.ts packages/observability/src/runtimeProfileRunGate.test.ts
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
