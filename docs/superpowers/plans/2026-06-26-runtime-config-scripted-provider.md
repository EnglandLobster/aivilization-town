# Runtime Config Scripted Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow local runtime profile config files to use the existing scripted LLM provider so full LLM profile runs can be exercised deterministically without live network calls.

**Architecture:** Keep provider construction in `@aivilization/llm` and stage construction in `localRuntimeTownProfileLlmPlanning.ts`. Replace the server runtime-config parser's openai-only provider parser with a structured-provider parser that accepts `openai-compatible` for production and `scripted` for deterministic CI/profile dry runs.

**Tech Stack:** TypeScript, Vitest, `@aivilization/server`, `@aivilization/llm`.

---

### Task 1: Runtime Config Scripted Provider Parsing

**Files:**

- Modify: `apps/server/src/localRuntimeTownProfileRuntimeConfig.test.ts`
- Modify: `apps/server/src/localRuntimeTownProfileRuntimeConfig.ts`
- Modify: `docs/superpowers/plans/2026-06-26-runtime-config-scripted-provider.md`

- [x] **Step 1: Write failing scripted-provider config tests**

Add runtime config tests proving:

- `loadLocalRuntimeTownProfileRuntimeConfig` accepts `scripted` providers with static JSON completion responses;
- `llmPlanning` and representative agent-cycle/cognition stages preserve `provider.kind`, `providerId`, and `responses`;
- malformed scripted providers without a non-empty `responses` array fail with a targeted error.

- [x] **Step 2: Verify RED**

Run:

```bash
pnpm vitest apps/server/src/localRuntimeTownProfileRuntimeConfig.test.ts --run
```

Expected: FAIL because runtime config provider parsing currently requires `openai-compatible`.

Observed: FAIL with `llmPlanning.provider.kind must be openai-compatible`, proving config parsing rejected the already-supported `scripted` provider kind.

- [x] **Step 3: Implement structured provider parsing**

Replace `parseOpenAiCompatibleProviderConfig(...)` with a helper that switches on `provider.kind`:

- `openai-compatible`: keep existing env-secret and response-format parsing;
- `scripted`: require `providerId` and a non-empty `responses` array of static completion response objects with `providerId`, `model`, `content`, and `finishReason`.

Do not add function/error scripted responses to JSON config; those remain programmatic test-only capabilities of `createScriptedLlmProvider`.

- [x] **Step 4: Verify GREEN**

Run:

```bash
pnpm vitest apps/server/src/localRuntimeTownProfileRuntimeConfig.test.ts --run
```

Expected: PASS.

Observed: PASS, `14` runtime-config parser tests passed.

### Task 2: Verification And Commit

**Files:**

- All touched files from Task 1.

- [x] **Step 1: Format touched files**

Run:

```bash
pnpm exec prettier --write apps/server/src/localRuntimeTownProfileRuntimeConfig.ts apps/server/src/localRuntimeTownProfileRuntimeConfig.test.ts docs/superpowers/plans/2026-06-26-runtime-config-scripted-provider.md
```

- [x] **Step 2: Run verification**

Run:

```bash
pnpm typecheck
pnpm lint
pnpm vitest apps/server/src/localRuntimeTownProfileRuntimeConfig.test.ts apps/server/src/localRuntimeTownProfileLlmPlanning.test.ts --run
git diff --check
```

Observed:

- `pnpm typecheck` PASS;
- `pnpm lint` PASS;
- `pnpm vitest apps/server/src/localRuntimeTownProfileRuntimeConfig.test.ts apps/server/src/localRuntimeTownProfileLlmPlanning.test.ts --run` PASS, `23` tests passed;
- `git diff --check` PASS.

- [ ] **Step 3: Commit**

Stage only this slice and commit with a detailed Conventional Commit message.
