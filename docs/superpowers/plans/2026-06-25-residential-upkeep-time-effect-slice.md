# Residential Upkeep Time Effect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add passive residential upkeep costs so residential tier becomes an ongoing economic pressure instead of only a production/job gate.

**Architecture:** Keep tier-cost calculation in `packages/society`; keep event emission and projection replay in `packages/world`; let `apps/worker` inherit the behavior through existing `AdvanceSimulationTime` tick dispatch. Upkeep is modeled as a currency sink via `ResidentialUpkeepCharged`, while safety-net subsidies can later restore agents after the charge in the same tick.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, existing command/event/projection architecture.

---

## File Structure

- Modify `packages/society/src/residential.ts`: add residential upkeep policy and pure evaluation rule.
- Modify `packages/society/src/residential.test.ts`: prove elapsed-time charge scaling, balance floor, no-cost tiers, and invalid policy handling.
- Modify `packages/world/src/events.ts`: add `ResidentialUpkeepCharged` event payload.
- Modify `packages/world/src/projection.ts`: replay upkeep into agent balance and money supply.
- Modify `packages/world/src/projection.test.ts`: prove replay behavior.
- Modify `packages/world/src/agentActions.ts`: add optional `residentialUpkeep` policy and emit upkeep events during `AdvanceSimulationTime`.
- Modify `packages/world/src/simulationTime.test.ts`: prove upkeep events are deterministic and run before safety-net subsidies.
- Modify `apps/worker/src/tickRunner.test.ts`: prove worker time phase applies upkeep through the normal event stream.
- Modify this plan file.

## Design Rules

1. `residentialUpkeep` is optional on `WorldCommandPolicies`; existing simulations without it keep current behavior.
2. Upkeep is a passive time effect on `AdvanceSimulationTime`, not an agent action.
3. Affected agents are processed in deterministic `agentId` order.
4. `SimulationTimeAdvanced` stays first. Health effects run first, then residential upkeep, then safety-net subsidy.
5. `ResidentialUpkeepCharged` decreases both `agent.balance` and `projection.moneySupply` by the charged `amount`, modeling upkeep as a currency sink.
6. The charge scales by `durationSeconds / 3600`, caps at the agent's available balance, and records `unpaidAmount` for later policy extensions.
7. No short-term memory is written for passive upkeep to avoid noisy STM spam.

## Task 1: Society Residential Upkeep Rule

**Files:**

- Modify: `packages/society/src/residential.ts`
- Modify: `packages/society/src/residential.test.ts`

- [x] **Step 1: Write failing residential upkeep tests**

Add tests that:

- tier `2`, balance `100`, cost `20/hour`, duration `1800s` charges `10`,
- tier `3`, balance `5`, cost `20/hour`, duration `1800s` charges `5` and leaves `unpaidAmount: 5`,
- missing tier cost returns no charge,
- invalid negative `currencyCostPerHour` returns rejected decision.

- [x] **Step 2: Verify RED**

Run:

```bash
pnpm --filter @aivilization/society test -- residential.test.ts
```

Expected before implementation: FAIL because upkeep types/functions do not exist.

- [x] **Step 3: Implement pure upkeep rule**

Export `ResidentialUpkeepPolicy`, `ResidentialUpkeepDecision`, and `evaluateResidentialUpkeep(input)`.

- [x] **Step 4: Verify GREEN**

Run:

```bash
pnpm --filter @aivilization/society test -- residential.test.ts
```

## Task 2: World Upkeep Event and Projection

**Files:**

- Modify: `packages/sim-core/src/event.ts`
- Modify: `packages/world/src/events.ts`
- Modify: `packages/world/src/projection.ts`
- Modify: `packages/world/src/projection.test.ts`

- [x] **Step 1: Write failing projection test**

Add a test applying `ResidentialUpkeepCharged` to an agent with balance `100` and money supply `1000`. Expect balance `90` and money supply `990`.

- [x] **Step 2: Verify RED**

Run:

```bash
pnpm --filter @aivilization/world test -- projection.test.ts
```

Expected before implementation: FAIL because `ResidentialUpkeepCharged` is not a known world event.

- [x] **Step 3: Add event contract and replay**

Add `ResidentialUpkeepChargedPayload` to `WorldEventPayloadByType`, update `CoreEventType`, and replay the event by reducing balance and money supply by `amount`.

- [x] **Step 4: Verify GREEN**

Run:

```bash
pnpm --filter @aivilization/world test -- projection.test.ts
```

## Task 3: World Time Effect Dispatch

**Files:**

- Modify: `packages/world/src/agentActions.ts`
- Modify: `packages/world/src/simulationTime.test.ts`

- [x] **Step 1: Write failing simulation time test**

Add an `AdvanceSimulationTime` test with one tier-2 low-balance agent and both policies:

```ts
residentialUpkeep: {
  costs: [{ residentialTier: 2, currencyCostPerHour: 20 }],
},
safetyNetSubsidy: {
  minimumBalance: 50,
  maxSubsidy: 25,
}
```

Expect event order `SimulationTimeAdvanced`, `ResidentialUpkeepCharged`, `SubsidyPaid`, proving safety net sees the post-upkeep balance.

- [x] **Step 2: Verify RED**

Run:

```bash
pnpm --filter @aivilization/world test -- simulationTime.test.ts
```

Expected before implementation: FAIL because `AdvanceSimulationTime` does not emit upkeep.

- [x] **Step 3: Emit deterministic upkeep events**

Add optional `residentialUpkeep` to `WorldCommandPolicies`; in `handleAdvanceSimulationTimeCommand`, process sorted agents after health effects and before safety-net subsidies.

- [x] **Step 4: Verify GREEN**

Run:

```bash
pnpm --filter @aivilization/world test -- simulationTime.test.ts
```

## Task 4: Worker Tick Integration

**Files:**

- Modify: `apps/worker/src/tickRunner.test.ts`

- [x] **Step 1: Add worker tick integration test**

Add a no-agent-cycle tick with a tier-2 agent, `moneySupply: 1000`, and `residentialUpkeep`. Expect the time phase to emit `SimulationTimeAdvanced` and `ResidentialUpkeepCharged`, and the returned projection balance/money supply to decrease.

- [x] **Step 2: Verify integration through existing dispatch path**

Run:

```bash
pnpm --filter @aivilization/worker test -- tickRunner.test.ts
```

After Task 3 this should pass without worker production-code changes because worker already dispatches `AdvanceSimulationTime`.

## Task 5: Verification and Commit

- [x] **Step 1: Format changed files**

Run:

```bash
pnpm exec prettier --write docs/superpowers/plans/2026-06-25-residential-upkeep-time-effect-slice.md packages/society/src/residential.ts packages/society/src/residential.test.ts packages/world/src/events.ts packages/world/src/projection.ts packages/world/src/projection.test.ts packages/world/src/agentActions.ts packages/world/src/simulationTime.test.ts apps/worker/src/tickRunner.test.ts packages/sim-core/src/event.ts
```

- [x] **Step 2: Run focused tests**

Run:

```bash
pnpm --filter @aivilization/society test -- residential.test.ts
pnpm --filter @aivilization/world test -- projection.test.ts
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
git add docs/superpowers/plans/2026-06-25-residential-upkeep-time-effect-slice.md packages/society/src/residential.ts packages/society/src/residential.test.ts packages/world/src/events.ts packages/world/src/projection.ts packages/world/src/projection.test.ts packages/world/src/agentActions.ts packages/world/src/simulationTime.test.ts apps/worker/src/tickRunner.test.ts packages/sim-core/src/event.ts
git commit -m "feat: charge residential upkeep"
```
