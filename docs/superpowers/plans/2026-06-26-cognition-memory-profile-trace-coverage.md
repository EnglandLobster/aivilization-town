# Cognition Memory Profile Trace Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make configured cognition LLM stages prove that the STM and long-term profile context they receive in prompts is present in provider traces and profile gates.

**Architecture:** Keep prompt payloads and LLM decision semantics unchanged. Extend trace contracts for reaction evaluation, reflective insight synthesis, and social model synthesis with compact cognitive-context counters, then make runtime profile gates require those counters for all configured cognition LLM stages.

**Tech Stack:** TypeScript, Vitest, pnpm workspace, existing `@aivilization/agent-runtime`, `@aivilization/memory`, and `@aivilization/server` profile-gate modules.

---

### Task 1: RED Tests For Cognition Trace Context

**Files:**

- Modify: `packages/agent-runtime/src/llmReactionEvaluator.test.ts`
- Modify: `packages/memory/src/llmReflectionSynthesizer.test.ts`
- Modify: `packages/memory/src/llmSocialModelSynthesizer.test.ts`
- Modify: `apps/server/src/localRuntimeTownProfileGate.test.ts`

- [ ] **Step 1: Assert reaction traces expose STM and profile counters**

In `creates a traceable LLM reaction evaluator that preserves accepted attempts and usage`, pass `longTermProfile: createProfile(agentId)` and `memoryContext: [createConversationMemory()]` into the evaluator call, then expect:

```ts
shortTermMemoryContext: { recordCount: 1 },
longTermProfileContext: { entryCount: 1 },
```

inside `reactionTrace`.

- [ ] **Step 2: Assert reflection synthesis traces expose STM and profile counters**

In the accepted reflective insight test, expect:

```ts
shortTermMemoryContext: { recordCount: 3 },
longTermProfileContext: { entryCount: 1 },
```

inside `trace`.

- [ ] **Step 3: Assert social-model synthesis traces expose STM and profile counters**

In the accepted social model synthesis test, expect:

```ts
shortTermMemoryContext: { recordCount: 3 },
longTermProfileContext: { entryCount: 1 },
```

inside `trace`.

- [ ] **Step 4: Assert profile gates require cognition memory/profile coverage for all configured cognition LLM stages**

Update `requiredCognitionLlmMemoryContextStages` and `requiredCognitionLlmProfileContextStages` expectations to:

```ts
[
  'strategicPlanning',
  'dailyPlanning',
  'reactionEvaluation',
  'reflectionSynthesis',
  'socialModelSynthesis',
];
```

- [ ] **Step 5: Verify RED**

Run:

```bash
pnpm vitest run packages/agent-runtime/src/llmReactionEvaluator.test.ts packages/memory/src/llmReflectionSynthesizer.test.ts packages/memory/src/llmSocialModelSynthesizer.test.ts apps/server/src/localRuntimeTownProfileGate.test.ts
```

Expected: FAIL because these traces and gate derivations do not yet emit/require the new cognitive-context counters.

### Task 2: Implement Trace Context Counters

**Files:**

- Modify: `packages/agent-runtime/src/reactionEvaluation.ts`
- Modify: `packages/agent-runtime/src/llmReactionEvaluator.ts`
- Create: `packages/memory/src/cognitiveContextTrace.ts`
- Modify: `packages/memory/src/reflection.ts`
- Modify: `packages/memory/src/socialModelSynthesis.ts`
- Modify: `packages/memory/src/llmReflectionSynthesizer.ts`
- Modify: `packages/memory/src/llmSocialModelSynthesizer.ts`
- Modify: `packages/memory/src/index.ts`

- [ ] **Step 1: Extend reaction trace type**

Add compact context trace fields to `ReactionEvaluationTrace`:

```ts
readonly shortTermMemoryContext?: LlmShortTermMemoryContextTrace;
readonly longTermProfileContext?: LlmLongTermProfileContextTrace;
```

using the existing agent-runtime `llmContextTrace` types.

- [ ] **Step 2: Map reaction evaluator context into trace**

In `mapLlmReactionTrace`, pass `memoryContext` and `longTermProfile` from the evaluator input and spread `createLlmCognitiveContextTrace(...)` into the accepted/fallback trace.

- [ ] **Step 3: Add memory-package cognitive trace helper**

Create `packages/memory/src/cognitiveContextTrace.ts` with:

