# Dynamic Runtime Agent Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow local runtime ticks to build agent cycle inputs dynamically from the current projection and repositories instead of freezing a static agent list at backend construction time.

**Architecture:** `apps/worker/src/localRuntimeStep.ts` owns the per-tick seam because it already hydrates projection, drains commands, and invokes `runWorkerSimulationTick`. Runtime manifest and backend registry only propagate the optional provider without learning how agents are selected. Static `agents` remain supported, and provider agents are appended after command drain so future objective renewal and canonical runtime resolution can observe the latest authoritative projection.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, existing local runtime step/lifecycle/manifest composition.

---

### Task 1: Runtime Step Provider Contract

**Files:**

- Modify: `apps/worker/src/localRuntimeStep.test.ts`
- Modify: `apps/worker/src/localRuntimeStep.ts`

- [x] **Step 1: Write failing provider step test**

Add a test proving `agentProvider` receives the post-command-drain projection and its returned agent runs in the same tick:

```ts
test('builds tick agents from a provider after command drain updates projection', async () => {
  const storage = createLocalWorldRuntimeStorage({
    rootDir: createRootDir(),
    simulationId: 'sim-1',
    partitionKey: 'world-main',
  });
  storage.commandStore.appendToStream({
    streamName: storage.partition.commandStreamName,
    expectedVersion: 0,
    idempotencyKey: 'append-command-provider',
    commands: [
      createCommandEnvelope({
        id: 'cmd-provider-study',
        simulationId: 'sim-1',
        actorId: agentOne,
        source: 'human',
        type: 'IssueReactiveCommand',
        payload: {
          reactiveCommandId: 'reactive-provider-study',
          summary: 'study before provider resolves agents',
          tags: ['study'],
        },
        issuedAt: 100,
      }),
    ],
  });
  const providerObservedEducation: number[] = [];

  const result = await runLocalWorldRuntimeStep({
    storage,
    tickId: 'tick-provider',
    simulationId: 'sim-1',
    issuedAt: 200,
    initialProjection: createInitialProjection(),
    policies,
    commandConsumerId: 'worker-main',
    localizedPlanners: [reactiveStudyPlanner()],
    steeringSimulator: ({ action }) => ({ status: 'accepted', action }),
    agents: [],
    agentProvider: ({ projection }) => {
      providerObservedEducation.push(projection.agents['agent-1']?.educationScore ?? -1);
      return [
        {
          agentId: agentOne,
          observedStateSummary: 'provider-built study agent',
          plan: createStudyPlan(),
          signals: [],
          microPlanners: [
            studyMicroPlanner({
              id: 'study-from-provider',
              description: 'study from provider',
              commandType: 'AgentStudy',
              payload: { durationSeconds: 30, educationRatePerSecond: 1 },
            }),
          ],
          simulate: ({ action }) => ({ status: 'accepted', action }),
        },
      ];
    },
  });

  expect(providerObservedEducation).toEqual([70]);
  expect(result.status).toBe('ticked');
  if (result.status !== 'ticked') {
    throw new Error('expected ticked result');
  }
  expect(result.projection.agents['agent-1']?.educationScore).toBe(100);
});
```

- [x] **Step 2: Run step test and verify RED**

Run: `pnpm --filter @aivilization/worker test -- localRuntimeStep.test.ts`

Expected: FAIL because `agentProvider` is not accepted or invoked.

- [x] **Step 3: Implement step provider contract**

Add `LocalWorldRuntimeAgentProviderInput` and `LocalWorldRuntimeAgentProvider` in `localRuntimeStep.ts`. Extend `LocalWorldRuntimeStepInput` with optional `agentProvider`, invoke it after successful command drain using `commandDrain.projection`, then pass `[...(input.agents ?? []), ...providerAgents]` to `runWorkerSimulationTick`.

- [x] **Step 4: Run step test and verify GREEN**

Run: `pnpm --filter @aivilization/worker test -- localRuntimeStep.test.ts`

