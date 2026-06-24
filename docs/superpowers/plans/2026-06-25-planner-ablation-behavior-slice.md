# Planner Ablation Behavior Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the default `without-branch` planner ablation variant change strategic planning behavior through a typed compiler boundary.

**Architecture:** Keep runtime behavior behind the existing `StrategicPlanCompiler` interface. The profile runner accepts an explicit compiler override, while the ablation suite owns experiment variant composition and provides a deterministic single-branch compiler with provenance trace.

**Tech Stack:** TypeScript, Vitest, pnpm workspace, file-backed runtime profile repositories.

---

### Task 1: Runner Compiler Override

**Files:**
- Modify: `apps/server/src/localRuntimeTownProfileRunner.ts`
- Test: `apps/server/src/localRuntimeTownProfileRunner.test.ts`

- [ ] **Step 1: Write the failing test**

Add a profile runner test that passes `strategicPlanCompiler` directly and asserts the saved branch plan, selected branch, and objective renewal trace all come from the injected compiler.

- [ ] **Step 2: Run the focused test to verify RED**

Run: `pnpm vitest run apps/server/src/localRuntimeTownProfileRunner.test.ts -t "uses an injected strategic plan compiler"`
Expected: FAIL because `LocalRuntimeTownProfileRunnerInput` does not accept or forward `strategicPlanCompiler`.

- [ ] **Step 3: Write minimal implementation**

Add `strategicPlanCompiler?: StrategicPlanCompiler` to `LocalRuntimeTownProfileRunnerInput` and prefer it over profile LLM planning when `agentProvider` is not supplied.

- [ ] **Step 4: Run the focused test to verify GREEN**

Run: `pnpm vitest run apps/server/src/localRuntimeTownProfileRunner.test.ts -t "uses an injected strategic plan compiler"`
Expected: PASS.

### Task 2: Without-Branch Ablation Variant

**Files:**
- Modify: `apps/server/src/localRuntimeTownPlannerAblationSuite.ts`
- Test: `apps/server/src/localRuntimeTownPlannerAblationSuite.test.ts`

- [ ] **Step 1: Write the failing test**

Add a suite test that captures profile runner inputs and asserts the default variant has no explicit compiler while `without-branch` receives a compiler whose normalized output has branch id `without-branch`, subtask id `pursue-objective`, and a deterministic trace message.

- [ ] **Step 2: Run the focused test to verify RED**

Run: `pnpm vitest run apps/server/src/localRuntimeTownPlannerAblationSuite.test.ts -t "wires default without-branch"`
Expected: FAIL because suite variants currently only pass labels.

- [ ] **Step 3: Write minimal implementation**

Create `createLocalRuntimeTownWithoutBranchStrategicPlanCompiler()` in the suite module and attach it when composing the built-in `without-branch` variant.

- [ ] **Step 4: Run the focused test to verify GREEN**

Run: `pnpm vitest run apps/server/src/localRuntimeTownPlannerAblationSuite.test.ts -t "wires default without-branch"`
Expected: PASS.

### Task 3: Verification and Commit

**Files:**
- Verify all changed tests and workspace checks.

- [ ] **Step 1: Run focused tests**

Run:
`pnpm vitest run apps/server/src/localRuntimeTownProfileRunner.test.ts apps/server/src/localRuntimeTownPlannerAblationSuite.test.ts`

- [ ] **Step 2: Run full verification**

Run:
`pnpm typecheck`
`pnpm lint`
`pnpm test`
`git diff --check`

- [ ] **Step 3: Commit**

Run:
`git add apps/server/src/localRuntimeTownProfileRunner.ts apps/server/src/localRuntimeTownProfileRunner.test.ts apps/server/src/localRuntimeTownPlannerAblationSuite.ts apps/server/src/localRuntimeTownPlannerAblationSuite.test.ts docs/superpowers/plans/2026-06-25-planner-ablation-behavior-slice.md`
`git commit -m "feat: make planner ablations alter strategy"`
