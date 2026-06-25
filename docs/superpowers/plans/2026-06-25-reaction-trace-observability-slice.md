# Reaction Trace Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist ambient social reaction evaluator decisions as durable observability traces.

**Architecture:** Add a repository in `@aivilization/observability`, add a traceable companion to
social observation intention creation, then wire a worker trace sink through local runtime storage.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, append-only JSONL repositories, existing worker
tick and local runtime storage abstractions.

---

## Task 1: Observability Repository

**Files:**

- Create: `packages/observability/src/reactionEvaluationTraceRepository.test.ts`
- Create: `packages/observability/src/reactionEvaluationTraceRepository.ts`
- Modify: `packages/observability/src/index.ts`

- [x] **Step 1: Write the failing repository tests**

Add tests that record ignore and follow-up reaction traces, query latest-first by agent and decision
kind, restart a file repository, and mutate returned arrays to prove cloning.

Run:

```bash
pnpm --filter @aivilization/observability test -- reactionEvaluationTraceRepository.test.ts
```

Expected: FAIL because `reactionEvaluationTraceRepository` does not exist.

Observed: failed because `./reactionEvaluationTraceRepository` did not exist.

- [x] **Step 2: Implement the repository**

Implement `InMemoryReactionEvaluationTraceRepository` and
`FileReactionEvaluationTraceRepository` using `reaction-evaluation-traces.jsonl`, validation, query
filters, latest-first sorting, and defensive cloning.

Run:

```bash
pnpm --filter @aivilization/observability test -- reactionEvaluationTraceRepository.test.ts
pnpm --filter @aivilization/observability typecheck
pnpm --filter @aivilization/observability build
```

Expected: PASS.

Observed:

- `pnpm --filter @aivilization/observability test -- reactionEvaluationTraceRepository.test.ts`
  passed.
- `pnpm --filter @aivilization/observability typecheck` passed.
- `pnpm --filter @aivilization/observability build` passed.

## Task 2: Traceable Social Observation Evaluation

**Files:**

- Modify: `apps/worker/src/socialObservationIntentions.test.ts`
- Modify: `apps/worker/src/socialObservationIntentions.ts`

- [x] **Step 3: Write the failing traceable social-observation test**

Add a test for `createTraceableSocialObservationScheduledIntentions` proving it returns one
evaluation per deduplicated social memory, preserves LLM trace metadata, records ignore decisions,
and links follow-up decisions to the scheduled intention id.

Run:

```bash
pnpm --filter @aivilization/worker test -- socialObservationIntentions.test.ts
```

Expected: FAIL because the traceable function does not exist.

Observed: failed because `createTraceableSocialObservationScheduledIntentions` was not a function.

- [x] **Step 4: Implement traceable social-observation evaluation**

Create the traceable companion, keep `createSocialObservationScheduledIntentions` delegating to it,
and avoid changing the existing scheduled intention contract.

Run:

```bash
pnpm --filter @aivilization/worker test -- socialObservationIntentions.test.ts
pnpm --filter @aivilization/worker typecheck
```

Expected: PASS.

Observed:

- `pnpm --filter @aivilization/worker test -- socialObservationIntentions.test.ts` passed.
- `pnpm --filter @aivilization/worker typecheck` passed.

## Task 3: Worker Tick Trace Sink

**Files:**

- Modify: `apps/worker/src/tickRunner.test.ts`
- Modify: `apps/worker/src/tickRunner.ts`

- [x] **Step 5: Write the failing worker trace sink test**

Add a worker tick test that runs an ambient conversation, injects an ignore reaction evaluator with
trace metadata, and asserts the trace sink receives the evaluated memory id, decision, provider
metadata, simulation id, and partition key.

Run:

```bash
pnpm --filter @aivilization/worker test -- tickRunner.test.ts
```

Expected: FAIL because worker ticks do not accept a reaction trace sink.

Observed: failed because the trace sink received no reaction traces.

- [x] **Step 6: Implement worker trace sink wiring**

