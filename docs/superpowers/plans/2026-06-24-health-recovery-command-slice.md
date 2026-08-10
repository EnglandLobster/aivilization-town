# Health Recovery Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the AIvilization `RecoverHealth` / `see doctor` activity as a server-authoritative backend action.

**Architecture:** Keep physiology math in `@aivilization/society`; keep command validation, event emission, projection replay, and STM records in `@aivilization/world`; keep objective compilation and canonical micro-planner adaptation outside domain rule packages. Reuse `PhysiologyChanged` for health recovery so projection remains a single physiology event path.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, `@aivilization/sim-core`, `@aivilization/society`, `@aivilization/world`, `@aivilization/agent-runtime`, `@aivilization/worker`.

---

### Task 1: Society Health Recovery Rule

**Files:**

- Modify: `packages/society/src/physiology.ts`
- Modify: `packages/society/src/physiology.test.ts`

- [x] **Step 1: Write failing health recovery tests**

Add tests beside the existing energy recovery tests:

```ts
expect(
  applyHealthRecovery({
    energy: 40,
    satiety: 70,
    health: 30,
    durationSeconds: 1800,
    healthRecoveryPerSecond: 0.05,
    maxHealth: 100,
  }),
).toEqual({ energy: 40, satiety: 70, health: 100 });

expect(() =>
  applyHealthRecovery({
    energy: 40,
    satiety: 70,
    health: 30,
    durationSeconds: 10,
    healthRecoveryPerSecond: -1,
    maxHealth: 100,
  }),
).toThrow(/healthRecoveryPerSecond must be non-negative/);
```

- [x] **Step 2: Run focused society tests and observe failure**

Run:

```bash
pnpm --filter @aivilization/society test -- physiology.test.ts
```

Expected: FAIL because `applyHealthRecovery` is not exported.

- [x] **Step 3: Implement `applyHealthRecovery`**

Add a `HealthRecoveryInput` type and an implementation mirroring `applyEnergyRecovery`, but only changing `health` and capping at `maxHealth`.

- [x] **Step 4: Verify society package**

Run:

```bash
pnpm --filter @aivilization/society test -- physiology.test.ts
pnpm --filter @aivilization/society typecheck
```

### Task 2: World `AgentSeeDoctor` Command

**Files:**

- Modify: `packages/sim-core/src/command.ts`
- Modify: `packages/world/src/commands.ts`
- Modify: `packages/world/src/agentActions.ts`
- Modify: `packages/world/src/agentActions.test.ts`
- Modify: `docs/superpowers/specs/2026-06-23-aivilization-town-design.md`

- [x] **Step 1: Write failing world command tests**

Add tests like the sleep command tests:

```ts
const events = handleAgentSeeDoctorCommand({
  command: createCommandEnvelope({
    id: 'command-see-doctor',
    simulationId: 'sim-1',
    actorId: 'agent-1',
    type: 'AgentSeeDoctor',
    payload: { durationSeconds: 1800 },
    issuedAt: 25,
  }),
  projection,
  healthRecoveryPerSecond: 0.05,
  maxHealth: 100,
  nextSequence: 1,
});

expect(events.map((event) => event.type)).toEqual(['PhysiologyChanged', 'ShortTermMemoryRecorded']);
expect(events[0]?.payload).toMatchObject({
  previous: { energy: 40, satiety: 70, health: 30 },
  next: { energy: 40, satiety: 70, health: 100 },
  reason: 'see-doctor',
});
```

Also cover invalid payload, invalid recovery policy, missing dispatch policy, and dispatcher routing.

- [x] **Step 2: Run focused world tests and observe failure**

Run:

```bash
pnpm --filter @aivilization/world test -- agentActions.test.ts
```

Expected: FAIL because `AgentSeeDoctor` command support is missing.

- [x] **Step 3: Implement command payload and dispatcher routing**

Add `AgentSeeDoctor` to `CoreCommandType`, add `AgentSeeDoctorPayload` plus `assertAgentSeeDoctorPayload`, add an optional world policy:

```ts
seeDoctor?: {
  readonly healthRecoveryPerSecond: number;
  readonly maxHealth: number;
};
```

Route `AgentSeeDoctor` through `dispatchWorldCommand`, rejecting with `missing see doctor policy` when absent.

