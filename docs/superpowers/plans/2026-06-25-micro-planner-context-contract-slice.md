# Micro-Planner Context Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the domain micro-planner proposal interface receive the same typed decision context that LLM action sequence generation already sees.

**Architecture:** Keep `WorldDecisionContext` as the single typed carrier for physiology, inventory, balance, housing, job, spot prices, and price index. Extend the `DomainMicroPlanner.propose` input in `@aivilization/agent-runtime` instead of introducing worker-only side channels, so deterministic fallback planners, canonical worker planners, and future plugin planners share one stable contract.

**Tech Stack:** TypeScript, Vitest, existing `@aivilization/agent-runtime` planning cycle abstractions.

---

### Task 1: Prove Micro-Planners Receive Planning Context

**Files:**

- Modify: `packages/agent-runtime/src/cycle.test.ts`
- Modify: `packages/agent-runtime/src/cycle.ts`

- [x] **Step 1: Write the failing test**

Add a test in `packages/agent-runtime/src/cycle.test.ts` that runs `runAgentPlanningCycle` without an LLM `actionSequenceGenerator`, captures the input passed to `DomainMicroPlanner.propose`, and expects it to include:

- `agentId`
- `issuedAt`
- `plan`
- `signals`
- `intentionState`
- `shortTermMemoryContext`
- `longTermProfile`
- `worldDecisionContext`
- `selectedSubtask`

- [x] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @aivilization/agent-runtime test -- cycle.test.ts
```

Expected: FAIL because `microPlanner.propose` only receives `{ selectedSubtask }`.

- [x] **Step 3: Implement minimal context plumbing**

In `packages/agent-runtime/src/cycle.ts`:

- Introduce `DomainMicroPlannerInput`.
- Change `DomainMicroPlanner.propose` to accept `DomainMicroPlannerInput`.
- Pass the same context fields into `collectSynthesisActionProposals`.
- Pass the same context fields into deterministic fallback calls inside `collectSynthesisActionProposalsWithGeneration`.

- [x] **Step 4: Run focused tests**

Run:

```bash
pnpm --filter @aivilization/agent-runtime test -- cycle.test.ts
```

Expected: PASS.

### Task 2: Check Downstream Worker Compatibility

**Files:**

- Existing canonical worker micro-planners should continue compiling because they can ignore extra fields.
- No worker production behavior should change except that the proposal input now carries context.

- [x] **Step 1: Run worker tests that exercise canonical planners**

Run:

```bash
pnpm --filter @aivilization/worker test -- canonicalDomainRuntimes.test.ts agentCycleRunner.test.ts
```

Expected: PASS.

### Task 3: Verify And Commit

- [x] **Step 1: Run full checks**

Run:

```bash
pnpm check
pnpm exec prettier --check docs/superpowers/plans/2026-06-25-micro-planner-context-contract-slice.md packages/agent-runtime/src/cycle.ts packages/agent-runtime/src/cycle.test.ts
git diff --check
```

- [x] **Step 2: Commit**

Commit only this slice:

```bash
git add docs/superpowers/plans/2026-06-25-micro-planner-context-contract-slice.md packages/agent-runtime/src/cycle.ts packages/agent-runtime/src/cycle.test.ts apps/worker/src/canonicalDomainRuntimes.test.ts apps/worker/src/canonicalWorkerRuntimeResolver.test.ts
git commit -m "feat(agent-runtime): 为 micro-planner 注入决策上下文"
```

### Self-Review

- Spec coverage: addresses the remaining backend contract gap where deterministic micro-planners could not consume the typed world and memory context already available to LLM action sequence generation.
- Placeholder scan: no placeholders remain.
- Scope check: deliberately limited to the micro-planner proposal contract; contextual scoring, price-sensitive deterministic ranking, and richer planner plugins remain later slices.
