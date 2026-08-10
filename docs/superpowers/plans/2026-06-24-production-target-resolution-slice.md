# Production Target Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let canonical production infer its target commodity from durable plan context when runtime config does not explicitly set one.

**Architecture:** The worker production runtime remains the integration boundary between branch-plan semantics and world commands. A single target resolver will read explicit config first, then selected subtask, branch, plan, and active objective text against the canonical content/economy catalogs; the production micro-planner and production subtask completion policy both use that resolver so action selection and progress completion cannot drift.

**Tech Stack:** TypeScript, Vitest, pnpm workspace packages, `@aivilization/content`, `@aivilization/economy`, `@aivilization/worker`.

---

### Task 1: Pin Target Inference In Domain Runtime

**Files:**
- Modify: `apps/worker/src/canonicalDomainRuntimes.test.ts`
- Modify: `apps/worker/src/canonicalDomainRuntimes.ts`

- [x] **Step 1: Write the failing test**

Add a test that builds a production plan whose branch/subtask says `Craft Book for the library.` with no `domainConfig.production.commodityName`, then expects the production planner to propose `AgentProduce` for `Book`.

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aivilization/worker test -- canonicalDomainRuntimes.test.ts`

Expected: FAIL because the production planner still defaults to `Apple`.

- [x] **Step 3: Implement target resolver**

Add `resolveProductionTargetCommodityName` in `apps/worker/src/canonicalDomainRuntimes.ts`. It must:
- Return `config.commodityName` when present.
- Search selected subtask, matching branch/subtask fields, plan objective, and active objective statement.
- Match canonical producible commodity names from content/economy with token boundaries.
- Prefer longer commodity phrases, so `Apple Pie` wins over `Apple`.
- Support simple plural text such as `chips` for `Chip`.
- Fall back to `Apple`.

- [x] **Step 4: Use resolver in production proposals**

Replace the production runtime's direct default commodity expression with `resolveProductionTargetCommodityName({ config, context, selectedSubtask })`.

- [x] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @aivilization/worker test -- canonicalDomainRuntimes.test.ts`

Expected: PASS.

### Task 2: Reuse Target In Completion Policy

**Files:**
- Modify: `apps/worker/src/canonicalActivePlanTick.test.ts`
- Modify: `apps/worker/src/canonicalWorkerRuntimeResolver.ts`

- [x] **Step 1: Write the failing integration test**

Add an active-plan tick test with a Book production objective and no production config. The first tick should produce upstream `Wood` and keep progress open; the second hydrated tick should produce `Book` and complete the objective.

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aivilization/worker test -- canonicalActivePlanTick.test.ts`

Expected: FAIL until the completion policy uses the same inferred target as the production planner.

- [x] **Step 3: Wire completion policy to resolver**

Pass the active runtime context into `createCanonicalProductionSubtaskCompletionPolicy` and resolve the target from `{ config, context, selectedSubtask }` at decision time.

- [x] **Step 4: Run targeted worker tests**

Run: `pnpm --filter @aivilization/worker test -- canonicalDomainRuntimes.test.ts canonicalActivePlanTick.test.ts`

Expected: PASS.

### Task 3: Verify And Commit

**Files:**
- Review: `apps/worker/src/canonicalDomainRuntimes.ts`
- Review: `apps/worker/src/canonicalWorkerRuntimeResolver.ts`
- Review: `docs/superpowers/plans/2026-06-24-production-target-resolution-slice.md`

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
git add docs/superpowers/plans/2026-06-24-production-target-resolution-slice.md apps/worker/src/canonicalDomainRuntimes.ts apps/worker/src/canonicalDomainRuntimes.test.ts apps/worker/src/canonicalWorkerRuntimeResolver.ts apps/worker/src/canonicalActivePlanTick.test.ts
git commit -m "feat: infer production targets from plan context"
```
