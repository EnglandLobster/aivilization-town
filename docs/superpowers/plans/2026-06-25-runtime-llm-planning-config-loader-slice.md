# Runtime LLM Planning Config Loader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let headless runtime profile runs load traceable LLM strategic-planning provider configuration from a JSON file with environment-backed secrets.

**Architecture:** Keep provider construction inside `@aivilization/llm` and compiler construction inside `localRuntimeTownProfileLlmPlanning`. Add a server-owned runtime config loader that converts unknown JSON plus env references into a validated `llmPlanning` config. The CLI remains a thin adapter: parse `--llm-planning-config`, load the file, and pass the resolved config to the profile runner.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, Node `fs/promises`, existing profile runner CLI and LLM provider config types.

---

## File Structure

- Create `apps/server/src/localRuntimeTownProfileRuntimeConfig.ts`: parse runtime profile config documents, select profile-specific LLM planning config, resolve `{ "env": "VAR" }` secret references, and return `LocalRuntimeTownProfileStrategicCompilerConfig`.
- Create `apps/server/src/localRuntimeTownProfileRuntimeConfig.test.ts`: prove parsing, profile override, secret resolution, and validation behavior.
- Modify `apps/server/src/localRuntimeTownProfileRunnerCli.ts`: parse `--llm-planning-config`, load resolved config with `process.env`, and include `llmPlanning` in `LocalRuntimeTownProfileRunnerInput`.
- Modify `apps/server/src/localRuntimeTownProfileRunnerCli.test.ts`: prove the CLI passes resolved LLM planning config into an injected runner.
- Modify `apps/server/src/index.ts`: export the runtime config loader for future daemon/suite entrypoints.

## Runtime Config Shape

```json
{
  "llmPlanning": {
    "kind": "traceable-llm-strategic-planner",
    "model": "planner-model",
    "provider": {
      "kind": "openai-compatible",
      "providerId": "planner-provider",
      "endpoint": "https://llm.example.test/v1/chat/completions",
      "apiKey": { "env": "AIVILIZATION_LLM_API_KEY" },
      "defaultHeaders": {
        "X-Org": { "env": "AIVILIZATION_LLM_ORG" }
      },
      "responseFormat": "json-schema"
    },
    "maxAttempts": 2,
    "timeoutMs": 30000,
    "pricing": {
      "inputTokenCostMicros": 2,
      "outputTokenCostMicros": 8
    }
  },
  "profiles": {
    "smoke-25": {
      "llmPlanning": null
    },
    "default-100": {
      "llmPlanning": {
        "kind": "traceable-llm-strategic-planner",
        "model": "default-planner",
        "provider": {
          "kind": "openai-compatible",
          "providerId": "default-provider",
          "endpoint": "https://llm.example.test/v1/chat/completions",
          "apiKey": { "env": "AIVILIZATION_DEFAULT_LLM_API_KEY" }
        }
      }
    }
  }
}
```

Profile-specific `profiles[profileId].llmPlanning` overrides the top-level default. `null` disables LLM planning for that profile. Only OpenAI-compatible live provider config is accepted by this runtime loader; scripted providers remain available for unit tests through the lower-level provider factory.

### Task 1: Runtime Config Loader

**Files:**

- Create: `apps/server/src/localRuntimeTownProfileRuntimeConfig.ts`
- Test: `apps/server/src/localRuntimeTownProfileRuntimeConfig.test.ts`
- Modify: `apps/server/src/index.ts`

- [x] **Step 1: Write failing config loader tests**

```ts
test('loads profile-specific OpenAI-compatible LLM planning config and resolves env secrets', async () => {
  const config = await loadLocalRuntimeTownProfileLlmPlanningConfig({
    profileId: 'default-100',
    path: '/runtime/config.json',
    env: {
      DEFAULT_KEY: 'secret-key',
      ORG_ID: 'org-1',
    },
    readTextFile: async () =>
      JSON.stringify({
        llmPlanning: null,
        profiles: {
          'default-100': {
            llmPlanning: {
              kind: 'traceable-llm-strategic-planner',
              model: 'default-planner',
              provider: {
                kind: 'openai-compatible',
                providerId: 'default-provider',
                endpoint: 'https://llm.example.test/v1/chat/completions',
                apiKey: { env: 'DEFAULT_KEY' },
                defaultHeaders: {
                  'X-Org': { env: 'ORG_ID' },
                },
                responseFormat: 'json-object',
              },
              maxAttempts: 2,
              timeoutMs: 30000,
              pricing: {
                inputTokenCostMicros: 2,
                outputTokenCostMicros: 8,
              },
            },
          },
        },
      }),
  });

  expect(config).toEqual({
    kind: 'traceable-llm-strategic-planner',
    profileId: 'default-100',
    model: 'default-planner',
    provider: {
      kind: 'openai-compatible',
      providerId: 'default-provider',
      endpoint: 'https://llm.example.test/v1/chat/completions',
      apiKey: 'secret-key',
      defaultHeaders: {
        'X-Org': 'org-1',
      },
      responseFormat: 'json-object',
    },
    maxAttempts: 2,
    timeoutMs: 30000,
    pricing: {
      inputTokenCostMicros: 2,
      outputTokenCostMicros: 8,
    },
  });
});
```

