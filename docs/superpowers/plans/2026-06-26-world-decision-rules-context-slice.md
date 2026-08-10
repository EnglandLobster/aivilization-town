# World Decision Rules Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add portable world-rule summaries to `WorldDecisionContext` so LLM decision stages can reason about occupation eligibility and production constraints before simulator rejection.

**Architecture:** Keep `@aivilization/agent-runtime` as the DTO owner and keep concrete content/policy adaptation in `apps/worker`. The worker derives optional `rules` from projection, content catalogs, and command policies, while existing callers without policies continue receiving the current agent/market context. Existing LLM prompt compilers need no separate side channel because they already serialize `worldDecisionContext`.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, `@aivilization/agent-runtime`, `apps/worker`, `@aivilization/content`, `@aivilization/society`.

---

### Task 1: Worker World Rule Context

**Files:**

- Modify: `packages/agent-runtime/src/worldDecisionContext.ts`
- Modify: `apps/worker/src/worldDecisionContext.ts`
- Modify: `apps/worker/src/worldDecisionContext.test.ts`
- Modify: `apps/worker/src/agentScheduling.ts`
- Modify: `apps/worker/src/agentScheduling.test.ts`
- Modify: `apps/worker/src/canonicalActivePlanTick.ts`
- Modify: `apps/worker/src/agentCycleRunner.ts`
- Modify: `apps/worker/src/agentCycleRunner.test.ts`
- Modify: `apps/server/src/localRuntimeTownProfileRunner.ts`

- [x] **Step 1: Write failing worker context test**

Extend `apps/worker/src/worldDecisionContext.test.ts` with a production-path case that calls:

```ts
createWorldDecisionContextFromProjection({
  projection,
  agentId,
  policies: {
    ...,
    jobApplication: {
      populationEducationScores: [10, 30, 70, 150],
      quotaByResidentialTier: [1, 2, 3, 4, 5],
    },
    production: {
      efficiency: {
        minEfficiency: 0.5,
        educationScoreForMaxEfficiency: 500,
      },
    },
  },
})
```

Assert the returned context includes:

- `rules.occupations` entries for `Cleaner` and `Stock Clerk`
- effective education thresholds and residential requirements
- eligibility/rejection reasons from the current agent state
- `rules.production` entries for producible commodities such as `Apple` and gated commodities such as `Transistor`
- recipe input and physiology cost metadata
- `rules.criticalThresholds` from policies

- [x] **Step 2: Verify worker context RED**

Run:

```bash
pnpm vitest run apps/worker/src/worldDecisionContext.test.ts -t "rules"
```

Expected: FAIL because `WorldDecisionContext` has no `rules` field and the builder ignores policies.

- [x] **Step 3: Add portable rule DTOs**

In `packages/agent-runtime/src/worldDecisionContext.ts`, add:

```ts
WorldDecisionOccupationRule;
WorldDecisionProductionRule;
WorldDecisionRulesContext;
```

Attach optional `rules?: WorldDecisionRulesContext` to `WorldDecisionContext`. Keep these types plain-data and free of imports from `world`, `content`, `society`, or `economy`.

- [x] **Step 4: Implement worker rule adaptation**

In `apps/worker/src/worldDecisionContext.ts`, accept optional `policies?: WorldCommandPolicies`.

Build:

- occupation rules from `occupations`, `jobTiers`, `calculateEffectiveKnowledgeThreshold`, current applications, and current agent state
- production rules from `commodities`, `productionRecipes`, current agent residential tier, and recipe costs
- critical threshold rules from `policies.criticalThresholds`

Sort occupations by job tier then name, and production rules by commodity name. Do not call simulator or mutate projection.

- [x] **Step 5: Verify worker context GREEN**

Run:

```bash
pnpm vitest run apps/worker/src/worldDecisionContext.test.ts -t "rules"
```

Expected: PASS.

### Task 2: Production Cycle Wiring And Prompt Proof

**Files:**

- Modify: `apps/worker/src/agentCycleRunner.ts`
- Modify: `apps/worker/src/agentCycleRunner.test.ts`
- Modify: `packages/agent-runtime/src/llmSubtaskPrioritizer.test.ts`

- [x] **Step 1: Write failing cycle wiring test**

Add an `agentCycleRunner` test that omits `worldDecisionContext`, configures a `subtaskPrioritizer`, and asserts the prioritizer input receives:

```ts
worldDecisionContext.rules.occupations;
worldDecisionContext.rules.production;
worldDecisionContext.rules.criticalThresholds;
```

This proves the production fallback path builds the enriched context from `projection + policies`.

- [x] **Step 2: Verify cycle wiring RED**

Run:

```bash
pnpm vitest run apps/worker/src/agentCycleRunner.test.ts -t "rules"
```

Expected: FAIL because `runWorkerAgentCycle` does not pass policies into the context builder.

- [x] **Step 3: Wire policies into cycle fallback context**

Update the fallback call in `runWorkerAgentCycle`:

```ts
createWorldDecisionContextFromProjection({
  projection: input.projection,
  agentId: input.agentId,
  policies: input.policies,
});
```

Keep explicitly supplied `worldDecisionContext` authoritative.

Also pass policies into `buildWorkerTickAgentsFromActivePlans` from canonical active-plan and server
profile-run paths so prebuilt scheduled-agent contexts carry the same rules.

- [x] **Step 4: Add LLM prompt proof**

Extend one LLM prompt test, preferably `llmSubtaskPrioritizer.test.ts`, so its test context includes a small `rules` object and asserts the request payload contains `"rules"`, `"Stock Clerk"`, and `"effectiveEducationThreshold"`.

- [x] **Step 5: Verify focused GREEN**

Run:

```bash
pnpm vitest run apps/worker/src/worldDecisionContext.test.ts apps/worker/src/agentCycleRunner.test.ts packages/agent-runtime/src/llmSubtaskPrioritizer.test.ts -t "rules|world decision context|LLM contextual"
```

Expected: relevant tests pass.

### Task 3: Final Verification And Commit

**Files:**

- All files modified in Tasks 1-2 plus this plan.

- [x] **Step 1: Run targeted tests**

Run:

```bash
pnpm vitest run apps/worker/src/worldDecisionContext.test.ts apps/worker/src/agentCycleRunner.test.ts packages/agent-runtime/src/llmSubtaskPrioritizer.test.ts
```

- [x] **Step 2: Run workspace checks**

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test
git diff --check
```

- [x] **Step 3: Commit**

Stage only this plan and the rules-context code/tests. Leave unrelated `docs/Aivilization-paper/` and `docs/reports/` directories untouched.
