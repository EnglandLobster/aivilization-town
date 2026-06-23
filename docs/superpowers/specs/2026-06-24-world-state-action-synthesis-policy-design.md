# World-State Action Synthesis Policy Design

## Purpose

Make action synthesis budgets come from the current town state instead of only from manually supplied
test policies. The runtime can already filter candidate actions against budget constraints, and
traces can already persist those decisions. The missing layer is the worker-side adapter that turns
an agent's current energy, satiety, balance, inventory, and canonical action estimates into an
`ActionSynthesisPolicy`.

This slice makes global synthesis participate in canonical town ticks while preserving package
boundaries.

## Current Gap

`@aivilization/agent-runtime` exposes `ActionSynthesisPolicy`, but it intentionally knows nothing
about `WorldProjection`. `apps/worker` can pass a policy into `runWorkerAgentCycle`, but canonical
tick scheduling does not produce one. Canonical micro-planners also produce command payloads without
`resourceEstimate`, so even a world-derived policy has little to evaluate.

## Design Goals

- Keep `@aivilization/agent-runtime` domain-agnostic.
- Keep `@aivilization/world` focused on command validation and event production.
- Put world-state policy derivation in `apps/worker`, where `WorldAgentState`, `WorldProjection`,
  and runtime binding meet.
- Annotate canonical proposals with resource estimates based on the same policies used by world
  command handlers.
- Pass derived policies through active-plan scheduling and tick execution.
- Avoid default time-window rejection until the planner has richer multi-action scheduling; time
  budgets are opt-in for this slice.

## Proposed Architecture

Add `apps/worker/src/actionSynthesisPolicy.ts`:

```ts
export type WorldStateActionSynthesisPolicyConfig = {
  readonly maxActions?: number;
  readonly planningWindowSeconds?: number;
  readonly minEnergyReserve?: number;
  readonly minSatietyReserve?: number;
  readonly minBalanceReserve?: number;
};

export function deriveActionSynthesisPolicyFromWorldState(input: {
  readonly agent: WorldAgentState;
  readonly config?: WorldStateActionSynthesisPolicyConfig;
}): ActionSynthesisPolicy;
```

The derived policy uses:

- `energyBudget = max(0, agent.energy - minEnergyReserve)`
- `satietyBudget = max(0, agent.satiety - minSatietyReserve)`
- `currencyBudget = max(0, agent.balance - minBalanceReserve)`
- `inventoryBudget = positive agent inventory entries`
- optional `availableActionSeconds = planningWindowSeconds`
- optional `maxActions`

Add optional `actionSynthesis` to:

- `WorkerAgentRuntimeBinding`
- `WorkerTickAgentInput`

`buildWorkerTickAgentsFromActivePlans` copies runtime binding policy into scheduled tick agents, and
`runWorkerSimulationTick` passes it into `runWorkerAgentCycle`.

`createCanonicalWorkerRuntimeResolver` derives a default world-state policy unless configured with
`actionSynthesis: false`. It accepts optional `actionSynthesis` config for reserve thresholds and
max action count.

Canonical proposal resource estimates:

- study: `actionSeconds = durationSeconds`
- sleep: `actionSeconds = durationSeconds`
- work: `actionSeconds = laborSeconds`, plus energy/satiety costs from `WorldCommandPolicies`
- trade buy: `currencyCost` from AMM buy price when the pool exists
- trade sell: `inventoryCosts[commodityName] = quantity`
- apply-job/social: no resource estimate for now

Every canonical proposal uses `priority: selectedSubtask.score`.

## Data Flow

```text
WorldProjection + active objective
  -> buildWorkerTickAgentsFromActivePlans
  -> createCanonicalWorkerRuntimeResolver(context)
  -> deriveActionSynthesisPolicyFromWorldState(context.agent)
  -> WorkerTickAgentInput.actionSynthesis
  -> runWorkerSimulationTick
  -> runWorkerAgentCycle
  -> runAgentPlanningCycle
  -> synthesizeActionCandidates
```

## Failure Model

- Unknown or missing AMM pools do not throw during estimate construction; dry-run simulation remains
  the authoritative command validator.
- Invalid policy config fails early in the worker policy factory.
- Low energy/satiety/balance clamps the corresponding budget to zero instead of becoming negative.
- Time budgets are only included when configured, preventing existing long sleep/study actions from
  being rejected by one-second simulation tick durations.

## Test Strategy

- Unit tests for world-state policy derivation, reserve clamping, inventory copying, and optional
  planning window/max actions.
- Canonical domain runtime tests assert resource estimates and priority on study, sleep, work, and
  trade proposals.
- Canonical runtime resolver tests assert scheduled active-plan tick agents receive a derived
  policy.
- Tick runner tests assert `WorkerTickAgentInput.actionSynthesis` reaches cycle traces and can reject
  a low-priority proposal before simulation.
- Full verification remains `pnpm check` and `pnpm build`.

## Future Extensions

- Derive time windows from planned daily schedule and map travel.
- Add production/crafting estimates once canonical production planning is introduced.
- Add policy factories per gameplay mode, settlement, role, or emergency state.
- Feed synthesis rejection traces back into reflection so agents learn planning habits.
