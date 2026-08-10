# LLM Social Model Synthesis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a bounded LLM seam for AIvilization paper Section 2.2.1 post-interaction social model updates while preserving deterministic fallback behavior.

**Architecture:** Keep generic habit/caution consolidation in `consolidation.ts`. Add a focused `SocialModelSynthesizer` boundary that owns social profile patches and social reflection artifacts, with deterministic and LLM implementations. Worker memory consolidation receives an optional synthesizer and replaces only the social update path, so social reasoning can become LLM-backed without coupling the worker to provider details.

**Tech Stack:** TypeScript, Vitest, `@aivilization/llm` structured gateway, existing `@aivilization/memory` profile and short-term memory models, worker memory consolidation pipeline.

---

### Task 1: Memory Package Social Model Contract

**Files:**

- Create: `packages/memory/src/socialModelSynthesis.test.ts`
- Create: `packages/memory/src/socialModelSynthesis.ts`
- Modify: `packages/memory/src/index.ts`

- [ ] **Step 1: Write the failing test**

Add `socialModelSynthesis.test.ts` with a test that calls `createDeterministicSocialModelSynthesizer()` and expects one `socialRecords` patch plus one reflection artifact for a successful `social-interaction` memory.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aivilization/memory test -- socialModelSynthesis.test.ts`
Expected: FAIL because `createDeterministicSocialModelSynthesizer` is not exported.

- [ ] **Step 3: Write minimal implementation**

Create `socialModelSynthesis.ts` with:

- `SocialModelSynthesizerInput`
- `SocialModelSynthesisTrace`
- `SocialModelSynthesisResult`
- `SocialModelSynthesizer`
- `createDeterministicSocialModelSynthesizer`

The deterministic implementation delegates to `proposeSocialLongTermMemoryPatches` and `proposeSocialInteractionReflections`.

- [ ] **Step 4: Export the contract**

Add `export * from './socialModelSynthesis';` to `packages/memory/src/index.ts`.

- [ ] **Step 5: Run memory tests**

Run: `pnpm --filter @aivilization/memory test -- socialModelSynthesis.test.ts`
Expected: PASS.

### Task 2: Split Social Patches From Generic Consolidation

**Files:**

- Modify: `packages/memory/src/consolidation.ts`
- Modify: `packages/memory/src/consolidation.test.ts`

- [ ] **Step 1: Write the failing test**

Add a test for `proposeNonSocialLongTermMemoryPatches()` proving it emits habit/caution patches but excludes `socialRecords`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aivilization/memory test -- consolidation.test.ts`
Expected: FAIL because `proposeNonSocialLongTermMemoryPatches` is not exported.

- [ ] **Step 3: Implement split helpers**

Refactor `consolidation.ts` to export:

- `proposeNonSocialLongTermMemoryPatches`
- `proposeSocialLongTermMemoryPatches`

Keep `proposeLongTermMemoryPatches` behavior stable by composing both helpers and sorting the combined result.

- [ ] **Step 4: Run consolidation tests**

Run: `pnpm --filter @aivilization/memory test -- consolidation.test.ts socialModelSynthesis.test.ts`
Expected: PASS.

### Task 3: LLM Social Model Synthesizer

**Files:**

- Create: `packages/memory/src/llmSocialModelSynthesizer.test.ts`
- Create: `packages/memory/src/llmSocialModelSynthesizer.ts`
- Modify: `packages/memory/src/index.ts`

- [ ] **Step 1: Write the failing accepted-path test**

Use `createScriptedLlmProvider` to return a grounded proposal with one social record and one reflection. Assert that the request includes `records`, `longTermProfile`, and deterministic fallback proposals.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aivilization/memory test -- llmSocialModelSynthesizer.test.ts`
Expected: FAIL because `proposeSocialModelWithLlm` is not exported.

- [ ] **Step 3: Implement accepted path and validation**

Create a structured schema named `aivilization_social_model_synthesis`. Validate:

- every target agent id appears in social memory hints;
- every evidence id appears in the same-agent social memory window;
- patches target `section: 'socialRecords'`;
- confidence is finite and in `[0, 1]`.

- [ ] **Step 4: Write fallback tests**

Add tests for provider failure and invalid evidence. Both must return deterministic social model output with fallback trace.

- [ ] **Step 5: Run LLM social model tests**

Run: `pnpm --filter @aivilization/memory test -- llmSocialModelSynthesizer.test.ts socialModelSynthesis.test.ts`
Expected: PASS.

### Task 4: Worker Memory Consolidation Injection

**Files:**

- Modify: `apps/worker/src/memoryConsolidation.test.ts`
- Modify: `apps/worker/src/memoryConsolidation.ts`

- [ ] **Step 1: Write the failing worker test**

Add a test that injects `socialModelSynthesizer` into `runWorkerMemoryConsolidation`, returns a custom `socialRecords` patch and reflection, and asserts the worker uses it instead of deterministic social aggregation.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aivilization/worker test -- memoryConsolidation.test.ts`
Expected: FAIL because `socialModelSynthesizer` is not accepted by worker consolidation input.

- [ ] **Step 3: Wire the synthesizer through worker consolidation**

Add optional `socialModelSynthesizer` to single, batch, and scheduled consolidation inputs. In `applyWorkerMemoryConsolidation`, use `proposeNonSocialLongTermMemoryPatches` for generic patches and `socialModelSynthesizer ?? createDeterministicSocialModelSynthesizer()` for social patches/reflections.

- [ ] **Step 4: Run worker memory tests**

Run: `pnpm --filter @aivilization/worker test -- memoryConsolidation.test.ts`
Expected: PASS.

### Task 5: Verification And Commit

**Files:**

- Review all modified files.

- [ ] **Step 1: Run focused tests**

Run:

- `pnpm --filter @aivilization/memory test -- consolidation.test.ts socialModelSynthesis.test.ts llmSocialModelSynthesizer.test.ts`
- `pnpm --filter @aivilization/worker test -- memoryConsolidation.test.ts`

Expected: PASS.

- [ ] **Step 2: Run full project checks**

Run:

- `pnpm check`
- `pnpm exec prettier --check .`
- `git diff --check`

Expected: PASS.

- [ ] **Step 3: Stage only this slice**

Run:
`git add docs/superpowers/plans/2026-06-25-llm-social-model-synthesis-slice.md packages/memory/src/consolidation.ts packages/memory/src/consolidation.test.ts packages/memory/src/socialModelSynthesis.ts packages/memory/src/socialModelSynthesis.test.ts packages/memory/src/llmSocialModelSynthesizer.ts packages/memory/src/llmSocialModelSynthesizer.test.ts packages/memory/src/index.ts apps/worker/src/memoryConsolidation.ts apps/worker/src/memoryConsolidation.test.ts`

- [ ] **Step 4: Commit**

Run:
`git commit -m "feat(memory): 增加社交模型 LLM 合成链路"`

Commit body must describe paper alignment, module boundaries, fallback semantics, user-visible behavior, and verification commands.

---

## Self-Review

- Spec coverage: covers paper Section 2.2.1 post-interaction relation/attitude update, LTM social records, reflection artifacts, worker integration, and fallback safety.
- Placeholder scan: no placeholders remain.
- Type consistency: `SocialModelSynthesizer` owns social patches/reflections; existing `ReflectiveInsightSynthesizer` remains responsible for values/personality/mood insight proposals.
