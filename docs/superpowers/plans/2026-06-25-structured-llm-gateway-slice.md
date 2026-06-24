# Structured LLM Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first production-shaped LLM integration boundary so AIvilization agents can later request structured planning proposals without letting model output mutate world state directly.

**Architecture:** Keep all provider calls, schema parsing, retries, timeouts, usage accounting, and scripted mock providers inside `packages/llm`. Domain and worker packages will later consume typed proposal results from this package rather than calling model providers directly.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, existing `@aivilization/llm` package.

---

### Task 1: Structured Gateway Contract

**Files:**

- Create: `packages/llm/src/structuredGateway.test.ts`
- Create: `packages/llm/src/structuredGateway.ts`
- Modify: `packages/llm/src/index.ts`

- [x] **Step 1: Write failing structured gateway tests**

Add tests for:

- successful JSON parsing through a schema parser;
- provider request pass-through for messages, model, request id, and tool contracts;
- usage aggregation and estimated cost in micro-currency units;
- retry after malformed or schema-invalid JSON;
- final failed result when all attempts remain invalid;
- timeout failure that aborts the provider signal.

- [x] **Step 2: Run gateway tests and verify RED**

Run:

```bash
pnpm --filter @aivilization/llm test -- structuredGateway.test.ts
```

Expected: FAIL because the structured gateway module does not exist.

- [x] **Step 3: Implement the structured gateway**

Add:

- `LlmChatMessage`
- `LlmToolContract`
- `LlmProviderCompletionRequest`
- `LlmProviderCompletionResponse`
- `LlmStructuredOutputSchema<T>`
- `runStructuredLlmRequest<T>()`
- result and trace types for succeeded/failed attempts

Rules:

- default `maxAttempts` is `1`;
- retry provider errors, invalid JSON, schema-invalid output, content-filtered output, and timeouts until attempts are exhausted;
- parse only JSON output before schema validation;
- return failed result objects instead of throwing for model/provider failures;
- clone request arrays before passing to providers;
- aggregate token usage from completed provider responses;
- calculate `estimatedCostMicros` from optional pricing input.

- [x] **Step 4: Export and verify GREEN**

Run:

```bash
pnpm --filter @aivilization/llm test -- structuredGateway.test.ts
pnpm --filter @aivilization/llm typecheck
```

Expected: PASS.

### Task 2: Scripted Provider For Deterministic Development

**Files:**

- Create: `packages/llm/src/scriptedProvider.test.ts`
- Create: `packages/llm/src/scriptedProvider.ts`
- Modify: `packages/llm/src/index.ts`

- [x] **Step 1: Write failing scripted provider tests**

Add tests proving:

- scripted responses are returned in order;
- scripted errors are thrown in order;
- every request is recorded as an immutable copy;
- provider throws a clear error when the script is exhausted.

- [x] **Step 2: Run provider tests and verify RED**

Run:

```bash
pnpm --filter @aivilization/llm test -- scriptedProvider.test.ts
```

Expected: FAIL because the scripted provider module does not exist.

- [x] **Step 3: Implement scripted provider**

Add `createScriptedLlmProvider(input)` that returns:

- `provider`: a `LlmStructuredProvider`;
- `getRequests()`: immutable request snapshots;
- `remainingResponseCount()`: unconsumed script count.

The provider should support scripted `LlmProviderCompletionResponse`, `Error`, or request callback entries.

- [x] **Step 4: Verify GREEN**

Run:

```bash
pnpm --filter @aivilization/llm test -- scriptedProvider.test.ts
pnpm --filter @aivilization/llm typecheck
```

Expected: PASS.

### Task 3: Verification And Commit

**Files:**

- Modify all files above.

- [x] **Step 1: Format touched files**

Run:

```bash
pnpm exec prettier --write docs/superpowers/plans/2026-06-25-structured-llm-gateway-slice.md packages/llm/src/structuredGateway.ts packages/llm/src/structuredGateway.test.ts packages/llm/src/scriptedProvider.ts packages/llm/src/scriptedProvider.test.ts packages/llm/src/index.ts
```

- [x] **Step 2: Run focused and full verification**

Run:

```bash
pnpm --filter @aivilization/llm test -- structuredGateway.test.ts scriptedProvider.test.ts
pnpm --filter @aivilization/llm typecheck
pnpm lint
pnpm typecheck
pnpm test
git diff --check
```

Expected: all commands exit 0.

- [x] **Step 3: Commit**

Run:

```bash
git add docs/superpowers/plans/2026-06-25-structured-llm-gateway-slice.md packages/llm/src/structuredGateway.ts packages/llm/src/structuredGateway.test.ts packages/llm/src/scriptedProvider.ts packages/llm/src/scriptedProvider.test.ts packages/llm/src/index.ts
git commit -m "feat: add structured llm gateway"
```
