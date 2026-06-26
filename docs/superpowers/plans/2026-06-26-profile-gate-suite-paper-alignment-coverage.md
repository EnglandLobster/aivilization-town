# Profile Gate Suite Paper Alignment Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist a paper-alignment LLM stage coverage matrix in profile gate-suite bundle manifests so every report package can show which paper cognition/planning capabilities were configured, gated, and satisfied.

**Architecture:** Keep profile execution and gate evaluation unchanged. Add a small server-owned coverage builder that derives stage requirements from `RuntimeProfileRunGateCriteria` and stage status from the existing gate result, then embed only compact, secret-free coverage metadata in the suite bundle manifest.

**Tech Stack:** TypeScript, Vitest, existing `@aivilization/server` profile gate suite and `@aivilization/observability` gate criteria.

---

### Task 1: Bundle Manifest Paper-Alignment Coverage

**Files:**

- Modify: `apps/server/src/localRuntimeTownProfileGateSuite.test.ts`
- Modify: `apps/server/src/localRuntimeTownProfileGateSuite.ts`
- Create: `apps/server/src/localRuntimeTownPaperAlignmentCoverage.ts`
- Modify: `docs/superpowers/plans/2026-06-26-profile-gate-suite-paper-alignment-coverage.md`

- [x] **Step 1: Write the failing bundle manifest test**

Add a report-backed gate-suite test using a full LLM runtime config and accepted diagnostics for all current LLM stages. Assert `bundleManifest.paperAlignment` and each profile's `paperAlignment` list all 11 paper-aligned stages, including configured counts, pass/fail counts, and stage-level requirements for accepted trace, deterministic bypass prevention, observed state, world context, economic context, memory/profile context, rules context, and output artifacts.

- [x] **Step 2: Run test to verify RED**

Run:

```bash
pnpm vitest apps/server/src/localRuntimeTownProfileGateSuite.test.ts --run
```

Expected: FAIL because bundle manifests currently do not expose paper-alignment coverage.

Observed RED: `pnpm vitest apps/server/src/localRuntimeTownProfileGateSuite.test.ts --run` failed because `result.bundleManifest?.paperAlignment` was `undefined`.

- [x] **Step 3: Implement coverage builder**

Create a server helper that maps the paper capabilities to runtime stages:

- strategic branch planning;
- daily planning;
- reaction evaluation;
- contextual prioritization;
- action sequence generation;
- social dialogue generation;
- global synthesis;
- reactive correction;
- memory-guided replanning decision;
- reflection synthesis;
- social model synthesis.

Derive requirement flags only from gate criteria and derive stage status from gate failures; do not serialize provider config or API secrets. Implemented in `apps/server/src/localRuntimeTownPaperAlignmentCoverage.ts`.

- [x] **Step 4: Embed coverage in bundle manifests**

Add profile-level and suite-level coverage summaries to `LocalRuntimeTownProfileGateSuiteBundleManifest`.

- [x] **Step 5: Verify GREEN**

Run:

```bash
pnpm vitest apps/server/src/localRuntimeTownProfileGateSuite.test.ts --run
```

Expected: PASS.

Observed GREEN: `pnpm vitest apps/server/src/localRuntimeTownProfileGateSuite.test.ts --run` passed with 15 tests.

### Task 2: Verification And Commit

**Files:**

- All touched files from Task 1.

- [x] **Step 1: Format touched files**

Run:

```bash
pnpm exec prettier --write apps/server/src/localRuntimeTownProfileGateSuite.ts apps/server/src/localRuntimeTownProfileGateSuite.test.ts apps/server/src/localRuntimeTownPaperAlignmentCoverage.ts docs/superpowers/plans/2026-06-26-profile-gate-suite-paper-alignment-coverage.md
```

- [x] **Step 2: Run project verification**

Run:

```bash
pnpm typecheck
pnpm vitest apps/server/src/localRuntimeTownProfileGateSuite.test.ts --run
git diff --check
```

Observed verification:

- `pnpm typecheck` passed.
- `pnpm lint` passed.
- `pnpm vitest apps/server/src/localRuntimeTownProfileGateSuite.test.ts apps/server/src/localRuntimeTownProfileGateSuiteCli.test.ts apps/server/src/localRuntimeTownProfileRunner.test.ts --run` passed with 39 tests.
- `git diff --check` passed.

- [ ] **Step 3: Commit**

Stage only this slice and commit with a detailed Conventional Commit message.
