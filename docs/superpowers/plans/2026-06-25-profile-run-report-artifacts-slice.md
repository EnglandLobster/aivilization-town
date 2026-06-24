# Profile Run Report Artifacts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist headless runtime profile runs as queryable observability artifacts so smoke, default, and stress profiles can be archived for CI and regression analysis.

**Architecture:** Add a neutral `RuntimeProfileRunReport` contract and JSONL repositories in `packages/observability`. The server profile runner maps its local summary into that report and optionally records it; the CLI remains a thin adapter that only parses `--report-root-dir` and injects a file repository.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, Node JSONL file repositories, existing local runtime profile runner.

---

### Task 1: Observability Report Repository

**Files:**

- Create: `packages/observability/src/runtimeProfileRunReport.test.ts`
- Create: `packages/observability/src/runtimeProfileRunReport.ts`
- Modify: `packages/observability/src/index.ts`

- [x] **Step 1: Write failing report repository tests**

Add tests that create two reports with the same `profileId` and different `generatedAt` values:

```ts
const repository = new InMemoryRuntimeProfileRunReportRepository();
const older = createRuntimeProfileRunReport({
  runId: 'run-100',
  profileId: 'smoke-25',
  generatedAt: 100,
  ...baseFields,
});
const newer = createRuntimeProfileRunReport({
  runId: 'run-200',
  profileId: 'smoke-25',
  generatedAt: 200,
  ...baseFields,
});
await repository.record(older);
await repository.record(newer);
await expect(repository.query({ profileId: 'smoke-25' })).resolves.toEqual([newer, older]);
```

Add a file-backed test that records a report, creates a new `FileRuntimeProfileRunReportRepository`, and verifies the report can still be read from `runtime-profile-runs.jsonl`.

- [x] **Step 2: Run observability tests and verify RED**

Run:

```bash
pnpm --filter @aivilization/observability test -- runtimeProfileRunReport.test.ts
```

Expected: FAIL because `RuntimeProfileRunReport` and repositories are not implemented.

- [x] **Step 3: Implement report contract and repositories**

Add:

- `RuntimeProfileRunReport`
- `RuntimeProfileRunPartitionReport`
- `RuntimeProfileRunReportRepository`
- `InMemoryRuntimeProfileRunReportRepository`
- `FileRuntimeProfileRunReportRepository`
- `createRuntimeProfileRunReport`

The repository must clone reports on write/read, ignore duplicate `runId` records, sort query results latest-first, and validate positive `limit`.

- [x] **Step 4: Export and verify GREEN**

Export the new module from `packages/observability/src/index.ts`, then run:

```bash
pnpm --filter @aivilization/observability test -- runtimeProfileRunReport.test.ts
pnpm --filter @aivilization/observability typecheck
```

Expected: PASS.

### Task 2: Server Runner Report Recording

**Files:**

- Modify: `apps/server/package.json`
- Modify: `apps/server/src/localRuntimeTownProfileRunner.test.ts`
- Modify: `apps/server/src/localRuntimeTownProfileRunner.ts`

- [x] **Step 1: Write failing server recording test**

Add a test that passes `new InMemoryRuntimeProfileRunReportRepository()` to `runLocalRuntimeTownDaemonScenarioProfile`:

```ts
const repository = new InMemoryRuntimeProfileRunReportRepository();
const summary = await runLocalRuntimeTownDaemonScenarioProfile({
  profileId: 'smoke-25',
  rootDir,
  cycleCount: 1,
  requestedAt: 100,
  profileRunReportRepository: repository,
});
await expect(repository.get(summary.run.traceId)).resolves.toMatchObject({
  runId: summary.run.traceId,
  profileId: 'smoke-25',
  totalProjectionAgentCount: 25,
});
```

- [x] **Step 2: Run server tests and verify RED**

Run:

```bash
pnpm --filter @aivilization/server test -- localRuntimeTownProfileRunner.test.ts
```

Expected: FAIL because the runner input does not accept or record a profile run repository.

- [x] **Step 3: Implement summary-to-report mapping**

