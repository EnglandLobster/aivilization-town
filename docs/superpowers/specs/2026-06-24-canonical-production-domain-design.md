# Canonical Production Domain Design

## Purpose

Add canonical production planning to worker runtime adapters so active plans can execute
`AgentProduce` commands through the same scheduling, simulation, action synthesis, tracing, and
world command dispatch path as study, work, trade, sleep, and social actions.

The world and economy packages already contain the authoritative production rules. This slice wires
those capabilities into canonical agent runtime selection without duplicating recipe logic.

## Current Gap

`@aivilization/world` supports `AgentProduce`, and `@aivilization/economy` exposes
`planProduction`. Existing tests also prove branch-plan progress can use ad hoc `AgentProduce`
micro-planners. However, canonical worker runtime registrations only expose:

- study
- work
- trade
- sleep
- social

An active objective/plan containing production tokens cannot currently resolve a canonical
production micro-planner.

## Design Goals

- Add `production` as a canonical worker domain.
- Keep production command validation in `@aivilization/world`.
- Use `planProduction` for proposal resource estimates when current world state makes the production
  plan acceptable.
- Preserve existing canonical domain order and IDs for current five domains by appending
  `production`.
- Let production proposals participate in action synthesis budgets and traces.
- Avoid inventing a new production optimization algorithm in this slice.

## Proposed Architecture

Extend `CanonicalDomainName`:

```ts
export type CanonicalDomainName =
  | 'study'
  | 'work'
  | 'trade'
  | 'sleep'
  | 'social'
  | 'production';
```

Add:

```ts
export type ProductionDomainRuntimeConfig = {
  readonly commodityName?: string;
  readonly quantity?: number;
  readonly availableLaborSeconds?: number;
};
```

The production registration returns a `DomainMicroPlanner` that proposes:

```ts
{
  id: 'canonical-production-<subtaskId>',
  description: `Produce ${commodityName}.`,
  commandType: 'AgentProduce',
  priority: selectedSubtask.score,
  payload: {
    commodityName,
    quantity,
    availableLaborSeconds,
  },
  resourceEstimate?: {
    actionSeconds: laborSeconds,
    energyCost,
    satietyCost,
    inventoryCosts,
  },
}
```

Default commodity is `Apple`, because it is the first baseline producible commodity in the paper
catalog and requires no inputs. Default quantity is `1`; default available labor window is `3600`
seconds. Configured production can target advanced commodities such as `Book` or `Chip`.

Resource estimates are only attached when `planProduction` returns `accepted` for the current agent
state. If it rejects, the proposal is still emitted and the dry-run simulator remains the
authoritative rejection path. This preserves failure observability in existing simulator and memory
flows.

## Data Flow

```text
Active objective/branch plan contains production token
  -> createCanonicalWorkerRuntimeResolver
  -> createCanonicalDomainRuntimeRegistrations(...).production
  -> production micro-planner proposes AgentProduce
  -> action synthesis uses resourceEstimate when present
  -> dry-run simulator validates through world command handler
  -> command dispatch emits CommodityProduced + STM memory
```

## Test Strategy

- Canonical domain runtime tests assert `production` is registered in deterministic order.
- Canonical proposal tests assert configured `Book` production produces `AgentProduce` payload and
  resource estimate from `planProduction`.
- Context default tests assert production defaults to `Apple`.
- Canonical active-plan tick tests assert an active production plan executes through the full worker
  tick path and mutates inventory via `CommodityProduced`.
- Existing worker/full checks verify no regression to the other canonical domains.

## Future Extensions

- Choose production targets from subtask text or objective commodity demand.
- Add multi-step production chain planning for inputs, for example Wood -> Book -> higher-tier
  components.
- Add recipe-aware production market signals and settlement-level supply constraints.
- Add deterministic reward seeding for rare production rewards in world command handling.
