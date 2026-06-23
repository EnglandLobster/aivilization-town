# Candidate Subtask Scoring Trace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Return and trace every selectable subtask candidate with deterministic score breakdown during agent planning cycles.

**Architecture:** `@aivilization/agent-runtime` owns candidate scoring and ranking. `@aivilization/observability` owns a serializable trace shape. `apps/worker` maps runtime candidate data into traces without recalculating planner scores.

**Tech Stack:** TypeScript, Vitest, `@aivilization/agent-runtime`, `@aivilization/observability`, `apps/worker`.

---

## Scope

This slice adds:

- `PrioritizedSubtaskScoreBreakdown`.
- `PrioritizedSubtaskCandidate`.
- `scorePrioritizedSubtaskCandidates`.
- `AgentCycleResult.subtaskCandidates`.
- `AgentCycleTrace.subtaskCandidates`.
- Worker trace wiring for subtask candidate score breakdowns.

It does not trace gated-out subtasks, candidate action simulator attempts, LLM rationales, UI panels,
or experiment-diff reports.

## File Structure

- Modify `packages/agent-runtime/src/planner.test.ts`: candidate scoring red test.
- Modify `packages/agent-runtime/src/planner.ts`: candidate scoring API and `selectPrioritizedSubtask` reuse.
- Modify `packages/agent-runtime/src/cycle.test.ts`: cycle result candidate trace red test.
- Modify `packages/agent-runtime/src/cycle.ts`: return sorted candidate list.
- Modify `packages/observability/src/agentCycleTrace.test.ts`: trace shape red test.
- Modify `packages/observability/src/agentCycleTrace.ts`: trace candidate type and required field.
- Modify `packages/observability/src/agentCycleTraceRepository.ts`: clone trace candidates.
- Modify `packages/observability/src/agentCycleTraceRepository.test.ts`: preserve subtask candidates through repository clones.
- Modify `apps/worker/src/agentCycleRunner.test.ts`: worker trace wiring red test.
- Modify `apps/worker/src/agentCycleRunner.ts`: map runtime candidates to trace.
- Modify this plan file as tasks complete.

## Task 1: Runtime Candidate Scoring Tests

**Files:**

- Modify: `packages/agent-runtime/src/planner.test.ts`
- Modify: `packages/agent-runtime/src/cycle.test.ts`

- [ ] **Step 1: Add failing planner candidate scoring test**

Import `scorePrioritizedSubtaskCandidates` in `packages/agent-runtime/src/planner.test.ts`.

Add this test:

```ts
test('scores selectable subtask candidates with deterministic breakdowns', () => {
  const plan = createBranchPlan({
    objective: 'balance survival and growth',
    branches: [
      {
        id: 'income',
        objective: 'earn wage',
        subtasks: [
          { id: 'work', description: 'work shift', basePriority: 3, signalKeys: ['low-money'] },
        ],
      },
      {
        id: 'recovery',
        objective: 'recover energy',
        subtasks: [
          {
            id: 'sleep',
            description: 'rest before work',
            basePriority: 1,
            signalKeys: ['low-energy'],
          },
        ],
      },
      {
        id: 'development',
        objective: 'improve education',
        subtasks: [
          {
            id: 'study',
            description: 'self study',
            basePriority: 2,
          },
        ],
      },
    ],
  });

  expect(
    scorePrioritizedSubtaskCandidates({
      plan,
      signals: [
        { key: 'low-energy', weight: 2 },
        { key: 'low-energy', weight: 0.5 },
      ],
      intentionInfluence: {
        study: { score: 3, matches: [] },
      },
      memoryInfluence: {
        sleep: { score: 1.5, matches: [] },
      },
      profileInfluence: {
        study: { score: 0.75, matches: [] },
      },
    }),
  ).toEqual([
    {
      branchId: 'development',
      subtaskId: 'study',
      description: 'self study',
      score: 5.75,
      scoreBreakdown: {
        basePriorityScore: 2,
        signalInfluenceScore: 0,
        intentionInfluenceScore: 3,
        memoryInfluenceScore: 0,
        profileInfluenceScore: 0.75,
      },
    },
    {
      branchId: 'recovery',
      subtaskId: 'sleep',
      description: 'rest before work',
      score: 5,
      scoreBreakdown: {
        basePriorityScore: 1,
        signalInfluenceScore: 2.5,
        intentionInfluenceScore: 0,
        memoryInfluenceScore: 1.5,
        profileInfluenceScore: 0,
      },
    },
    {
      branchId: 'income',
      subtaskId: 'work',
      description: 'work shift',
      score: 3,
      scoreBreakdown: {
        basePriorityScore: 3,
        signalInfluenceScore: 0,
        intentionInfluenceScore: 0,
        memoryInfluenceScore: 0,
        profileInfluenceScore: 0,
      },
    },
  ]);
});
```