```ts
export type MemorySynthesisShortTermMemoryContextTrace = {
  readonly recordCount: number;
};

export type MemorySynthesisLongTermProfileContextTrace = {
  readonly entryCount: number;
};

export function createMemorySynthesisCognitiveContextTrace(input: {
  readonly records?: readonly ShortTermMemoryRecord[];
  readonly longTermProfile?: LongTermAgentProfile;
}): {
  readonly shortTermMemoryContext?: MemorySynthesisShortTermMemoryContextTrace;
  readonly longTermProfileContext?: MemorySynthesisLongTermProfileContextTrace;
};
```

Count all records supplied to the synthesis window and all profile entries across beliefs, habits, mood, values, personality, and socialRecords.

- [ ] **Step 4: Extend reflection and social-model trace types**

Add `shortTermMemoryContext` and `longTermProfileContext` fields to `ReflectiveInsightSynthesisTrace` and `SocialModelSynthesisTrace`.

- [ ] **Step 5: Map memory synthesis context into accepted/fallback traces**

In both memory LLM synthesizers, spread `createMemorySynthesisCognitiveContextTrace({ records: input.records, longTermProfile: input.longTermProfile })` into accepted and fallback traces.

- [ ] **Step 6: Export the helper**

Export `cognitiveContextTrace` from `packages/memory/src/index.ts`.

- [ ] **Step 7: Verify GREEN**

Run:

```bash
pnpm vitest run packages/agent-runtime/src/llmReactionEvaluator.test.ts packages/memory/src/llmReflectionSynthesizer.test.ts packages/memory/src/llmSocialModelSynthesizer.test.ts apps/server/src/localRuntimeTownProfileGate.test.ts
```

Expected: PASS except profile-gate expectations until Task 3 is implemented.

### Task 3: Require Context Coverage In Profile Gates

**Files:**

- Modify: `apps/server/src/localRuntimeTownProfileGate.ts`

- [ ] **Step 1: Update memory context stage derivation**

Change `deriveRequiredCognitionLlmMemoryContextStagesFromRuntimeConfig` to return every configured cognition LLM stage, matching `deriveRequiredCognitionLlmAcceptedStagesFromRuntimeConfig(runtimeConfig)`.

- [ ] **Step 2: Update profile context stage derivation**

Change `deriveRequiredCognitionLlmProfileContextStagesFromRuntimeConfig` to return every configured cognition LLM stage, matching `deriveRequiredCognitionLlmAcceptedStagesFromRuntimeConfig(runtimeConfig)`.

- [ ] **Step 3: Verify focused tests**

Run:

```bash
pnpm vitest run packages/agent-runtime/src/llmReactionEvaluator.test.ts packages/memory/src/llmReflectionSynthesizer.test.ts packages/memory/src/llmSocialModelSynthesizer.test.ts apps/server/src/localRuntimeTownProfileGate.test.ts
```

Expected: PASS.

### Task 4: Full Verification And Commit

**Files:**

- All touched files from Tasks 1-3

- [ ] **Step 1: Format touched files**

Run:

```bash
pnpm prettier --write packages/agent-runtime/src/reactionEvaluation.ts packages/agent-runtime/src/llmReactionEvaluator.ts packages/agent-runtime/src/llmReactionEvaluator.test.ts packages/memory/src/cognitiveContextTrace.ts packages/memory/src/reflection.ts packages/memory/src/socialModelSynthesis.ts packages/memory/src/llmReflectionSynthesizer.ts packages/memory/src/llmReflectionSynthesizer.test.ts packages/memory/src/llmSocialModelSynthesizer.ts packages/memory/src/llmSocialModelSynthesizer.test.ts packages/memory/src/index.ts apps/server/src/localRuntimeTownProfileGate.ts apps/server/src/localRuntimeTownProfileGate.test.ts docs/superpowers/plans/2026-06-26-cognition-memory-profile-trace-coverage.md
```

- [ ] **Step 2: Run full verification**

Run:

```bash
pnpm typecheck
pnpm lint
pnpm test -- --reporter=dot
git diff --check
```

Expected: all exit 0.

- [ ] **Step 3: Commit**

Stage only touched files and commit with a Conventional Commit message explaining the paper-alignment reason, touched modules, trace/gate semantics, user-visible diagnostics, and exact verification commands.
