# Profile-Aware Strategic Plan Compilation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let long-term profile evidence participate in strategic branch-plan construction, not
only per-cycle subtask scoring.

**Architecture:** Extend `StrategicPlanCompilerInput` with optional `longTermProfile`. Keep
profile interpretation inside strategic planning and keep worker modules responsible only for
supplying the profile they already own.

**Tech Stack:** TypeScript, Vitest, pnpm workspace packages, `@aivilization/agent-runtime`,
`@aivilization/worker`.

---

### Task 1: Agent Runtime Compiler Semantics

**Files:**

- Modify: `packages/agent-runtime/src/strategicPlanning.test.ts`
- Modify: `packages/agent-runtime/src/strategicPlanning.ts`

- [x] **Step 1: Write failing test**

Add a test where a production objective plus a study-oriented long-term profile produces both
`development` and `production` branches.

- [x] **Step 2: Verify red**

Run:

```bash
pnpm --filter @aivilization/agent-runtime test -- strategicPlanning.test.ts
```

Expected: FAIL because `StrategicPlanCompilerInput` has no profile field and deterministic
compilation only reads objective text/tags.

Observed: FAIL because a production objective compiled only `production` instead of
`development` plus `production`.

- [x] **Step 3: Implement minimal deterministic profile context**

Add optional `longTermProfile`, collect high-confidence `values` and `habits` statements into the
planning text context, and let existing domain rules match against that context.

- [x] **Step 4: Verify green**

Run:

```bash
pnpm --filter @aivilization/agent-runtime test -- strategicPlanning.test.ts
```

Expected: PASS.

Observed: PASS.

### Task 2: LLM Strategic Planner Context

**Files:**

- Modify: `packages/agent-runtime/src/llmStrategicPlanner.test.ts`
- Modify: `packages/agent-runtime/src/llmStrategicPlanner.ts`

- [x] **Step 1: Write failing tests**

Assert that LLM strategic planner requests include profile context when present, and that fallback
compilers receive the same `longTermProfile`.

- [x] **Step 2: Verify red**

Run:

```bash
pnpm --filter @aivilization/agent-runtime test -- llmStrategicPlanner.test.ts
```

Expected: FAIL because LLM messages and fallback compilation currently omit profile context.

Observed: FAIL because request payloads omitted `longTermProfile` and fallback compilers received
no profile keys.

- [x] **Step 3: Pass profile context through**

Include `longTermProfile` in the planner user message and pass it through fallback compiler calls.

- [x] **Step 4: Verify green**

Run:

```bash
pnpm --filter @aivilization/agent-runtime test -- llmStrategicPlanner.test.ts
```

Expected: PASS.

Observed: PASS.

### Task 3: Worker Profile Wiring

**Files:**

- Modify: `apps/worker/src/steering.test.ts`
- Modify: `apps/worker/src/steering.ts`
- Modify: `apps/worker/src/objectiveRenewal.test.ts`
- Modify: `apps/worker/src/objectiveRenewal.ts`

- [x] **Step 1: Write failing tests**

Assert that strategic steering compilers receive the updated long-term profile and autonomous
objective renewal compilers receive the loaded long-term profile.

- [x] **Step 2: Verify red**

Run:

```bash
pnpm --filter @aivilization/worker test -- steering.test.ts objectiveRenewal.test.ts
```

Expected: FAIL because compiler calls currently pass only `objective` and `issuedAt`.

Observed: FAIL because steering and renewal custom compilers observed `undefined` profile context.

- [x] **Step 3: Pass profile through compiler inputs**

Thread optional `longTermProfile` through strategic steering plan creation and autonomous objective
renewal plan creation.

- [x] **Step 4: Verify green**

Run:

```bash
pnpm --filter @aivilization/worker test -- steering.test.ts objectiveRenewal.test.ts
```

Expected: PASS.

Observed: PASS.

### Task 4: Final Verification and Commit

**Files:**

- Verify all changed files

- [x] **Step 1: Run focused checks**

Run:

```bash
pnpm --filter @aivilization/agent-runtime test -- strategicPlanning.test.ts llmStrategicPlanner.test.ts
pnpm --filter @aivilization/worker test -- steering.test.ts objectiveRenewal.test.ts
```

Observed: PASS.

- [x] **Step 2: Run workspace checks**

Run:

```bash
pnpm check
```

Observed: PASS, including lint, typecheck, and 155 test files / 795 tests.

- [x] **Step 3: Review diff and commit**

Run `git diff --check`, review the diff, stage only this slice, and commit with a detailed Chinese
Conventional Commit message.

Observed: `git diff --check` and staged diff review passed before commit.