Run:

```bash
pnpm --filter @aivilization/agent-runtime test
```

Expected before implementation: fail because `scorePrioritizedSubtaskCandidates` does not exist.

- [ ] **Step 2: Add failing cycle result candidate list test**

In `packages/agent-runtime/src/cycle.test.ts`, update the existing short-term memory/profile
selection test to assert `result.subtaskCandidates`:

```ts
expect(result.subtaskCandidates).toEqual([
  {
    branchId: 'recovery',
    subtaskId: 'sleep',
    description: 'rest before working',
    score: 5.6,
    scoreBreakdown: {
      basePriorityScore: 1,
      signalInfluenceScore: 0,
      intentionInfluenceScore: 0,
      memoryInfluenceScore: 3.2,
      profileInfluenceScore: 1.4,
    },
  },
  {
    branchId: 'income',
    subtaskId: 'work',
    description: 'work shift',
    score: 4,
    scoreBreakdown: {
      basePriorityScore: 4,
      signalInfluenceScore: 0,
      intentionInfluenceScore: 0,
      memoryInfluenceScore: 0,
      profileInfluenceScore: 0,
    },
  },
]);
```

Run:

```bash
pnpm --filter @aivilization/agent-runtime test
```

Expected before implementation: fail because `AgentCycleResult.subtaskCandidates` does not exist.

## Task 2: Runtime Candidate Scoring Implementation

**Files:**

- Modify: `packages/agent-runtime/src/planner.ts`
- Modify: `packages/agent-runtime/src/cycle.ts`

- [ ] **Step 3: Implement candidate scoring API**

Add to `packages/agent-runtime/src/planner.ts`:

```ts
export type PrioritizedSubtaskScoreBreakdown = {
  readonly basePriorityScore: number;
  readonly signalInfluenceScore: number;
  readonly intentionInfluenceScore: number;
  readonly memoryInfluenceScore: number;
  readonly profileInfluenceScore: number;
};

export type PrioritizedSubtaskCandidate = PrioritizedSubtask & {
  readonly scoreBreakdown: PrioritizedSubtaskScoreBreakdown;
};
```

Create `scorePrioritizedSubtaskCandidates(input)` with the same input type as
`selectPrioritizedSubtask`. Move signal-weight construction and candidate construction from
`selectPrioritizedSubtask` into this function. `selectPrioritizedSubtask` should call it and return:

```ts
const { scoreBreakdown: _scoreBreakdown, ...selectedSubtask } = selected;
return selectedSubtask;
```

- [ ] **Step 4: Return candidate list from cycle result**

Modify `packages/agent-runtime/src/cycle.ts`:

- import `scorePrioritizedSubtaskCandidates` and `type PrioritizedSubtaskCandidate`;
- add `readonly subtaskCandidates: readonly PrioritizedSubtaskCandidate[]` to `AgentCycleResult`;
- call `scorePrioritizedSubtaskCandidates` after influence maps are built;
- select the first candidate and strip `scoreBreakdown` for `selectedSubtask`;
- return `subtaskCandidates`.

Run:

```bash
pnpm --filter @aivilization/agent-runtime test
pnpm --filter @aivilization/agent-runtime typecheck
```

Expected after implementation: both pass.

## Task 3: Observability Trace Tests

**Files:**

- Modify: `packages/observability/src/agentCycleTrace.test.ts`
- Modify: `packages/observability/src/agentCycleTraceRepository.test.ts`

- [ ] **Step 5: Add failing trace shape test**

In `packages/observability/src/agentCycleTrace.test.ts`, add `subtaskCandidates` to the trace input:

```ts
subtaskCandidates: [
  {
    branchId: 'production-resource-management',
    subtaskId: 'craft-transistor',
    description: 'craft Transistor',
    score: 7.25,
    scoreBreakdown: {
      basePriorityScore: 3,
      signalInfluenceScore: 2,
      intentionInfluenceScore: 0,
      memoryInfluenceScore: 1.25,
      profileInfluenceScore: 1,
    },
  },
],
```

Assert:

```ts
expect(trace.subtaskCandidates[0]?.scoreBreakdown.memoryInfluenceScore).toBe(1.25);
```

Run:

```bash
pnpm --filter @aivilization/observability typecheck
```

Expected before implementation: fail because `AgentCycleTrace.subtaskCandidates` does not exist.

- [ ] **Step 6: Add failing repository clone preservation test**

In `packages/observability/src/agentCycleTraceRepository.test.ts`, update `createTrace` to include
a `subtaskCandidates` array with one candidate. After mutating the read trace, also mutate:

```ts
(read!.subtaskCandidates[0]!.scoreBreakdown as { memoryInfluenceScore: number }).memoryInfluenceScore = 999;
```

