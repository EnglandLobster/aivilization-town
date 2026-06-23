# Strategic Domain Branch Compiler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compile long-horizon objectives into explicit executable domain branches instead of a generic primary objective branch when the objective text already names supported town domains.

**Architecture:** `@aivilization/agent-runtime` owns deterministic strategic decomposition, but it remains content-catalog independent. The compiler recognizes domain intent and preserves target text for downstream worker domain runtimes to resolve against content catalogs.

**Tech Stack:** TypeScript, Vitest, `@aivilization/agent-runtime`, `apps/worker`.

---

### Task 1: Strategic Compiler Tests

**Files:**
- Modify: `packages/agent-runtime/src/strategicPlanning.test.ts`

- [x] **Step 1: Write failing domain branch tests**

Assert that a complex objective mentioning residential readiness, Stock Clerk work, and Chip production
compiles to explicit `residential`, `work`, and `production` branches, preserves the original objective
text in subtask descriptions, and does not emit `primary-objective`.

- [x] **Step 2: Run focused agent-runtime test**

Run: `pnpm --filter @aivilization/agent-runtime test -- strategicPlanning.test.ts`

Expected: FAIL before implementation because the compiler only emits `primary-objective` plus older
study/wellbeing branches.

### Task 2: Compiler Implementation

**Files:**
- Modify: `packages/agent-runtime/src/strategicPlanning.ts`

- [x] **Step 1: Introduce domain rule table**

Represent domain detection through data-driven rules with stable branch ids, subtask ids, keywords,
aliases, priorities, and text factories.

- [x] **Step 2: Emit explicit executable branches**

Generate branches for recognized `study`, `residential`, `work`, `production`, `sleep`, `trade`, and
`social` domains. Keep affinity tags domain-scoped so one subtask does not accidentally support every
domain named by the objective.

- [x] **Step 3: Preserve generic fallback only for unknown goals**

Only emit `primary-objective` when no executable domain branch was recognized.

### Task 3: Worker Expectations

**Files:**
- Modify: `apps/worker/src/steering.test.ts`

- [x] **Step 1: Update old branch-shape assertions**

Update assertions that expected `primary-objective` for study objectives so they reflect the explicit
domain branch compiler contract.

### Task 4: Verify And Commit

**Files:**
- Review: `packages/agent-runtime/src/strategicPlanning.ts`
- Review: `packages/agent-runtime/src/strategicPlanning.test.ts`
- Review: `apps/worker/src/steering.test.ts`
- Review: this plan file

- [x] **Step 1: Run focused tests and typechecks**

Run:

```bash
pnpm --filter @aivilization/agent-runtime test -- strategicPlanning.test.ts
pnpm --filter @aivilization/worker test -- steering.test.ts
pnpm --filter @aivilization/agent-runtime typecheck
pnpm --filter @aivilization/worker typecheck
```

- [x] **Step 2: Run full verification**

Run:

```bash
pnpm check
pnpm build
```

- [x] **Step 3: Commit**

Run:

```bash
git add docs/superpowers/plans/2026-06-24-strategic-domain-branch-compiler-slice.md packages/agent-runtime/src/strategicPlanning.ts packages/agent-runtime/src/strategicPlanning.test.ts apps/worker/src/steering.test.ts
git commit -m "feat: compile strategic objectives into domain branches"
```
