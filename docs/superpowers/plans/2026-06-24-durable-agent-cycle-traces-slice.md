# Durable Agent Cycle Traces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist `AgentCycleTrace` records behind an observability repository and expose the file-backed repository through local runtime storage.

**Architecture:** `@aivilization/observability` owns the trace repository interface plus in-memory and JSONL adapters. `apps/worker` local runtime storage creates the file adapter and lets callers pass it as a `traceSink`; worker cycle logic stays unchanged.

**Tech Stack:** TypeScript, Vitest, Node fs JSONL storage, `@aivilization/observability`, `apps/worker`.

---

## Scope

This slice adds durable trace storage:

- Add `AgentCycleTraceRepository`.
- Add in-memory and file-backed repository implementations.
- Export repository APIs from `@aivilization/observability`.
- Expose `agentCycleTraceRepository` from local runtime storage.
- Verify worker tick traces persist when the repository is used as `traceSink`.

It does not add UI trace panels, trace retention, candidate scoring traces, database adapters, or
batch export.

## File Structure

- Create `packages/observability/src/agentCycleTraceRepository.test.ts`: repository behavior tests.
- Create `packages/observability/src/agentCycleTraceRepository.ts`: repository contracts and adapters.
- Modify `packages/observability/src/index.ts`: export repository APIs.
- Modify `apps/worker/src/localRuntimeStorage.test.ts`: local storage persistence integration test.
- Modify `apps/worker/src/localRuntimeStorage.ts`: instantiate and expose file-backed trace repository.
- Modify this plan file as tasks complete.

## Task 1: Observability Repository Tests

**Files:**

- Create: `packages/observability/src/agentCycleTraceRepository.test.ts`

- [ ] **Step 1: Add failing in-memory repository behavior test**

Create a test helper in `packages/observability/src/agentCycleTraceRepository.test.ts`:

```ts
function createTrace(input: {
  readonly traceId: string;
  readonly simulationId?: string;
  readonly agentId?: string;
  readonly cycleStartedAt?: number;
}): AgentCycleTrace {
  return createAgentCycleTrace({
    traceId: input.traceId,
    simulationId: input.simulationId ?? 'sim-1',
    agentId: input.agentId ?? 'agent-1',
    cycleStartedAt: input.cycleStartedAt ?? 100,
    observedStateSummary: 'energy=50 satiety=80 health=100 education=10',
    selectedBranch: 'development',
    candidateActions: ['study for one minute'],
    simulatorResult: { status: 'accepted' },
    selectionEvidence: {
      selectedSubtaskId: 'study',
      intentionInfluenceScore: 0,
      memoryInfluenceScore: 0,
      profileInfluenceScore: 0,
      memoryEvidenceRecordIds: [],
      profileEntryKeys: [],
      profileEvidenceRecordIds: [],
    },
    replanningDecision: { kind: 'none' },
    emittedCommandIds: [`${input.traceId}:command-1`],
    memoryContextIds: [],
    memoryWriteIds: [`${input.traceId}:memory-1`],
  });
}
```

Add a test:

```ts
test('records and queries in-memory traces idempotently', async () => {
  const repository = new InMemoryAgentCycleTraceRepository();
  const older = createTrace({ traceId: 'trace-100', cycleStartedAt: 100 });
  const newer = createTrace({ traceId: 'trace-200', cycleStartedAt: 200 });
  const otherAgent = createTrace({
    traceId: 'trace-150-agent-2',
    agentId: 'agent-2',
    cycleStartedAt: 150,
  });
  const otherSimulation = createTrace({
    traceId: 'trace-other-simulation',
    simulationId: 'sim-2',
    cycleStartedAt: 300,
  });

  await repository.record(older);
  await repository.record(newer);
  await repository.record(otherAgent);
  await repository.record(otherSimulation);
  await repository.record({ ...newer, selectedBranch: 'duplicate-ignored' });

  await expect(repository.query({ simulationId: 'sim-1', agentId: 'agent-1' })).resolves.toEqual([
    newer,
    older,
  ]);
  await expect(repository.query({ simulationId: 'sim-1', limit: 1 })).resolves.toEqual([newer]);
  await expect(
    repository.query({
      simulationId: 'sim-1',
      fromCycleStartedAt: 120,
      toCycleStartedAt: 170,
    }),
  ).resolves.toEqual([otherAgent]);
  await expect(repository.get('missing')).resolves.toBeUndefined();

  const read = await repository.get('trace-200');
  (read!.memoryWriteIds as string[]).push('mutated');
  await expect(repository.get('trace-200')).resolves.toEqual(newer);
});
```

Run:

```bash
pnpm --filter @aivilization/observability test
```

Expected before implementation: fail because `InMemoryAgentCycleTraceRepository` does not exist.

- [ ] **Step 2: Add failing file repository persistence test**

In the same test file, add tmpdir setup and a file repository test:

```ts
const tmpRoots: string[] = [];

afterEach(() => {
  while (tmpRoots.length > 0) {
    const root = tmpRoots.pop();
    if (root !== undefined) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

function createRootDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'aivilization-agent-cycle-traces-'));
  tmpRoots.push(root);
  return root;
}

test('persists file-backed traces across repository instances', async () => {
  const rootDir = createRootDir();
  const first = new FileAgentCycleTraceRepository({ rootDir });
  const trace = createTrace({ traceId: 'trace-1', cycleStartedAt: 100 });

  await first.record(trace);
  await first.record({ ...trace, selectedBranch: 'duplicate-ignored' });

  const restarted = new FileAgentCycleTraceRepository({ rootDir });

  await expect(restarted.get('trace-1')).resolves.toEqual(trace);
  await expect(restarted.query({ simulationId: 'sim-1' })).resolves.toEqual([trace]);
  await expect(restarted.query({ simulationId: 'sim-1', limit: 0 })).rejects.toThrow(
    'limit must be positive',
  );
});
```

