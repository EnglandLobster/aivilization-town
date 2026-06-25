# Memory Synthesis Economic Context Trace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make reflection and social-model memory synthesis traces explicitly prove economic context completeness.

**Architecture:** Keep the LLM prompts and synthesis behavior unchanged. Extend the memory package's `MemorySynthesisWorldDecisionContextTrace` with the same economic aggregate fields used by agent-runtime traces so observability does not need to infer memory-synthesis economic coverage only from legacy field combinations.

**Tech Stack:** TypeScript, Vitest, pnpm workspace, existing `@aivilization/memory` LLM reflection/social-model seams.

---

### Task 1: RED Tests For Memory Synthesis Trace Fields

**Files:**

- Modify: `packages/memory/src/worldContext.test.ts`
- Modify: `packages/memory/src/llmReflectionSynthesizer.test.ts`
- Modify: `packages/memory/src/llmSocialModelSynthesizer.test.ts`

- [ ] **Step 1: Assert trace aggregate fields in world context unit test**

Extend `createMemorySynthesisWorldDecisionContextTrace` expectations to include:

```ts
hasEconomicState: true,
hasMarketPrices: true,
completeEconomicContext: false
```

for a context that has balance/inventory and spot prices but no latest price index.

- [ ] **Step 2: Assert LLM reflection trace carries economic completeness**

In the accepted reflective insight test, expect `trace.worldDecisionContext` to include:

```ts
hasEconomicState: true,
hasMarketPrices: true,
completeEconomicContext: true
```

- [ ] **Step 3: Assert LLM social-model trace carries economic completeness**

In the accepted social-model synthesis test, expect the same three fields in `trace.worldDecisionContext`.

- [ ] **Step 4: Verify RED**

Run:

```bash
pnpm vitest run packages/memory/src/worldContext.test.ts packages/memory/src/llmReflectionSynthesizer.test.ts packages/memory/src/llmSocialModelSynthesizer.test.ts
```

Expected: FAIL because memory synthesis traces do not yet emit the economic aggregate fields.

### Task 2: Implement Memory Synthesis Economic Trace Semantics

**Files:**

- Modify: `packages/memory/src/worldContext.ts`

- [ ] **Step 1: Extend trace type**

Add `hasEconomicState`, `hasMarketPrices`, and `completeEconomicContext` to `MemorySynthesisWorldDecisionContextTrace`.

- [ ] **Step 2: Compute aggregate fields**

Compute:

```ts
const hasBalance = Number.isFinite(context.agent.balance);
const hasInventory = context.agent.inventory !== undefined;
const hasLatestPriceIndex = context.market.latestPriceIndex !== undefined;
const hasEconomicState = hasBalance && hasInventory;
const hasMarketPrices =
  context.market.spotPrices.length > 0 &&
  context.market.spotPrices.every(
    (price) => price.commodity.trim().length > 0 && Number.isFinite(price.spotPrice),
  );
const completeEconomicContext = hasEconomicState && hasMarketPrices && hasLatestPriceIndex;
```

Use the computed primitives in the returned trace to avoid divergent semantics.

- [ ] **Step 3: Verify GREEN**

Run:

```bash
pnpm vitest run packages/memory/src/worldContext.test.ts packages/memory/src/llmReflectionSynthesizer.test.ts packages/memory/src/llmSocialModelSynthesizer.test.ts
```

Expected: PASS.

### Task 3: Full Verification And Commit

**Files:**

- All touched files from Tasks 1-2

- [ ] **Step 1: Format touched files**

Run:

```bash
pnpm prettier --write packages/memory/src/worldContext.ts packages/memory/src/worldContext.test.ts packages/memory/src/llmReflectionSynthesizer.test.ts packages/memory/src/llmSocialModelSynthesizer.test.ts docs/superpowers/plans/2026-06-26-memory-synthesis-economic-context-trace.md
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

Stage only touched files and commit with a Conventional Commit message that explains why the trace semantics matter for paper alignment, what modules changed, and the exact verification commands run.
