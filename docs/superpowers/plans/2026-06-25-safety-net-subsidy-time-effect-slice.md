# Safety Net Subsidy Time Effect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a paper-aligned social safety-net subsidy that keeps low-balance agents above a configurable survival floor.

**Architecture:** Keep subsidy eligibility math in `packages/society`; keep event emission and projection replay in `packages/world`; let `apps/worker` inherit the behavior through existing `AdvanceSimulationTime` tick dispatch. The first slice models subsidies as currency issuance through `SubsidyPaid`, leaving later tax/government-account mechanics as an extension rather than hard-coding fiscal policy now.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, existing command/event/projection architecture.

---

## File Structure

- Create `packages/society/src/welfare.ts`: policy type and pure subsidy calculation.
- Modify `packages/society/src/index.ts`: export welfare rules.
- Add `packages/society/src/welfare.test.ts`: prove top-up, cap, no-op, and validation behavior.
- Modify `packages/world/src/events.ts`: add `SubsidyPaid` event payload.
- Modify `packages/world/src/projection.ts`: replay subsidy into agent balance and money supply.
- Modify `packages/world/src/agentActions.ts`: add optional `safetyNetSubsidy` policy and emit `SubsidyPaid` during `AdvanceSimulationTime`.
- Modify `packages/world/src/simulationTime.test.ts`: prove time advancement pays only eligible agents and preserves deterministic event order.
- Modify `apps/worker/src/tickRunner.test.ts`: prove worker time phase applies subsidy through the normal event stream.
- Modify this plan file.

## Design Rules

1. `safetyNetSubsidy` is optional on `WorldCommandPolicies`; existing simulations without it keep current behavior.
2. Subsidies are passive time effects on `AdvanceSimulationTime`, not agent actions.
3. Affected agents are processed in deterministic `agentId` order.
4. `SimulationTimeAdvanced` stays first. Health time effects run before subsidies because subsidies do not alter physiology.
5. `SubsidyPaid` increases both `agent.balance` and `projection.moneySupply` by `amount`, matching current AMM money-supply accounting style.
6. No short-term memory is written for passive subsidies to avoid noisy STM spam.
7. The policy tops up toward `minimumBalance` but caps each payment at `maxSubsidy`.

## Task 1: Society Welfare Rule

**Files:**

- Create: `packages/society/src/welfare.ts`
- Modify: `packages/society/src/index.ts`
- Add: `packages/society/src/welfare.test.ts`

- [x] **Step 1: Write failing welfare tests**

Add tests that:

- balance `10`, `minimumBalance: 50`, `maxSubsidy: 25` returns amount `25`,
- balance `40`, `minimumBalance: 50`, `maxSubsidy: 25` returns amount `10`,
- balance `50` returns no subsidy,
- invalid negative policy values throw.

- [x] **Step 2: Verify RED**

Run:

```bash
pnpm --filter @aivilization/society test -- welfare.test.ts
```

Expected before implementation: FAIL because `welfare.ts` and its exports do not exist.

- [x] **Step 3: Implement pure welfare rule**

Export `SafetyNetSubsidyPolicy`, `SafetyNetSubsidyDecision`, and `evaluateSafetyNetSubsidy(input)`.

- [x] **Step 4: Verify GREEN**

Run:

```bash
pnpm --filter @aivilization/society test -- welfare.test.ts
```

## Task 2: World Subsidy Event and Projection

**Files:**

- Modify: `packages/world/src/events.ts`
- Modify: `packages/world/src/projection.ts`
- Modify: `packages/world/src/projection.test.ts`

- [x] **Step 1: Write failing projection test**

Add a test applying `SubsidyPaid` to an agent with balance `10` and money supply `100`. Expect balance `35` and money supply `125`.

- [x] **Step 2: Verify RED**

Run:

```bash
pnpm --filter @aivilization/world test -- projection.test.ts
```

Expected before implementation: FAIL because `SubsidyPaid` is not a known world event.

- [x] **Step 3: Add event contract and replay**

Add `SubsidyPaidPayload` to `WorldEventPayloadByType`, update `CoreEventType`, and replay the event by increasing balance and money supply.

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

Add an `AdvanceSimulationTime` test with two agents: one below `minimumBalance`, one at or above it. Enable:

```ts
safetyNetSubsidy: {
  minimumBalance: 50,
  maxSubsidy: 25,
}
```

Expect `SimulationTimeAdvanced`, then one `SubsidyPaid` for the eligible agent, and replayed projection balance/money supply updates.

- [x] **Step 2: Verify RED**

Run:

```bash
pnpm --filter @aivilization/world test -- simulationTime.test.ts
```

Expected before implementation: FAIL because `AdvanceSimulationTime` does not emit subsidies.

- [x] **Step 3: Emit deterministic subsidy events**

Add optional `safetyNetSubsidy` to `WorldCommandPolicies`; in `handleAdvanceSimulationTimeCommand`, process sorted agents after health time effects and append `SubsidyPaid` only when amount is positive.

- [x] **Step 4: Verify GREEN**

Run:

```bash
pnpm --filter @aivilization/world test -- simulationTime.test.ts
```

## Task 4: Worker Tick Integration

**Files:**

- Modify: `apps/worker/src/tickRunner.test.ts`

- [x] **Step 1: Add worker tick integration test**

Add a no-agent-cycle tick with a low-balance agent and `safetyNetSubsidy`. Expect the time phase to emit `SimulationTimeAdvanced` and `SubsidyPaid`, and the returned projection balance/money supply to increase.

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
pnpm exec prettier --write docs/superpowers/plans/2026-06-25-safety-net-subsidy-time-effect-slice.md packages/society/src/welfare.ts packages/society/src/welfare.test.ts packages/society/src/index.ts packages/world/src/events.ts packages/world/src/projection.ts packages/world/src/projection.test.ts packages/world/src/agentActions.ts packages/world/src/simulationTime.test.ts apps/worker/src/tickRunner.test.ts packages/sim-core/src/event.ts
```

- [x] **Step 2: Run focused tests**

Run:

```bash
pnpm --filter @aivilization/society test -- welfare.test.ts
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
git add docs/superpowers/plans/2026-06-25-safety-net-subsidy-time-effect-slice.md packages/society/src/welfare.ts packages/society/src/welfare.test.ts packages/society/src/index.ts packages/world/src/events.ts packages/world/src/projection.ts packages/world/src/projection.test.ts packages/world/src/agentActions.ts packages/world/src/simulationTime.test.ts apps/worker/src/tickRunner.test.ts packages/sim-core/src/event.ts
git commit -m "feat: add safety net subsidies"
```
