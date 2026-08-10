# Work Occupation Target Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let canonical work plans apply for occupations named in durable plan context instead of defaulting to Cleaner.

**Architecture:** `apps/worker` owns the adapter from branch-plan text to canonical action proposals. Occupation names come from the source-derived `@aivilization/content` catalog. World command simulation remains the authority for eligibility, prerequisite consumption, and assignment.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, `@aivilization/content`, `@aivilization/worker`, `@aivilization/world`.

---

### Task 1: Domain Runtime Occupation Target

**Files:**
- Modify: `apps/worker/src/canonicalDomainRuntimes.test.ts`
- Modify: `apps/worker/src/canonicalDomainRuntimes.ts`

- [x] **Step 1: Write failing domain runtime test**

Add a durable work plan whose objective/subtask says `Apply for Stock Clerk` with no work config.
Assert the canonical work proposal is `AgentApplyJob` for `Stock Clerk` and includes prerequisite
`Beef` resource estimate when the agent has Beef.

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aivilization/worker test -- canonicalDomainRuntimes.test.ts`

Expected: FAIL because current work domain applies for `Cleaner`.

- [x] **Step 3: Implement occupation resolver**

Add `resolveWorkOccupationName` using configured default first, then longest occupation-name match
from selected subtask, branch, plan, and active objective text, then `Cleaner`.

- [x] **Step 4: Attach prerequisite estimate when available**

When the resolved occupation's job tier has a prerequisite commodity and the agent currently has it,
attach `resourceEstimate.inventoryCosts`.

- [x] **Step 5: Run domain runtime test**

Run: `pnpm --filter @aivilization/worker test -- canonicalDomainRuntimes.test.ts`

Expected: PASS.

### Task 2: Active Plan Pipeline

**Files:**
- Modify: `apps/worker/src/canonicalActivePlanTick.test.ts`

- [x] **Step 1: Write failing active-plan test**

Add an active plan for Stock Clerk with an agent at residential tier 2, education score 20, and
inventory `{ Beef: 1 }`. Assert the tick applies for Stock Clerk, consumes Beef, assigns the job,
and completes the objective.

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aivilization/worker test -- canonicalActivePlanTick.test.ts`

Expected: FAIL until canonical work occupation inference is implemented.

- [x] **Step 3: Run targeted worker tests**

Run: `pnpm --filter @aivilization/worker test -- canonicalDomainRuntimes.test.ts canonicalActivePlanTick.test.ts`

Expected: PASS.

### Task 3: Verify And Commit

**Files:**
- Review: `apps/worker/src/canonicalDomainRuntimes.ts`
- Review: `apps/worker/src/canonicalActivePlanTick.test.ts`
- Review: `docs/superpowers/plans/2026-06-24-work-occupation-target-resolution-slice.md`

- [x] **Step 1: Typecheck worker**

Run: `pnpm --filter @aivilization/worker typecheck`

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
git add docs/superpowers/plans/2026-06-24-work-occupation-target-resolution-slice.md apps/worker/src/canonicalDomainRuntimes.ts apps/worker/src/canonicalDomainRuntimes.test.ts apps/worker/src/canonicalActivePlanTick.test.ts
git commit -m "feat: infer work occupations from plan context"
```