The existing `await expect(repository.get('trace-200')).resolves.toEqual(newer);` assertion should
continue proving clone boundaries for nested candidate breakdowns.

Run:

```bash
pnpm --filter @aivilization/observability test
```

Expected before implementation: fail because repository clone logic does not handle
`subtaskCandidates`.

## Task 4: Observability Trace Implementation

**Files:**

- Modify: `packages/observability/src/agentCycleTrace.ts`
- Modify: `packages/observability/src/agentCycleTraceRepository.ts`

- [ ] **Step 7: Extend trace schema**

Add to `packages/observability/src/agentCycleTrace.ts`:

```ts
export type AgentCycleSubtaskCandidateTrace = {
  readonly branchId: string;
  readonly subtaskId: string;
  readonly description: string;
  readonly score: number;
  readonly scoreBreakdown: {
    readonly basePriorityScore: number;
    readonly signalInfluenceScore: number;
    readonly intentionInfluenceScore: number;
    readonly memoryInfluenceScore: number;
    readonly profileInfluenceScore: number;
  };
};
```

Add required field:

```ts
readonly subtaskCandidates: readonly AgentCycleSubtaskCandidateTrace[];
```

Update `createAgentCycleTrace` to throw `agent cycle trace requires at least one subtask candidate`
when `input.subtaskCandidates.length === 0`.

- [ ] **Step 8: Clone trace candidates in repository**

Update `packages/observability/src/agentCycleTraceRepository.ts` clone logic to deep clone
`subtaskCandidates` and their nested `scoreBreakdown`.

Run:

```bash
pnpm --filter @aivilization/observability test
pnpm --filter @aivilization/observability typecheck
```

Expected after implementation: both pass.

## Task 5: Worker Trace Wiring Tests

**Files:**

- Modify: `apps/worker/src/agentCycleRunner.test.ts`

- [ ] **Step 9: Add failing worker trace candidate assertion**

In the worker memory/profile-context planning test, assert:

```ts
expect(result.trace.subtaskCandidates).toEqual([
  {
    branchId: 'recovery',
    subtaskId: 'sleep',
    description: 'rest before working',
    score: 5.6,
    scoreBreakdown: {
      basePriorityScore: 1,
      signalInfluenceScore: 0,
      intentionInfluenceScore: 0,
      memoryInfluenceScore: 3.2,
      profileInfluenceScore: 1.4,
    },
  },
  {
    branchId: 'income',
    subtaskId: 'work',
    description: 'work shift',
    score: 4,
    scoreBreakdown: {
      basePriorityScore: 4,
      signalInfluenceScore: 0,
      intentionInfluenceScore: 0,
      memoryInfluenceScore: 0,
      profileInfluenceScore: 0,
    },
  },
]);
```

Run:

```bash
pnpm --filter @aivilization/worker test
```

Expected before implementation: fail because worker traces do not include `subtaskCandidates`.

## Task 6: Worker Trace Wiring Implementation

**Files:**

- Modify: `apps/worker/src/agentCycleRunner.ts`

- [ ] **Step 10: Map runtime candidates into trace**

In `runWorkerAgentCycle`, pass:

```ts
subtaskCandidates: cycleResult.subtaskCandidates,
```

to `createAgentCycleTrace`.

Run:

```bash
pnpm --filter @aivilization/worker test
pnpm --filter @aivilization/worker typecheck
```

Expected after implementation: both pass.

## Task 7: Verification And Commit

**Files:**

- Modify: this plan file

- [ ] **Step 11: Run focused verification**

Run:

```bash
pnpm --filter @aivilization/agent-runtime test
pnpm --filter @aivilization/agent-runtime typecheck
pnpm --filter @aivilization/observability test
pnpm --filter @aivilization/observability typecheck
pnpm --filter @aivilization/worker test
pnpm --filter @aivilization/worker typecheck
```

- [ ] **Step 12: Run repo verification**

Run:

```bash
pnpm check
pnpm build
```

- [ ] **Step 13: Commit implementation**

Commit command:

```bash
git add docs/superpowers/plans/2026-06-24-candidate-subtask-scoring-trace-slice.md packages/agent-runtime/src/planner.test.ts packages/agent-runtime/src/planner.ts packages/agent-runtime/src/cycle.test.ts packages/agent-runtime/src/cycle.ts packages/observability/src/agentCycleTrace.test.ts packages/observability/src/agentCycleTrace.ts packages/observability/src/agentCycleTraceRepository.test.ts packages/observability/src/agentCycleTraceRepository.ts apps/worker/src/agentCycleRunner.test.ts apps/worker/src/agentCycleRunner.ts
git commit -m "feat: trace subtask candidate scores"
```
