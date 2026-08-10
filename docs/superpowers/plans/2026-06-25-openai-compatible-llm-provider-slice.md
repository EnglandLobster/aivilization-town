# OpenAI Compatible LLM Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a configurable OpenAI-compatible structured provider so future runtime profiles can choose scripted, deterministic, local, or live model backends without leaking provider details into worker or domain code.

**Architecture:** Keep HTTP request construction, response parsing, authentication headers, response-format selection, and provider config validation inside `@aivilization/llm`. The existing `runStructuredLlmRequest` remains the only gateway used by agent-runtime; it receives an `LlmStructuredProvider` built by this package. Workers and domain packages still do not know about API keys, base URLs, Chat Completions payloads, or provider-specific response fields.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, built-in `fetch`, `@aivilization/llm`.

---

### Task 1: OpenAI-Compatible HTTP Provider

**Files:**

- Create: `packages/llm/src/openAiCompatibleProvider.test.ts`
- Create: `packages/llm/src/openAiCompatibleProvider.ts`
- Modify: `packages/llm/src/index.ts`

- [x] **Step 1: Write failing OpenAI-compatible provider tests**

Add tests proving:

- the provider sends `POST <endpoint>` with `Authorization`, `Content-Type`, configured extra headers, model, messages, request signal, and `response_format: { type: "json_schema", json_schema: ... }`;
- the JSON schema is derived from the first tool contract's `inputSchema` and the request `schemaName`;
- chat completion `choices[0].message.content`, `finish_reason`, `model`, and `usage.prompt_tokens/completion_tokens` map into `LlmProviderCompletionResponse`;
- `finish_reason: "content_filter"` maps to `content-filtered`;
- non-2xx HTTP responses throw a clear provider error that includes status and response body.

- [x] **Step 2: Run provider tests and verify RED**

Run:

```bash
pnpm --filter @aivilization/llm test -- openAiCompatibleProvider.test.ts
```

Expected before implementation: FAIL because `./openAiCompatibleProvider` does not exist.

- [x] **Step 3: Implement OpenAI-compatible provider**

Add:

- `OpenAiCompatibleFetch`
- `OpenAiCompatibleResponseFormatMode`
- `OpenAiCompatibleProviderConfig`
- `createOpenAiCompatibleProvider(config)`

Rules:

- default endpoint is provided explicitly by config, not hardcoded into worker code;
- default response format mode is `json-schema`;
- `json-schema` mode requires a tool contract schema and uses `strict: true`;
- `json-object` mode sends `{ type: "json_object" }`;
- `none` mode omits `response_format`;
- do not depend on the OpenAI SDK;
- preserve request abort signal;
- do not log API keys or include them in errors.

- [x] **Step 4: Verify provider GREEN**

Run:

```bash
pnpm --filter @aivilization/llm test -- openAiCompatibleProvider.test.ts
pnpm --filter @aivilization/llm typecheck
```

Expected: PASS.

### Task 2: Provider Factory From Runtime Config

**Files:**

- Create: `packages/llm/src/providerFactory.test.ts`
- Create: `packages/llm/src/providerFactory.ts`
- Modify: `packages/llm/src/index.ts`

- [x] **Step 1: Write failing provider factory tests**

Add tests proving:

- `createLlmStructuredProviderFromConfig({ kind: "openai-compatible", ... })` returns a provider that behaves like the HTTP adapter;
- `kind: "scripted"` can wrap scripted responses for deterministic runtime profiles;
- unknown provider kinds and invalid provider ids are rejected before runtime use.

- [x] **Step 2: Run factory tests and verify RED**

Run:

```bash
pnpm --filter @aivilization/llm test -- providerFactory.test.ts
```

Expected before implementation: FAIL because `./providerFactory` does not exist.

- [x] **Step 3: Implement provider factory**

Add:

- `OpenAiCompatibleLlmProviderConfig`
- `ScriptedLlmProviderConfig`
- `LlmStructuredProviderConfig`
- `createLlmStructuredProviderFromConfig(config)`

Rules:

- factory returns `LlmStructuredProvider`;
- scripted config may be used only by tests and local deterministic profiles;
- openai-compatible config delegates to `createOpenAiCompatibleProvider`;
- keep config serializable except scripted responses, which are explicitly test/local-only.

- [x] **Step 4: Verify factory GREEN**

Run:

```bash
pnpm --filter @aivilization/llm test -- providerFactory.test.ts openAiCompatibleProvider.test.ts
pnpm --filter @aivilization/llm typecheck
```

Expected: PASS.

### Task 3: Verification And Commit

**Files:**

- Modify all files above plus this plan file.

- [x] **Step 1: Format touched files**

Run:

```bash
pnpm exec prettier --write docs/superpowers/plans/2026-06-25-openai-compatible-llm-provider-slice.md packages/llm/src/openAiCompatibleProvider.ts packages/llm/src/openAiCompatibleProvider.test.ts packages/llm/src/providerFactory.ts packages/llm/src/providerFactory.test.ts packages/llm/src/index.ts
```

- [x] **Step 2: Run focused and full verification**

Run:

```bash
pnpm --filter @aivilization/llm test -- openAiCompatibleProvider.test.ts providerFactory.test.ts
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
git add docs/superpowers/plans/2026-06-25-openai-compatible-llm-provider-slice.md packages/llm/src/openAiCompatibleProvider.ts packages/llm/src/openAiCompatibleProvider.test.ts packages/llm/src/providerFactory.ts packages/llm/src/providerFactory.test.ts packages/llm/src/index.ts
git commit -m "feat: add openai compatible llm provider"
```
