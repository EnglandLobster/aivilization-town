# Canonical Full Replan Materialization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire full-replan materialization into worker tick orchestration so canonical active-plan ticks can regenerate durable plans when an agent cycle escalates to full top-down replanning.

**Architecture:** `runWorkerAgentCycle` already owns the per-cycle materialization boundary. This slice adds a tick-level option to `runWorkerSimulationTick` and `runCanonicalWorkerActivePlanTick`, then forwards it into repository-backed cycles. `agent-runtime` remains pure decision logic; worker orchestration owns repository composition and replacement-plan persistence.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, existing worker tick orchestration, branch plan repositories, progress repositories, and strategic plan compiler contracts.

---

### Task 1: Worker Tick Materialization Forwarding

**Files:**

- Modify: `apps/worker/src/tickRunner.ts`
- Test: `apps/worker/src/tickRunner.test.ts`

- [x] **Step 1: Write the failing worker tick test**

```typescript
test('materializes replacement plans during repository-backed full replanning ticks', async () => {
  const eventStore = new InMemoryEventStore<WorldEvent>();
  const repositories = createRepositories();
  const planRepository = new InMemoryBranchPlanRepository();
  const planProgressRepository = new InMemoryBranchPlanProgressRepository();
  const replacementPlan = createBranchPlan({
    objective: 'study safely',
    branches: [
      {
        id: 'recovery',
        objective: 'recover before studying',
        subtasks: [{ id: 'sleep-first', description: 'sleep before studying', basePriority: 9 }],
      },
    ],
  });

  await repositories.intentionRepository.setObjective(agentOne, {
    id: 'study-plan',
    agentId: agentOne,
    statement: 'study safely',
    priority: 8,
    source: 'agent',
    affinityTags: ['study', 'energy'],
    createdAt: 50,
    updatedAt: 50,
  });
  await planRepository.save({
    planId: 'study-plan',
    agentId: agentOne,
    plan: createStudyPlan(),
    createdAt: 50,
    updatedAt: 50,
  });
  await planProgressRepository.getOrCreate({
    planId: 'study-plan',
    agentId: agentOne,
    createdAt: 50,
  });
  await repositories.shortTermMemoryRepository.append(createStudyFailureMemory(agentOne));

  const result = await runWorkerSimulationTick({
    tickId: 'tick-materialize-replan',
    simulationId,
    issuedAt: 100,
    projection: createProjection(),
    policies,
    eventStore,
    streamName: partition.eventStreamName,
    expectedVersion: 0,
    planRepository,
    planProgressRepository,
    materializeFullReplan: {
      strategicPlanCompiler: () => replacementPlan,
    },
    agents: [
      {
        agentId: agentOne,
        observedStateSummary: 'agent-1 energy=0',
        planId: 'study-plan',
        signals: [],
        memoryRetrievalLimit: 10,
        microPlanners: [
          createStudyPlanner({
            id: 'study-agent-1',
            description: 'agent 1 studies',
            commandType: 'AgentStudy',
            payload: { durationSeconds: 60, educationRatePerSecond: 1 },
          }),
        ],
        simulate: ({ action }) => ({ status: 'rejected', action, reason: 'energy too low' }),
      },
    ],
    ...repositories,
  });

  expect(result.agentResults[0]?.replanMaterialization).toMatchObject({
    status: 'replanned',
    planId: 'study-plan',
    agentId: agentOne,
  });
  await expect(
    planRepository.require({ planId: 'study-plan', agentId: agentOne }),
  ).resolves.toMatchObject({
    plan: replacementPlan,
    updatedAt: 100,
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aivilization/worker test -- tickRunner.test.ts`
Expected: FAIL because `runWorkerSimulationTick` does not accept or forward `materializeFullReplan`.

- [x] **Step 3: Implement worker tick forwarding**

Add `materializeFullReplan?: { strategicPlanCompiler?: StrategicPlanCompiler; resetProgress?: boolean }` to the worker tick base input and pass it to `runWorkerAgentCycle` when present.

- [x] **Step 4: Run focused worker tick test**

