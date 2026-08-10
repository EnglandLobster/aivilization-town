# Sleep Deprivation Health Decay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add policy-driven health deterioration from cumulative sleep deprivation, matching the AIvilization paper's survival and physiological constraints.

**Architecture:** Keep the physiological rule in `packages/society`, emit deterministic world events from `AdvanceSimulationTime` in `packages/world`, and let worker ticks inherit the behavior through existing time-advance dispatch. This keeps passive time effects separate from active recovery actions like `AgentSleep` and `AgentSeeDoctor`, while leaving room for future stochastic illness policies.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, existing command/event/projection architecture.

---

## File Structure

- Modify `packages/society/src/physiology.ts`: add a pure `applySleepDeprivationHealthDecay` rule and policy type.
- Modify `packages/society/src/physiology.test.ts`: prove low energy over elapsed time reduces health and clamps at a minimum.
- Modify `packages/world/src/agentActions.ts`: pass optional sleep-deprivation policy into `AdvanceSimulationTime` and emit `PhysiologyChanged` events after `SimulationTimeAdvanced`.
- Modify `packages/world/src/simulationTime.test.ts`: prove time advancement decays only low-energy agents and preserves deterministic event ordering.
- Modify `apps/worker/src/tickRunner.test.ts`: prove worker ticks apply the time-effect before agent cycles through the normal event stream path.
- Modify this plan file.

## Design Rules

1. `sleepDeprivation` is optional on `WorldCommandPolicies`; existing simulations without it keep current behavior.
2. Health decay is a passive time effect on `AdvanceSimulationTime`, not an agent action.
3. Affected agents are processed in deterministic `agentId` order.
4. `SimulationTimeAdvanced` remains the first event in the batch; physiology changes follow it.
5. No short-term memory is written for passive per-tick decay to avoid noisy STM spam.
6. Health never drops below the configured `minHealth`.

## Task 1: Society Physiology Rule

**Files:**

- Modify: `packages/society/src/physiology.ts`
- Modify: `packages/society/src/physiology.test.ts`

- [x] **Step 1: Write failing physiology tests**

Add tests that:

- an agent at or below `energyThreshold` loses `durationSeconds * healthDecayPerSecond` health,
- an agent above the threshold is unchanged,
- health clamps to `minHealth`.

- [x] **Step 2: Verify RED**

Run:

```bash
pnpm --filter @aivilization/society test -- physiology.test.ts
```

Expected before implementation: FAIL because `applySleepDeprivationHealthDecay` does not exist.

- [x] **Step 3: Implement pure rule**

Export `SleepDeprivationHealthDecayPolicy` and `applySleepDeprivationHealthDecay(input)` from `packages/society/src/physiology.ts`.

- [x] **Step 4: Verify GREEN**

Run:

```bash
pnpm --filter @aivilization/society test -- physiology.test.ts
```

## Task 2: World Time Effect Events

**Files:**

- Modify: `packages/world/src/agentActions.ts`
- Modify: `packages/world/src/simulationTime.test.ts`

- [x] **Step 1: Write failing world time-effect test**

Add a test dispatching `AdvanceSimulationTime` with two agents, one low-energy and one rested, plus:

```ts
sleepDeprivation: {
  energyThreshold: 20,
  healthDecayPerSecond: 0.5,
  minHealth: 10,
}
```

Expect event types `['SimulationTimeAdvanced', 'PhysiologyChanged']`, low-energy health to decay, rested agent unchanged, and sequences to remain contiguous.

- [x] **Step 2: Verify RED**

Run:

```bash
pnpm --filter @aivilization/world test -- simulationTime.test.ts
```

Expected before implementation: FAIL because `AdvanceSimulationTime` emits only `SimulationTimeAdvanced`.

- [x] **Step 3: Emit deterministic physiology events**

Add optional `sleepDeprivation` to `WorldCommandPolicies`, pass it into `handleAdvanceSimulationTimeCommand`, sort agents by id, and append `PhysiologyChanged` events only for changed physiology.

- [x] **Step 4: Verify GREEN**

Run:

```bash
pnpm --filter @aivilization/world test -- simulationTime.test.ts
```

## Task 3: Worker Tick Integration

**Files:**

- Modify: `apps/worker/src/tickRunner.test.ts`

- [x] **Step 1: Add worker tick integration test**

Add a tick-runner test with no agent cycles required, a low-energy agent in projection, and a `sleepDeprivation` policy. Expect the tick's time-advance stream events to include the health decay and the returned projection health to be reduced.

- [x] **Step 2: Verify integration through the existing world dispatch path**

Run:

```bash
pnpm --filter @aivilization/worker test -- tickRunner.test.ts
```

After Task 2 this should pass without extra worker code because worker already dispatches `AdvanceSimulationTime`.

- [x] **Step 3: Verify integration stays GREEN**

Run:

```bash
pnpm --filter @aivilization/worker test -- tickRunner.test.ts
```

## Task 4: Verification and Commit

- [x] **Step 1: Format changed files**

Run:

```bash
pnpm exec prettier --write docs/superpowers/plans/2026-06-25-sleep-deprivation-health-decay-slice.md packages/society/src/physiology.ts packages/society/src/physiology.test.ts packages/world/src/agentActions.ts packages/world/src/simulationTime.test.ts apps/worker/src/tickRunner.test.ts
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
git add docs/superpowers/plans/2026-06-25-sleep-deprivation-health-decay-slice.md packages/society/src/physiology.ts packages/society/src/physiology.test.ts packages/world/src/agentActions.ts packages/world/src/simulationTime.test.ts apps/worker/src/tickRunner.test.ts
git commit -m "feat: decay health from sleep deprivation"
```
