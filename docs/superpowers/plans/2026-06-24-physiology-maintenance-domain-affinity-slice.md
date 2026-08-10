# Physiology Maintenance Domain Affinity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make autonomous physiology-maintenance objectives route to the concrete recovery domain that matches the failing physiological axis, then verify low-satiety active-plan ticks execute `AgentEat` end to end.

**Architecture:** Keep objective renewal as the worker-level bridge from world state into strategic intent. Instead of giving every physiology-maintenance objective broad `health`, `energy`, and `satiety` text/tags, derive the statement and affinity tags from the actual low state: satiety -> `eat`, energy -> `sleep`, health -> `health`. The existing strategic compiler and canonical runtime then select the right domain without special-case command routing.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, `@aivilization/worker`, `@aivilization/agent-runtime`, `@aivilization/world`.

---

### Task 1: Objective Renewal Axis Tags

**Files:**

- Modify: `apps/worker/src/objectiveRenewal.test.ts`
- Modify: `apps/worker/src/objectiveRenewal.ts`

- [x] **Step 1: Write failing low-satiety tag test**

Update the hungry-agent physiology-maintenance test to expect:

```ts
expect(objective).toMatchObject({
  statement: 'Recover satiety before pursuing growth.',
  affinityTags: ['maintain', 'eat', 'satiety'],
});
```

- [x] **Step 2: Run focused worker objective renewal test and observe failure**

Run:

```bash
pnpm --filter @aivilization/worker test -- objectiveRenewal.test.ts
```

Expected: FAIL because physiology-maintenance still emits broad `['maintain', 'health', 'energy', 'satiety']` tags.

- [x] **Step 3: Implement axis-derived physiology statement and tags**

Add helpers:

```ts
function createPhysiologyMaintenanceAffinityTags(agent: WorldAgentState): readonly string[] {
  return stableUnique([
    'maintain',
    ...(agent.physiology.satiety < 30 ? ['eat', 'satiety'] : []),
    ...(agent.physiology.energy < 30 ? ['sleep', 'energy'] : []),
    ...(agent.physiology.health < 50 ? ['health'] : []),
  ]);
}

function createPhysiologyMaintenanceStatement(agent: WorldAgentState): string {
  const lowAxes = collectLowPhysiologyAxes(agent);
  if (lowAxes.length === 1) {
    return `Recover ${lowAxes[0]} before pursuing growth.`;
  }
  return 'Maintain energy, satiety, and health before pursuing growth.';
}
```

Use them for the `physiology-maintenance` candidate.

- [x] **Step 4: Verify focused objective renewal**

Run:

```bash
pnpm --filter @aivilization/worker test -- objectiveRenewal.test.ts
pnpm --filter @aivilization/worker typecheck
```

### Task 2: Active-Plan Eat Tick

**Files:**

- Modify: `apps/worker/src/canonicalActivePlanTick.test.ts`

- [x] **Step 1: Write failing end-to-end low-satiety tick test**

Add a test proving an idle hungry agent with edible inventory is renewed, planned, scheduled, and executed as `AgentEat`:

```ts
test('renews hungry idle agents and executes eating through the canonical active-plan pipeline', async () => {
  const repositories = createRepositories();
  const planProgressRepository = new InMemoryBranchPlanProgressRepository();
  const eventStore = new InMemoryEventStore<WorldEvent>();

  const result = await runCanonicalWorkerActivePlanTick({
    tickId: 'tick-renew-hungry-agent',
    simulationId,
    issuedAt: 100,
    projection: createWorldProjection({
      agents: [
        createAgent(agentA, {
          physiology: { energy: 90, satiety: 10, health: 100 },
          educationScore: 150,
          balance: 200,
          inventory: { Apple: 2 },
        }),
      ],
      marketPools: [{ commodity: 'Apple', commodityReserve: 100, currencyReserve: 1000 }],
    }),
    policies,
    eventStore,
    streamName: partition.eventStreamName,
    planProgressRepository,
    ...repositories,
  });

  expect(result.agentResults[0]?.cycleResult.selectedSubtask).toMatchObject({
    branchId: 'satiety',
    subtaskId: 'eat',
  });
  expect(result.agentResults[0]?.cycleResult.commandDrafts[0]).toMatchObject({
    type: 'AgentEat',
    payload: { commodityName: 'Apple', quantity: 1 },
  });
  expect(result.events.map((event) => event.type)).toEqual([
    'SimulationTimeAdvanced',
    'InventoryChanged',
    'PhysiologyChanged',
    'ShortTermMemoryRecorded',
  ]);
  expect(result.projection.agents[agentA]?.inventory).toEqual({ Apple: 1 });
  expect(result.projection.agents[agentA]?.physiology).toEqual({
    energy: 90,
    satiety: 20,
    health: 100,
  });
});
```

- [x] **Step 2: Run focused active-plan test and observe failure**

Run:

```bash
pnpm --filter @aivilization/worker test -- canonicalActivePlanTick.test.ts
```

Expected before Task 1 implementation: FAIL because the selected subtask is not the satiety/eat branch.

- [x] **Step 3: Verify active-plan tick after implementation**

Run:

```bash
pnpm --filter @aivilization/worker test -- canonicalActivePlanTick.test.ts
pnpm --filter @aivilization/worker typecheck
```

### Task 3: Full Verification And Commit

**Files:**

- Review changed tests, objective renewal implementation, and this plan.

- [x] **Step 1: Run full verification**

Run:

```bash
pnpm check
pnpm build
```

- [x] **Step 2: Commit**

Run:

```bash
git add docs/superpowers/plans/2026-06-24-physiology-maintenance-domain-affinity-slice.md apps/worker/src/objectiveRenewal.ts apps/worker/src/objectiveRenewal.test.ts apps/worker/src/canonicalActivePlanTick.test.ts
git commit -m "feat: route physiology maintenance by failing axis"
```
