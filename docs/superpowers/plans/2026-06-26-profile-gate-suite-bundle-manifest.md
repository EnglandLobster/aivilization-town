# Profile Gate Suite Bundle Manifest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist a machine-readable bundle manifest for multi-profile gate-suite runs that indexes profile reports, validation report ids, and gate summaries.

**Architecture:** Keep runtime execution, validation math, and report storage in their existing modules. Add a server-level manifest builder in `localRuntimeTownProfileGateSuite.ts` that derives a compact, stable bundle from the already-produced suite summary and writes it under `reportRootDir` when durable reports are enabled.

**Tech Stack:** TypeScript, Vitest, Node filesystem APIs, existing `@aivilization/server` profile gate suite.

---

### Task 1: Gate Suite Bundle Manifest

**Files:**

- Modify: `apps/server/src/localRuntimeTownProfileGateSuite.ts`
- Modify: `apps/server/src/localRuntimeTownProfileGateSuite.test.ts`
- Modify: `docs/superpowers/plans/2026-06-26-profile-gate-suite-bundle-manifest.md`

- [x] **Step 1: Write the failing test**

Add a suite test that runs `runLocalRuntimeTownProfileGateSuite` with `reportRootDir`, `experimentValidation: true`, and an injected profile summary containing `experimentValidationReports`. Assert:

- `result.bundleManifest` exists;
- it has a deterministic `manifestId`, `artifactPaths`, profile report id, validation report id, gate status, and validation status counts;
- `reportRootDir/profile-gate-suite-<requestedAt>-bundle-manifest.json` exists and equals the returned manifest.

- [x] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm vitest apps/server/src/localRuntimeTownProfileGateSuite.test.ts --run
```

Expected RED: bundle manifest fields and file are missing.

Observed RED: target suite test fails because `result.bundleManifest` is undefined.

- [x] **Step 3: Write minimal implementation**

Add:

- `LocalRuntimeTownProfileGateSuiteBundleManifest`
- `LocalRuntimeTownProfileGateSuiteBundleProfile`
- `LocalRuntimeTownProfileGateSuiteBundleValidationReport`

Then build the manifest after profile gates are evaluated and write it to:

```ts
profile-gate-suite-${requestedAt}-bundle-manifest.json
```

under `reportRootDir`. Use relative artifact paths inside the manifest:

```ts
artifactPaths: {
  bundleManifest: 'profile-gate-suite-100-bundle-manifest.json',
  runtimeProfileRuns: 'runtime-profile-runs.jsonl',
}
```

- [x] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm vitest apps/server/src/localRuntimeTownProfileGateSuite.test.ts --run
```

Expected GREEN: bundle manifest is returned and persisted.

Observed GREEN: `pnpm vitest apps/server/src/localRuntimeTownProfileGateSuite.test.ts --run` passes with 14 tests.

## Review

- Spec coverage: converts multi-profile validation output into a durable experiment-package index, moving closer to paper Section 5 reproducibility.
- Boundary: manifest references existing reports and compact validation summaries; it does not duplicate full reports or invent missing OHLC/wealth evidence.
- Remaining gap: future stages should add OHLC window snapshots and wealth-distribution snapshot ids to the bundle once those durable extractors exist.
