# Strategic Plan Provenance Record Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist strategic plan compilation provenance on durable branch plan records so LLM-generated and fallback plans remain auditable after worker restarts.

**Architecture:** Keep compiler execution behind the existing `StrategicPlanCompiler` contract. Extend `BranchPlanRecord` with optional `planningTrace`, clone it inside the repository boundary, and populate it from normalized compiler output in both autonomous objective renewal and human steering. Objective renewal keeps its existing observability trace; the durable plan record becomes the source of truth for plan-generation provenance.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, existing `@aivilization/agent-runtime` repositories and worker steering/objective renewal flows.

---

## File Structure

- Modify `packages/agent-runtime/src/branchPlanRepository.ts`: add optional `planningTrace` to `BranchPlanRecord` and defensively clone it.
- Modify `packages/agent-runtime/src/branchPlanRepository.test.ts`: prove in-memory and file repositories preserve optional provenance.
- Modify `apps/worker/src/steering.ts`: save normalized compiler `planningTrace` onto human-set objective plan records.
- Modify `apps/worker/src/steering.test.ts`: prove `SetLongHorizonObjective` stores traceable compiler evidence.
- Modify `apps/worker/src/objectiveRenewal.ts`: save normalized compiler `planningTrace` onto autonomous renewal plan records.
- Modify `apps/worker/src/objectiveRenewal.test.ts`: prove renewed branch plan records also persist traceable compiler evidence.

## Task 1: Branch Plan Record Provenance

**Files:**

- Modify: `packages/agent-runtime/src/branchPlanRepository.ts`
- Test: `packages/agent-runtime/src/branchPlanRepository.test.ts`

- [x] **Step 1: Write failing repository tests**

Add a test that saves a plan record containing:

```ts
planningTrace: {
  status: 'accepted',
  source: 'llm',
  requestId: 'request-1',
  providerId: 'scripted-provider',
  model: 'planner-model',
  attempts: [
    {
      attemptIndex: 1,
      status: 'succeeded',
      providerId: 'scripted-provider',
      model: 'planner-model',
      message: 'LLM structured response validated',
      usage: {
        inputTokens: 1,
        outputTokens: 2,
        totalTokens: 3,
        estimatedCostMicros: 4,
      },
    },
  ],
  usage: {
    inputTokens: 1,
    outputTokens: 2,
    totalTokens: 3,
    estimatedCostMicros: 4,
  },
}
```

Assert both `InMemoryBranchPlanRepository` and `FileBranchPlanRepository` return the trace after save/read, and that repeated reads are defensive clones.

- [x] **Step 2: Verify RED**

Run:

```bash
pnpm --filter @aivilization/agent-runtime test -- branchPlanRepository.test.ts
```

Expected before implementation: FAIL because `BranchPlanRecord` does not expose or clone `planningTrace`.

- [x] **Step 3: Implement optional provenance on records**

Change:

```ts
export type BranchPlanRecord = {
  readonly planId: string;
  readonly agentId: AgentId;
  readonly plan: BranchPlan;
  readonly planningTrace?: StrategicPlanCompilationTrace;
  readonly createdAt: number;
  readonly updatedAt: number;
};
```

Import `StrategicPlanCompilationTrace` from `./strategicPlanning` and add a `clonePlanningTrace` helper that copies attempts and usage objects.

- [x] **Step 4: Verify GREEN**

Run:

```bash
pnpm --filter @aivilization/agent-runtime test -- branchPlanRepository.test.ts
```

Expected after implementation: PASS.

## Task 2: Worker Steering Provenance

**Files:**

- Modify: `apps/worker/src/steering.ts`
- Test: `apps/worker/src/steering.test.ts`

- [x] **Step 1: Write failing steering test**

Add a `SetLongHorizonObjective` test where `strategicPlanCompiler` returns:

```ts
{
  plan: createBranchPlan({
    objective: objective.statement,
    branches: [
      {
        id: 'llm-development',
        objective: 'Use an LLM-proposed steering route.',
        subtasks: [{ id: 'study', description: 'Study via steering LLM plan.', basePriority: 12 }],
      },
    ],
  }),
  planningTrace: createPlanningTrace(),
}
```

Assert `result.planRecord?.planningTrace` and the repository `require(...)` result both include `requestId: 'steering-llm-plan-objective-study'`.

- [x] **Step 2: Verify RED**

Run:

```bash
pnpm --filter @aivilization/worker test -- steering.test.ts
```

Expected before implementation: FAIL because steering normalizes compiler output but drops `planningTrace`.

- [x] **Step 3: Save trace on steering plan records**

In `createAndSaveStrategicPlanRecord`, include:

```ts
...(compiled.planningTrace === undefined ? {} : { planningTrace: compiled.planningTrace }),
```

inside the saved `BranchPlanRecord`.

- [x] **Step 4: Verify GREEN**

Run:

```bash
pnpm --filter @aivilization/worker test -- steering.test.ts
```

Expected after implementation: PASS.

## Task 3: Objective Renewal Provenance

**Files:**

- Modify: `apps/worker/src/objectiveRenewal.ts`
- Test: `apps/worker/src/objectiveRenewal.test.ts`

- [x] **Step 1: Write failing objective renewal assertion**

Extend the existing traceable compiler test to expect the saved plan record to include:

```ts
planningTrace: {
  status: 'accepted',
  source: 'llm',
  requestId: 'llm-plan-objective-from-llm-compiler',
}
```

- [x] **Step 2: Verify RED**

Run:

```bash
pnpm --filter @aivilization/worker test -- objectiveRenewal.test.ts
```

Expected before implementation: FAIL because autonomous renewal stores planning trace only in the decision trace.

- [x] **Step 3: Save trace on renewed plan records**

In `createStrategicPlanRecord`, include `planningTrace` in the returned record when normalized compiler output contains it.

- [x] **Step 4: Verify GREEN**

Run:

```bash
pnpm --filter @aivilization/worker test -- objectiveRenewal.test.ts
```

Expected after implementation: PASS.

## Task 4: Verification and Commit

**Files:**

- All files above.

- [x] **Step 1: Format changed files**

Run:

```bash
pnpm exec prettier --write docs/superpowers/plans/2026-06-25-strategic-plan-provenance-record-slice.md packages/agent-runtime/src/branchPlanRepository.ts packages/agent-runtime/src/branchPlanRepository.test.ts apps/worker/src/steering.ts apps/worker/src/steering.test.ts apps/worker/src/objectiveRenewal.ts apps/worker/src/objectiveRenewal.test.ts
```

- [x] **Step 2: Run focused tests**

Run:

```bash
pnpm --filter @aivilization/agent-runtime test -- branchPlanRepository.test.ts
pnpm --filter @aivilization/worker test -- steering.test.ts objectiveRenewal.test.ts
```

- [x] **Step 3: Run package and repo checks**

Run:

```bash
pnpm --filter @aivilization/agent-runtime typecheck
pnpm --filter @aivilization/worker typecheck
pnpm lint
pnpm typecheck
pnpm test
git diff --check
```

- [x] **Step 4: Commit**

Run:

```bash
git add docs/superpowers/plans/2026-06-25-strategic-plan-provenance-record-slice.md packages/agent-runtime/src/branchPlanRepository.ts packages/agent-runtime/src/branchPlanRepository.test.ts apps/worker/src/steering.ts apps/worker/src/steering.test.ts apps/worker/src/objectiveRenewal.ts apps/worker/src/objectiveRenewal.test.ts
git commit -m "feat: persist strategic plan provenance"
```
