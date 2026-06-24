# Satiety Recovery Domain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect AIvilization `RecoverSatiety` / `eat` activity to strategic planning and canonical worker execution.

**Architecture:** Keep world `AgentEat` semantics in `@aivilization/world`; add only the missing cognition/runtime adapters. `@aivilization/agent-runtime` compiles satiety intent into an `eat` branch, and `apps/worker` turns that branch into an inventory-consuming `AgentEat` proposal with resource estimates for global synthesis.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, `@aivilization/agent-runtime`, `@aivilization/worker`, `@aivilization/world`.

---

### Task 1: Strategic Satiety Domain

**Files:**

- Modify: `packages/agent-runtime/src/strategicPlanning.test.ts`
- Modify: `packages/agent-runtime/src/strategicPlanning.ts`
- Modify: `apps/worker/src/objectiveRenewal.test.ts`
- Modify: `apps/worker/src/objectiveRenewal.ts`

- [x] **Step 1: Write failing strategic planning test**

Add a test for a hunger/satiety objective:

```ts
test('compiles satiety recovery objectives into eat branches', () => {
  const statement = 'Recover satiety by eating food before walking around town.';
  const plan = compileStrategicObjectiveToBranchPlan({
    objective: {
      id: 'objective-satiety',
      agentId,
      statement,
      priority: 2,
      source: 'human',
      affinityTags: ['satiety'],
      createdAt: 100,
      updatedAt: 100,
    },
    issuedAt: 100,
  });

  expect(plan.branches.map((branch) => branch.id)).toEqual(['satiety']);
  expect(plan.branches[0]).toMatchObject({
    id: 'satiety',
    objective: 'Recover satiety before pursuing the long-horizon objective.',
    subtasks: [
      {
        id: 'eat',
        description: `Eat toward: ${statement}`,
        intentionAffinityTags: ['eat', 'satiety'],
        memoryAffinityTags: ['eat', 'satiety'],
        profileAffinityTags: ['eat', 'satiety'],
        signalKeys: ['eat', 'satiety'],
      },
    ],
  });
});
```

- [x] **Step 2: Run focused strategic planning test and observe failure**

Run:

```bash
pnpm --filter @aivilization/agent-runtime test -- strategicPlanning.test.ts
```

Expected: FAIL because no `eat` strategic domain exists.

- [x] **Step 3: Write failing autonomous satiety signal test**

Add a worker objective renewal test proving hungry agents carry a satiety affinity tag:

```ts
test('proposes physiology maintenance with satiety affinity for hungry agents', () => {
  const projection = createProjection([
    createAgent({ agentId: agentA, educationScore: 150, balance: 200, satiety: 10 }),
  ]);

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
    shortTermMemoryContext: [],
    issuedAt: 100,
  });

  expect(objective).toMatchObject({
    statement: 'Maintain energy, satiety, and health before pursuing growth.',
    affinityTags: ['maintain', 'health', 'energy', 'satiety'],
  });
});
```

- [x] **Step 4: Run focused objective renewal test and observe failure**

Run:

```bash
pnpm --filter @aivilization/worker test -- objectiveRenewal.test.ts
```

Expected: FAIL because physiology maintenance tags do not include `satiety`.

- [x] **Step 5: Implement `eat` strategic domain rule and satiety renewal tag**

Add `eat` to `StrategicDomainName` and a rule:

```ts
{
  domain: 'eat',
  branchId: 'satiety',
  subtaskId: 'eat',
  branchObjective: 'Recover satiety before pursuing the long-horizon objective.',
  subtaskDescription: (objectiveText) => `Eat toward: ${objectiveText}`,
  priorityOffset: 9,
  affinityAliases: ['eat', 'satiety', 'food', 'hunger', 'hungry'],
  keywords: ['eat', 'food', 'hunger', 'hungry', 'meal', 'satiety'],
}
```

- [x] **Step 6: Verify planning and objective renewal**

Run:

```bash
pnpm --filter @aivilization/agent-runtime test -- strategicPlanning.test.ts
pnpm --filter @aivilization/worker test -- objectiveRenewal.test.ts
pnpm --filter @aivilization/agent-runtime typecheck
```

### Task 2: Canonical Eat Runtime

**Files:**

- Modify: `apps/worker/src/canonicalDomainRuntimes.test.ts`
- Modify: `apps/worker/src/canonicalDomainRuntimes.ts`

- [x] **Step 1: Write failing canonical runtime tests**

Extend `domainOrder` with `eat` appended after `health`, add configured eat runtime input:

```ts
eat: { commodityName: 'Apple', quantity: 2 },
```

Assert the proposal:

```ts
expect(firstProposal(binding.microPlanners, 'eat')).toMatchObject({
  id: 'canonical-eat-step-i',
  commandType: 'AgentEat',
  payload: { commodityName: 'Apple', quantity: 2 },
  priority: 10,
  resourceEstimate: { inventoryCosts: { Apple: 2 } },
});
```

Add a default-resolution test where the agent inventory contains `{ Book: 3, Bread: 1 }` and `satietyRecoveryByCommodity` marks `Bread` edible. Expected default payload is `{ commodityName: 'Bread', quantity: 1 }`.

- [x] **Step 2: Run focused worker test and observe failure**

Run:

```bash
pnpm --filter @aivilization/worker test -- canonicalDomainRuntimes.test.ts
```

Expected: FAIL because no canonical `eat` domain exists.

- [x] **Step 3: Implement canonical eat runtime**

Add `EatDomainRuntimeConfig`:

```ts
export type EatDomainRuntimeConfig = {
  readonly commodityName?: string;
  readonly quantity?: number;
};
```

Append `createEatDomainRuntimeRegistration(config.eat, policies?.satietyRecoveryByCommodity)` after health. The runtime emits `AgentEat`, defaults quantity to `1`, and chooses the first positive inventory item with a configured satiety recovery value before falling back to configured/default food.

- [x] **Step 4: Verify worker package**

Run:

```bash
pnpm --filter @aivilization/worker test -- canonicalDomainRuntimes.test.ts
pnpm --filter @aivilization/worker typecheck
```

### Task 3: Full Verification And Commit

**Files:**

- Review changed plan, tests, and implementation files.

- [x] **Step 1: Run full verification**

Run:

```bash
pnpm check
pnpm build
```

- [x] **Step 2: Commit**

Run:

```bash
git add docs/superpowers/plans/2026-06-24-satiety-recovery-domain-slice.md packages/agent-runtime/src/strategicPlanning.ts packages/agent-runtime/src/strategicPlanning.test.ts apps/worker/src/canonicalDomainRuntimes.ts apps/worker/src/canonicalDomainRuntimes.test.ts
git commit -m "feat: add satiety recovery domain"
```
