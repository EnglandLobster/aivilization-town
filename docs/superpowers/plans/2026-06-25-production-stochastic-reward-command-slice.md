# Production Stochastic Reward Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the paper's stochastic production reward mechanism to the server-authoritative `AgentProduce` command path.

**Architecture:** `@aivilization/economy` already owns pure production planning and reward-roll math. This slice keeps that rule there, adds deterministic seeding in `@aivilization/world`, and verifies that worker ticks inherit reward behavior through normal command dispatch and event replay.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, existing command/event/projection architecture.

---

## Source Notes

- Paper source: `/Users/bytedance/AgentDev/Ai-Town/AIVILIZATION-20260623201223/AIVILIZATION.md`
- Section 3.1.5 describes low-probability special rewards in production recipes.
- Appendix B Table 7 defines `Gold Apple` as a special reward item, not a regular production target.
- Appendix B Table 9 gives reward probabilities for `Chicken Salad`, `Beef Rice`, `Transistor`, `Circuit Board`, and `Chip`.

## File Structure

- Modify `packages/world/src/agentActions.test.ts`: prove `AgentProduce` emits `Gold Apple` through the world command path when the recipe reward probability is forced to 100%.
- Modify `packages/world/src/agentActions.ts`: seed production reward RNG from command and projection identity, then pass it to `planProduction`.
- Modify `apps/worker/src/tickRunner.test.ts`: prove a worker tick with an `AgentProduce` action persists the rewarded output through the event stream.
- Modify this plan file as tasks complete.

## Design Rules

1. Reward rolls occur during command handling, not during projection replay.
2. `CommodityProduced.produced` remains the complete replayable fact; projection replay stays deterministic without RNG.
3. The seed must include stable command context: simulation id, command id, actor id, previous clock time, commodity, quantity, and reward effect name.
4. Tests may use `recipeOverrides` at the handler boundary to force 100% reward probability without mutating source content.
5. Production reward support must not add market pools for `Gold Apple`; the content/scenario rule excluding it from regular trading remains unchanged.

## Task 1: World Command RED

**Files:**

- Modify: `packages/world/src/agentActions.test.ts`

- [x] **Step 1: Write failing world command test**

Add a test in `agent produce command handling` that calls `handleAgentProduceCommand` with a tier-5 agent producing one `Chip`, enough inputs, and:

```ts
recipeOverrides: [{ output: 'Chip', rewardProbabilityPercent: 100 }];
```

Expect `CommodityProduced.payload.produced` to equal:

```ts
{ Chip: 1, 'Gold Apple': 1 }
```

Replay the events and expect final inventory to include both items.

- [x] **Step 2: Verify RED**

Run:

```bash
pnpm --filter @aivilization/world test -- agentActions.test.ts
```

Expected before implementation: FAIL because the world handler does not pass an RNG into `planProduction`.

## Task 2: Deterministic World Reward Seed

**Files:**

- Modify: `packages/world/src/agentActions.ts`

- [x] **Step 3: Implement seeded reward dispatch**

Import `createSeededRandom` from `@aivilization/sim-core`. Extend `handleAgentProduceCommand` input with optional `recipeOverrides` for test and scenario policy composition:

```ts
readonly recipeOverrides?: Parameters<typeof planProduction>[0]['recipeOverrides'];
```

Call `planProduction` with:

```ts
rng: createSeededRandom(createProductionRewardSeed({ input, payload, agent })),
```

and conditionally pass `recipeOverrides`.

Add helper:

```ts
function createProductionRewardSeed(input: {
  readonly input: Parameters<typeof handleAgentProduceCommand>[0];
  readonly payload: { readonly commodityName: string; readonly quantity: number };
  readonly agent: WorldAgentState;
}): string {
  return [
    'production-reward',
    input.input.command.simulationId,
    input.input.command.id,
    input.input.projection.clock.now,
    input.agent.agentId,
    input.payload.commodityName,
    input.payload.quantity,
  ].join(':');
}
```

- [x] **Step 4: Verify GREEN**

Run:

```bash
pnpm --filter @aivilization/world test -- agentActions.test.ts
```

Expected after implementation: pass.

## Task 3: Worker Integration

**Files:**

- Modify: `apps/worker/src/tickRunner.test.ts`

- [x] **Step 5: Add worker reward integration test**

Add a tick with one agent action that proposes `AgentProduce` for `Chip`, enough inputs, tier 5, and enough physiology. Configure `policies.production.recipeOverrides` to force `Chip` reward probability to 100%. Expect `CommodityProduced` to include `{ Chip: 1, 'Gold Apple': 1 }`, and expect final projection inventory to include both items.

- [x] **Step 6: Verify worker integration**

Run:

```bash
pnpm --filter @aivilization/worker test -- tickRunner.test.ts
```

Expected after Task 2 and policy pass-through: pass.

## Task 4: Verification and Commit

- [x] **Step 7: Format changed files**

Run:

```bash
pnpm exec prettier --write docs/superpowers/plans/2026-06-25-production-stochastic-reward-command-slice.md packages/world/src/agentActions.ts packages/world/src/agentActions.test.ts apps/worker/src/tickRunner.test.ts
```

- [x] **Step 8: Run focused checks**

Run:

```bash
pnpm --filter @aivilization/world test -- agentActions.test.ts
pnpm --filter @aivilization/worker test -- tickRunner.test.ts
pnpm typecheck
```

- [x] **Step 9: Run repo checks**

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test
git diff --check
```

- [x] **Step 10: Commit**

Run:

```bash
git add docs/superpowers/plans/2026-06-25-production-stochastic-reward-command-slice.md packages/world/src/agentActions.ts packages/world/src/agentActions.test.ts apps/worker/src/tickRunner.test.ts
git commit -m "feat: seed production rewards"
```
