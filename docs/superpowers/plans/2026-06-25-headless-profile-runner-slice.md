# Headless Profile Runner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reusable headless backend runner for `smoke-25`, `default-100`, and `headless-stress-1000` runtime profiles.

**Architecture:** Keep profile execution in `apps/server` because it composes scenario profiles, local runtime API, daemon status, and process entrypoints. Add a default canonical `agentProvider` that reuses worker-owned objective renewal, active-plan scheduling, and canonical domain runtime resolution; the provider selects agents but does not run ticks. The CLI is a thin adapter over the library runner and only parses args and prints JSON.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, Node ESM CLI, existing local runtime supervisor and scenario profile factories.

---

### Task 1: Default Profile Agent Provider

**Files:**

- Create: `apps/server/src/localRuntimeTownProfileRunner.test.ts`
- Create: `apps/server/src/localRuntimeTownProfileRunner.ts`

- [x] **Step 1: Write failing provider/runner test**

Add a test that calls `runLocalRuntimeTownDaemonScenarioProfile({ profileId: 'smoke-25', rootDir, cycleCount: 1, requestedAt: 100 })` and asserts:

- summary profile/manifest ids match `smoke-25`
- one cycle completes successfully
- one partition is healthy
- projection has 25 agents
- event count is greater than partition count, proving the default provider caused more than time-advance events
- agent trace count is greater than zero

- [x] **Step 2: Run runner test and verify RED**

Run: `pnpm --filter @aivilization/server test -- localRuntimeTownProfileRunner.test.ts`

Expected: FAIL because the runner module is not implemented.

- [x] **Step 3: Implement default policies and provider**

Add `createLocalRuntimeTownProfileWorldPolicies()` and `createLocalRuntimeTownProfileAgentProvider()` in `localRuntimeTownProfileRunner.ts`. The provider should call `renewMissingActiveObjectives`, then `buildWorkerTickAgentsFromActivePlans` with `createCanonicalWorkerRuntimeResolver`.

- [x] **Step 4: Run runner test and verify GREEN**

Run: `pnpm --filter @aivilization/server test -- localRuntimeTownProfileRunner.test.ts`

Expected: PASS.

### Task 2: Runner Summary Contract

**Files:**

- Modify: `apps/server/src/localRuntimeTownProfileRunner.test.ts`
- Modify: `apps/server/src/localRuntimeTownProfileRunner.ts`
- Modify: `apps/server/src/index.ts`

- [x] **Step 1: Write failing summary detail test**

Add a test for `default-100` with `cycleCount: 2` asserting summary includes two partitions, total projection agent count 100, deterministic `traceId`, per-partition `streamVersion`, `eventCount`, `agentTraceCount`, and `daemonHealth`.

- [x] **Step 2: Run runner tests and verify RED**

Run: `pnpm --filter @aivilization/server test -- localRuntimeTownProfileRunner.test.ts`

Expected: FAIL until summary fields and export are implemented.

- [x] **Step 3: Implement runner summary**

`runLocalRuntimeTownDaemonScenarioProfile` should:

- create the selected scenario profile
- create `createLocalRuntimeTownApi` with profile manifest/presets, default policies, no static agents, default agent provider unless caller supplies one
- call `supervisor.runCycles`
- read daemon status
- query projection and event feed for each partition
- return an immutable summary with profile, run, daemon, and partition data

- [x] **Step 4: Export runner API**

Export the runner from `apps/server/src/index.ts`.

- [x] **Step 5: Run runner tests and verify GREEN**

Run: `pnpm --filter @aivilization/server test -- localRuntimeTownProfileRunner.test.ts`

Expected: PASS.

### Task 3: CLI Adapter

**Files:**

- Create: `apps/server/src/localRuntimeTownProfileRunnerCli.test.ts`
- Create: `apps/server/src/localRuntimeTownProfileRunnerCli.ts`
- Modify: `apps/server/package.json`

- [x] **Step 1: Write failing CLI tests**

Add tests for:

- `parseLocalRuntimeTownProfileRunnerCliArgs(['--profile', 'smoke-25', '--root-dir', '/tmp/town', '--cycles', '2', '--requested-at', '100'])`
- `runLocalRuntimeTownProfileRunnerCli` writing JSON to an injected stdout using an injected fake runner

- [x] **Step 2: Run CLI tests and verify RED**

Run: `pnpm --filter @aivilization/server test -- localRuntimeTownProfileRunnerCli.test.ts`

Expected: FAIL because the CLI module is missing.

- [x] **Step 3: Implement CLI parser and adapter**

Add `parseLocalRuntimeTownProfileRunnerCliArgs`, `runLocalRuntimeTownProfileRunnerCli`, and direct-execution guard using `pathToFileURL(process.argv[1]).href === import.meta.url`.

- [x] **Step 4: Wire package bin/build**

Add a `bin` entry for `aivilization-town-run-profile` and update the server build script to include `src/localRuntimeTownProfileRunnerCli.ts`.

- [x] **Step 5: Run CLI tests and verify GREEN**

Run: `pnpm --filter @aivilization/server test -- localRuntimeTownProfileRunnerCli.test.ts`

Expected: PASS.

### Task 4: Verification And Commit

**Files:**

- Modify: all files above

- [x] **Step 1: Format touched files**

Run: `pnpm exec prettier --write docs/superpowers/plans/2026-06-25-headless-profile-runner-slice.md apps/server/src/localRuntimeTownProfileRunner.ts apps/server/src/localRuntimeTownProfileRunner.test.ts apps/server/src/localRuntimeTownProfileRunnerCli.ts apps/server/src/localRuntimeTownProfileRunnerCli.test.ts apps/server/src/index.ts apps/server/package.json`

- [x] **Step 2: Run focused and full verification**

Run: `pnpm --filter @aivilization/server typecheck && pnpm --filter @aivilization/server test -- localRuntimeTownProfileRunner.test.ts localRuntimeTownProfileRunnerCli.test.ts && pnpm --filter @aivilization/server build && pnpm lint && pnpm typecheck && pnpm test && git diff --check`

Expected: all commands exit 0.

- [x] **Step 3: Commit**

```bash
git add docs/superpowers/plans/2026-06-25-headless-profile-runner-slice.md apps/server/src/localRuntimeTownProfileRunner.ts apps/server/src/localRuntimeTownProfileRunner.test.ts apps/server/src/localRuntimeTownProfileRunnerCli.ts apps/server/src/localRuntimeTownProfileRunnerCli.test.ts apps/server/src/index.ts apps/server/package.json
git commit -m "feat: add headless profile runner"
```
