# Complex Objective Residential Target Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let canonical active plans repeatedly upgrade residential tier until the tier required by named jobs or production targets is reached, so complex town objectives can execute end to end.

**Architecture:** Worker canonical domain runtimes remain the content-aware adapter layer. The world keeps the invariant that residential upgrades advance exactly one tier at a time. The worker infers the long-horizon target tier from durable plan context, issues one valid upgrade action per tick, and marks the residential subtask complete only after the inferred target tier is reached.

**Tech Stack:** TypeScript, Vitest, `@aivilization/content`, `@aivilization/worker`, `@aivilization/world`.

---

### Task 1: End-To-End Red Test

**Files:**

- Modify: `apps/worker/src/canonicalActivePlanTick.test.ts`

- [x] **Step 1: Write failing complex objective test**

Add a test that sends `SetLongHorizonObjective` for:

`Upgrade residential tier, apply for Stock Clerk work, then craft Chip for the electronics market.`

Start the agent at residential tier 1 with enough balance, education, physiology, and one Beef. Run
canonical active-plan ticks through projection hydration until the objective completes. Assert:

- residential upgrades reach tier 5 one tier at a time;
- Stock Clerk application consumes Beef and assigns the job;
- production eventually creates Chip;
- plan progress includes residential, work, and production subtasks;
- the active objective is moved to completed objectives.

- [x] **Step 2: Run focused test and observe failure**

Run: `pnpm --filter @aivilization/worker test -- canonicalActivePlanTick.test.ts`

Expected: FAIL because the current residential subtask completes after one upgrade to tier 2, then Chip
production cannot pass the residential tier gate.

### Task 2: Residential Target Inference

**Files:**

- Modify: `apps/worker/src/canonicalDomainRuntimes.ts`
- Modify: `apps/worker/src/canonicalDomainRuntimes.test.ts`

- [x] **Step 1: Add focused domain runtime test**

Assert a residential proposal for a plan mentioning `Chip` targets the next valid tier from the
current tier, and that the inferred long-horizon target is tier 5.

- [x] **Step 2: Implement target resolver**

Add a content-aware resolver that scans selected subtask, branch, plan, and objective text for
commodity and occupation names, then returns the maximum residential tier required by those targets
or the configured/default next tier.

- [x] **Step 3: Use resolver for residential proposal**

Keep command payload as `current residentialTier + 1` until the inferred target is reached, because
world upgrade rules intentionally reject tier jumps.

### Task 3: Completion Policy

**Files:**

- Modify: `apps/worker/src/canonicalWorkerRuntimeResolver.ts`

- [x] **Step 1: Replace production-only completion policy**

Create a canonical completion policy that handles both:

- production subtasks: stay in-progress while upstream materials are produced;
- residential subtasks: stay in-progress while the accepted upgrade target is below the inferred
  residential target.

### Task 4: Verify And Commit

**Files:**

- Review changed source/tests and this plan.

- [x] **Step 1: Focused verification**

Run:

```bash
pnpm --filter @aivilization/worker test -- canonicalDomainRuntimes.test.ts canonicalActivePlanTick.test.ts
pnpm --filter @aivilization/worker typecheck
```

- [x] **Step 2: Full verification**

Run:

```bash
pnpm check
pnpm build
```

- [x] **Step 3: Commit**

Run:

```bash
git add docs/superpowers/plans/2026-06-24-complex-objective-residential-target-slice.md apps/worker/src/canonicalDomainRuntimes.ts apps/worker/src/canonicalDomainRuntimes.test.ts apps/worker/src/canonicalWorkerRuntimeResolver.ts apps/worker/src/canonicalActivePlanTick.test.ts
git commit -m "feat: infer residential targets for complex objectives"
```
