# Profile Runner CLI Validation Artifact Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the headless profile runner CLI enable post-run experiment validation artifacts from the command line.

**Architecture:** Keep experiment validation generation in `runLocalRuntimeTownDaemonScenarioProfile`. The CLI only parses a boolean switch, requires a report root for planner experiment report lookup, and passes a validation schedule using the existing runtime profile report repository as `plannerRunSource`.

**Tech Stack:** TypeScript, Vitest, `@aivilization/server`, `@aivilization/observability`.

---

### Task 1: CLI Experiment Validation Switch

**Files:**

- Modify: `apps/server/src/localRuntimeTownProfileRunnerCli.ts`
- Test: `apps/server/src/localRuntimeTownProfileRunnerCli.test.ts`

- [x] **Step 1: Write the failing tests**

Add tests that parse `--experiment-validation`, require `--report-root-dir` when the switch is used, and verify the injected profile runner receives an `experimentValidationSchedule` with a `plannerRunSource` backed by the report repository.

- [x] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm vitest apps/server/src/localRuntimeTownProfileRunnerCli.test.ts --run
```

Expected RED: parser output lacks `experimentValidation`, and runner input lacks `experimentValidationSchedule`.

Observed RED: `--experiment-validation` is parsed as a value flag, so the parser rejects it before the schedule can be created.

- [x] **Step 3: Write minimal implementation**

Add `--experiment-validation` to boolean flag parsing, extend CLI config, validate that it has `--report-root-dir`, and create an `experimentValidationSchedule` with `plannerRunSource`, default pass/watch report gate, and profile-scoped report query.

- [x] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm vitest apps/server/src/localRuntimeTownProfileRunnerCli.test.ts --run
```

Expected GREEN: CLI tests pass and the feature remains an orchestration-only change.

Observed GREEN: `pnpm vitest apps/server/src/localRuntimeTownProfileRunnerCli.test.ts --run` passes with 15 tests.

## Review

- Spec coverage: makes the paper Section 5 validation path reachable from the headless runtime CLI instead of only TypeScript callers.
- Boundary: no synthetic planner metrics are invented; planner ablation evidence must come from runtime profile reports under the supplied report root.
- Remaining gap: future work should add a consolidated report manifest for full profile/gate-suite runs and wire mature OHLC window presets for long-horizon experiments.
