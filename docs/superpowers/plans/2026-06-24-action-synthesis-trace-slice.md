# Action Synthesis Trace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist action synthesis accepted/rejected evidence in `AgentCycleTrace` and let worker cycles supply synthesis policies.

**Architecture:** `@aivilization/observability` owns a serializable action synthesis trace shape. `apps/worker` passes optional synthesis policy into `@aivilization/agent-runtime` and maps the returned runtime result into trace data. Existing `candidateActions` stays as a compact accepted-action description list.

**Tech Stack:** TypeScript, Vitest, `@aivilization/agent-runtime`, `@aivilization/observability`, `apps/worker`.

---

## Scope

This slice adds:

- `AgentCycleActionResourceEstimateTrace`.
- `AgentCycleActionProposalTrace`.
- `AgentCycleActionSynthesisTrace`.
- `AgentCycleTrace.actionSynthesis`.
- Repository deep cloning for action synthesis evidence.
- Worker input `actionSynthesis?: ActionSynthesisPolicy`.
- Worker trace mapping from `cycleResult.actionSynthesisResult`.

It does not add UI rendering, derive budgets from world state, or include command payloads in trace
proposal records.

## File Structure

- Modify `packages/observability/src/agentCycleTrace.test.ts`: red test for synthesis evidence.
- Modify `packages/observability/src/agentCycleTrace.ts`: trace types and validation.
- Modify `packages/observability/src/agentCycleTraceRepository.test.ts`: clone red test.
- Modify `packages/observability/src/agentCycleTraceRepository.ts`: clone synthesis evidence.
- Modify `apps/worker/src/agentCycleRunner.test.ts`: worker policy and trace red test.
- Modify `apps/worker/src/agentCycleRunner.ts`: pass policy and map synthesis result.
- Modify this plan file as steps complete.

## Task 1: Observability Trace Schema

**Files:**

- Modify: `packages/observability/src/agentCycleTrace.test.ts`
- Modify: `packages/observability/src/agentCycleTrace.ts`

- [x] **Step 1: Write failing trace schema test**

Update the existing trace test to include:

```ts
actionSynthesis: {
  acceptedActions: [
    {
      id: 'craft-1',
      description: 'craft Transistor 1',
      commandType: 'AgentProduce',
      priority: 3,
      resourceEstimate: {
        actionSeconds: 60,
        energyCost: 4,
        inventoryCosts: { 'Iron Ingot': 1 },
      },
    },
  ],
  rejectedActions: [
    {
      action: {
        id: 'buy-fish-1',
        description: 'buy Fish 1',
        commandType: 'AgentTrade',
        priority: 1,
        resourceEstimate: { currencyCost: 10 },
      },
      reason: 'maxActions exhausted',
    },
  ],
},
```

Then assert:

```ts
expect(trace.actionSynthesis.rejectedActions[0]?.reason).toBe('maxActions exhausted');
expect(trace.actionSynthesis.acceptedActions[0]?.resourceEstimate?.inventoryCosts).toEqual({
  'Iron Ingot': 1,
});
```

Run:

```bash
pnpm --filter @aivilization/observability test -- agentCycleTrace.test.ts
```

Expected before implementation: fail because `AgentCycleTrace` lacks `actionSynthesis`.

- [x] **Step 2: Implement trace schema**

Add serializable action synthesis trace types and required `actionSynthesis` field to
`AgentCycleTrace`. Add validation that `acceptedActions.length > 0`.

## Task 2: Repository Deep Clone

**Files:**

- Modify: `packages/observability/src/agentCycleTraceRepository.test.ts`
- Modify: `packages/observability/src/agentCycleTraceRepository.ts`

- [x] **Step 3: Write failing repository clone test**

Update `createTrace` to include `actionSynthesis`. In the in-memory clone test, mutate:

```ts
(read!.actionSynthesis.acceptedActions[0]!.resourceEstimate!.inventoryCosts as Record<string, number>).Book = 999;
(read!.actionSynthesis.rejectedActions[0]!.action as { description: string }).description = 'mutated';
```

Then assert `repository.get('trace-200')` still equals the original trace.

Run:

```bash
pnpm --filter @aivilization/observability test -- agentCycleTraceRepository.test.ts
```

Expected before implementation: fail because repository clone does not copy `actionSynthesis`.

- [x] **Step 4: Implement repository cloning**

Clone accepted actions, rejected actions, priorities, and nested resource estimates including
inventory costs.

## Task 3: Worker Wiring

**Files:**

- Modify: `apps/worker/src/agentCycleRunner.test.ts`
- Modify: `apps/worker/src/agentCycleRunner.ts`

- [x] **Step 5: Write failing worker test**

Add a test where a micro-planner proposes `study` and `sleep`, `actionSynthesis: { maxActions: 1 }`
selects the higher-priority `study`, and the trace records rejected `sleep`.

Assert:

```ts
expect(simulatedActionIds).toEqual(['study-1']);
expect(result.trace.actionSynthesis.rejectedActions).toEqual([
  {
    action: {
      id: 'sleep-1',
      description: 'sleep for one minute',
      commandType: 'AgentSleep',
      priority: 1,
      resourceEstimate: { actionSeconds: 60 },
    },
    reason: 'maxActions exhausted',
  },
]);
```

Run:

```bash
pnpm --filter @aivilization/worker test -- agentCycleRunner.test.ts
```

Expected before implementation: fail because worker does not accept or trace synthesis policy.

- [x] **Step 6: Implement worker mapping**

Import `ActionSynthesisPolicy`, add optional `actionSynthesis` input, pass it into
`runAgentPlanningCycle`, and map `cycleResult.actionSynthesisResult` into `AgentCycleTrace`.

## Task 4: Verification and Commit

**Files:**

- Modify: this plan file.

- [x] **Step 7: Run targeted checks**

Run:

```bash
pnpm --filter @aivilization/observability test && pnpm --filter @aivilization/observability typecheck
pnpm --filter @aivilization/worker test && pnpm --filter @aivilization/worker typecheck
```

Expected after implementation: pass.

- [x] **Step 8: Run full checks**

Run:

```bash
pnpm check
pnpm build
```

Expected: pass.

- [x] **Step 9: Commit**

Commit docs and implementation:

```bash
git add docs/superpowers/specs/2026-06-24-action-synthesis-trace-design.md docs/superpowers/plans/2026-06-24-action-synthesis-trace-slice.md packages/observability/src apps/worker/src
git commit -m "feat: trace action synthesis decisions"
```