Add `@aivilization/observability` as a server dependency. Extend `LocalRuntimeTownProfileRunnerInput` with:

```ts
readonly profileRunReportRepository?: RuntimeProfileRunReportRepository;
readonly reportGeneratedAt?: number;
```

After creating the summary, call `createRuntimeProfileRunReport` and record it when a repository is supplied. Keep the local runner behavior unchanged when the repository is omitted.

- [x] **Step 4: Run server tests and verify GREEN**

Run:

```bash
pnpm --filter @aivilization/server test -- localRuntimeTownProfileRunner.test.ts
pnpm --filter @aivilization/server typecheck
```

Expected: PASS.

### Task 3: CLI Report Root Adapter

**Files:**

- Modify: `apps/server/src/localRuntimeTownProfileRunnerCli.test.ts`
- Modify: `apps/server/src/localRuntimeTownProfileRunnerCli.ts`

- [x] **Step 1: Write failing CLI parse/injection tests**

Extend the parser test with:

```ts
'--report-root-dir',
'/tmp/reports',
```

and assert:

```ts
reportRootDir: '/tmp/reports';
```

Add a CLI integration test that runs the real profile runner with a temp `--report-root-dir`, then reads `runtime-profile-runs.jsonl` with `FileRuntimeProfileRunReportRepository` and verifies one report exists for `smoke-25`.

- [x] **Step 2: Run CLI tests and verify RED**

Run:

```bash
pnpm --filter @aivilization/server test -- localRuntimeTownProfileRunnerCli.test.ts
```

Expected: FAIL because `--report-root-dir` is not parsed or injected.

- [x] **Step 3: Implement CLI adapter**

Extend `LocalRuntimeTownProfileRunnerCliConfig` with `reportRootDir?: string`. In `runLocalRuntimeTownProfileRunnerCli`, create `new FileRuntimeProfileRunReportRepository({ rootDir: config.reportRootDir })` only when `reportRootDir` is present, then pass it to `runProfile`.

- [x] **Step 4: Run CLI tests and verify GREEN**

Run:

```bash
pnpm --filter @aivilization/server test -- localRuntimeTownProfileRunnerCli.test.ts
```

Expected: PASS.

### Task 4: Verification And Commit

**Files:**

- Modify all files above.

- [x] **Step 1: Format touched files**

Run:

```bash
pnpm exec prettier --write docs/superpowers/plans/2026-06-25-profile-run-report-artifacts-slice.md packages/observability/src/runtimeProfileRunReport.ts packages/observability/src/runtimeProfileRunReport.test.ts packages/observability/src/index.ts apps/server/package.json apps/server/src/localRuntimeTownProfileRunner.ts apps/server/src/localRuntimeTownProfileRunner.test.ts apps/server/src/localRuntimeTownProfileRunnerCli.ts apps/server/src/localRuntimeTownProfileRunnerCli.test.ts
```

- [x] **Step 2: Run focused and full verification**

Run:

```bash
pnpm --filter @aivilization/observability typecheck && pnpm --filter @aivilization/observability test -- runtimeProfileRunReport.test.ts && pnpm --filter @aivilization/server typecheck && pnpm --filter @aivilization/server test -- localRuntimeTownProfileRunner.test.ts localRuntimeTownProfileRunnerCli.test.ts && pnpm lint && pnpm typecheck && pnpm test && git diff --check
```

Expected: all commands exit 0.

- [x] **Step 3: Commit**

Run:

```bash
git add docs/superpowers/plans/2026-06-25-profile-run-report-artifacts-slice.md packages/observability/src/runtimeProfileRunReport.ts packages/observability/src/runtimeProfileRunReport.test.ts packages/observability/src/index.ts apps/server/package.json apps/server/src/localRuntimeTownProfileRunner.ts apps/server/src/localRuntimeTownProfileRunner.test.ts apps/server/src/localRuntimeTownProfileRunnerCli.ts apps/server/src/localRuntimeTownProfileRunnerCli.test.ts
git commit -m "feat: persist profile run reports"
```
