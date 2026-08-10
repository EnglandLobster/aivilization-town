# Runtime Agent-Cycle LLM Stage Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let headless runtime profile runs explicitly configure and inject traceable LLM
agent-cycle stages: contextual prioritization, action sequence generation, global synthesis, and
reactive correction.

**Architecture:** Keep LLM provider construction in `apps/server`, agent-cycle prompt/schema logic
in `@aivilization/agent-runtime`, and game execution in `apps/worker`. Runtime config selects
stage-specific server factories, profile runner composes the hooks, canonical worker resolver
copies them into each agent binding, and existing cycle traces record the evidence.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, `@aivilization/llm` structured providers,
agent-runtime LLM compilers, worker canonical runtime resolver, server profile runtime config.

---

## File Structure

- Modify `apps/server/src/localRuntimeTownProfileRuntimeConfig.ts`: parse four new runtime config
  nodes.
- Modify `apps/server/src/localRuntimeTownProfileRuntimeConfig.test.ts`: add RED/GREEN config
  parser coverage.
- Modify `apps/server/src/localRuntimeTownProfileLlmPlanning.ts`: add factory functions and config
  types for subtask prioritizer, action sequence generator, global synthesizer, and reactive
  corrector.
- Modify `apps/server/src/localRuntimeTownProfileLlmPlanning.test.ts`: prove factory request ids
  and scripted provider compatibility.
- Modify `apps/worker/src/canonicalWorkerRuntimeResolver.ts`: preserve optional stage hooks in
  canonical runtime bindings.
- Modify `apps/worker/src/canonicalWorkerRuntimeResolver.test.ts`: prove resolver pass-through.
- Modify `apps/server/src/localRuntimeTownProfileRunner.ts`: accept direct hooks and runtime config
  for the four new stages, then pass them into the profile agent provider.
- Modify `apps/server/src/localRuntimeTownProfileRunner.test.ts`: prove direct injected hooks reach
  generated agents.
- Modify `apps/server/src/localRuntimeTownProfileRunnerCli.ts`: map parsed runtime config stage
  nodes into `LocalRuntimeTownProfileRunnerInput`.
- Modify `apps/server/src/localRuntimeTownProfileRunnerCli.test.ts`: prove CLI runtime config
  mapping for the four new stage configs.
- Modify `apps/worker/src/agentScheduling.ts`: pass `subtaskPrioritizer` from runtime binding to
  tick agent input.
- Update this plan with verification logs before the implementation commit.

## Task 1: Runtime Config Parser

- [x] **Step 1: Write failing parser tests**

Add tests to `apps/server/src/localRuntimeTownProfileRuntimeConfig.test.ts` proving:

- a combined config document can load `subtaskPrioritization`, `actionSequenceGeneration`,
  `globalSynthesis`, and `reactiveCorrection`;
- profile-specific nodes override top-level nodes;
- `null` disables a node;
- env secret references resolve;
- invalid node kind and invalid provider kind throw stage-specific messages.

Run:

```bash
pnpm --filter @aivilization/server test -- localRuntimeTownProfileRuntimeConfig.test.ts
```

Expected: FAIL because `LocalRuntimeTownProfileRuntimeConfig` has no new fields and parser rejects
or ignores the new nodes.

- [x] **Step 2: Implement parser types and functions**

In `apps/server/src/localRuntimeTownProfileRuntimeConfig.ts`:

- extend `LocalRuntimeTownProfileRuntimeConfig` with:
  - `subtaskPrioritization`
  - `actionSequenceGeneration`
  - `globalSynthesis`
  - `reactiveCorrection`
- extend `LocalRuntimeTownProfileRuntimeConfigNodeName` with those node names;
- add parse functions that require these kinds:
  - `traceable-llm-subtask-prioritizer`
  - `traceable-llm-action-sequence-generator`
  - `traceable-llm-global-synthesizer`
  - `traceable-llm-reactive-corrector`
- reuse `parseOpenAiCompatibleProviderConfig`, `parseOptionalPricing`,
  `readOptionalPositiveInteger`, and `readOptionalNonNegativeFinite`.

- [x] **Step 3: Verify parser tests pass**

Run:

```bash
pnpm --filter @aivilization/server test -- localRuntimeTownProfileRuntimeConfig.test.ts
```

Expected: PASS.

### Verification Log

- RED: `pnpm --filter @aivilization/server test -- localRuntimeTownProfileRuntimeConfig.test.ts`
  failed because `loadLocalRuntimeTownProfileRuntimeConfig` returned `{}` for the four new
  agent-cycle LLM stage nodes and did not reject invalid new-node config.
- GREEN: `pnpm --filter @aivilization/server test -- localRuntimeTownProfileRuntimeConfig.test.ts`
  passed after parser types and node-specific validation were added.

## Task 2: Server LLM Stage Factories

