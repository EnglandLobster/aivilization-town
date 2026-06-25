# Canonical Replanning Policy Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire `AdaptiveReplanningPolicy` through canonical worker scheduling and profile runs so backend profiles can deliberately exercise full-replan recovery.

**Architecture:** `@aivilization/agent-runtime` already owns pure replanning policy semantics. This slice only propagates that policy through worker runtime binding, tick agent inputs, canonical resolver config, and server profile runner input. Full-replan materialization remains in worker orchestration, while profile runners can opt into a recovery policy without hard-coding planner decisions.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, agent-runtime replanning policy, worker canonical runtime, server profile runner.

---

### Task 1: Worker Scheduling Contract

**Files:**

- Modify: `apps/worker/src/agentScheduling.ts`
- Test: `apps/worker/src/agentScheduling.test.ts`

- [x] **Step 1: Write failing scheduling test**

Extend the first scheduling test with a runtime binding that includes:

```typescript
replanningPolicy: {
  consecutiveFailureThreshold: 2,
  majorContextShift: {
    key: 'profile-recovery-drill',
    reason: 'profile recovery drill requires a fresh plan',
  },
},
```

Assert:

```typescript
expect(agents[0]?.replanningPolicy).toEqual(studyRuntime.replanningPolicy);
```

- [x] **Step 2: Run scheduling test to verify RED**

Run: `pnpm --filter @aivilization/worker test -- agentScheduling.test.ts`

Expected: FAIL because `WorkerAgentRuntimeBinding` and `WorkerTickAgentInput` do not carry `replanningPolicy`.

- [x] **Step 3: Implement scheduling policy propagation**

Import `type AdaptiveReplanningPolicy` from `@aivilization/agent-runtime`, add optional `replanningPolicy` to `WorkerAgentRuntimeBinding`, and copy it into the scheduled `WorkerTickAgentInput` when present.

- [x] **Step 4: Run scheduling test to verify GREEN**

Run: `pnpm --filter @aivilization/worker test -- agentScheduling.test.ts`

Expected: PASS.

### Task 2: Tick Runner Cycle Wiring

**Files:**

- Modify: `apps/worker/src/tickRunner.ts`
- Test: `apps/worker/src/tickRunner.test.ts`

- [x] **Step 1: Write failing tick runner test**

Add a test near the full-replan materialization tests:

```typescript
test('passes agent replanning policies into cycle decisions', async () => {
  const eventStore = new InMemoryEventStore<WorldEvent>();
  const repositories = createRepositories();

  const result = await runWorkerSimulationTick({
    tickId: 'tick-agent-replanning-policy',
    simulationId,
    issuedAt: 100,
    projection: createProjection(),
    policies,
    eventStore,
    streamName: partition.eventStreamName,
    expectedVersion: 0,
    agents: [
      {
        agentId: agentOne,
        observedStateSummary: 'agent-1 needs replanning policy drill',
        plan: createStudyPlan(),
        signals: [],
        replanningPolicy: {
          consecutiveFailureThreshold: 2,
          majorContextShift: {
            key: 'policy-drill',
            reason: 'policy drill requires a replacement plan',
          },
        },
        microPlanners: [
          createStudyPlanner({
            id: 'study-agent-1',
            description: 'agent 1 studies',
            commandType: 'AgentStudy',
            payload: { durationSeconds: 60, educationRatePerSecond: 1 },
          }),
        ],
        simulate: ({ action }) => ({ status: 'accepted', action }),
      },
    ],
    ...repositories,
  });

  expect(result.agentResults[0]?.cycleResult.replanningDecision).toMatchObject({
    kind: 'full-replan',
    trigger: 'major-context-shift',
    reason: 'policy drill requires a replacement plan',
  });
});
```

- [x] **Step 2: Run tick runner test to verify RED**

Run: `pnpm --filter @aivilization/worker test -- tickRunner.test.ts`

Expected: FAIL because `WorkerTickAgentInput` is not forwarded as `replanningPolicy` to `runWorkerAgentCycle`.

- [x] **Step 3: Implement tick runner forwarding**

Import `type AdaptiveReplanningPolicy` in `tickRunner.ts`, add optional `replanningPolicy` to `WorkerTickAgentInput`, and pass it into `runWorkerAgentCycle` when present.

- [x] **Step 4: Run tick runner test to verify GREEN**

Run: `pnpm --filter @aivilization/worker test -- tickRunner.test.ts`

Expected: PASS.

### Task 3: Canonical Resolver And Profile Runner Policy

**Files:**

- Modify: `apps/worker/src/canonicalWorkerRuntimeResolver.ts`
- Test: `apps/worker/src/canonicalWorkerRuntimeResolver.test.ts`
- Modify: `apps/server/src/localRuntimeTownProfileRunner.ts`
- Test: `apps/server/src/localRuntimeTownProfileRunner.test.ts`

