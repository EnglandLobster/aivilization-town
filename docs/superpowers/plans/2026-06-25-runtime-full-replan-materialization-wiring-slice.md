# Runtime Full Replan Materialization Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire full top-down replanning materialization into the local runtime step so durable profile runs can regenerate replacement branch plans during normal backend execution.

**Architecture:** `runWorkerAgentCycle`, `runWorkerSimulationTick`, and `runCanonicalWorkerActivePlanTick` already own lower-level materialization. This slice connects the local runtime orchestration boundary to that capability, using the existing `strategicPlanCompiler` by default when one is configured. Agent-runtime remains pure decision logic; runtime storage owns durable repositories and tick composition.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, local runtime storage, worker tick orchestration, branch plan repositories, short-term memory repositories.

---

### Task 1: Local Runtime Step Full-Replan Materialization

**Files:**

- Modify: `apps/worker/src/localRuntimeStep.ts`
- Test: `apps/worker/src/localRuntimeStep.test.ts`

- [x] **Step 1: Write the failing local runtime regression**

Add a test that seeds an active objective, an existing durable plan, existing progress, and two recent matching failed STM records. Then run `runLocalWorldRuntimeStep` with a repository-backed `planId` agent whose simulated action fails. Pass a `strategicPlanCompiler` and assert that the runtime step materializes the replacement plan and resets progress.

```typescript
test('materializes full replans through local runtime steps', async () => {
  const storage = createLocalWorldRuntimeStorage({
    rootDir: createRootDir(),
    simulationId: 'sim-1',
    partitionKey: 'world-main',
  });
  const objective = createStudyObjective();
  const replacementPlan = createRecoveryPlan();
  await storage.intentionRepository.setObjective(agentOne, objective);
  await storage.planRepository.save({
    planId: objective.id,
    agentId: agentOne,
    plan: createStudyPlan(),
    createdAt: 100,
    updatedAt: 100,
  });
  await storage.planProgressRepository.getOrCreate({
    planId: objective.id,
    agentId: agentOne,
    createdAt: 100,
  });
  await storage.shortTermMemoryRepository.appendMany([
    createStudyFailureMemory('runtime-study-failure-1', 140),
    createStudyFailureMemory('runtime-study-failure-2', 150),
  ]);

  const result = await runLocalWorldRuntimeStep({
    storage,
    tickId: 'tick-runtime-full-replan',
    simulationId: 'sim-1',
    issuedAt: 200,
    initialProjection: createInitialProjection(),
    policies,
    commandConsumerId: 'worker-main',
    localizedPlanners: [],
    steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
    strategicPlanCompiler: ({ objective: compilerObjective, issuedAt }) => {
      expect(compilerObjective).toEqual(objective);
      expect(issuedAt).toBe(200);
      return replacementPlan;
    },
    agents: [
      {
        agentId: agentOne,
        observedStateSummary: 'agent-1 energy=0 study failure',
        planId: objective.id,
        signals: [],
        memoryRetrievalLimit: 10,
        microPlanners: [
          studyMicroPlanner({
            id: 'runtime-study-failure',
            description: 'study during runtime failure',
            commandType: 'AgentStudy',
            payload: { durationSeconds: 30, educationRatePerSecond: 1 },
          }),
        ],
        simulate: ({ action }) => ({ status: 'rejected', action, reason: 'energy too low' }),
      },
    ],
  });

  if (result.status !== 'ticked') {
    throw new Error('expected runtime step to tick');
  }
  expect(result.tick.agentResults[0]?.replanMaterialization).toMatchObject({
    status: 'replanned',
    planId: objective.id,
    agentId: agentOne,
    progressReset: true,
    trigger: 'repeated-failure',
  });
  await expect(
    storage.planRepository.require({ planId: objective.id, agentId: agentOne }),
  ).resolves.toMatchObject({ plan: replacementPlan, createdAt: 100, updatedAt: 200 });
  await expect(
    storage.planProgressRepository.get({ planId: objective.id, agentId: agentOne }),
  ).resolves.toEqual({
    planId: objective.id,
    agentId: agentOne,
    completedSubtaskIds: [],
    blockedSubtasks: [],
    updatedAt: 200,
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aivilization/worker test -- localRuntimeStep.test.ts`

Expected: FAIL because `runLocalWorldRuntimeStep` does not pass `materializeFullReplan` into `runWorkerSimulationTick`, so `result.tick.agentResults[0]?.replanMaterialization` is `undefined`.

- [x] **Step 3: Implement local runtime forwarding**

Add a helper that passes `materializeFullReplan` to `runWorkerSimulationTick`, using `input.strategicPlanCompiler` when present and otherwise allowing the worker materializer's default strategic compiler to run.

- [x] **Step 4: Run focused test**

Run: `pnpm --filter @aivilization/worker test -- localRuntimeStep.test.ts`

Expected: PASS.

### Task 2: Verification And Commit

**Files:**

- Verify all files changed in Task 1 plus this plan document.

- [x] **Step 1: Run focused type and format checks**

Run:

- `pnpm --filter @aivilization/worker typecheck`
- `pnpm exec prettier --check apps/worker/src/localRuntimeStep.ts apps/worker/src/localRuntimeStep.test.ts docs/superpowers/plans/2026-06-25-runtime-full-replan-materialization-wiring-slice.md`

- [x] **Step 2: Run full repository verification**

Run:

- `pnpm check`
- `git diff --check`

- [x] **Step 3: Commit**

```bash
git add docs/superpowers/plans/2026-06-25-runtime-full-replan-materialization-wiring-slice.md apps/worker/src/localRuntimeStep.ts apps/worker/src/localRuntimeStep.test.ts
git commit -m "feat(runtime): 接入本地运行步进的 full replan 物化"
```
