# Branch-Aware Global Synthesis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add branch-aware global action synthesis so candidate actions can be selected by strategic alignment, branch urgency, and per-branch conflict limits instead of base action priority alone.

**Architecture:** Keep synthesis as a pure `@aivilization/agent-runtime` planning boundary. `AtomicActionProposal` carries optional synthesis context, the planning cycle injects selected branch/subtask context before synthesis, and `@aivilization/observability` persists that context without inspecting world command payloads.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, `@aivilization/agent-runtime`, `@aivilization/observability`, `apps/worker`.

---

## Scope

- Add optional `ActionSynthesisContext` to action proposals.
- Add action synthesis scoring weights for `priority`, `strategicAlignment`, `branchUrgency`, and `subtaskScore`.
- Add a per-branch accepted-action cap that rejects extra actions with deterministic reasons.
- Preserve existing synthesis behavior when no new policy fields are supplied.
- Inject selected subtask provenance into cycle proposals before synthesis.
- Persist synthesis context in agent cycle traces and repositories.
- Keep this slice single-selected-subtask compatible; multi-subtask synthesis becomes a later branch that can reuse these primitives.

## Task 1: Pure Branch-Aware Synthesis

**Files:**

- Modify: `packages/agent-runtime/src/actionSynthesis.test.ts`
- Modify: `packages/agent-runtime/src/actionSynthesis.ts`
- Modify: `packages/agent-runtime/src/actions.ts`

- [x] **Step 1: Write failing tests**

Add tests proving:

- a per-branch cap prevents one branch from consuming the whole action budget;
- strategic alignment and branch urgency can outrank raw priority when scoring weights are supplied.

Run:

```bash
pnpm --filter @aivilization/agent-runtime test -- actionSynthesis.test.ts
```

Expected: FAIL because action proposals do not expose synthesis context and policy has no branch-aware scoring or branch cap.

- [x] **Step 2: Implement minimal pure synthesis support**

Add:

```ts
export type ActionSynthesisContext = {
  readonly branchId?: string;
  readonly subtaskId?: string;
  readonly subtaskScore?: number;
  readonly strategicAlignment?: number;
  readonly branchUrgency?: number;
};
```

Extend `AtomicActionProposal` with `synthesisContext?: ActionSynthesisContext`.

Extend `ActionSynthesisPolicy` with:

```ts
readonly scoring?: {
  readonly priorityWeight?: number;
  readonly strategicAlignmentWeight?: number;
  readonly branchUrgencyWeight?: number;
  readonly subtaskScoreWeight?: number;
};
readonly branchLimits?: {
  readonly maxAcceptedActionsPerBranch?: number;
};
```

Rank by weighted score and original order. If `maxAcceptedActionsPerBranch` is supplied and a candidate has a `branchId` whose accepted count is exhausted, reject it with `branch action budget exhausted for <branchId>`.

## Task 2: Cycle Context Injection

**Files:**

- Modify: `packages/agent-runtime/src/cycle.test.ts`
- Modify: `packages/agent-runtime/src/cycle.ts`

- [x] **Step 1: Write failing cycle test**

Add a test where the selected subtask is `development/study`, the micro-planner proposal has no synthesis context, and `result.actionSynthesisResult.acceptedActions[0].synthesisContext` equals:

```ts
{
  branchId: 'development',
  subtaskId: 'study',
  subtaskScore: 5,
}
```

Run:

```bash
pnpm --filter @aivilization/agent-runtime test -- cycle.test.ts
```

Expected: FAIL because the cycle currently passes raw micro-planner proposals directly to synthesis.

- [x] **Step 2: Inject selected subtask context**

Before calling `synthesizeActionCandidates`, clone proposed actions and merge:

- selected candidate `branchId`;
- selected candidate `subtaskId`;
- selected candidate `score` as `subtaskScore`;
- any action-provided `strategicAlignment` or `branchUrgency`.

Existing action-provided `branchId`, `subtaskId`, and `subtaskScore` stay authoritative only if they are already present.

## Task 3: Trace Synthesis Context

**Files:**

- Modify: `packages/observability/src/agentCycleTrace.test.ts`
- Modify: `packages/observability/src/agentCycleTrace.ts`
- Modify: `packages/observability/src/agentCycleTraceRepository.test.ts`
- Modify: `packages/observability/src/agentCycleTraceRepository.ts`
- Modify: `apps/worker/src/agentCycleRunner.test.ts`
- Modify: `apps/worker/src/agentCycleRunner.ts`

- [x] **Step 1: Write failing trace tests**

Add `synthesisContext` to accepted and rejected trace action proposals. Mutate a returned repository trace's nested context and prove the stored trace remains unchanged.

Run:

```bash
pnpm --filter @aivilization/observability test -- agentCycleTrace.test.ts agentCycleTraceRepository.test.ts
```

Expected: FAIL because trace action proposals do not carry synthesis context.

- [x] **Step 2: Write failing worker mapping test**

Extend the worker action synthesis test to expect the accepted `study` trace action to include:

```ts
synthesisContext: {
  branchId: 'development',
  subtaskId: 'study',
  subtaskScore: 5,
}
```

Run:

```bash
pnpm --filter @aivilization/worker test -- agentCycleRunner.test.ts
```

Expected: FAIL because worker trace mapping drops synthesis context.

- [x] **Step 3: Implement trace mapping and repository cloning**

Add an observability trace type for synthesis context, map it from runtime action proposals in `runWorkerAgentCycle`, and clone nested context defensively in trace repositories.

## Task 4: Verification

**Files:**

- Modify: this plan file

- [x] Run focused tests:

```bash
pnpm --filter @aivilization/agent-runtime test -- actionSynthesis.test.ts cycle.test.ts
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
- [x] Commit as `feat: add branch-aware global synthesis`.

Observed verification:

- Red pure synthesis tests failed first because ranking ignored branch caps and alignment/urgency.
- Red cycle test failed first because accepted actions had no `synthesisContext`.
- Red observability repository test failed first because clone logic dropped nested context.
- Red worker trace test failed first because trace mapping dropped runtime synthesis context.
- Focused tests passed:
  - `pnpm --filter @aivilization/agent-runtime test -- actionSynthesis.test.ts cycle.test.ts`
  - `pnpm --filter @aivilization/observability test -- agentCycleTrace.test.ts agentCycleTraceRepository.test.ts`
  - `pnpm --filter @aivilization/worker test -- agentCycleRunner.test.ts tickRunner.test.ts`
- Focused typechecks passed for `@aivilization/agent-runtime`, `@aivilization/observability`, and `@aivilization/worker`.
- Full verification passed:
  - `pnpm lint`
  - `pnpm typecheck`
  - `pnpm test` (`139` files, `668` tests)
  - `pnpm build`
  - `git diff --check`
- Diff inspected before commit.