- [x] **Step 1: Write failing canonical resolver test**

Add a test that creates `createCanonicalWorkerRuntimeResolver({ simulationId, policies, replanningPolicy })` and asserts:

```typescript
expect(binding?.replanningPolicy).toEqual(replanningPolicy);
```

- [x] **Step 2: Run canonical resolver test to verify RED**

Run: `pnpm --filter @aivilization/worker test -- canonicalWorkerRuntimeResolver.test.ts`

Expected: FAIL because canonical resolver config does not expose replanning policy.

- [x] **Step 3: Implement canonical resolver policy binding**

Add optional `replanningPolicy?: AdaptiveReplanningPolicy` to `CanonicalWorkerRuntimeResolverConfig` and include it in the returned runtime binding when present.

- [x] **Step 4: Write failing profile runner integration test**

Add a `runLocalRuntimeTownDaemonScenarioProfile` test using:

```typescript
replanningPolicy: {
  consecutiveFailureThreshold: 2,
  majorContextShift: {
    key: 'profile-recovery-drill',
    reason: 'profile recovery drill requires a replacement plan',
  },
},
strategicPlanCompiler: ({ objective }) => ({
  plan: createBranchPlan({
    objective: objective.statement,
    branches: [
      {
        id: 'eat-recovery-drill',
        objective: 'Try an impossible eat action so the profile proves replan recovery.',
        subtasks: [
          {
            id: 'eat-without-inventory',
            description: 'eat an Apple without inventory',
            basePriority: 99,
            intentionAffinityTags: ['eat'],
          },
        ],
      },
    ],
  }),
  planningTrace: {
    status: 'deterministic',
    source: 'deterministic',
    message: 'Injected recovery drill plan',
  },
}),
```

Assert:

```typescript
expect(summary.agentCycleDiagnostics.fullReplanMaterializationCount).toBeGreaterThan(0);
expect(summary.agentCycleDiagnostics.fullReplanMaterializationRatio).toBeGreaterThan(0);
```

- [x] **Step 5: Run profile runner test to verify RED**

Run: `pnpm --filter @aivilization/server test -- localRuntimeTownProfileRunner.test.ts`

Expected: FAIL because profile runner input does not forward `replanningPolicy` into its canonical agent provider.

- [x] **Step 6: Implement profile runner policy forwarding**

Import `type AdaptiveReplanningPolicy` in `localRuntimeTownProfileRunner.ts`, add optional `replanningPolicy` to `LocalRuntimeTownProfileRunnerInput` and `createLocalRuntimeTownProfileAgentProvider` input, then pass it to `createCanonicalWorkerRuntimeResolver`.

- [x] **Step 7: Run canonical and profile tests to verify GREEN**

Run:

- `pnpm --filter @aivilization/worker test -- canonicalWorkerRuntimeResolver.test.ts`
- `pnpm --filter @aivilization/server test -- localRuntimeTownProfileRunner.test.ts`

Expected: PASS.

### Task 4: Verification And Commit

**Files:**

- Verify all files changed in Tasks 1-3 plus this plan document.

- [x] **Step 1: Run focused tests**

Run:

- `pnpm --filter @aivilization/worker test -- agentScheduling.test.ts tickRunner.test.ts canonicalWorkerRuntimeResolver.test.ts`
- `pnpm --filter @aivilization/server test -- localRuntimeTownProfileRunner.test.ts`

- [x] **Step 2: Run type and format checks**

Run:

- `pnpm --filter @aivilization/worker typecheck`
- `pnpm --filter @aivilization/server typecheck`
- `pnpm exec prettier --check docs/superpowers/plans/2026-06-25-canonical-replanning-policy-wiring-slice.md apps/worker/src/agentScheduling.ts apps/worker/src/agentScheduling.test.ts apps/worker/src/tickRunner.ts apps/worker/src/tickRunner.test.ts apps/worker/src/canonicalWorkerRuntimeResolver.ts apps/worker/src/canonicalWorkerRuntimeResolver.test.ts apps/server/src/localRuntimeTownProfileRunner.ts apps/server/src/localRuntimeTownProfileRunner.test.ts`

- [x] **Step 3: Run full repository verification**

Run:

- `pnpm check`
- `git diff --check`

- [x] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-06-25-canonical-replanning-policy-wiring-slice.md apps/worker/src/agentScheduling.ts apps/worker/src/agentScheduling.test.ts apps/worker/src/tickRunner.ts apps/worker/src/tickRunner.test.ts apps/worker/src/canonicalWorkerRuntimeResolver.ts apps/worker/src/canonicalWorkerRuntimeResolver.test.ts apps/server/src/localRuntimeTownProfileRunner.ts apps/server/src/localRuntimeTownProfileRunner.test.ts
git commit -m "feat(replanning): 打通 canonical replanning policy 注入"
```
