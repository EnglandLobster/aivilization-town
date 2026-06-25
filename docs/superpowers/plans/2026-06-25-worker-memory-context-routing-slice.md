# Worker Memory Context Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route short-term memory retrieval budgets from worker scheduling into agent cycles so
ambient and action memories can affect later planning.

**Architecture:** Keep actual STM retrieval in `runWorkerAgentCycle`. Add an optional
`memoryRetrievalLimit` to scheduled tick agents, pass it through `runWorkerSimulationTick`, and
enable a conservative default for local runtime profile agent providers.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, `apps/worker`, `apps/server`.

---

## Scope

- Add memory retrieval budget to `WorkerTickAgentInput`.
- Carry the budget through `buildWorkerTickAgentsFromActivePlans`.
- Pass the budget from `runWorkerSimulationTick` into `runWorkerAgentCycle`.
- Enable a default memory context budget in `createLocalRuntimeTownProfileAgentProvider`.

## Task 1: Failing Tests

**Files:**

- Modify: `apps/worker/src/tickRunner.test.ts`
- Modify: `apps/worker/src/agentScheduling.test.ts`

- [x] **Step 1: Worker tick context routing test**

Seed one STM record for a scheduled agent, run a worker tick with `memoryRetrievalLimit: 1`, and
assert `result.traces[0].memoryContextIds` contains that record id.

- [x] **Step 2: Active-plan scheduling budget test**

Call `buildWorkerTickAgentsFromActivePlans` with `memoryRetrievalLimit` and assert scheduled
`WorkerTickAgentInput` values carry the budget.

Run:

```bash
pnpm --filter @aivilization/worker test -- tickRunner.test.ts agentScheduling.test.ts
```

Expected: FAIL because tick agents do not yet expose or pass the budget.

Observed: `tickRunner.test.ts` failed with empty `memoryContextIds`, and
`agentScheduling.test.ts` failed because scheduled tick agents had `memoryRetrievalLimit:
undefined`.

## Task 2: Worker Routing

**Files:**

- Modify: `apps/worker/src/tickRunner.ts`
- Modify: `apps/worker/src/agentScheduling.ts`

- [x] **Step 3: Implement routing**

Add `memoryRetrievalLimit?: number` to `WorkerTickAgentInput`, pass it to `runWorkerAgentCycle`,
and have `buildWorkerTickAgentsFromActivePlans` attach the budget when configured.

- [x] **Step 4: Focused verification**

Run:

```bash
pnpm --filter @aivilization/worker test -- tickRunner.test.ts agentScheduling.test.ts
pnpm --filter @aivilization/worker typecheck
```

Observed: `pnpm --filter @aivilization/worker test -- tickRunner.test.ts agentScheduling.test.ts`
passed. `pnpm --filter @aivilization/worker typecheck` passed.

## Task 3: Profile Runtime Default

**Files:**

- Modify: `apps/server/src/localRuntimeTownProfileRunner.ts`
- Modify: `apps/server/src/localRuntimeTownProfileRunner.test.ts`

- [x] **Step 5: Enable conservative default**

Add a profile-provider `memoryRetrievalLimit` option and default it for local runtime profile
agents. Keep the lower worker primitives opt-in.

- [x] **Step 6: Server focused verification**

Run:

```bash
pnpm --filter @aivilization/server test -- localRuntimeTownProfileRunner.test.ts
pnpm --filter @aivilization/server typecheck
```

Observed: `pnpm --filter @aivilization/server test -- localRuntimeTownProfileRunner.test.ts`
passed. `pnpm --filter @aivilization/server typecheck` passed.

## Task 4: Full Verification And Commit

- [x] **Step 7: Run full checks**

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

Observed:

- `pnpm lint` passed.
- `pnpm typecheck` passed.
- `pnpm test` passed with 141 test files and 693 tests.
- `pnpm build` passed.
- `git diff --check` passed.

- [x] **Step 8: Inspect and commit**

Confirm the diff is limited to memory-context routing, tests, docs, and profile-provider defaults.

Commit with:

```bash
git add docs/superpowers/specs/2026-06-25-worker-memory-context-routing-design.md docs/superpowers/plans/2026-06-25-worker-memory-context-routing-slice.md apps/worker/src/tickRunner.ts apps/worker/src/tickRunner.test.ts apps/worker/src/agentScheduling.ts apps/worker/src/agentScheduling.test.ts apps/worker/src/canonicalActivePlanTick.ts apps/server/src/localRuntimeTownProfileRunner.ts apps/server/src/localRuntimeTownProfileRunner.test.ts
git commit -m "feat: route memory context into worker ticks"
```

Observed: committed with message `feat: route memory context into worker ticks`.
