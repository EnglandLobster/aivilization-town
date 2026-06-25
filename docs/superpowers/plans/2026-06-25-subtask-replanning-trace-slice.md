# Subtask Replanning Trace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose and persist per-producer-subtask replanning decisions so multi-branch planning failures are observable without replacing the existing global `replanningDecision`.

**Architecture:** Keep `replanningDecision` as the cycle-level compatibility surface. `cycle.ts` groups simulation results by action synthesis context and emits `subtaskReplanningDecisions`; `apps/worker` maps those decisions into `@aivilization/observability` traces; trace repositories clone the nested decision list defensively.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, `@aivilization/agent-runtime`, `@aivilization/observability`, `apps/worker`.

---

## Scope

- Add `AgentCycleSubtaskReplanningDecision` and `AgentCycleResult.subtaskReplanningDecisions`.
- Add `AgentCycleSubtaskReplanningDecisionTrace` and `AgentCycleTrace.subtaskReplanningDecisions`.
- Map runtime subtask replan decisions into worker traces.
- Clone nested subtask replan decisions in trace repositories.
- Preserve global `replanningDecision` and current progress update behavior.

## Task 1: Runtime Per-Subtask Replanning Decisions

**Files:**

- Modify: `packages/agent-runtime/src/cycle.test.ts`
- Modify: `packages/agent-runtime/src/cycle.ts`

- [x] **Step 1: Write failing runtime test**

Add a test proving:

- top selected `income/work` succeeds;
- second synthesized `development/study` fails and escalates to full replan;
- `result.subtaskReplanningDecisions` contains `work -> none`;
- `result.subtaskReplanningDecisions` contains `study -> full-replan`.

Run:

```bash
pnpm --filter @aivilization/agent-runtime test -- cycle.test.ts
```

Expected: FAIL because `subtaskReplanningDecisions` does not exist yet.

Observed: FAIL, `result.subtaskReplanningDecisions` was `undefined`.

- [x] **Step 2: Implement runtime grouped replanning**

In `cycle.ts`:

- add `AgentCycleSubtaskReplanningDecision`;
- add `subtaskReplanningDecisions` to `AgentCycleResult`;
- reuse producer grouping to call `decideAdaptiveReplanning` per group;
- use the same memory context and replanning policy as the global decision;
- preserve global `replanningDecision`.

## Task 2: Observability Trace Surface

**Files:**

- Modify: `packages/observability/src/agentCycleTrace.test.ts`
- Modify: `packages/observability/src/agentCycleTrace.ts`
- Modify: `packages/observability/src/agentCycleTraceRepository.test.ts`
- Modify: `packages/observability/src/agentCycleTraceRepository.ts`

- [x] **Step 1: Write failing trace tests**

Add tests proving:

- `createAgentCycleTrace` carries `subtaskReplanningDecisions`;
- trace repositories clone nested subtask replanning decisions defensively.

Run:

```bash
pnpm --filter @aivilization/observability test -- agentCycleTrace.test.ts agentCycleTraceRepository.test.ts
```

Expected: FAIL because trace type/repository cloning does not expose the new field.

Observed: FAIL, repository reads dropped `subtaskReplanningDecisions`.

- [x] **Step 2: Implement trace types and cloning**

Add `AgentCycleSubtaskReplanningDecisionTrace`, add the array to `AgentCycleTrace`, and update
`cloneTrace` to clone each nested decision via the existing `cloneReplanningDecision` helper.

## Task 3: Worker Trace Mapping

**Files:**

- Modify: `apps/worker/src/agentCycleRunner.test.ts`
- Modify: `apps/worker/src/agentCycleRunner.ts`

- [x] **Step 1: Write failing worker trace test**

Extend the multi-subtask full-replan worker test to expect:

- `result.trace.subtaskReplanningDecisions` contains `sleep -> none`;
- `result.trace.subtaskReplanningDecisions` contains `study -> full-replan`.

Run:

```bash
pnpm --filter @aivilization/worker test -- agentCycleRunner.test.ts
```

Expected: FAIL until worker maps runtime subtask decisions into traces.

Observed: FAIL, `result.trace.subtaskReplanningDecisions` was `undefined`.

- [x] **Step 2: Implement worker mapping**

Map each runtime decision into `{ branchId, subtaskId, decision }` and pass it to
`createAgentCycleTrace`.

## Task 4: Verification

**Files:**

- Modify: this plan file

- [x] Run focused tests:

```bash
pnpm --filter @aivilization/agent-runtime test -- cycle.test.ts
pnpm --filter @aivilization/observability test -- agentCycleTrace.test.ts agentCycleTraceRepository.test.ts
pnpm --filter @aivilization/worker test -- agentCycleRunner.test.ts
```

- [x] Run focused typechecks:

```bash
pnpm --filter @aivilization/agent-runtime typecheck
pnpm --filter @aivilization/observability typecheck
pnpm --filter @aivilization/worker typecheck
```

- [x] Run full verification:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

- [x] Inspect `git diff`.
- [x] Commit as `feat: trace replans by subtask`.
