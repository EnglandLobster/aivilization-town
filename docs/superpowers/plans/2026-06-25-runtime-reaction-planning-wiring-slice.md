# Runtime Reaction Planning Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire traceable LLM reaction evaluators into local runtime profile runs.

**Architecture:** Extend profile runtime config with `reactionPlanning`, create a server-side
reaction evaluator factory, and carry `ambientObservationMemory` through worker runtime wiring into
`runWorkerSimulationTick`.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, existing `@aivilization/llm` provider config,
existing `@aivilization/agent-runtime` reaction evaluator seam.

---

## Task 1: Runtime Config And Factory

**Files:**

- Modify: `apps/server/src/localRuntimeTownProfileRuntimeConfig.test.ts`
- Modify: `apps/server/src/localRuntimeTownProfileRuntimeConfig.ts`
- Create: `apps/server/src/localRuntimeTownProfileLlmPlanning.test.ts`
- Modify: `apps/server/src/localRuntimeTownProfileLlmPlanning.ts`

- [x] **Step 1: Add failing config tests**

Add coverage proving:

- `loadLocalRuntimeTownProfileRuntimeConfig` parses profile-specific `reactionPlanning` with
  OpenAI-compatible provider secrets, max attempts, timeout, and pricing;
- top-level `reactionPlanning` applies unless a profile sets `reactionPlanning: null`;
- invalid `reactionPlanning.kind` and provider kinds fail with node-specific messages.

Run:

```bash
pnpm --filter @aivilization/server test -- localRuntimeTownProfileRuntimeConfig.test.ts
```

Expected: FAIL because `reactionPlanning` is ignored or rejected.

Observed: failed because `reactionPlanning` was ignored and invalid reaction config resolved to `{}`.

- [x] **Step 2: Implement config parsing**

Extend runtime config types and parsing helpers to support `reactionPlanning` while keeping existing
`llmPlanning` and `dailyPlanning` behavior unchanged.

Run:

```bash
pnpm --filter @aivilization/server test -- localRuntimeTownProfileRuntimeConfig.test.ts
pnpm --filter @aivilization/server typecheck
```

Expected: PASS.

Observed:

- `pnpm --filter @aivilization/server test -- localRuntimeTownProfileRuntimeConfig.test.ts`
  passed.
- `pnpm --filter @aivilization/server typecheck` passed.

- [x] **Step 3: Add failing reaction evaluator factory test**

Add a scripted provider test proving `createLocalRuntimeTownProfileReactionEvaluator` creates a
traceable evaluator with request id
`profile-llm-reaction:{profileId}:{agentId}:{memoryId}:{issuedAt}`.

Run:

```bash
pnpm --filter @aivilization/server test -- localRuntimeTownProfileLlmPlanning.test.ts
```

Expected: FAIL because the factory does not exist.

Observed: failed because `createLocalRuntimeTownProfileReactionEvaluator` was not a function.

- [x] **Step 4: Implement reaction evaluator factory**

Add `LocalRuntimeTownProfileReactionPlanningConfig`,
`LocalRuntimeTownProfileReactionEvaluatorConfig`, and
`createLocalRuntimeTownProfileReactionEvaluator` using
`createTraceableLlmReactionEvaluator`.

Run:

```bash
pnpm --filter @aivilization/server test -- localRuntimeTownProfileLlmPlanning.test.ts
pnpm --filter @aivilization/server typecheck
```

Expected: PASS.

Observed:

- `pnpm --filter @aivilization/server test -- localRuntimeTownProfileLlmPlanning.test.ts` passed.
- `pnpm --filter @aivilization/server typecheck` passed.

## Task 2: Worker Runtime Ambient Wiring

**Files:**

- Modify: `apps/worker/src/localSimulationRuntimeManifest.test.ts`
- Modify: `apps/worker/src/localSimulationRuntimeManifest.ts`
- Modify: `apps/worker/src/localSimulationRuntimeHost.ts`

- [x] **Step 5: Add failing manifest wiring test**

Add a test proving `ambientObservationMemory` supplied to runtime manifest wiring appears on the
created backend registration.

Run:

```bash
pnpm --filter @aivilization/worker test -- localSimulationRuntimeManifest.test.ts
```

Expected: FAIL because manifest wiring drops `ambientObservationMemory`.

Observed: failed because registrations returned `ambientObservationMemory: undefined`.

- [x] **Step 6: Implement ambient wiring passthrough**

Add `ambientObservationMemory?: WorkerTickAmbientObservationMemoryInput` to
`LocalSimulationRuntimeWiringInput`, pass it through manifest registration creation, and pass it
through host bootstrap.