Run:

```bash
pnpm --filter @aivilization/observability test
```

Expected before implementation: fail because `FileAgentCycleTraceRepository` does not exist.

## Task 2: Observability Repository Implementation

**Files:**

- Create: `packages/observability/src/agentCycleTraceRepository.ts`
- Modify: `packages/observability/src/index.ts`

- [ ] **Step 3: Implement trace repository adapters**

Create `packages/observability/src/agentCycleTraceRepository.ts` with:

```ts
export type AgentCycleTraceQuery = {
  readonly simulationId: string;
  readonly agentId?: string;
  readonly fromCycleStartedAt?: number;
  readonly toCycleStartedAt?: number;
  readonly limit?: number;
};

export type AgentCycleTraceRepository = {
  readonly record: (trace: AgentCycleTrace) => Promise<void>;
  readonly get: (traceId: string) => Promise<AgentCycleTrace | undefined>;
  readonly query: (query: AgentCycleTraceQuery) => Promise<AgentCycleTrace[]>;
};
```

Implement `InMemoryAgentCycleTraceRepository` with a private `Map<string, AgentCycleTrace>`.
Implement `FileAgentCycleTraceRepository` with JSONL file `agent-cycle-traces.jsonl`.

Both adapters must:

- call `cloneTrace` at write and read boundaries;
- ignore duplicate `traceId` records;
- return query results sorted by `cycleStartedAt` descending and `traceId` descending;
- reject `limit <= 0` with `limit must be positive`;
- reject empty `simulationId`, `traceId`, and `rootDir`.

- [ ] **Step 4: Export repository APIs**

Modify `packages/observability/src/index.ts`:

```ts
export * from './agentCycleTrace';
export * from './agentCycleTraceRepository';
```

Run:

```bash
pnpm --filter @aivilization/observability test
pnpm --filter @aivilization/observability typecheck
```

Expected after implementation: both pass.

## Task 3: Local Runtime Storage Tests

**Files:**

- Modify: `apps/worker/src/localRuntimeStorage.test.ts`

- [ ] **Step 5: Add failing local trace repository integration test**

Add a test in `apps/worker/src/localRuntimeStorage.test.ts`:

```ts
test('persists worker tick traces through local trace repository storage', async () => {
  const rootDir = createRootDir();
  const storage = createLocalWorldRuntimeStorage({
    rootDir,
    simulationId,
    partitionKey: 'world-main',
  });

  await runWorkerSimulationTick({
    tickId: 'tick-trace',
    simulationId,
    issuedAt: 100,
    projection: createProjection(),
    policies,
    eventStore: storage.eventStore,
    streamName: storage.partition.eventStreamName,
    expectedVersion: 0,
    agents: [createTickAgents()[0]!],
    traceSink: storage.agentCycleTraceRepository,
    ...storage.repositories,
  });

  const restarted = createLocalWorldRuntimeStorage({
    rootDir,
    simulationId,
    partitionKey: 'world-main',
  });

  expect(storage.paths.observabilityDir).toContain('observability');
  await expect(restarted.agentCycleTraceRepository.query({ simulationId })).resolves.toMatchObject([
    {
      traceId: 'tick-trace:cycle:1:agent-1',
      simulationId: 'sim-1',
      agentId: 'agent-1',
      selectedBranch: 'development',
      selectionEvidence: {
        selectedSubtaskId: 'study',
      },
    },
  ]);
});
```

Run:

```bash
pnpm --filter @aivilization/worker test
```

Expected before implementation: fail because `agentCycleTraceRepository` and
`observabilityDir` are not exposed by local storage.

## Task 4: Local Runtime Storage Implementation

**Files:**

- Modify: `apps/worker/src/localRuntimeStorage.ts`

- [ ] **Step 6: Expose file-backed trace repository from local storage**

Modify `apps/worker/src/localRuntimeStorage.ts`:

- import `FileAgentCycleTraceRepository` from `@aivilization/observability`;
- add `observabilityDir` to `LocalWorldRuntimeStoragePaths`;
- add `agentCycleTraceRepository` to `LocalWorldRuntimeStorage`;
- instantiate `new FileAgentCycleTraceRepository({ rootDir: paths.observabilityDir })`;
- return it from `createLocalWorldRuntimeStorage`.

Run:

```bash
pnpm --filter @aivilization/worker test
pnpm --filter @aivilization/worker typecheck
```

Expected after implementation: both pass.

## Task 5: Verification And Commit

**Files:**

- Modify: this plan file

- [ ] **Step 7: Run focused verification**

Run:

```bash
pnpm --filter @aivilization/observability test
pnpm --filter @aivilization/observability typecheck
pnpm --filter @aivilization/worker test
pnpm --filter @aivilization/worker typecheck
```

- [ ] **Step 8: Run repo verification**

Run:

```bash
pnpm check
pnpm build
```

- [ ] **Step 9: Commit implementation**

Commit command:

```bash
git add docs/superpowers/plans/2026-06-24-durable-agent-cycle-traces-slice.md packages/observability/src/agentCycleTraceRepository.test.ts packages/observability/src/agentCycleTraceRepository.ts packages/observability/src/index.ts apps/worker/src/localRuntimeStorage.test.ts apps/worker/src/localRuntimeStorage.ts
git commit -m "feat: persist agent cycle traces"
```
