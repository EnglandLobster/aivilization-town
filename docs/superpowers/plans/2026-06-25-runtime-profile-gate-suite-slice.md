# Runtime Profile Gate Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic suite runner for backend runtime profile gates so smoke, default, and stress profiles can be exercised as one acceptance boundary before larger game features build on the runtime.

**Architecture:** Keep per-profile run execution in `localRuntimeTownProfileRunner`. Add a higher-level suite module in `apps/server` that owns profile ordering, per-profile root directories, report repository wiring, gate evaluation, and aggregate pass/fail status. Add a thin CLI around that module for local and CI use.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, existing runtime profile runner, report repository, and profile gate evaluator.

---

### Task 1: Suite Domain Module

**Files:**

- Create: `apps/server/src/localRuntimeTownProfileGateSuite.test.ts`
- Create: `apps/server/src/localRuntimeTownProfileGateSuite.ts`
- Modify: `apps/server/src/index.ts`

- [x] **Step 1: Write failing suite tests**

Add injected-runner tests that do not execute the expensive profiles:

- a passing suite with `smoke-25` and `default-100`
- a failing suite where the injected summary violates daemon health and trace criteria

Assert sequential profile inputs, deterministic root directories, report repository wiring, aggregate counts, and gate failure codes.

- [x] **Step 2: Run suite tests and verify RED**

Run:

```bash
pnpm --filter @aivilization/server test -- localRuntimeTownProfileGateSuite.test.ts
```

Expected: FAIL because the suite module is missing.

- [x] **Step 3: Implement suite runner**

Add:

- `localRuntimeTownProfileGateSuiteDefaultProfileIds`
- `runLocalRuntimeTownProfileGateSuite(input)`
- immutable suite result types
- a report conversion helper from profile runner summaries

The suite should validate inputs, run profiles sequentially, evaluate each profile against `createLocalRuntimeTownProfileGateCriteria(profileId, { minimumCompletedCycleCount: cycleCount })`, and return aggregate status without throwing for gate failures.

- [x] **Step 4: Export and verify GREEN**

Export from `apps/server/src/index.ts`, then run:

```bash
pnpm --filter @aivilization/server test -- localRuntimeTownProfileGateSuite.test.ts
pnpm --filter @aivilization/server typecheck
```

Expected: PASS.

### Task 2: Suite CLI

**Files:**

- Create: `apps/server/src/localRuntimeTownProfileGateSuiteCli.test.ts`
- Create: `apps/server/src/localRuntimeTownProfileGateSuiteCli.ts`
- Modify: `apps/server/package.json`

- [x] **Step 1: Write failing CLI tests**

Add parser and injected-suite tests for:

- `--root-dir`, `--requested-at`, `--cycles`, `--cycle-interval-ms`, `--profiles`, and `--report-root-dir`
- pass status returns exit code `0`
- fail status returns exit code `2` and writes a concise failure message to stderr

- [x] **Step 2: Run CLI tests and verify RED**

Run:

```bash
pnpm --filter @aivilization/server test -- localRuntimeTownProfileGateSuiteCli.test.ts
```

Expected: FAIL because the CLI module is missing.

- [x] **Step 3: Implement CLI and package entry**

Create `aivilization-town-run-profile-suite` as a bin entry backed by `localRuntimeTownProfileGateSuiteCli.ts`. Keep stdout as JSON and stderr limited to suite gate failures or parse/runtime errors.

- [x] **Step 4: Run CLI tests and verify GREEN**

Run:

```bash
pnpm --filter @aivilization/server test -- localRuntimeTownProfileGateSuiteCli.test.ts
pnpm --filter @aivilization/server typecheck
pnpm --filter @aivilization/server build
```

Expected: PASS.

### Task 3: Verification And Commit

**Files:**

- Modify all files above.

- [x] **Step 1: Format touched files**

Run:

```bash
pnpm exec prettier --write docs/superpowers/plans/2026-06-25-runtime-profile-gate-suite-slice.md apps/server/src/localRuntimeTownProfileGateSuite.ts apps/server/src/localRuntimeTownProfileGateSuite.test.ts apps/server/src/localRuntimeTownProfileGateSuiteCli.ts apps/server/src/localRuntimeTownProfileGateSuiteCli.test.ts apps/server/src/index.ts apps/server/package.json
```

- [x] **Step 2: Run focused and full verification**

Run:

```bash
pnpm --filter @aivilization/server test -- localRuntimeTownProfileGateSuite.test.ts localRuntimeTownProfileGateSuiteCli.test.ts
pnpm --filter @aivilization/server typecheck
pnpm --filter @aivilization/server build
pnpm lint
pnpm typecheck
pnpm test
git diff --check
```

Expected: all commands exit 0.

- [x] **Step 3: Commit**

Run:

```bash
git add docs/superpowers/plans/2026-06-25-runtime-profile-gate-suite-slice.md apps/server/src/localRuntimeTownProfileGateSuite.ts apps/server/src/localRuntimeTownProfileGateSuite.test.ts apps/server/src/localRuntimeTownProfileGateSuiteCli.ts apps/server/src/localRuntimeTownProfileGateSuiteCli.test.ts apps/server/src/index.ts apps/server/package.json
git commit -m "feat: add runtime profile gate suite"
```
