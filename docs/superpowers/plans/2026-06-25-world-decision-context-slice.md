# World Decision Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a shared world-decision context and route dynamic agent state plus market prices
into existing backend LLM decision seams.

**Architecture:** Define portable cognitive input types in `@aivilization/agent-runtime`, build
them from concrete `WorldProjection` inside `apps/worker`, and thread the context through existing
compiler/evaluator inputs. Deterministic behavior remains compatible while future LLM
prioritization and micro-planning get one stable data contract.

**Tech Stack:** TypeScript, Vitest, pnpm workspace packages, `@aivilization/agent-runtime`,
`@aivilization/worker`, `@aivilization/world`, `@aivilization/economy`.

---

### Task 1: Agent Runtime Context Contract and LLM Prompt Visibility

**Files:**

- Create: `packages/agent-runtime/src/worldDecisionContext.ts`
- Modify: `packages/agent-runtime/src/index.ts`
- Modify: `packages/agent-runtime/src/strategicPlanning.ts`
- Modify: `packages/agent-runtime/src/dailyPlanning.ts`
- Modify: `packages/agent-runtime/src/reactionEvaluation.ts`
- Modify: `packages/agent-runtime/src/llmStrategicPlanner.ts`
- Modify: `packages/agent-runtime/src/llmDailyPlanner.ts`
- Modify: `packages/agent-runtime/src/llmReactionEvaluator.ts`
- Modify: `packages/agent-runtime/src/cycle.ts`
- Test: `packages/agent-runtime/src/llmStrategicPlanner.test.ts`
- Test: `packages/agent-runtime/src/llmDailyPlanner.test.ts`
- Test: `packages/agent-runtime/src/llmReactionEvaluator.test.ts`

- [x] **Step 1: Write failing LLM prompt tests**

Add tests that pass a `worldDecisionContext` with:

```ts
agent: {
  agentId,
  locationId: 'market',
  physiology: { energy: 45, satiety: 30, health: 90 },
  educationScore: 31,
  balance: 191696904,
  residentialTier: 5,
  job: 'Stock Clerk',
  inventory: { Fish: 46, Transistor: 12 },
},
market: {
  spotPrices: [{ commodity: 'Fish', spotPrice: 304.5 }],
  latestPriceIndex: { baselineAt: 0, recordedAt: 100, overall: 1.12, ratios: { Fish: 1.12 } },
}
```

Assert the strategic, daily, and reaction provider request payloads contain
`"worldDecisionContext"`, `"Fish"`, `"balance":191696904`, `"educationScore":31`, and
`"spotPrice":304.5`.

- [x] **Step 2: Verify red**

Run:

```bash
pnpm --filter @aivilization/agent-runtime test -- llmStrategicPlanner.test.ts llmDailyPlanner.test.ts llmReactionEvaluator.test.ts
```

Expected: FAIL because the compiler/evaluator input types do not accept `worldDecisionContext`.

- [x] **Step 3: Implement the runtime contract**

Create `WorldDecisionContext` and add optional `worldDecisionContext` to:

- `StrategicPlanCompilerInput`
- `DailyPlanCompilerInput`
- `ReactionEvaluatorInput`
- `runAgentPlanningCycle` input

Serialize it into all three LLM user payloads.

- [x] **Step 4: Verify green**

Run the same agent-runtime focused test command. Expected: PASS.

### Task 2: Worker Projection Builder and Runtime Wiring

**Files:**

- Create: `apps/worker/src/worldDecisionContext.ts`
- Test: `apps/worker/src/worldDecisionContext.test.ts`
- Modify: `apps/worker/src/agentScheduling.ts`
- Modify: `apps/worker/src/tickRunner.ts`
- Modify: `apps/worker/src/agentCycleRunner.ts`
- Modify: `apps/worker/src/objectiveRenewal.ts`
- Modify: `apps/worker/src/objectiveReplanning.ts`
- Modify: `apps/worker/src/dailyRoutineSchedule.ts`
- Modify: `apps/worker/src/socialObservationIntentions.ts`
- Test: `apps/worker/src/agentScheduling.test.ts`
- Test: `apps/worker/src/objectiveReplanning.test.ts`
- Test: `apps/worker/src/dailyRoutineSchedule.test.ts`

- [x] **Step 1: Write failing worker tests**

Add tests proving:

- `createWorldDecisionContextFromProjection` captures dynamic agent state and sorted AMM spot
  prices.