Run:

```bash
pnpm --filter @aivilization/worker test -- localSimulationRuntimeManifest.test.ts
pnpm --filter @aivilization/worker typecheck
```

Expected: PASS.

Observed:

- `pnpm --filter @aivilization/worker test -- localSimulationRuntimeManifest.test.ts` passed.
- `pnpm --filter @aivilization/worker typecheck` passed.

## Task 3: Profile Runner And CLI Wiring

**Files:**

- Modify: `apps/server/src/localRuntimeTownProfileRunner.test.ts`
- Modify: `apps/server/src/localRuntimeTownProfileRunner.ts`
- Modify: `apps/server/src/localRuntimeTownProfileRunnerCli.test.ts`
- Modify: `apps/server/src/localRuntimeTownProfileRunnerCli.ts`

- [x] **Step 7: Add failing profile runner reaction test**

Add a profile-run test with scripted `reactionPlanning` returning `ignore`. Run one smoke profile
cycle that creates ambient social observations. Assert the bystander still receives observation
memory, but deterministic social follow-up intentions are not created.

Run:

```bash
pnpm --filter @aivilization/server test -- localRuntimeTownProfileRunner.test.ts
```

Expected: FAIL because profile runner does not pass reaction planning into runtime ticks.

Observed:

- The first version of the test passed accidentally because it did not prove provider invocation
  and read intentions from the wrong root. After strengthening it, the test failed because the
  profile reaction provider was never called.

- [x] **Step 8: Wire reaction planning into profile runner**

Create the reaction evaluator from either direct injection or `reactionPlanning` config and pass it
as `ambientObservationMemory.reactionEvaluator` to `createLocalRuntimeTownApi`.

Run:

```bash
pnpm --filter @aivilization/server test -- localRuntimeTownProfileRunner.test.ts
pnpm --filter @aivilization/server typecheck
```

Expected: PASS.

Observed:

- `pnpm --filter @aivilization/worker build` was required before focused server tests because
  server tests import the worker package entrypoint.
- The first fix still failed until `localSimulationLifecycle.toLoopBaseInput` also forwarded
  `ambientObservationMemory`.
- `pnpm --filter @aivilization/server test -- localRuntimeTownProfileRunner.test.ts` passed.
- `pnpm --filter @aivilization/server typecheck` passed.

- [x] **Step 9: Add and implement CLI runtime config propagation**

Extend the existing `--llm-planning-config` loader path so resolved `reactionPlanning` is passed to
`runLocalRuntimeTownDaemonScenarioProfile`.

Run:

```bash
pnpm --filter @aivilization/server test -- localRuntimeTownProfileRunnerCli.test.ts
```

Expected: PASS after implementation.

Observed:

- The CLI test first failed because `reactionPlanning` was undefined on the runner input.
- `pnpm --filter @aivilization/server test -- localRuntimeTownProfileRunnerCli.test.ts` passed
  after forwarding `runtimeConfig.reactionPlanning`.

## Task 4: Full Verification And Commit

- [x] **Step 10: Full checks**

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

Observed:

- `pnpm lint` passed.
- `pnpm typecheck` passed.
- `pnpm test` passed: 149 test files, 738 tests.
- `pnpm build` passed.
- `git diff --check` passed.

- [x] **Step 11: Inspect and commit**

Confirm the diff is limited to runtime reaction planning wiring, tests, and this slice's docs.

Commit with:

```bash
git add docs/superpowers/specs/2026-06-25-runtime-reaction-planning-wiring-design.md docs/superpowers/plans/2026-06-25-runtime-reaction-planning-wiring-slice.md apps/server/src/localRuntimeTownProfileRuntimeConfig.ts apps/server/src/localRuntimeTownProfileRuntimeConfig.test.ts apps/server/src/localRuntimeTownProfileLlmPlanning.ts apps/server/src/localRuntimeTownProfileLlmPlanning.test.ts apps/server/src/localRuntimeTownProfileRunner.ts apps/server/src/localRuntimeTownProfileRunner.test.ts apps/server/src/localRuntimeTownProfileRunnerCli.ts apps/server/src/localRuntimeTownProfileRunnerCli.test.ts apps/worker/src/localSimulationRuntimeManifest.ts apps/worker/src/localSimulationRuntimeManifest.test.ts apps/worker/src/localSimulationRuntimeHost.ts
git commit -m "feat: wire profile reaction planning into runtime"
```

Observed: diff reviewed and limited to runtime reaction planning wiring, tests, and this slice's
docs.
