# Job Prerequisite Commodity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce AIvilization Table 10 prerequisite commodities during job application.

**Architecture:** `@aivilization/society` resolves occupation/job-tier requirements and returns a pure application decision. `@aivilization/world` consumes prerequisite inventory through existing `InventoryChanged` events before job submission/assignment. Projection mutation remains event sourced.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, `@aivilization/content`, `@aivilization/society`, `@aivilization/world`.

---

### Task 1: Society Occupation Application Requirements

**Files:**
- Modify: `packages/society/src/occupation.ts`
- Modify: `packages/society/src/occupation-catalog.ts`
- Modify: `packages/society/src/occupation.test.ts`

- [x] **Step 1: Write failing tests**

Add tests for `evaluateOccupationApplication` proving:
- Stock Clerk requires the tier-2 minimum education score from Table 10, even though its occupation floor is 0.
- Stock Clerk requires and consumes `Beef`.
- Missing `Beef` rejects the application.

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aivilization/society test -- occupation.test.ts`

Expected: FAIL because `evaluateOccupationApplication` is not implemented.

- [x] **Step 3: Implement pure evaluator**

Resolve the occupation, resolve its job tier, compute effective education threshold as the max of
occupation dynamic/floor threshold and job-tier minimum, enforce residential tier, and return
accepted decisions with `consumedInventory` for prerequisite commodities.

- [x] **Step 4: Run society test**

Run: `pnpm --filter @aivilization/society test -- occupation.test.ts`

Expected: PASS.

### Task 2: World Job Application Consumption

**Files:**
- Modify: `packages/world/src/agentActions.ts`
- Modify: `packages/world/src/agentActions.test.ts`

- [x] **Step 1: Write failing world tests**

Add tests proving:
- Successful Stock Clerk application emits `InventoryChanged`, `JobApplicationSubmitted`,
  `JobAssigned`, and `ShortTermMemoryRecorded`.
- Missing prerequisite inventory rejects with `ActionRejected` and does not assign the job.

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aivilization/world test -- agentActions.test.ts`

Expected: FAIL because current job application ignores prerequisite commodities.

- [x] **Step 3: Use society evaluator in world handler**

Replace direct `isEligibleForOccupation` use in `handleAgentApplyJobCommand` with
`evaluateOccupationApplication`, emit prerequisite `InventoryChanged` when required, then submit and
assign the job.

- [x] **Step 4: Run world test**

Run: `pnpm --filter @aivilization/world test -- agentActions.test.ts`

Expected: PASS.

### Task 3: Verify And Commit

**Files:**
- Review: `packages/society/src/occupation.ts`
- Review: `packages/world/src/agentActions.ts`
- Review: `docs/superpowers/plans/2026-06-24-job-prerequisite-commodity-slice.md`

- [x] **Step 1: Typecheck touched packages**

Run:

```bash
pnpm --filter @aivilization/society typecheck
pnpm --filter @aivilization/world typecheck
```

Expected: PASS.

- [x] **Step 2: Run full repo checks**

Run: `pnpm check`

Expected: PASS.

- [x] **Step 3: Run build**

Run: `pnpm build`

Expected: PASS.

- [x] **Step 4: Commit**

Run:

```bash
git add docs/superpowers/plans/2026-06-24-job-prerequisite-commodity-slice.md packages/society/src/occupation.ts packages/society/src/occupation-catalog.ts packages/society/src/occupation.test.ts packages/world/src/agentActions.ts packages/world/src/agentActions.test.ts
git commit -m "feat: consume job prerequisite commodities"
```