Expected: PASS.

### Task 2: Manifest And Registry Propagation

**Files:**

- Modify: `apps/worker/src/localSimulationRuntimeManifest.test.ts`
- Modify: `apps/worker/src/localSimulationRuntimeManifest.ts`

- [x] **Step 1: Write failing manifest propagation test**

Add a test proving `createLocalSimulationBackendRegistryFromManifest` passes `agentProvider` into the created backend. Use a one-agent scenario, `agents: []`, and a provider that returns the same study agent from Task 1; after `startSimulation`, assert the agent education increased from 10 to 40.

- [x] **Step 2: Run manifest test and verify RED**

Run: `pnpm --filter @aivilization/worker test -- localSimulationRuntimeManifest.test.ts`

Expected: FAIL because manifest wiring drops `agentProvider`.

- [x] **Step 3: Propagate agentProvider through manifest registration**

Extend `LocalSimulationRuntimeWiringInput` with optional `agentProvider` and copy it into registrations in both manifest registration helpers.

- [x] **Step 4: Run manifest test and verify GREEN**

Run: `pnpm --filter @aivilization/worker test -- localSimulationRuntimeManifest.test.ts`

Expected: PASS.

### Task 3: Server Composition Type Surface

**Files:**

- Modify: `apps/server/src/localRuntimeTownServer.test.ts`
- Modify: `apps/server/src/localRuntimeTownServer.ts`

- [x] **Step 1: Write failing server composition test**

Add a smoke test that starts `createLocalRuntimeTownApi` or `createLocalRuntimeTownNodeHttpServer` with `agents: []` and an `agentProvider`; run one supervisor cycle and assert the provider-built agent changed projection state.

- [x] **Step 2: Run server test and verify RED**

Run: `pnpm --filter @aivilization/server test -- localRuntimeTownServer.test.ts`

Expected: FAIL until the server input type can carry the provider through the worker host input.

- [x] **Step 3: Keep server as composition only**

No server-side agent-selection logic is added. The server input type inherits the worker host input and passes all runtime wiring to `bootstrapLocalSimulationRuntimeHostFromManifest`.

- [x] **Step 4: Run server test and verify GREEN**

Run: `pnpm --filter @aivilization/server test -- localRuntimeTownServer.test.ts`

Expected: PASS.

### Task 4: Verification And Commit

**Files:**

- Modify: all files above

- [x] **Step 1: Format touched files**

Run: `pnpm exec prettier --write docs/superpowers/plans/2026-06-25-dynamic-runtime-agent-provider-slice.md apps/worker/src/localRuntimeStep.ts apps/worker/src/localRuntimeStep.test.ts apps/worker/src/localSimulationRuntimeManifest.ts apps/worker/src/localSimulationRuntimeManifest.test.ts apps/server/src/localRuntimeTownServer.ts apps/server/src/localRuntimeTownServer.test.ts`

- [x] **Step 2: Run focused and full verification**

Run: `pnpm --filter @aivilization/worker typecheck && pnpm --filter @aivilization/worker test -- localRuntimeStep.test.ts localSimulationRuntimeManifest.test.ts && pnpm --filter @aivilization/server typecheck && pnpm --filter @aivilization/server test -- localRuntimeTownServer.test.ts && pnpm lint && pnpm typecheck && pnpm test && git diff --check`

Expected: all commands exit 0.

- [x] **Step 3: Commit**

```bash
git add docs/superpowers/plans/2026-06-25-dynamic-runtime-agent-provider-slice.md apps/worker/src/localRuntimeStep.ts apps/worker/src/localRuntimeStep.test.ts apps/worker/src/localSimulationRuntimeManifest.ts apps/worker/src/localSimulationRuntimeManifest.test.ts apps/server/src/localRuntimeTownServer.ts apps/server/src/localRuntimeTownServer.test.ts
git commit -m "feat: add dynamic runtime agent provider"
```
