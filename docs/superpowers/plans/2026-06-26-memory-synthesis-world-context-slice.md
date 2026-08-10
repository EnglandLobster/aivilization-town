# Memory Synthesis World Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Feed structured current-world context into reflection synthesis and social-model synthesis so memory LLMs can reason over inventory, balance, residence, education, physiology, and market prices instead of relying only on memory text.

**Architecture:** Keep `@aivilization/memory` independent from `@aivilization/agent-runtime` by defining a structural memory synthesis world-context type with the same data shape as the existing worker-built `WorldDecisionContext`. Worker memory consolidation accepts an optional per-agent context provider, and lifecycle supplies contexts from the latest loop projection.

**Tech Stack:** TypeScript, Vitest, `@aivilization/memory`, `@aivilization/worker`, existing `createWorldDecisionContextFromProjection`.

---

### Task 1: Add world context to memory LLM prompt contracts

**Files:**
- Modify: `packages/memory/src/reflection.ts`
- Modify: `packages/memory/src/socialModelSynthesis.ts`
- Modify: `packages/memory/src/llmReflectionSynthesizer.ts`
- Modify: `packages/memory/src/llmSocialModelSynthesizer.ts`
- Test: `packages/memory/src/llmReflectionSynthesizer.test.ts`
- Test: `packages/memory/src/llmSocialModelSynthesizer.test.ts`

- [ ] **Step 1: Write failing reflection prompt test**

Add `worldDecisionContext` to the accepted reflection request and assert the provider prompt contains `"worldDecisionContext"`, `"balance":191696904`, `"educationScore":31`, `"residentialTier":5`, `"Fish":46`, and `"spotPrice":304.5`.

- [ ] **Step 2: Write failing social-model prompt test**

Add `worldDecisionContext` to the accepted social-model request and assert the provider prompt contains the same current-world fields.

- [ ] **Step 3: Run memory LLM tests to verify RED**

Run: `pnpm vitest run packages/memory/src/llmReflectionSynthesizer.test.ts packages/memory/src/llmSocialModelSynthesizer.test.ts`

Expected: TypeScript/test failure because the synthesizer inputs do not accept or serialize `worldDecisionContext`.

- [ ] **Step 4: Implement memory context type and prompt serialization**

Define a structural `MemorySynthesisWorldDecisionContext` in memory-layer types and add optional `worldDecisionContext` to `ReflectiveInsightSynthesizerInput` and `SocialModelSynthesizerInput`. Include it in both LLM prompt JSON payloads only when present.

- [ ] **Step 5: Verify GREEN for memory LLM tests**

Run: `pnpm vitest run packages/memory/src/llmReflectionSynthesizer.test.ts packages/memory/src/llmSocialModelSynthesizer.test.ts`

Expected: both tests pass.

### Task 2: Thread world context through worker memory consolidation

**Files:**
- Modify: `apps/worker/src/memoryConsolidation.ts`
- Test: `apps/worker/src/memoryConsolidation.test.ts`

- [ ] **Step 1: Write failing worker consolidation test**

Use custom reflective and social synthesizers that capture their inputs. Call `runWorkerMemoryConsolidationSchedule` with a per-agent world-context provider and assert both captured inputs receive the matching context.

- [ ] **Step 2: Run worker memory test to verify RED**

Run: `pnpm vitest run apps/worker/src/memoryConsolidation.test.ts`

Expected: failure because schedule input does not yet pass world context to synthesizers.

- [ ] **Step 3: Implement optional context provider**

Add optional `worldDecisionContext` to single consolidation input and optional `worldDecisionContextProvider(agentId)` to batch/schedule inputs. Pass the resolved context into both synthesizers.

- [ ] **Step 4: Verify GREEN for worker memory test**

Run: `pnpm vitest run apps/worker/src/memoryConsolidation.test.ts`

Expected: all worker memory consolidation tests pass.

### Task 3: Supply latest lifecycle projection context

**Files:**
- Modify: `apps/worker/src/localSimulationLifecycle.ts`
- Test: `apps/worker/src/localSimulationLifecycle.test.ts`

- [ ] **Step 1: Write failing lifecycle test**

In an existing lifecycle memory-schedule test, capture the reflective synthesizer input and assert it receives `worldDecisionContext.agent.agentId`, `balance`, `inventory`, and market `spotPrices` from the latest completed loop projection.

- [ ] **Step 2: Run lifecycle test to verify RED**

Run: `pnpm vitest run apps/worker/src/localSimulationLifecycle.test.ts`

Expected: failure because lifecycle does not pass projection-derived world context into memory consolidation.

- [ ] **Step 3: Implement lifecycle context provider**

Pass `loop.projection` into `runLifecycleMemoryConsolidation`, and use `createWorldDecisionContextFromProjection` to build contexts for known agents. Return `undefined` for unknown configured agent IDs rather than failing the whole memory consolidation pass.

- [ ] **Step 4: Verify GREEN for lifecycle test**

Run: `pnpm vitest run apps/worker/src/localSimulationLifecycle.test.ts`

Expected: all lifecycle tests pass.

### Task 4: Final verification and commit

**Files:**
- Verify all modified files.

- [ ] **Step 1: Run targeted tests**

Run:
`pnpm vitest run packages/memory/src/llmReflectionSynthesizer.test.ts packages/memory/src/llmSocialModelSynthesizer.test.ts apps/worker/src/memoryConsolidation.test.ts apps/worker/src/localSimulationLifecycle.test.ts`

- [ ] **Step 2: Run project checks**

Run:
`pnpm lint`
`pnpm typecheck`
`pnpm test`
`git diff --check`

- [ ] **Step 3: Commit**

Commit only this slice and leave existing untracked paper/report directories untouched.