- [x] **Step 2: Run config loader tests to verify RED**

Run: `pnpm --filter @aivilization/server test -- localRuntimeTownProfileRuntimeConfig.test.ts`

Expected before implementation: FAIL because `localRuntimeTownProfileRuntimeConfig` does not exist.

- [x] **Step 3: Implement the loader**

Create:

```ts
export async function loadLocalRuntimeTownProfileLlmPlanningConfig(input: {
  readonly profileId: LocalRuntimeTownDaemonScenarioProfileId;
  readonly path: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly readTextFile?: (path: string) => Promise<string>;
}): Promise<LocalRuntimeTownProfileStrategicCompilerConfig>;
```

The implementation must parse JSON, require an object document, select `profiles[profileId].llmPlanning` over the top-level `llmPlanning`, resolve string or `{ env }` values, validate positive integer `maxAttempts`, non-negative finite `timeoutMs`, finite non-negative pricing values, and reject unsupported provider kinds.

- [x] **Step 4: Run config loader tests to verify GREEN**

Run: `pnpm --filter @aivilization/server test -- localRuntimeTownProfileRuntimeConfig.test.ts`

Expected after implementation: PASS.

### Task 2: CLI Wiring

**Files:**

- Modify: `apps/server/src/localRuntimeTownProfileRunnerCli.ts`
- Modify: `apps/server/src/localRuntimeTownProfileRunnerCli.test.ts`

- [x] **Step 1: Write failing CLI tests**

Add expectations that:

```ts
parseLocalRuntimeTownProfileRunnerCliArgs([
  '--profile',
  'default-100',
  '--root-dir',
  '/tmp/town',
  '--llm-planning-config',
  '/runtime/config.json',
]).llmPlanningConfigPath === '/runtime/config.json';
```

and that an injected `runProfile` receives:

```ts
expect(receivedInput?.llmPlanning).toEqual({
  kind: 'traceable-llm-strategic-planner',
  profileId: 'default-100',
  model: 'default-planner',
  provider: {
    kind: 'openai-compatible',
    providerId: 'default-provider',
    endpoint: 'https://llm.example.test/v1/chat/completions',
    apiKey: 'secret-key',
  },
});
```

- [x] **Step 2: Run CLI tests to verify RED**

Run: `pnpm --filter @aivilization/server test -- localRuntimeTownProfileRunnerCli.test.ts`

Expected before implementation: FAIL because the parser rejects `--llm-planning-config`.

- [x] **Step 3: Implement CLI wiring**

Extend `LocalRuntimeTownProfileRunnerCliConfig` with `llmPlanningConfigPath?: string`, parse the optional flag, and change `createRunnerInput` into an async function that loads the config:

```ts
const llmPlanning =
  config.llmPlanningConfigPath === undefined
    ? undefined
    : await loadLocalRuntimeTownProfileLlmPlanningConfig({
        profileId: config.profileId,
        path: config.llmPlanningConfigPath,
        env: process.env,
      });
```

Include `llmPlanning` only when the loader returns a config.

- [x] **Step 4: Run CLI tests to verify GREEN**

Run: `pnpm --filter @aivilization/server test -- localRuntimeTownProfileRunnerCli.test.ts`

Expected after implementation: PASS.

### Task 3: Verification and Commit

**Files:**

- All files above.

- [x] **Step 1: Format changed files**

Run:

```bash
pnpm exec prettier --write docs/superpowers/plans/2026-06-25-runtime-llm-planning-config-loader-slice.md apps/server/src/localRuntimeTownProfileRuntimeConfig.ts apps/server/src/localRuntimeTownProfileRuntimeConfig.test.ts apps/server/src/localRuntimeTownProfileRunnerCli.ts apps/server/src/localRuntimeTownProfileRunnerCli.test.ts apps/server/src/index.ts
```

- [x] **Step 2: Run focused tests**

Run:

```bash
pnpm --filter @aivilization/server test -- localRuntimeTownProfileRuntimeConfig.test.ts localRuntimeTownProfileRunnerCli.test.ts
```

- [x] **Step 3: Run package and repo checks**

Run:

```bash
pnpm --filter @aivilization/server typecheck
pnpm lint
pnpm typecheck
pnpm test
git diff --check
```

- [x] **Step 4: Commit**

Run:

```bash
git add docs/superpowers/plans/2026-06-25-runtime-llm-planning-config-loader-slice.md apps/server/src/localRuntimeTownProfileRuntimeConfig.ts apps/server/src/localRuntimeTownProfileRuntimeConfig.test.ts apps/server/src/localRuntimeTownProfileRunnerCli.ts apps/server/src/localRuntimeTownProfileRunnerCli.test.ts apps/server/src/index.ts
git commit -m "feat: load runtime llm planning config"
```