- [x] **Step 4: Implement `handleAgentSeeDoctorCommand`**

Use `applyHealthRecovery`; emit `PhysiologyChanged` with `reason: 'see-doctor'` and a successful STM record tagged `['see-doctor', 'health']`. Rejections must use the existing `rejectCommand` path so they create `ActionRejected` plus failed STM.

- [x] **Step 5: Update source design command list**

Add `AgentSeeDoctor` to the design spec command list next to `AgentSleep`.

- [x] **Step 6: Verify world package**

Run:

```bash
pnpm --filter @aivilization/world test -- agentActions.test.ts
pnpm --filter @aivilization/world typecheck
```

### Task 3: Planner And Worker Adapter

**Files:**

- Modify: `packages/agent-runtime/src/strategicPlanning.ts`
- Modify: `packages/agent-runtime/src/strategicPlanning.test.ts`
- Modify: `apps/worker/src/canonicalDomainRuntimes.ts`
- Modify: `apps/worker/src/canonicalDomainRuntimes.test.ts`

- [x] **Step 1: Write failing planning and adapter tests**

Add a strategic planning test for:

```ts
statement: 'Recover health by seeing a doctor before returning to work.';
affinityTags: ['health'];
```

Expected branch: `health`, subtask: `see-doctor`, affinity tags: `['health']`.

In canonical domain runtime tests, add `health` to deterministic registration order and assert:

```ts
expect(firstProposal(binding.microPlanners, 'health')).toMatchObject({
  id: 'canonical-health-step-h',
  commandType: 'AgentSeeDoctor',
  payload: { durationSeconds: 1800 },
  priority: 10,
  resourceEstimate: { actionSeconds: 1800 },
});
```

- [x] **Step 2: Run focused tests and observe failure**

Run:

```bash
pnpm --filter @aivilization/agent-runtime test -- strategicPlanning.test.ts
pnpm --filter @aivilization/worker test -- canonicalDomainRuntimes.test.ts
```

Expected: FAIL because health strategic branch and canonical health domain are missing.

- [x] **Step 3: Implement health strategic domain**

Add a `health` strategic domain rule with branch id `health`, subtask id `see-doctor`, aliases `health`, `doctor`, `hospital`, `medical`, and keywords for health recovery / illness.

- [x] **Step 4: Implement canonical health domain runtime**

Add:

```ts
export type HealthDomainRuntimeConfig = {
  readonly durationSeconds?: number;
};
```

Register `health` after `residential` to avoid shifting existing canonical action ids. Propose `AgentSeeDoctor` with default `durationSeconds = 1800` and `resourceEstimate.actionSeconds`.

- [x] **Step 5: Verify planner and worker packages**

Run:

```bash
pnpm --filter @aivilization/agent-runtime test -- strategicPlanning.test.ts
pnpm --filter @aivilization/worker test -- canonicalDomainRuntimes.test.ts
pnpm --filter @aivilization/agent-runtime typecheck
pnpm --filter @aivilization/worker typecheck
```

### Task 4: Full Verification And Commit

**Files:**

- Review all changed source, tests, and this plan.

- [x] **Step 1: Run focused integration checks**

Run:

```bash
pnpm --filter @aivilization/society test -- physiology.test.ts
pnpm --filter @aivilization/world test -- agentActions.test.ts
pnpm --filter @aivilization/agent-runtime test -- strategicPlanning.test.ts
pnpm --filter @aivilization/worker test -- canonicalDomainRuntimes.test.ts
```

- [x] **Step 2: Run full verification**

Run:

```bash
pnpm check
pnpm build
```

- [x] **Step 3: Commit**

Run:

```bash
git add docs/superpowers/plans/2026-06-24-health-recovery-command-slice.md docs/superpowers/specs/2026-06-23-aivilization-town-design.md packages/sim-core/src/command.ts packages/society/src/physiology.ts packages/society/src/physiology.test.ts packages/world/src/commands.ts packages/world/src/agentActions.ts packages/world/src/agentActions.test.ts packages/agent-runtime/src/strategicPlanning.ts packages/agent-runtime/src/strategicPlanning.test.ts apps/worker/src/canonicalDomainRuntimes.ts apps/worker/src/canonicalDomainRuntimes.test.ts
git commit -m "feat: add health recovery command"
```
