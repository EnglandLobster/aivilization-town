# Simulator Event Trace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist compact Action Simulator event traces on every agent cycle.

**Architecture:** `agent-runtime` carries domain-agnostic simulator event summaries; `apps/worker` converts world dry-run events and maps runtime results into traces; `@aivilization/observability` owns the durable DTO and defensive cloning.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, `@aivilization/agent-runtime`, `@aivilization/observability`, `apps/worker`.

---

## Scope

- Add generic action simulation trace event types.
- Preserve trace events through repair and replan result conversion.
- Add `AgentCycleTrace.simulatorEvents`.
- Map world dry-run `WorldEvent`s into compact trace summaries.
- Clone nested simulator event traces and normalize legacy records.

## Task 1: Runtime Trace Propagation

**Files:**

- Modify: `packages/agent-runtime/src/actions.test.ts`
- Modify: `packages/agent-runtime/src/actions.ts`

- [x] **Step 1: Write failing runtime test**

Add a test proving `simulateActionWithRepair` returns:

- `originalTraceEvents` for the rejected original action;
- `repairedTraceEvents` for the accepted repaired action.

Run:

```bash
pnpm --filter @aivilization/agent-runtime test -- actions.test.ts
```

Expected: FAIL because repaired results currently drop simulator trace events.

Observed: FAIL, repaired results omitted `originalTraceEvents` and `repairedTraceEvents`.

- [x] **Step 2: Implement runtime trace fields**

Add `ActionSimulationTraceEvent`, optional `traceEvents` on `ActionSimulationResult`, and trace
fields on `ActionWithRepairResult`. Preserve trace events in `simulateActionWithRepair`.

## Task 2: Observability Trace Surface

**Files:**

- Modify: `packages/observability/src/agentCycleTrace.test.ts`
- Modify: `packages/observability/src/agentCycleTrace.ts`
- Modify: `packages/observability/src/agentCycleTraceRepository.test.ts`
- Modify: `packages/observability/src/agentCycleTraceRepository.ts`

- [x] **Step 3: Write failing observability tests**

Add tests proving:

- `createAgentCycleTrace` carries `simulatorEvents`;
- repositories clone nested simulator event arrays defensively;
- legacy file traces without `simulatorEvents` read back with `simulatorEvents: []`.

Run:

```bash
pnpm --filter @aivilization/observability test -- agentCycleTrace.test.ts agentCycleTraceRepository.test.ts
```

Expected: FAIL because repository cloning does not expose the field yet.

Observed: FAIL, repository reads dropped `simulatorEvents` and legacy reads did not normalize it.

- [x] **Step 4: Implement observability DTO and cloning**

Add `AgentCycleSimulatorTraceEvent`, `AgentCycleSimulatorEventTrace`, and
`AgentCycleTrace.simulatorEvents`. Update clone logic and legacy normalization.

## Task 3: Worker Mapping And Dry-Run Event Summaries

**Files:**

- Modify: `apps/worker/src/canonicalWorkerRuntimeResolver.test.ts`
- Modify: `apps/worker/src/canonicalWorkerRuntimeResolver.ts`
- Modify: `apps/worker/src/agentCycleRunner.test.ts`
- Modify: `apps/worker/src/agentCycleRunner.ts`

- [x] **Step 5: Write failing worker tests**

Add tests proving:

- `createWorldCommandDryRunSimulator` returns event summaries for accepted `AgentEat`;
- `runWorkerAgentCycle` maps simulator trace events into `result.trace.simulatorEvents`.

Run:

```bash
pnpm --filter @aivilization/worker test -- canonicalWorkerRuntimeResolver.test.ts agentCycleRunner.test.ts
```

Expected: FAIL because dry-run results and worker traces do not expose simulator events.

Observed: FAIL, `traceEvents` were missing from dry-run results and `result.trace.simulatorEvents`
was `undefined`.

- [x] **Step 6: Implement worker mappings**

Map `WorldEvent` objects to compact simulator trace events in the dry-run simulator. Map
`ActionWithRepairResult` objects to `AgentCycleTrace.simulatorEvents` in `runWorkerAgentCycle`.

## Task 4: Fixture Updates, Verification, Commit

**Files:**

- Modify: all `createAgentCycleTrace` fixtures that now require `simulatorEvents`.
- Modify: this plan file.

- [x] **Step 7: Run focused checks**

Run:

```bash
pnpm --filter @aivilization/agent-runtime test -- actions.test.ts
pnpm --filter @aivilization/observability test -- agentCycleTrace.test.ts agentCycleTraceRepository.test.ts
pnpm --filter @aivilization/worker test -- canonicalWorkerRuntimeResolver.test.ts agentCycleRunner.test.ts
pnpm --filter @aivilization/agent-runtime typecheck
pnpm --filter @aivilization/observability typecheck
pnpm --filter @aivilization/worker typecheck
```

- [x] **Step 8: Run full verification**

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

Observed:

- `pnpm lint`: PASS.
- `pnpm typecheck`: PASS across 13 workspace projects.
- `pnpm test`: PASS, 139 test files and 680 tests.
- `pnpm build`: PASS across 13 workspace projects.
- `git diff --check`: PASS.

- [x] **Step 9: Inspect diff**

Confirm changes are limited to runtime trace types, observability trace DTO/repository, worker
mapping, test fixtures, and this slice's docs.

- [x] **Step 10: Commit**

Commit with:

```bash
git add docs/superpowers/specs/2026-06-25-simulator-event-trace-design.md docs/superpowers/plans/2026-06-25-simulator-event-trace-slice.md packages/agent-runtime/src/actions.test.ts packages/agent-runtime/src/actions.ts packages/observability/src/agentCycleTrace.test.ts packages/observability/src/agentCycleTrace.ts packages/observability/src/agentCycleTraceRepository.test.ts packages/observability/src/agentCycleTraceRepository.ts apps/worker/src/canonicalWorkerRuntimeResolver.test.ts apps/worker/src/canonicalWorkerRuntimeResolver.ts apps/worker/src/agentCycleRunner.test.ts apps/worker/src/agentCycleRunner.ts apps/worker/src/experimentValidationRunner.test.ts apps/worker/src/localExperimentValidationSchedule.test.ts apps/server/src/localRuntimeTownPlannerAblationSuite.test.ts apps/server/src/localRuntimeTownPlannerOutcomeMetrics.test.ts
git commit -m "feat: trace simulator dry-run events"
```
