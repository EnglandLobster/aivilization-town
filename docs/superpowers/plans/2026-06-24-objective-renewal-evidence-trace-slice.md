# Objective Renewal Evidence Trace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make autonomous objective renewal return and optionally emit decision evidence linking selected objectives to STM and LTM profile provenance.

**Architecture:** Keep objectives as durable memory state and add worker-level decision traces beside renewal results. The default proposer emits a rich `AutonomousObjectiveProposal`; existing custom proposers can still return plain `LongHorizonObjective` and receive a fallback trace.

**Tech Stack:** TypeScript, Vitest, `@aivilization/memory`, `@aivilization/agent-runtime`, `apps/worker`.

---

## Scope

This slice adds explainability to objective renewal:

- Add `ObjectiveRenewalDecisionTrace`.
- Add `AutonomousObjectiveProposal`.
- Add `createDefaultAutonomousObjectiveProposal`.
- Include decision traces in `RenewedActiveObjectiveResult`.
- Add optional `objectiveRenewalTraceSink`.
- Pass the trace sink through canonical active-plan ticks.

It does not add a durable trace repository, UI surface, or LLM proposer.

## File Structure

- Modify `apps/worker/src/objectiveRenewal.test.ts`: add red tests for default decision evidence, custom proposer fallback traces, and trace sink emission.
- Modify `apps/worker/src/canonicalActivePlanTick.test.ts`: add red test for canonical trace sink pass-through.
- Modify `apps/worker/src/objectiveRenewal.ts`: implement proposal normalization, candidate evidence, and trace sink emission.
- Modify `apps/worker/src/canonicalActivePlanTick.ts`: expose and pass `objectiveRenewalTraceSink`.
- Modify this plan file as tasks complete.

## Task 1: Objective Renewal Trace Tests

**Files:**

- Modify: `apps/worker/src/objectiveRenewal.test.ts`

- [x] **Step 1: Add failing default proposer evidence tests**

Add tests that require:

- recent failed STM recovery objective exposes a trace with `selectedCandidateId:
  'recent-setback-recovery'`, matching memory context ids, and a recovery rationale;
- profile-aligned routine exposes profile entry keys and profile provenance record ids.

Run:

```bash
pnpm test -- apps/worker/src/objectiveRenewal.test.ts
```

Expected before implementation: fail because `createDefaultAutonomousObjectiveProposal` and
`decisionTrace` do not exist.

- [x] **Step 2: Add failing renewal orchestration trace tests**

Add tests that require:

- plain custom proposers still renew objectives with fallback trace id `custom-proposer`;
- `renewMissingActiveObjectives` returns `decisionTrace`;
- optional `objectiveRenewalTraceSink.record` receives the same trace.

Run:

```bash
pnpm test -- apps/worker/src/objectiveRenewal.test.ts
```

Expected before implementation: fail because renewal does not normalize proposals or emit traces.

Observed red failures:

- `createDefaultAutonomousObjectiveProposal` was not exported;
- `renewMissingActiveObjectives` returned only ids and did not include `decisionTrace`.

## Task 2: Objective Renewal Trace Implementation

**Files:**

- Modify: `apps/worker/src/objectiveRenewal.ts`

- [x] **Step 3: Add proposal and trace types**

Add:

```ts
export type ObjectiveRenewalDecisionTrace = {
  readonly agentId: AgentId;
  readonly objectiveId: string;
  readonly selectedCandidateId: string;
  readonly rationale: string;
  readonly score: number;
  readonly shortTermMemoryContextIds: readonly string[];
  readonly profileEntryKeys: readonly string[];
  readonly profileEvidenceRecordIds: readonly string[];
  readonly issuedAt: number;
};

export type AutonomousObjectiveProposal = {
  readonly objective: LongHorizonObjective;
  readonly decisionTrace: ObjectiveRenewalDecisionTrace;
};
```

Update `AutonomousObjectiveProposer` to return `LongHorizonObjective | AutonomousObjectiveProposal`
or `undefined`.

- [x] **Step 4: Emit rich default proposal evidence**

Implement `createDefaultAutonomousObjectiveProposal(input)`.

Candidate evidence rules:

- recent setback recovery cites matching STM ids;
- profile routine cites selected profile entry key and all provenance ids;
- physiology, education, income, and fallback use empty evidence lists with world-state rationales.

Keep `createDefaultAutonomousObjective(input)` as a compatibility wrapper returning only
`proposal.objective`.

- [x] **Step 5: Normalize proposer results and emit traces**

In `renewMissingActiveObjectives`:

- normalize plain objectives to fallback decision traces;
- persist objective and plan as before;
- include `decisionTrace` in `RenewedActiveObjectiveResult`;
- call optional `objectiveRenewalTraceSink.record(decisionTrace)` after durable objective and plan
  save succeeds.

## Task 3: Canonical Tick Trace Pass-Through

**Files:**

- Modify: `apps/worker/src/canonicalActivePlanTick.test.ts`
- Modify: `apps/worker/src/canonicalActivePlanTick.ts`

- [x] **Step 6: Add failing canonical pass-through test**

Add a test that runs `runCanonicalWorkerActivePlanTick` with an idle agent and
`objectiveRenewalTraceSink`, then expects the sink to receive the default study decision trace.

Run:

```bash
pnpm test -- apps/worker/src/canonicalActivePlanTick.test.ts
```

Expected before implementation: fail because canonical input does not expose the sink.

Observed red failure:

- canonical tick accepted the extra test field at runtime but did not pass it into renewal, so the
  trace sink received no records.

- [x] **Step 7: Wire canonical trace sink**

Add `objectiveRenewalTraceSink?: WorkerObjectiveRenewalTraceSink` to
`CanonicalWorkerActivePlanTickBaseInput` and pass it to `renewMissingActiveObjectives`.

## Task 4: Verification And Commit

**Files:**

- Modify: this plan file

- [x] **Step 8: Run focused verification**

Run:

```bash
pnpm test -- apps/worker/src/objectiveRenewal.test.ts apps/worker/src/canonicalActivePlanTick.test.ts
pnpm --filter @aivilization/worker test
pnpm --filter @aivilization/worker typecheck
```

Verification passed:

- `pnpm test -- apps/worker/src/objectiveRenewal.test.ts apps/worker/src/canonicalActivePlanTick.test.ts`
- `pnpm --filter @aivilization/worker test`
- `pnpm --filter @aivilization/worker typecheck`

- [x] **Step 9: Run repo verification**

Run:

```bash
pnpm check
pnpm build
```

Verification passed:

- `pnpm check`
- `pnpm build`

- [x] **Step 10: Commit implementation**

Commit command:

```bash
git add docs/superpowers/plans/2026-06-24-objective-renewal-evidence-trace-slice.md apps/worker/src/objectiveRenewal.test.ts apps/worker/src/canonicalActivePlanTick.test.ts apps/worker/src/objectiveRenewal.ts apps/worker/src/canonicalActivePlanTick.ts
git commit -m "feat: trace objective renewal evidence"
```