Run: `pnpm --filter @aivilization/worker test -- tickRunner.test.ts`
Expected: PASS.

### Task 2: Canonical Active-Plan Tick Configuration

**Files:**

- Modify: `apps/worker/src/canonicalActivePlanTick.ts`
- Test: `apps/worker/src/canonicalActivePlanTick.test.ts`

- [x] **Step 1: Write the failing canonical tick test**

```typescript
test('materializes a replacement plan from canonical active-plan full replanning', async () => {
  const repositories = createRepositories();
  const planProgressRepository = new InMemoryBranchPlanProgressRepository();
  const eventStore = new InMemoryEventStore<WorldEvent>();
  const replacementPlan = createBranchPlan({
    objective: 'study safely',
    branches: [
      {
        id: 'recovery',
        objective: 'recover before studying',
        subtasks: [{ id: 'sleep-first', description: 'sleep before studying', basePriority: 9 }],
      },
    ],
  });

  await repositories.intentionRepository.setObjective(agentA, createObjective(agentA));
  await repositories.planRepository.save(createStudyPlanRecord(agentA));
  await planProgressRepository.getOrCreate({
    planId: 'objective-study',
    agentId: agentA,
    createdAt: 50,
  });
  await repositories.shortTermMemoryRepository.append(createStudyFailureMemory(agentA));

  const result = await runCanonicalWorkerActivePlanTick({
    tickId: 'tick-canonical-materialize-replan',
    simulationId,
    issuedAt: 100,
    projection: createProjection({ agents: [createAgent(agentA, { energy: 0 })] }),
    policies,
    eventStore,
    streamName: partition.eventStreamName,
    planProgressRepository,
    objectiveProposer: () => undefined,
    materializeFullReplan: {
      strategicPlanCompiler: () => replacementPlan,
    },
    ...repositories,
  });

  expect(result.agentResults[0]?.replanMaterialization).toMatchObject({
    status: 'replanned',
    planId: 'objective-study',
    agentId: agentA,
  });
  await expect(
    repositories.planRepository.require({ planId: 'objective-study', agentId: agentA }),
  ).resolves.toMatchObject({
    plan: replacementPlan,
    updatedAt: 100,
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aivilization/worker test -- canonicalActivePlanTick.test.ts`
Expected: FAIL because canonical active-plan tick does not accept or forward `materializeFullReplan`.

- [x] **Step 3: Implement canonical tick forwarding**

Add `materializeFullReplan?: { strategicPlanCompiler?: StrategicPlanCompiler; resetProgress?: boolean }` to `CanonicalWorkerActivePlanTickBaseInput` and pass it through to `runWorkerSimulationTick`.

- [x] **Step 4: Run focused canonical tick test**

Run: `pnpm --filter @aivilization/worker test -- canonicalActivePlanTick.test.ts`
Expected: PASS.

Execution note: the first canonical RED test used study plus low energy. Root-cause
debugging showed `AgentStudy` has no world-level energy gate, so the final
canonical regression uses production plus repeated production-energy failures to
exercise the real canonical action-synthesis / world dry-run failure path.

### Task 3: Verification And Commit

**Files:**

- Verify all files changed in Tasks 1-2.

- [x] **Step 1: Run typecheck and formatting**

Run:

- `pnpm --filter @aivilization/worker typecheck`
- `pnpm exec prettier --check apps/worker/src/tickRunner.ts apps/worker/src/tickRunner.test.ts apps/worker/src/canonicalActivePlanTick.ts apps/worker/src/canonicalActivePlanTick.test.ts docs/superpowers/plans/2026-06-25-canonical-full-replan-materialization-slice.md`

- [x] **Step 2: Run full repository verification**

Run:

- `pnpm check`
- `git diff --check`

- [x] **Step 3: Commit**

```bash
git add docs/superpowers/plans/2026-06-25-canonical-full-replan-materialization-slice.md apps/worker/src/tickRunner.ts apps/worker/src/tickRunner.test.ts apps/worker/src/canonicalActivePlanTick.ts apps/worker/src/canonicalActivePlanTick.test.ts
git commit -m "feat(replanning): 接入 canonical tick 的 full replan 物化"
```
