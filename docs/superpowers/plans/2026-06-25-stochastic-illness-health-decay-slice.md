# Stochastic Illness Health Decay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add paper-aligned stochastic illness as a deterministic, replayable time effect that reduces agent health.

**Architecture:** Keep illness physiology math and risk scaling in `packages/society`; keep seeded illness rolls and event emission in `packages/world`; let `apps/worker` inherit the behavior through its existing `AdvanceSimulationTime` dispatch. Illness must be pseudo-random during command dispatch but fully replayable afterward because projections apply recorded `PhysiologyChanged` events.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, existing command/event/projection architecture, `@aivilization/sim-core` seeded RNG.

---

## File Structure

- Modify `packages/society/src/physiology.ts`: add `StochasticIllnessPolicy`, `calculateStochasticIllnessProbabilityPercent`, and `applyStochasticIllnessHealthDecay`.
- Modify `packages/society/src/physiology.test.ts`: prove risk scaling, illness health damage, no-op rolls, and min-health clamping.
- Modify `packages/world/src/agentActions.ts`: add optional `stochasticIllness` to `WorldCommandPolicies`, roll illness with `createSeededRandom`, and append deterministic `PhysiologyChanged` events after existing time effects.
- Modify `packages/world/src/simulationTime.test.ts`: prove illness events are replayable, deterministic for the same command, and compose after sleep-deprivation changes.
- Modify `apps/worker/src/tickRunner.test.ts`: prove worker ticks apply stochastic illness during the time phase through the normal event stream.
- Modify this plan file.

## Design Rules

1. `stochasticIllness` is optional on `WorldCommandPolicies`; simulations without it keep current behavior.
2. Illness is a passive time effect on `AdvanceSimulationTime`, not an active agent action.
3. The world dispatcher builds a seed from `simulationId`, `command.id`, previous clock, delta, agent id, and the `stochastic-illness` effect name.
4. Affected agents are processed in deterministic `agentId` order.
5. `SimulationTimeAdvanced` stays first. Sleep-deprivation changes run before stochastic illness, so illness composes on the current per-agent physiology inside the same tick.
6. No short-term memory is written for passive stochastic illness to avoid noisy STM spam.
7. Health never drops below configured `minHealth`.

## Task 1: Society Illness Rule

**Files:**

- Modify: `packages/society/src/physiology.ts`
- Modify: `packages/society/src/physiology.test.ts`

- [x] **Step 1: Write failing physiology tests**

Add tests that:

- `calculateStochasticIllnessProbabilityPercent({ illnessProbabilityPercentPerHour: 30, durationSeconds: 1800 })` returns `15`,
- risk caps at `100`,
- `applyStochasticIllnessHealthDecay` reduces health only when `illnessOccurs` is true,
- health clamps to `minHealth`.

- [x] **Step 2: Verify RED**

Run:

```bash
pnpm --filter @aivilization/society test -- physiology.test.ts
```

Expected before implementation: FAIL because the illness functions do not exist.

- [x] **Step 3: Implement pure illness rule**

Export `StochasticIllnessPolicy`, `calculateStochasticIllnessProbabilityPercent`, and `applyStochasticIllnessHealthDecay(input)` from `packages/society/src/physiology.ts`.

- [x] **Step 4: Verify GREEN**

Run:

```bash
pnpm --filter @aivilization/society test -- physiology.test.ts
```

## Task 2: World Time Effect Events

**Files:**

- Modify: `packages/world/src/agentActions.ts`
- Modify: `packages/world/src/simulationTime.test.ts`

- [x] **Step 1: Write failing world illness tests**

Add tests dispatching `AdvanceSimulationTime` with:

```ts
stochasticIllness: {
  illnessProbabilityPercentPerHour: 100,
  healthDamage: 12,
  minHealth: 10,
}
```

Expect `SimulationTimeAdvanced` followed by `PhysiologyChanged` with reason `stochastic-illness`. Add a composition assertion where sleep deprivation first reduces health and illness then reduces the already-updated value.

- [x] **Step 2: Verify RED**

Run:

```bash
pnpm --filter @aivilization/world test -- simulationTime.test.ts
```

Expected before implementation: FAIL because `AdvanceSimulationTime` does not roll illness.

- [x] **Step 3: Emit deterministic illness events**

Add optional `stochasticIllness` to `WorldCommandPolicies`, import seeded RNG helpers from `@aivilization/sim-core`, and update `handleAdvanceSimulationTimeCommand` to maintain a per-agent physiology accumulator across time effects.

- [x] **Step 4: Verify GREEN**

Run:

```bash
pnpm --filter @aivilization/world test -- simulationTime.test.ts
```

## Task 3: Worker Tick Integration

**Files:**

- Modify: `apps/worker/src/tickRunner.test.ts`

- [x] **Step 1: Add worker tick integration test**

Add a tick-runner test with no agent cycles, a healthy agent in projection, `timeDeltaMs: 3_600_000`, and `stochasticIllness` probability at `100`. Expect the time phase to emit `SimulationTimeAdvanced` and `PhysiologyChanged`, and the returned projection health to be reduced.

- [x] **Step 2: Verify integration through existing dispatch path**

Run:

```bash
pnpm --filter @aivilization/worker test -- tickRunner.test.ts
```

After Task 2 this should pass without worker production-code changes because worker already dispatches `AdvanceSimulationTime`.

## Task 4: Verification and Commit

- [x] **Step 1: Format changed files**

Run:

```bash
pnpm exec prettier --write docs/superpowers/plans/2026-06-25-stochastic-illness-health-decay-slice.md packages/society/src/physiology.ts packages/society/src/physiology.test.ts packages/world/src/agentActions.ts packages/world/src/simulationTime.test.ts apps/worker/src/tickRunner.test.ts
```

- [x] **Step 2: Run focused tests**

Run:

```bash
pnpm --filter @aivilization/society test -- physiology.test.ts
pnpm --filter @aivilization/world test -- simulationTime.test.ts
pnpm --filter @aivilization/worker test -- tickRunner.test.ts
pnpm typecheck
```

- [x] **Step 3: Run repo checks**

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test
git diff --check
```

- [x] **Step 4: Commit**

Run:

```bash
git add docs/superpowers/plans/2026-06-25-stochastic-illness-health-decay-slice.md packages/society/src/physiology.ts packages/society/src/physiology.test.ts packages/world/src/agentActions.ts packages/world/src/simulationTime.test.ts apps/worker/src/tickRunner.test.ts
git commit -m "feat: add stochastic illness time effect"
```
