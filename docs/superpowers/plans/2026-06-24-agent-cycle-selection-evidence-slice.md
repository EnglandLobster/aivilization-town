# Agent Cycle Selection Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Return and trace selected-subtask evidence from agent planning cycles, including STM evidence and LTM profile provenance.

**Architecture:** `@aivilization/agent-runtime` owns influence scoring and selected-subtask evidence. `@aivilization/observability` owns the trace schema. `apps/worker` maps runtime evidence into `AgentCycleTrace` without changing world events or persistence.

**Tech Stack:** TypeScript, Vitest, `@aivilization/agent-runtime`, `@aivilization/observability`, `apps/worker`.

---

## Scope

This slice adds selected-subtask evidence:

- Add provenance ids to `ProfileInfluenceEntryMatch`.
- Add `AgentCycleSelectionEvidence` to `AgentCycleResult`.
- Extend `AgentCycleTrace` with `selectionEvidence`.
- Make `runWorkerAgentCycle` write selection evidence into traces.

It does not add full candidate traces, durable trace repositories, UI panels, or LLM rationales.

## File Structure

- Modify `packages/agent-runtime/src/profileInfluence.test.ts`: add provenance expectation.
- Modify `packages/agent-runtime/src/profileInfluence.ts`: include profile provenance in matches.
- Modify `packages/agent-runtime/src/cycle.test.ts`: add selected evidence expectation.
- Modify `packages/agent-runtime/src/cycle.ts`: return selected-subtask evidence.
- Modify `packages/observability/src/agentCycleTrace.test.ts`: add trace shape expectation.
- Modify `packages/observability/src/agentCycleTrace.ts`: extend trace type.
- Modify `apps/worker/src/agentCycleRunner.test.ts`: assert worker trace contains selection evidence.
- Modify `apps/worker/src/agentCycleRunner.ts`: pass cycle selection evidence into trace.
- Modify this plan file as tasks complete.

## Task 1: Agent Runtime Evidence Tests

**Files:**

- Modify: `packages/agent-runtime/src/profileInfluence.test.ts`
- Modify: `packages/agent-runtime/src/cycle.test.ts`

- [x] **Step 1: Add failing profile provenance test**

Update an existing profile influence test so a matched profile entry with
`provenanceRecordIds: ['reflection-study-1']` expects the match to include that id.

Run:

```bash
pnpm --filter @aivilization/agent-runtime test
```

Expected before implementation: fail because `ProfileInfluenceEntryMatch` does not include
`provenanceRecordIds`.

- [x] **Step 2: Add failing selected evidence cycle test**

Add or update a cycle test that passes:

- STM context matching selected subtask memory affinity tags;
- LTM profile matching selected subtask profile affinity tags.

Expect `cycleResult.selectionEvidence` to include:

- selected subtask id;
- memory influence score and evidence record ids;
- profile influence score, profile entry keys, and provenance record ids.

Run:

```bash
pnpm --filter @aivilization/agent-runtime test
```

Expected before implementation: fail because `selectionEvidence` is missing.

## Task 2: Agent Runtime Implementation

**Files:**

- Modify: `packages/agent-runtime/src/profileInfluence.ts`
- Modify: `packages/agent-runtime/src/cycle.ts`

- [x] **Step 3: Include provenance in profile influence matches**

Add `provenanceRecordIds` to `ProfileInfluenceEntryMatch` and populate it from the matched
`LongTermProfileEntry`.

- [x] **Step 4: Return selected-subtask evidence**

Add:

```ts
export type AgentCycleSelectionEvidence = {
  readonly selectedSubtaskId: string;
  readonly intentionInfluenceScore: number;
  readonly memoryInfluenceScore: number;
  readonly profileInfluenceScore: number;
  readonly memoryEvidenceRecordIds: readonly string[];
  readonly profileEntryKeys: readonly string[];
  readonly profileEvidenceRecordIds: readonly string[];
};
```

In `runAgentPlanningCycle`, compute influence maps once, pass them to selection, and return selected
evidence from the selected subtask id.

## Task 3: Trace Schema And Worker Tests

**Files:**

- Modify: `packages/observability/src/agentCycleTrace.test.ts`
- Modify: `apps/worker/src/agentCycleRunner.test.ts`

- [x] **Step 5: Add failing observability trace test**

Expect `createAgentCycleTrace` to preserve a `selectionEvidence` object with memory and profile
evidence ids.

Run:

```bash
pnpm --filter @aivilization/observability test
```

Expected before implementation: fail because `AgentCycleTrace` does not include
`selectionEvidence`.

- [x] **Step 6: Add failing worker trace test**

Update the worker memory/profile-context planning test to expect
`result.trace.selectionEvidence.profileEvidenceRecordIds` and
`result.trace.selectionEvidence.memoryEvidenceRecordIds`.

Run:

```bash
pnpm --filter @aivilization/worker test
```

Expected before implementation: fail because worker traces do not include selected evidence.

## Task 4: Trace Schema And Worker Implementation

**Files:**

- Modify: `packages/observability/src/agentCycleTrace.ts`
- Modify: `apps/worker/src/agentCycleRunner.ts`

- [x] **Step 7: Extend trace schema**

Add `selectionEvidence` to `AgentCycleTrace`. Reuse the same field names as
`AgentCycleSelectionEvidence` to keep mapping direct.

- [x] **Step 8: Map cycle evidence into worker trace**

In `runWorkerAgentCycle`, set `selectionEvidence: cycleResult.selectionEvidence` when creating
`AgentCycleTrace`.

## Task 5: Verification And Commit

**Files:**

- Modify: this plan file

- [x] **Step 9: Run focused verification**

Run:

```bash
pnpm --filter @aivilization/agent-runtime test
pnpm --filter @aivilization/observability test
pnpm --filter @aivilization/worker test
pnpm --filter @aivilization/agent-runtime typecheck
pnpm --filter @aivilization/observability typecheck
pnpm --filter @aivilization/worker typecheck
```

- [x] **Step 10: Run repo verification**

Run:

```bash
pnpm check
pnpm build
```

- [x] **Step 11: Commit implementation**

Commit command:

```bash
git add docs/superpowers/plans/2026-06-24-agent-cycle-selection-evidence-slice.md packages/agent-runtime/src/profileInfluence.test.ts packages/agent-runtime/src/profileInfluence.ts packages/agent-runtime/src/cycle.test.ts packages/agent-runtime/src/cycle.ts packages/observability/src/agentCycleTrace.test.ts packages/observability/src/agentCycleTrace.ts apps/worker/src/agentCycleRunner.test.ts apps/worker/src/agentCycleRunner.ts
git commit -m "feat: trace agent cycle selection evidence"
```
