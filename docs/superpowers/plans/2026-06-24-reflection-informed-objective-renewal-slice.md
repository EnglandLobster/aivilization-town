# Reflection-Informed Objective Renewal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make autonomous objective renewal use retrieved short-term memory and long-term profile context when generating the next durable objective.

**Architecture:** Keep memory repositories in `@aivilization/memory` and keep objective renewal as a worker orchestration seam. `renewMissingActiveObjectives` retrieves bounded STM context, passes it plus LTM profile to an injectable proposer, and persists only accepted objectives that also compile to durable branch plans.

**Tech Stack:** TypeScript, Vitest, `@aivilization/memory`, `@aivilization/agent-runtime`, `apps/worker`.

---

## Scope

This slice upgrades the existing objective renewal path:

- Add `shortTermMemoryContext` to `AutonomousObjectiveProposerInput`.
- Add `shortTermMemoryRepository` and `memoryRetrievalLimit` to `renewMissingActiveObjectives`.
- Make canonical active-plan ticks pass the existing STM repository into renewal.
- Improve the default proposer with deterministic candidate scoring from physiology, STM failures,
  LTM profile, economy, education, and recently completed objectives.
- Keep custom proposers and compilers fully injectable.

It does not add LLM reflection, embeddings, vector search, social negotiation, or a new reflection
persistence model.

## File Structure

- Modify `apps/worker/src/objectiveRenewal.test.ts`: add red tests for memory-informed proposer behavior and STM context handoff.
- Modify `apps/worker/src/canonicalActivePlanTick.test.ts`: add integration coverage for canonical renewal with memory context.
- Modify `apps/worker/src/objectiveRenewal.ts`: extend contracts, retrieve STM context, and implement deterministic candidate scoring.
- Modify `apps/worker/src/canonicalActivePlanTick.ts`: pass `shortTermMemoryRepository` and optional `objectiveMemoryRetrievalLimit`.
- Modify this plan file as tasks complete.

## Task 1: Tests

**Files:**

- Modify: `apps/worker/src/objectiveRenewal.test.ts`
- Modify: `apps/worker/src/canonicalActivePlanTick.test.ts`

- [ ] **Step 1: Add failing proposer tests**

Add tests that require:

- a recent high-importance failed work memory can make the default proposer choose recovery over study;
- a long-term habit/value can choose a profile-aligned routine when urgent survival, education, and economy pressure are absent;
- a just-completed objective is not repeated when another viable objective exists.

Use `createShortTermMemoryRecord` and `InMemoryShortTermMemoryRepository` from `@aivilization/memory`.

- [ ] **Step 2: Add failing renewal handoff tests**

Add tests that require:

- `renewMissingActiveObjectives` retrieves STM records and passes them to a custom proposer;
- `runCanonicalWorkerActivePlanTick` can renew an idle agent from STM context before scheduling.

The custom proposer assertion should inspect `shortTermMemoryContext.map((record) => record.id)`.

- [ ] **Step 3: Run focused tests and verify red**

Run:

```bash
pnpm test -- apps/worker/src/objectiveRenewal.test.ts apps/worker/src/canonicalActivePlanTick.test.ts
```

Expected before implementation: fail because `shortTermMemoryContext`, `shortTermMemoryRepository`,
and `objectiveMemoryRetrievalLimit` are not wired into objective renewal.

## Task 2: Contract And Worker Wiring

**Files:**

- Modify: `apps/worker/src/objectiveRenewal.ts`
- Modify: `apps/worker/src/canonicalActivePlanTick.ts`

- [ ] **Step 4: Extend proposer and renewal contracts**

Implementation shape:

```ts
export type AutonomousObjectiveProposerInput = {
  readonly agentId: AgentId;
  readonly agent: WorldAgentState;
  readonly projection: WorldProjection;
  readonly intentionState: AgentIntentionState;
  readonly longTermProfile: LongTermAgentProfile;
  readonly shortTermMemoryContext: readonly ShortTermMemoryRecord[];
  readonly issuedAt: number;
};
```

`renewMissingActiveObjectives` receives `shortTermMemoryRepository` and optional
`memoryRetrievalLimit`, defaulting to `8`.

- [ ] **Step 5: Retrieve STM context before proposer invocation**

Implementation behavior:

- for each idle agent, call `shortTermMemoryRepository.retrieve({ agentId, limit })`;
- pass the retrieved records to the proposer;
- keep active-objective skip behavior unchanged.

- [ ] **Step 6: Wire canonical active-plan tick**

`runCanonicalWorkerActivePlanTick` should pass `input.shortTermMemoryRepository` to renewal and
expose optional `objectiveMemoryRetrievalLimit?: number` on `CanonicalWorkerActivePlanTickBaseInput`.

## Task 3: Deterministic Reflection-Informed Proposer

**Files:**

- Modify: `apps/worker/src/objectiveRenewal.ts`

- [ ] **Step 7: Score candidate objectives**

Implement helper functions in `objectiveRenewal.ts` to score a bounded set of candidates:

- recovery: physiology danger or failed memory tags/summaries containing `work`, `energy`,
  `satiety`, `health`, `tired`, `hungry`, or `failed`;
- education: low education score and no stronger recovery need;
- income: low balance or economy-related pressure;
- profile routine: LTM entries whose key/statement mentions study, work, health, routine, social,
  or creativity;
- balanced routine: fallback.

Sort candidates by score, then priority, then stable candidate id.

- [ ] **Step 8: Avoid immediate exact repetition**

If the highest candidate statement matches the most recently completed objective statement and a
different candidate has positive score, select the next candidate instead.

- [ ] **Step 9: Preserve current bootstrap behavior**

Existing tests for low physiology, low education, low balance, and fallback routine should still
pass unless stronger STM or LTM evidence is intentionally present.

## Task 4: Verification And Commit

**Files:**

- Modify: this plan file

- [ ] **Step 10: Run focused verification**

Run:

```bash
pnpm test -- apps/worker/src/objectiveRenewal.test.ts apps/worker/src/canonicalActivePlanTick.test.ts
pnpm --filter @aivilization/worker test
pnpm --filter @aivilization/worker typecheck
```

- [ ] **Step 11: Run repo verification**

Run:

```bash
pnpm check
pnpm build
```

- [ ] **Step 12: Commit implementation**

Commit command:

```bash
git add docs/superpowers/plans/2026-06-24-reflection-informed-objective-renewal-slice.md apps/worker/src/objectiveRenewal.test.ts apps/worker/src/canonicalActivePlanTick.test.ts apps/worker/src/objectiveRenewal.ts apps/worker/src/canonicalActivePlanTick.ts
git commit -m "feat: inform objective renewal from memory"
```
