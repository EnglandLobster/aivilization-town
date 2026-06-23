# Production Chain Planner Design

## Purpose

Add a pure economy-layer planner that expands a target production request into the dependency
ordered production steps required by the paper's multi-tier commodity recipes.

This moves the project closer to the AIvilization paper's industrial economy: agents should not
only validate a single `AgentProduce` command, they must also understand upstream material
requirements, residential gates, and cumulative resource budgets for objectives such as efficient
chip production.

## Source Requirements

The paper describes commodities as a vertical supply chain with residential barriers, upstream and
downstream dependencies, and hard non-substitutable material inputs. It also calls out efficient
chip production as a benchmark-style task. Existing code already has the paper commodity catalog,
recipes, residential gates, single-step production validation, and AMM trading.

The missing piece is a source-backed pure function that answers:

- which upstream commodities must be produced first;
- how existing inventory reduces upstream requirements;
- what total energy, satiety, and labor budget the chain needs;
- why a requested chain is impossible before worker or agent code tries to execute it.

## Scope

This slice adds only the pure planner in `@aivilization/economy`.

It does not change worker execution, active-plan completion semantics, action synthesis, trading,
or world command dispatch. That is intentional: current branch-plan progress marks a selected
subtask complete after one successful action. If a `produce Book` subtask emits `produce Wood` as a
first upstream action, marking the original subtask complete would be incorrect. Cross-tick chain
execution therefore needs a separate agent-runtime/worker design.

## Proposed API

Create `packages/economy/src/productionChain.ts`.

```ts
export type ProductionChainStep = {
  readonly commodityName: string;
  readonly quantity: number;
  readonly produced: Inventory;
  readonly consumedInputs: Inventory;
  readonly energyCost: number;
  readonly satietyCost: number;
  readonly laborSeconds: number;
};

export type ProductionChainPlan =
  | {
      readonly status: 'accepted';
      readonly targetCommodityName: string;
      readonly targetQuantity: number;
      readonly steps: readonly ProductionChainStep[];
      readonly inventoryAfter: Inventory;
      readonly inventoryDelta: Readonly<Record<string, number>>;
      readonly energyCost: number;
      readonly satietyCost: number;
      readonly laborSeconds: number;
    }
  | {
      readonly status: 'rejected';
      readonly reason: ProductionRejectionReason | 'cyclic-recipe';
      readonly detail: string;
      readonly blockingCommodityName?: string;
    };

export function planProductionChain(input: {
  readonly commodityName: string;
  readonly quantity: number;
  readonly agent: ProductionAgentState;
  readonly commodityCatalog?: readonly CommodityConfig[];
  readonly recipeCatalog?: readonly ProductionRecipe[];
  readonly recipeOverrides?: readonly ProductionRecipeOverride[];
}): ProductionChainPlan;
```

`quantity` means the requested newly produced target quantity. Existing inventory of the target
commodity does not reduce the requested output. Existing inventory of upstream inputs does reduce
the amount of upstream production required.

## Algorithm

The planner keeps a virtual inventory initialized from the agent's current inventory.

For each commodity to produce:

1. Resolve the commodity and recipe from the same catalog and override rules used by
   `planProduction`.
2. Reject if the commodity is unknown, not producible, or gated above the agent's residential tier.
3. For each recipe input, consume existing virtual inventory first.
4. If an input is missing, recursively plan production for the missing quantity, then consume it.
5. Append the current commodity step after all dependencies, so steps are topologically ordered.
6. Add produced output to virtual inventory.
7. Track cumulative energy, satiety, and labor costs.

After expansion, reject if cumulative energy, satiety, or labor exceeds the agent budget.

The planner is deterministic and ignores stochastic reward rolls. Rewards remain part of concrete
single-step command execution.

## Boundary Choices

The planner lives in `economy` because recipe dependencies and resource budgets are economic rules,
not worker orchestration. It has no dependency on world projections, memory, agent objectives, or
LLM output.

The existing `planProduction` single-step validator remains the authority for one executable
production command. The chain planner shares catalog resolution with it but does not replace it.

Worker integration should later use `planProductionChain` to decide the next executable upstream
step and should add explicit completion conditions so a target production subtask completes only
when the target output exists or the target command succeeds.

## Test Strategy

- A `Book` request with empty inventory plans `Wood` before `Book` and reports the combined budget.
- Existing upstream inventory removes unnecessary upstream steps.
- A `Chip` request with empty inventory aggregates shared intermediate needs, including two
  `Copper Ingot` units.
- Residential gates reject impossible high-tier chains before any worker action is proposed.
- Cumulative budget checks reject chains whose individual steps are valid in isolation but exceed
  total available energy, satiety, or labor.
- Existing `planProduction` tests continue passing.

## Follow-Up Slice

After this pure planner lands, the next worker slice should add production-chain execution semantics:

- extract or configure target commodity from production subtasks;
- propose the next executable chain step;
- keep the parent production subtask open until the target step succeeds;
- trace chain intent, selected upstream action, and remaining target deficit.
