# Full Replan Materialization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Materialize full top-down replanning by recompiling the active objective into a replacement durable branch plan when a worker agent cycle escalates to `full-replan`.

**Architecture:** Keep `@aivilization/agent-runtime` as the pure planning/decision layer. Add a worker orchestration boundary that observes a full-replan decision, looks up the active objective, recompiles it through `StrategicPlanCompiler`, saves a new `BranchPlanRecord` under the same objective-backed `planId`, and resets branch-plan progress so the replacement plan is selectable. `runWorkerAgentCycle` owns integration because it already composes cycle decisions, repositories, traces, and progress persistence.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, existing branch plan repositories, intention repositories, and strategic plan compiler contracts.

---

### Task 1: Worker Full-Replan Materializer

**Files:**

- Create: `apps/worker/src/objectiveReplanning.ts`
- Test: `apps/worker/src/objectiveReplanning.test.ts`
- Modify: `apps/worker/src/index.ts`

- [x] **Step 1: Write the failing materializer test**

```typescript
test('recompiles the active objective and resets progress for full replanning', async () => {
  const intentionRepository = new InMemoryAgentIntentionRepository();
  const planRepository = new InMemoryBranchPlanRepository();
  const progressRepository = new InMemoryBranchPlanProgressRepository();
  await intentionRepository.setObjective(agentId, objective);
  await planRepository.save(oldRecord);
  await progressRepository.save(blockedProgress);

  const result = await materializeFullReplanForActiveObjective({
    agentId,
    planId: objective.id,
    issuedAt: 200,
    intentionRepository,
    planRepository,
    planProgressRepository: progressRepository,
    replanningDecision: fullReplanDecision,
    strategicPlanCompiler: () => replacementPlan,
  });

  expect(result.status).toBe('replanned');
  await expect(planRepository.require({ planId: objective.id, agentId })).resolves.toMatchObject({
    planId: objective.id,
    plan: replacementPlan,
    createdAt: oldRecord.createdAt,
    updatedAt: 200,
  });
  await expect(progressRepository.get({ planId: objective.id, agentId })).resolves.toEqual({
    planId: objective.id,
    agentId,
    completedSubtaskIds: [],
    blockedSubtasks: [],
    updatedAt: 200,
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aivilization/worker test -- objectiveReplanning.test.ts`
Expected: FAIL because `objectiveReplanning.ts` and `materializeFullReplanForActiveObjective` do not exist.

- [x] **Step 3: Implement the materializer**

Create `materializeFullReplanForActiveObjective(input)` with this behavior:

- load the agent intention state;
- skip with `missing-active-objective` when no active objective exists;
- skip with `plan-id-mismatch` when the active objective id differs from the requested plan id;
- compile the active objective with `strategicPlanCompiler ?? compileStrategicObjectiveToBranchPlan`;
- normalize compiler output;
- preserve the previous plan record `createdAt` when one exists;
- save a replacement `BranchPlanRecord` with `updatedAt = issuedAt`;
- reset progress by saving `createBranchPlanProgress({ planId, agentId, createdAt: issuedAt })` when `planProgressRepository` is provided and `resetProgress !== false`.

- [x] **Step 4: Run materializer test to verify it passes**

Run: `pnpm --filter @aivilization/worker test -- objectiveReplanning.test.ts`
Expected: PASS.

### Task 2: Agent Cycle Integration

**Files:**

- Modify: `apps/worker/src/agentCycleRunner.ts`
- Test: `apps/worker/src/agentCycleRunner.test.ts`

- [x] **Step 1: Write the failing integration test**

```typescript
test('materializes a replacement plan after repository-backed full replanning', async () => {
  const repositories = createRepositories();
  const planRepository = new InMemoryBranchPlanRepository();
  const planProgressRepository = new InMemoryBranchPlanProgressRepository();
  await repositories.intentionRepository.setObjective(agentId, objective);
  await planRepository.save(oldRecord);
  await planProgressRepository.getOrCreate({ planId: objective.id, agentId, createdAt: 50 });
  await repositories.shortTermMemoryRepository.append(failureMemory);

  const result = await runWorkerAgentCycle({
    cycleId: 'cycle-materialize-full-replan',
    simulationId,
    agentId,
    issuedAt: 200,
    observedStateSummary: 'energy=0 satiety=80 health=100 education=10',
    planRepository,
    planId: objective.id,
    planProgressRepository,
    planProgressId: objective.id,
    materializeFullReplan: {
      strategicPlanCompiler: () => replacementPlan,
    },
    signals: [],
    memoryRetrievalLimit: 10,
    replanningPolicy: { consecutiveFailureThreshold: 1 },
    projection: createProjection(),
    policies,
    eventStore: new InMemoryEventStore<WorldEvent>(),
    streamName: partition.eventStreamName,
    expectedVersion: 0,
    appendIdempotencyKey: 'cycle-materialize-full-replan',
    commandIdPrefix: 'cycle-materialize-full-replan-command',
    microPlanners: [
      createStudyPlanner({
        id: 'study-1',
        description: 'study for one minute',
        commandType: 'AgentStudy',
        payload: { durationSeconds: 60, educationRatePerSecond: 1 },
      }),
    ],
    simulate: ({ action }) => ({ status: 'rejected', action, reason: 'energy too low' }),
    ...repositories,
  });

  expect(result.replanMaterialization).toMatchObject({
    status: 'replanned',
    planId: objective.id,
    agentId,
  });
});
```

- [x] **Step 2: Run integration test to verify it fails**

Run: `pnpm --filter @aivilization/worker test -- agentCycleRunner.test.ts`
Expected: FAIL because `runWorkerAgentCycle` does not accept or return full-replan materialization yet.

- [x] **Step 3: Integrate materialization in `runWorkerAgentCycle`**

Add optional `materializeFullReplan` input with `strategicPlanCompiler?: StrategicPlanCompiler` and `resetProgress?: boolean`. After progress persistence and before trace creation, when `cycleResult.replanningDecision.kind === 'full-replan'`, `input.planRepository` and `input.planId` are present, call `materializeFullReplanForActiveObjective`. Add `replanMaterialization?: WorkerFullReplanMaterializationResult` to `WorkerAgentCycleResult`.

- [x] **Step 4: Run focused tests**

Run:

- `pnpm --filter @aivilization/worker test -- objectiveReplanning.test.ts`
- `pnpm --filter @aivilization/worker test -- agentCycleRunner.test.ts`
  Expected: PASS.

### Task 3: Verification And Commit

**Files:**

- Verify all files changed in Tasks 1-2.

- [x] **Step 1: Run typecheck and formatting**

Run:

- `pnpm --filter @aivilization/worker typecheck`
- `pnpm exec prettier --check apps/worker/src/objectiveReplanning.ts apps/worker/src/objectiveReplanning.test.ts apps/worker/src/agentCycleRunner.ts apps/worker/src/agentCycleRunner.test.ts docs/superpowers/plans/2026-06-25-full-replan-materialization-slice.md`

- [x] **Step 2: Run full repository verification**

Run:

- `pnpm check`
- `git diff --check`

- [x] **Step 3: Commit**

```bash
git add docs/superpowers/plans/2026-06-25-full-replan-materialization-slice.md apps/worker/src/objectiveReplanning.ts apps/worker/src/objectiveReplanning.test.ts apps/worker/src/index.ts apps/worker/src/agentCycleRunner.ts apps/worker/src/agentCycleRunner.test.ts
git commit -m "feat(replanning): 物化 full replan 的替代计划"
```
