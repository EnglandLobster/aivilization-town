# Profile-Aware Full Replanning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve long-term profile context when Adaptive Re-planning escalates to full BTP
materialization.

**Architecture:** Keep profile repository reads in `runWorkerAgentCycle`, where cycle context is
already hydrated. Pass the loaded profile as optional data into the full replan materializer and
then into `StrategicPlanCompilerInput`.

**Tech Stack:** TypeScript, Vitest, pnpm workspace packages, `@aivilization/worker`,
`@aivilization/agent-runtime`.

---

### Task 1: Direct Replan Materializer Contract

**Files:**

- Modify: `apps/worker/src/objectiveReplanning.test.ts`
- Modify: `apps/worker/src/objectiveReplanning.ts`

- [x] **Step 1: Write failing test**

Add a direct materialization test that passes a long-term profile and asserts a custom strategic
compiler receives its values.

- [x] **Step 2: Verify red**

Run:

```bash
pnpm --filter @aivilization/worker test -- objectiveReplanning.test.ts
```

Expected: FAIL because `WorkerFullReplanMaterializationInput` does not accept or forward
`longTermProfile`.

- [x] **Step 3: Implement minimal passthrough**

Add optional `longTermProfile` to the materializer input and include it in the compiler call when
present.

- [x] **Step 4: Verify green**

Run:

```bash
pnpm --filter @aivilization/worker test -- objectiveReplanning.test.ts
```

Expected: PASS.

### Task 2: Agent Cycle Replan Wiring

**Files:**

- Modify: `apps/worker/src/agentCycleRunner.test.ts`
- Modify: `apps/worker/src/agentCycleRunner.ts`

- [x] **Step 1: Write failing test**

Extend the full replan materialization test to seed `longTermProfileRepository` and assert the
custom compiler receives that profile during cycle-level materialization.

- [x] **Step 2: Verify red**

Run:

```bash
pnpm --filter @aivilization/worker test -- agentCycleRunner.test.ts
```

Expected: FAIL because `runWorkerAgentCycle` currently calls the materializer without profile
context.

- [x] **Step 3: Wire loaded profile into materialization**

Pass the `longTermProfile` loaded at cycle start into `materializeFullReplanForActiveObjective`.

- [x] **Step 4: Verify green**

Run:

```bash
pnpm --filter @aivilization/worker test -- agentCycleRunner.test.ts
```

Expected: PASS.

### Task 3: Final Verification and Commit

**Files:**

- Verify all changed files

- [x] **Step 1: Run focused checks**

Run:

```bash
pnpm --filter @aivilization/worker test -- objectiveReplanning.test.ts agentCycleRunner.test.ts
```

- [x] **Step 2: Run workspace checks**

Run:

```bash
pnpm check
```

- [x] **Step 3: Review diff and commit**

Run `git diff --check`, review the diff, stage only this slice, and commit with a detailed Chinese
Conventional Commit message.

## Observed Verification

- RED: `pnpm --filter @aivilization/worker test -- objectiveReplanning.test.ts agentCycleRunner.test.ts`
  failed because both custom strategic compilers received an empty profile key list.
- GREEN: `pnpm --filter @aivilization/worker test -- objectiveReplanning.test.ts agentCycleRunner.test.ts`
  passed with 51 worker test files and 289 tests.
- FULL: `pnpm check` passed lint, typecheck, and 155 test files / 796 tests.
- DIFF: `git diff --check` passed.
