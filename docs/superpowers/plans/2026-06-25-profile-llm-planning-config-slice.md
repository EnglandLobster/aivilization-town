# Profile LLM Planning Config Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let local runtime scenario profiles opt into traceable LLM strategic planning through a typed config object that builds on the `@aivilization/llm` provider factory without leaking provider details into worker or domain code.

**Architecture:** `apps/server` owns profile-level composition: it converts a profile planning config into a `StrategicPlanCompiler` and passes that compiler into the existing worker agent provider. `@aivilization/llm` remains the provider boundary, `@aivilization/agent-runtime` remains the strategic compiler boundary, and worker/domain packages stay unaware of API keys, endpoints, response-format modes, or scripted test providers.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, `@aivilization/server`, `@aivilization/agent-runtime`, `@aivilization/llm`.

---

### Task 1: Profile LLM Planning Config Factory

**Files:**

- Create: `apps/server/src/localRuntimeTownProfileLlmPlanning.test.ts`
- Create: `apps/server/src/localRuntimeTownProfileLlmPlanning.ts`
- Modify: `apps/server/src/index.ts`
- Modify: `apps/server/package.json`
- Modify: this plan file

- [x] **Step 1: Write failing profile LLM planning config tests**

Add tests proving:

- `createLocalRuntimeTownProfileStrategicPlanCompiler` builds a traceable compiler from a scripted provider config;
- the compiler preserves accepted LLM planning trace fields including `source`, `providerId`, `requestId`, attempt status, and usage;
- the generated request id includes the profile id, objective id, agent id, and issued timestamp;
- `undefined` planning config returns `undefined`, so deterministic profile behavior remains the default;
- invalid provider configuration is rejected through the LLM provider factory before runtime use.

- [x] **Step 2: Run tests and verify RED**

Run:

```bash
pnpm --filter @aivilization/server test -- localRuntimeTownProfileLlmPlanning.test.ts
```

Expected before implementation: FAIL because `./localRuntimeTownProfileLlmPlanning` does not exist.

- [x] **Step 3: Implement profile LLM planning config factory**

Add:

- `LocalRuntimeTownProfileLlmPlanningConfig`
- `LocalRuntimeTownProfileStrategicCompilerConfig`
- `createLocalRuntimeTownProfileStrategicPlanCompiler(config)`

Rules:

- config kind is `traceable-llm-strategic-planner`;
- config owns `profileId`, `model`, provider config, `maxAttempts`, `timeoutMs`, and optional pricing;
- provider config delegates to `createLlmStructuredProviderFromConfig`;
- compiler delegates to `createTraceableLlmStrategicPlanCompiler`;
- request id format is `profile-llm-plan:<profileId>:<agentId>:<objectiveId>:<issuedAt>`;
- default fallback remains the deterministic strategic compiler already inside `agent-runtime`.

- [x] **Step 4: Verify factory GREEN**

Run:

```bash
pnpm --filter @aivilization/server test -- localRuntimeTownProfileLlmPlanning.test.ts
pnpm --filter @aivilization/server typecheck
```

Expected: PASS.

### Task 2: Wire Profile Runner To Planning Config

**Files:**

- Modify: `apps/server/src/localRuntimeTownProfileRunner.ts`
- Modify: `apps/server/src/localRuntimeTownProfileRunner.test.ts`
- Modify: this plan file

- [x] **Step 1: Write failing runner integration test**

Add a test proving that `runLocalRuntimeTownDaemonScenarioProfile` accepts an `llmPlanning` config, persists an LLM-created branch plan, and executes a generated agent cycle whose selection trace chooses that LLM branch for the smoke profile.

- [x] **Step 2: Run runner test and verify RED**

Run:

```bash
pnpm --filter @aivilization/server test -- localRuntimeTownProfileRunner.test.ts
```

Expected before runner wiring: FAIL because `llmPlanning` is not accepted or not used.

- [x] **Step 3: Implement runner injection**

Update:

- `LocalRuntimeTownProfileRunnerInput` gains optional `llmPlanning`;
- `createLocalRuntimeTownProfileAgentProvider` accepts optional `strategicPlanCompiler`;
- `runLocalRuntimeTownDaemonScenarioProfile` builds the compiler once from profile config and passes it to the profile agent provider;
- explicitly supplied `agentProvider` keeps its override behavior and is not replaced by profile LLM config.

- [x] **Step 4: Verify runner GREEN**

Run:

```bash
pnpm --filter @aivilization/server test -- localRuntimeTownProfileRunner.test.ts localRuntimeTownProfileLlmPlanning.test.ts
pnpm --filter @aivilization/server typecheck
```

Expected: PASS.

### Task 3: Verification And Commit

**Files:**

- All files above.

- [x] **Step 1: Format touched files**

Run:

```bash
pnpm exec prettier --write docs/superpowers/plans/2026-06-25-profile-llm-planning-config-slice.md apps/server/package.json apps/server/src/index.ts apps/server/src/localRuntimeTownProfileLlmPlanning.ts apps/server/src/localRuntimeTownProfileLlmPlanning.test.ts apps/server/src/localRuntimeTownProfileRunner.ts apps/server/src/localRuntimeTownProfileRunner.test.ts
```

- [x] **Step 2: Run focused and full verification**

Run:

```bash
pnpm --filter @aivilization/server test -- localRuntimeTownProfileLlmPlanning.test.ts localRuntimeTownProfileRunner.test.ts
pnpm --filter @aivilization/server typecheck
pnpm lint
pnpm typecheck
pnpm test
git diff --check
```

Expected: all commands exit 0.

- [x] **Step 3: Commit**

Run:

```bash
git add docs/superpowers/plans/2026-06-25-profile-llm-planning-config-slice.md apps/server/package.json apps/server/src/index.ts apps/server/src/localRuntimeTownProfileLlmPlanning.ts apps/server/src/localRuntimeTownProfileLlmPlanning.test.ts apps/server/src/localRuntimeTownProfileRunner.ts apps/server/src/localRuntimeTownProfileRunner.test.ts
git commit -m "feat: wire profile llm planning config"
```
