# Production Chain Worker Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let canonical production plans execute recipe-chain upstream steps across ticks without prematurely completing the parent production subtask.

**Architecture:** `@aivilization/agent-runtime` gains an optional subtask completion policy with default old behavior. `apps/worker` forwards the policy from runtime bindings to agent cycles. Canonical production uses `planProductionChain` to propose the next executable step and supplies a completion policy that completes only when the target commodity action succeeds.

**Tech Stack:** TypeScript, Vitest, `@aivilization/agent-runtime`, `@aivilization/economy`, `@aivilization/worker`, `@aivilization/world`.

---

## Scope

This slice adds:

- `CycleSubtaskCompletionPolicy` and completion decisions.
- Worker plumbing for runtime-provided completion policies.
- Chain-aware canonical production proposals.
- Active-plan integration coverage for `Wood -> Book` across two ticks.

It does not add UI, LLM planning, market-buy fallback, or full chip benchmark runners.

## File Structure

- Modify `packages/agent-runtime/src/cycle.ts`: add completion policy input and result field.
- Modify `packages/agent-runtime/src/replanning.ts`: gate progress completion on completion decision.
- Modify `packages/agent-runtime/src/cycle.test.ts`: red/green tests for in-progress completion.
- Modify `apps/worker/src/agentScheduling.ts`: add completion policy to runtime binding and scheduled agents.
- Modify `apps/worker/src/tickRunner.ts`: pass completion policy into cycles.
- Modify `apps/worker/src/agentCycleRunner.ts`: accept and forward completion policy.
- Modify `apps/worker/src/canonicalDomainRuntimes.ts`: call `planProductionChain` for production next-step proposals.
- Modify `apps/worker/src/canonicalWorkerRuntimeResolver.ts`: attach canonical production completion policy.
- Modify `apps/worker/src/canonicalActivePlanTick.test.ts`: two-tick chain execution integration.

## Task 1: Agent Runtime Completion Policy

- [x] **Step 1: Write failing cycle test**

Add a test to `packages/agent-runtime/src/cycle.test.ts` proving a successful action can leave a
progress-tracked subtask in progress:

```ts
expect(result.subtaskCompletionDecision).toEqual({
  status: 'in-progress',
  reason: 'produced upstream material Wood for target Book',
});
expect(result.progressUpdate).toBeUndefined();
```

Run:

```bash
pnpm --filter @aivilization/agent-runtime test -- cycle.test.ts
```

Expected: FAIL because `subtaskCompletion` is not supported.

- [x] **Step 2: Implement completion policy**

Add:

```ts
export type SubtaskCompletionDecision =
  | { readonly status: 'completed' }
  | { readonly status: 'in-progress'; readonly reason: string };

export type CycleSubtaskCompletionPolicy = (input: {
  readonly selectedSubtask: PrioritizedSubtask;
  readonly simulationResults: readonly ActionWithRepairResult[];
}) => SubtaskCompletionDecision;
```

Add `subtaskCompletion?: CycleSubtaskCompletionPolicy` to `runAgentPlanningCycle`, expose
`subtaskCompletionDecision` on `AgentCycleResult`, and update progress only when completion status
is `completed`.

- [x] **Step 3: Verify agent runtime**

Run:

```bash
pnpm --filter @aivilization/agent-runtime test -- cycle.test.ts
pnpm --filter @aivilization/agent-runtime typecheck
```

Expected: PASS.

## Task 2: Worker Plumbing

- [x] **Step 4: Forward completion policy through worker inputs**

Add `subtaskCompletion?: CycleSubtaskCompletionPolicy` to:

- `WorkerAgentRuntimeBinding`
- `WorkerTickAgentInput`
- `runWorkerAgentCycle` input

Forward the value through `buildWorkerTickAgentsFromActivePlans`, `runWorkerSimulationTick`, and
`runWorkerAgentCycle`.

- [x] **Step 5: Run worker typecheck**

Run:

```bash
pnpm --filter @aivilization/worker typecheck
```

Expected: PASS.

## Task 3: Chain-Aware Canonical Production

- [x] **Step 6: Write failing active-plan chain integration test**

Add a test that:

- configures canonical production target `Book`;
- starts with empty inventory;
- runs tick 1 with a progress repository and expects `AgentProduce(Wood)`;
- confirms the production subtask is not completed after tick 1;
- runs tick 2 from hydrated projection;
- expects `AgentProduce(Book)`;
- confirms the objective completes after tick 2.

Run:

```bash
pnpm --filter @aivilization/worker test -- canonicalActivePlanTick.test.ts
```

Expected: FAIL because production still proposes direct `Book` or completes after upstream action.

- [x] **Step 7: Implement canonical production chain proposal and completion**

In `canonicalDomainRuntimes.ts`, call `planProductionChain`. If accepted, use the first step for
the proposal payload and resource estimate. If rejected, keep the direct target proposal fallback.

In `canonicalWorkerRuntimeResolver.ts`, attach a production completion policy that leaves matching
production subtasks in progress until an accepted or repaired `AgentProduce` action produces the
configured target commodity.

- [x] **Step 8: Verify worker chain behavior**

Run:

```bash
pnpm --filter @aivilization/worker test -- canonicalActivePlanTick.test.ts canonicalDomainRuntimes.test.ts
pnpm --filter @aivilization/worker typecheck
```

Expected: PASS.

## Task 4: Full Verification and Commit

- [x] **Step 9: Run full checks**

Run:

```bash
pnpm check
pnpm build
```

Expected: PASS.

- [ ] **Step 10: Commit**

Run:

```bash
git add packages/agent-runtime/src apps/worker/src docs/superpowers/specs/2026-06-24-production-chain-worker-execution-design.md docs/superpowers/plans/2026-06-24-production-chain-worker-execution-slice.md
git commit -m "feat: execute production chains across ticks"
```

## Self-Review

- Spec coverage: The tasks cover completion semantics, worker plumbing, chain proposal, two-tick
  integration, and full verification.
- Placeholder scan: No placeholder markers remain.
- Type consistency: Completion policy names and result shapes match across runtime, worker, and
  tests.
