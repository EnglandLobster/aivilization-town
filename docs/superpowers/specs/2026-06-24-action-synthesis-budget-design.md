# Action Synthesis Budget Design

## Purpose

Add a planner-owned global action synthesis layer between domain micro-planners and simulator
validation. Micro-planners can propose multiple locally valid actions for a selected subtask, but
the runtime currently sends every proposal to simulation independently. That misses the paper-style
global synthesis step where candidate actions are reconciled against shared constraints such as
time, energy, satiety, money, inventory, and goal priority.

This slice introduces a deterministic, domain-agnostic budget gate for action candidates while
keeping world command validation and command execution unchanged.

## Current Gap

`runAgentPlanningCycle` currently does:

```text
select subtask -> choose first supporting micro-planner -> propose actions -> simulate/repair each
```

There is no runtime-owned step that asks whether the set of actions fits the same planning window
or resource envelope. If a planner proposes `sleep`, `work`, and `study`, all three are simulated
as independent commands even when a cycle should only advance one bounded intention.

## Design Goals

- Keep global action synthesis inside `@aivilization/agent-runtime`.
- Keep world packages responsible for command invariants and state transitions only.
- Avoid hard-coding canonical world command payloads in the synthesis algorithm.
- Let micro-planners attach resource estimates to proposals without changing existing callers.
- Support deterministic ranking and rejection reasons for future trace/UI work.
- Preserve existing behavior when no synthesis policy is provided.

## Proposed Architecture

Extend `AtomicActionProposal` with optional planning metadata:

```ts
export type ActionResourceEstimate = {
  readonly actionSeconds?: number;
  readonly energyCost?: number;
  readonly satietyCost?: number;
  readonly currencyCost?: number;
  readonly inventoryCosts?: Readonly<Record<string, number>>;
};

export type AtomicActionProposal = {
  readonly id: string;
  readonly description: string;
  readonly commandType: string;
  readonly payload: unknown;
  readonly priority?: number;
  readonly resourceEstimate?: ActionResourceEstimate;
};
```

Add `synthesizeActionCandidates(input)` in a new `actionSynthesis.ts` module. The function sorts
proposals by descending `priority` and stable original order, then greedily accepts actions that fit
the configured envelope:

- `maxActions`
- `availableActionSeconds`
- `energyBudget`
- `satietyBudget`
- `currencyBudget`
- `inventoryBudget`

Missing estimates count as zero cost. Missing policy values mean unbounded capacity. Rejected
actions carry deterministic reasons such as `maxActions exhausted`, `action seconds budget
exceeded`, or `inventory budget exceeded for Bread`.

`runAgentPlanningCycle` should call synthesis after the micro-planner proposes actions and before
simulation:

```text
micro-planner proposals
  -> synthesizeActionCandidates(...)
  -> synthesized candidate actions
  -> simulateActionWithRepair(...)
  -> command drafts
```

`AgentCycleResult` should include the full `actionSynthesisResult` so observability can be wired in
a later slice without recomputing runtime decisions.

## Failure Model

- A micro-planner that proposes no actions keeps the existing failure.
- If synthesis accepts no actions, the planning cycle throws
  `action synthesis accepted no candidate actions for subtask ...`.
- Negative or non-finite estimates are rejected as invalid input. These are planner bugs, not world
  validation failures.
- Ties are stable by original proposal order.
- Synthesis never mutates proposals or payloads.

## Test Strategy

- Pure synthesis tests cover priority ordering, `maxActions`, time budget, and inventory budget.
- Cycle tests cover that only synthesized actions are simulated and drafted.
- Existing repair and replanning tests should continue to pass because no-policy synthesis accepts
  every proposal.
- Verification remains `pnpm --filter @aivilization/agent-runtime test`, typecheck, `pnpm check`,
  and `pnpm build`.

## Future Extensions

- Persist `actionSynthesisResult` into `AgentCycleTrace`.
- Add policy factories that derive budgets from current physiology, inventory, workday windows, and
  active objective urgency.
- Add soft penalties and trade-off optimization after enough deterministic trace data exists.
- Let simulator feedback update estimate calibration over repeated cycles.
