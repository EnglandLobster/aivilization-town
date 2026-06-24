# Recent Hunger Recovery Affinity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route recent hunger/satiety failure memories into the `eat` recovery path instead of only generic health/energy recovery.

**Architecture:** Keep objective renewal in `apps/worker`, where STM context and world state meet. Preserve existing recent-setback scoring and decision trace shape, but derive candidate affinity tags from the strongest failed memory evidence so downstream strategic planning can choose `eat`, `sleep`, or `health` domains through existing tag matching. Narrow the health strategic rule so generic `recover` does not pull non-health recovery into doctor visits.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, `@aivilization/worker`, `@aivilization/agent-runtime`.

---

### Task 1: TDD Evidence Tags

**Files:**

- Modify: `apps/worker/src/objectiveRenewal.test.ts`
- Modify: `apps/worker/src/objectiveRenewal.ts`
- Modify: `packages/agent-runtime/src/strategicPlanning.ts`

- [x] **Step 1: Write failing hunger evidence test**

Add a test beside the existing recent failed memory recovery tests:

```ts
test('uses recent hunger failures to recover through satiety affinity', () => {
  const projection = createProjection([createAgent({ agentId: agentA, educationScore: 12 })]);

  const objective = createDefaultAutonomousObjective({
    agentId: agentA,
    agent: projection.agents[agentA] ?? createAgent({ agentId: agentA }),
    projection,
    intentionState: {
      agentId: agentA,
      completedObjectives: [],
      scheduledIntentions: [],
      updatedAt: 0,
    },
    longTermProfile: createProfile(agentA),
    shortTermMemoryContext: [
      createMemory({
        id: 'memory-hungry-failed',
        agentId: agentA,
        status: 'failed',
        summary: 'Production failed because the agent was hungry and low on satiety.',
        tags: ['production', 'failed', 'hungry', 'satiety'],
        importanceScore: 0.95,
      }),
    ],
    issuedAt: 100,
  });

  expect(objective).toMatchObject({
    statement: 'Recover from recent setbacks before pursuing new growth.',
    affinityTags: ['recover', 'maintain', 'eat', 'satiety'],
  });
});
```

- [x] **Step 2: Run focused worker test and observe failure**

Run:

```bash
pnpm --filter @aivilization/worker test -- objectiveRenewal.test.ts
```

Expected: FAIL because recent setback recovery affinity tags are always `['recover', 'maintain', 'health', 'energy']`.

- [x] **Step 3: Implement evidence-derived recovery tags**

Extend `scoreRecentRecoveryNeed` to return:

```ts
{
  readonly score: number;
  readonly evidenceMemoryRecordIds: readonly string[];
  readonly affinityTags: readonly string[];
}
```

For best evidence containing `hungry`, `hunger`, or `satiety`, use `['recover', 'maintain', 'eat', 'satiety']`.
For evidence containing `tired`, `fatigue`, `sleep`, or `energy`, use `['recover', 'maintain', 'sleep', 'energy']`.
For evidence containing `doctor`, `hospital`, `sick`, `ill`, or `health`, use `['recover', 'maintain', 'health']`.
Fallback stays `['recover', 'maintain', 'health', 'energy']`.

Also remove generic `recover` from the health strategic domain aliases; keep the explicit `recover health` keyword.

- [x] **Step 4: Verify focused worker behavior**

Run:

```bash
pnpm --filter @aivilization/worker test -- objectiveRenewal.test.ts
pnpm --filter @aivilization/worker typecheck
```

### Task 2: Planning Integration

**Files:**

- Modify: `packages/agent-runtime/src/strategicPlanning.test.ts`

- [x] **Step 1: Add integration test from renewal tags to eat branch**

Add a test showing the objective renewal tags compile into the `satiety` branch:

```ts
test('compiles recovery objectives with eat affinity into satiety branches', () => {
  const statement = 'Recover from recent setbacks before pursuing new growth.';
  const plan = compileStrategicObjectiveToBranchPlan({
    objective: {
      id: 'objective-recent-hunger',
      agentId,
      statement,
      priority: 3,
      source: 'agent',
      affinityTags: ['recover', 'maintain', 'eat', 'satiety'],
      createdAt: 100,
      updatedAt: 100,
    },
    issuedAt: 100,
  });

  expect(plan.branches.map((branch) => branch.id)).toEqual(['satiety']);
});
```

- [x] **Step 2: Run focused agent-runtime test**

Run:

```bash
pnpm --filter @aivilization/agent-runtime test -- strategicPlanning.test.ts
pnpm --filter @aivilization/agent-runtime typecheck
```

Expected: PASS after Task 1 because the existing strategic compiler already supports `eat`; this test protects the integration contract.

### Task 3: Full Verification And Commit

**Files:**

- Review all changed files and this plan.

- [x] **Step 1: Run full verification**

Run:

```bash
pnpm check
pnpm build
```

- [x] **Step 2: Commit**

Run:

```bash
git add docs/superpowers/plans/2026-06-24-recent-hunger-recovery-affinity-slice.md apps/worker/src/objectiveRenewal.ts apps/worker/src/objectiveRenewal.test.ts packages/agent-runtime/src/strategicPlanning.test.ts
git commit -m "feat: route hunger recovery through eat affinity"
```