Add `WorkerReactionEvaluationTraceSink`, pass it through ambient observation handling, create stable
trace ids, and record traces after social intention upserts.

Run:

```bash
pnpm --filter @aivilization/worker test -- tickRunner.test.ts
pnpm --filter @aivilization/worker typecheck
```

Expected: PASS.

Observed:

- `pnpm --filter @aivilization/worker test -- tickRunner.test.ts` passed.
- `pnpm --filter @aivilization/worker typecheck` passed.

## Task 4: Local Runtime Persistence

**Files:**

- Modify: `apps/worker/src/localRuntimeStorage.test.ts`
- Modify: `apps/worker/src/localRuntimeStorage.ts`
- Modify: `apps/worker/src/localRuntimeStep.test.ts`
- Modify: `apps/worker/src/localRuntimeStep.ts`
- Modify: `apps/server/src/localRuntimeTownProfileRunner.test.ts`

- [x] **Step 7: Write failing storage and runtime path tests**

Extend storage restart tests to include `reactionEvaluationTraceRepository`, add a local runtime
step test proving the repository records an ambient conversation reaction, and extend the profile
runner reaction-planning test to query persisted reaction traces.

Run:

```bash
pnpm --filter @aivilization/worker test -- localRuntimeStorage.test.ts localRuntimeStep.test.ts
pnpm --filter @aivilization/server test -- localRuntimeTownProfileRunner.test.ts
```

Expected: FAIL because storage lacks the repository and local runtime does not pass the sink.

Observed:

- Worker tests failed because `storage.reactionEvaluationTraceRepository` was undefined.
- Profile runner test failed because no persisted reaction trace was queryable.

- [x] **Step 8: Implement local runtime persistence**

Instantiate `FileReactionEvaluationTraceRepository` in local storage, expose it on
`LocalWorldRuntimeStorage`, and have `runLocalWorldRuntimeStep` pass the repository sink with the
current partition identity.

Run:

```bash
pnpm --filter @aivilization/worker test -- localRuntimeStorage.test.ts localRuntimeStep.test.ts
pnpm --filter @aivilization/worker typecheck
pnpm --filter @aivilization/worker build
pnpm --filter @aivilization/server test -- localRuntimeTownProfileRunner.test.ts
pnpm --filter @aivilization/server typecheck
```

Expected: PASS.

Observed:

- `pnpm --filter @aivilization/worker test -- localRuntimeStorage.test.ts localRuntimeStep.test.ts`
  passed.
- `pnpm --filter @aivilization/worker typecheck` passed.
- `pnpm --filter @aivilization/worker build` passed.
- `pnpm --filter @aivilization/server test -- localRuntimeTownProfileRunner.test.ts` passed.
- `pnpm --filter @aivilization/server typecheck` passed.

## Task 5: Verification And Commit

- [x] **Step 9: Run full checks**

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

Expected: PASS.

Observed:

- `pnpm lint` passed.
- `pnpm typecheck` passed.
- `pnpm test` passed with 150 files and 744 tests.
- `pnpm build` passed.
- `git diff --check` passed.

- [ ] **Step 10: Commit**

Run:

```bash
git add docs/superpowers/specs/2026-06-25-reaction-trace-observability-design.md docs/superpowers/plans/2026-06-25-reaction-trace-observability-slice.md packages/observability/src/reactionEvaluationTraceRepository.test.ts packages/observability/src/reactionEvaluationTraceRepository.ts packages/observability/src/index.ts apps/worker/src/socialObservationIntentions.test.ts apps/worker/src/socialObservationIntentions.ts apps/worker/src/tickRunner.test.ts apps/worker/src/tickRunner.ts apps/worker/src/localRuntimeStorage.test.ts apps/worker/src/localRuntimeStorage.ts apps/worker/src/localRuntimeStep.test.ts apps/worker/src/localRuntimeStep.ts apps/server/src/localRuntimeTownProfileRunner.test.ts
git commit -m "feat: persist reaction evaluation traces"
```

Expected: commit succeeds on `feat/architecture-skeleton`.