- [x] **Step 1: Write failing factory tests**

Add tests to `apps/server/src/localRuntimeTownProfileLlmPlanning.test.ts` proving each factory can
use a scripted provider:

- `createLocalRuntimeTownProfileSubtaskPrioritizer`
- `createLocalRuntimeTownProfileActionSequenceGenerator`
- `createLocalRuntimeTownProfileGlobalSynthesizer`
- `createLocalRuntimeTownProfileReactiveCorrector`

Each test should invoke the returned hook with a minimal valid input and assert:

- result uses the LLM-produced ordering/action/decision;
- trace status is `accepted`;
- request id matches the stage-specific format;
- provider id, model, attempts, and usage are preserved.

Run:

```bash
pnpm --filter @aivilization/server test -- localRuntimeTownProfileLlmPlanning.test.ts
```

Expected: FAIL because the factory exports do not exist.

- [x] **Step 2: Implement factory types and functions**

In `apps/server/src/localRuntimeTownProfileLlmPlanning.ts`:

- import agent-runtime factory functions and types:
  - `createTraceableLlmSubtaskPrioritizer`
  - `createTraceableLlmActionSequenceGenerator`
  - `createTraceableLlmGlobalSynthesizer`
  - `createTraceableLlmReactiveCorrector`
  - `SubtaskPrioritizer`, `ActionSequenceGenerator`, `GlobalActionSynthesizer`,
    `ReactiveCorrector`
- add one config type per stage with `kind`, `profileId`, `model`, `provider`, `maxAttempts`,
  `timeoutMs`, `pricing`;
- add one optional config alias per stage;
- add factory functions that construct a provider from config and return the traceable stage.

- [x] **Step 3: Verify factory tests pass**

Run:

```bash
pnpm --filter @aivilization/server test -- localRuntimeTownProfileLlmPlanning.test.ts
```

Expected: PASS.

### Verification Log

- RED: `pnpm --filter @aivilization/server test -- localRuntimeTownProfileLlmPlanning.test.ts`
  failed because `createLocalRuntimeTownProfileSubtaskPrioritizer` and sibling factory exports did
  not exist.
- GREEN: `pnpm --filter @aivilization/server test -- localRuntimeTownProfileLlmPlanning.test.ts`
  passed after all four scripted-provider factory functions were added.

## Task 3: Worker Canonical Resolver Pass-Through

- [x] **Step 1: Write failing resolver test**

Add a test to `apps/worker/src/canonicalWorkerRuntimeResolver.test.ts` that passes all four stage
hooks into `createCanonicalWorkerRuntimeResolver`, resolves a binding for an active production plan,
and asserts the returned binding preserves:

- `subtaskPrioritizer`
- `actionSequenceGenerator`
- `globalSynthesizer`
- `reactiveCorrector`

Run:

```bash
pnpm --filter @aivilization/worker test -- canonicalWorkerRuntimeResolver.test.ts
```

Expected: FAIL because resolver config does not expose or copy those fields.

- [x] **Step 2: Implement resolver pass-through**

In `apps/worker/src/canonicalWorkerRuntimeResolver.ts`:

- import the four stage hook types;
- extend `CanonicalWorkerRuntimeResolverConfig`;
- copy defined hooks into the returned `WorkerAgentRuntimeBinding`.

- [x] **Step 3: Verify resolver test passes**

Run:

```bash
pnpm --filter @aivilization/worker test -- canonicalWorkerRuntimeResolver.test.ts
```

Expected: PASS.

### Verification Log

- RED: `pnpm --filter @aivilization/worker test -- canonicalWorkerRuntimeResolver.test.ts`
  failed because the canonical runtime binding omitted configured agent-cycle LLM stage hooks.
- GREEN: `pnpm --filter @aivilization/worker test -- canonicalWorkerRuntimeResolver.test.ts`
  passed after resolver config and binding pass-through were added.

## Task 4: Profile Runner Composition

- [x] **Step 1: Write failing runner tests**

Add tests to `apps/server/src/localRuntimeTownProfileRunner.test.ts` proving:

- direct injected stage hooks on `runLocalRuntimeTownDaemonScenarioProfile` reach generated agent
  bindings;
- `createLocalRuntimeTownProfileAgentProvider` passes hooks into canonical runtime resolver;
- if runtime config objects are supplied, the profile runner constructs stage hooks unless an
  explicit direct hook is already provided.

Run:

```bash
pnpm --filter @aivilization/server test -- localRuntimeTownProfileRunner.test.ts
```

Expected: FAIL because runner inputs and agent provider do not accept the new hooks/configs.

- [x] **Step 2: Implement runner composition**

In `apps/server/src/localRuntimeTownProfileRunner.ts`:

- extend `LocalRuntimeTownProfileRunnerInput` with direct hooks and config fields;
- construct each hook as `directHook ?? createLocalRuntimeTownProfileX(config)`;
- pass hooks into `createLocalRuntimeTownProfileAgentProvider`;
- extend provider input with the four hooks and pass them to `createCanonicalWorkerRuntimeResolver`.

- [x] **Step 3: Verify runner tests pass**

Run:

```bash
pnpm --filter @aivilization/server test -- localRuntimeTownProfileRunner.test.ts
```

Expected: PASS.

### Verification Log

- RED: `pnpm --filter @aivilization/server test -- localRuntimeTownProfileRunner.test.ts`
  failed because `createLocalRuntimeTownProfileAgentProvider` did not pass configured agent-cycle
  LLM stage hooks through to generated tick agents.
- GREEN: `pnpm --filter @aivilization/server test -- localRuntimeTownProfileRunner.test.ts`
  passed after profile runner/provider composition and the missing scheduling pass-through were
  added.
- RED: `pnpm --filter @aivilization/server test -- localRuntimeTownProfileRunnerCli.test.ts`
  failed because `--runtime-config` loaded the new stage config nodes but did not map them into
  `LocalRuntimeTownProfileRunnerInput`.
- GREEN: `pnpm --filter @aivilization/server test -- localRuntimeTownProfileRunnerCli.test.ts`
  passed after CLI runtime config mapping was extended.

## Task 5: Full Verification And Commit

- [x] **Step 1: Format touched files**

Run:

```bash
pnpm exec prettier --write docs/superpowers/specs/2026-06-25-runtime-agent-cycle-llm-stage-wiring-design.md docs/superpowers/plans/2026-06-25-runtime-agent-cycle-llm-stage-wiring-slice.md apps/server/src/localRuntimeTownProfileRuntimeConfig.ts apps/server/src/localRuntimeTownProfileRuntimeConfig.test.ts apps/server/src/localRuntimeTownProfileLlmPlanning.ts apps/server/src/localRuntimeTownProfileLlmPlanning.test.ts apps/server/src/localRuntimeTownProfileRunner.ts apps/server/src/localRuntimeTownProfileRunner.test.ts apps/server/src/localRuntimeTownProfileRunnerCli.ts apps/server/src/localRuntimeTownProfileRunnerCli.test.ts apps/worker/src/agentScheduling.ts apps/worker/src/canonicalWorkerRuntimeResolver.ts apps/worker/src/canonicalWorkerRuntimeResolver.test.ts
```

- [x] **Step 2: Run focused verification**

Run:

```bash
pnpm --filter @aivilization/server test -- localRuntimeTownProfileRuntimeConfig.test.ts localRuntimeTownProfileLlmPlanning.test.ts localRuntimeTownProfileRunner.test.ts localRuntimeTownProfileRunnerCli.test.ts
pnpm --filter @aivilization/worker test -- canonicalWorkerRuntimeResolver.test.ts
```

- [x] **Step 3: Run full verification**

Run:

```bash
pnpm check
git diff --check
```

Expected: both pass.

### Verification Log

- GREEN: `pnpm --filter @aivilization/server test -- localRuntimeTownProfileRuntimeConfig.test.ts localRuntimeTownProfileLlmPlanning.test.ts localRuntimeTownProfileRunner.test.ts localRuntimeTownProfileRunnerCli.test.ts`
  passed with 14 test files and 75 tests.
- GREEN: `pnpm --filter @aivilization/worker test -- canonicalWorkerRuntimeResolver.test.ts`
  passed with 52 test files and 299 tests.
- GREEN: `pnpm check` passed lint, typecheck, and the full Vitest suite with 161 test files and
  838 tests.
- GREEN: `git diff --check` passed.

- [x] **Step 4: Commit**

Commit with a detailed Conventional Commit message:

```bash
git add docs/superpowers/specs/2026-06-25-runtime-agent-cycle-llm-stage-wiring-design.md docs/superpowers/plans/2026-06-25-runtime-agent-cycle-llm-stage-wiring-slice.md apps/server/src/localRuntimeTownProfileRuntimeConfig.ts apps/server/src/localRuntimeTownProfileRuntimeConfig.test.ts apps/server/src/localRuntimeTownProfileLlmPlanning.ts apps/server/src/localRuntimeTownProfileLlmPlanning.test.ts apps/server/src/localRuntimeTownProfileRunner.ts apps/server/src/localRuntimeTownProfileRunner.test.ts apps/server/src/localRuntimeTownProfileRunnerCli.ts apps/server/src/localRuntimeTownProfileRunnerCli.test.ts apps/worker/src/agentScheduling.ts apps/worker/src/canonicalWorkerRuntimeResolver.ts apps/worker/src/canonicalWorkerRuntimeResolver.test.ts
git commit -m "feat(planning): 接入运行时 agent-cycle LLM 阶段"
```