- `buildWorkerTickAgentsFromActivePlans` places context on each scheduled cycle input.
- `materializeFullReplanForActiveObjective` passes context to the strategic compiler.
- `renewDailyPlanScheduledIntentions` passes context to the daily compiler.

- [x] **Step 2: Verify red**

Run:

```bash
pnpm --filter @aivilization/worker test -- worldDecisionContext.test.ts agentScheduling.test.ts objectiveReplanning.test.ts dailyRoutineSchedule.test.ts
```

Expected: FAIL because the worker builder and passthrough fields do not exist.

- [x] **Step 3: Implement worker builder and passthrough**

Build the context from `WorldProjection` using `getSpotPrice`, copy only positive inventory, sort
market prices and inventory keys, and pass the context through scheduling, tick execution,
agent-cycle execution, daily renewal, objective renewal, full replanning, and reaction evaluation.

- [x] **Step 4: Verify green**

Run the same worker focused test command. Expected: PASS.

### Task 3: Final Verification and Commit

**Files:**

- Verify all changed files.

- [x] **Step 1: Run focused checks**

```bash
pnpm --filter @aivilization/agent-runtime test -- llmStrategicPlanner.test.ts llmDailyPlanner.test.ts llmReactionEvaluator.test.ts
pnpm --filter @aivilization/worker test -- worldDecisionContext.test.ts agentScheduling.test.ts objectiveReplanning.test.ts dailyRoutineSchedule.test.ts
```

- [x] **Step 2: Run formatting and workspace checks**

```bash
pnpm exec prettier --write packages/agent-runtime/src/worldDecisionContext.ts packages/agent-runtime/src/index.ts packages/agent-runtime/src/strategicPlanning.ts packages/agent-runtime/src/dailyPlanning.ts packages/agent-runtime/src/reactionEvaluation.ts packages/agent-runtime/src/llmStrategicPlanner.ts packages/agent-runtime/src/llmDailyPlanner.ts packages/agent-runtime/src/llmReactionEvaluator.ts packages/agent-runtime/src/cycle.ts packages/agent-runtime/src/llmStrategicPlanner.test.ts packages/agent-runtime/src/llmDailyPlanner.test.ts packages/agent-runtime/src/llmReactionEvaluator.test.ts apps/worker/src/worldDecisionContext.ts apps/worker/src/worldDecisionContext.test.ts apps/worker/src/agentScheduling.ts apps/worker/src/tickRunner.ts apps/worker/src/agentCycleRunner.ts apps/worker/src/objectiveRenewal.ts apps/worker/src/objectiveReplanning.ts apps/worker/src/dailyRoutineSchedule.ts apps/worker/src/socialObservationIntentions.ts apps/worker/src/agentScheduling.test.ts apps/worker/src/objectiveReplanning.test.ts apps/worker/src/dailyRoutineSchedule.test.ts docs/superpowers/specs/2026-06-25-world-decision-context-design.md docs/superpowers/plans/2026-06-25-world-decision-context-slice.md
pnpm check
git diff --check
```

- [x] **Step 3: Review and commit**

Stage only this slice's files, leaving existing untracked paper/report files untouched, then commit
with a detailed Chinese Conventional Commit message.

## Observed Verification

- RED agent-runtime:
  `pnpm --filter @aivilization/agent-runtime test -- llmStrategicPlanner.test.ts llmDailyPlanner.test.ts llmReactionEvaluator.test.ts`
  failed because LLM payloads did not include `worldDecisionContext`.
- GREEN agent-runtime:
  `pnpm --filter @aivilization/agent-runtime test -- llmStrategicPlanner.test.ts llmDailyPlanner.test.ts llmReactionEvaluator.test.ts`
  passed 18 files / 98 tests.
- RED worker:
  `pnpm --filter @aivilization/worker test -- worldDecisionContext.test.ts agentScheduling.test.ts objectiveReplanning.test.ts dailyRoutineSchedule.test.ts`
  failed because the builder and pass-through fields did not exist.
- GREEN worker:
  `pnpm --filter @aivilization/worker test -- worldDecisionContext.test.ts agentScheduling.test.ts objectiveReplanning.test.ts dailyRoutineSchedule.test.ts`
  passed 52 files / 290 tests.
- FULL workspace:
  `pnpm check` passed lint, typecheck, and 156 files / 800 tests.
- DIFF hygiene: `git diff --check` passed.
