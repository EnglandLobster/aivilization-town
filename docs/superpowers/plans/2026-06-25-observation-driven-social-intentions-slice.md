# Observation-Driven Social Intentions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert ambient social observation memories into durable scheduled social intentions.

**Architecture:** Add a focused worker policy for observation-to-intention mapping, then wire it
into `runWorkerSimulationTick` after ambient memory persistence. The policy emits normal
`ScheduledIntention` records so existing objective renewal and canonical social runtime consume the
new signal without a parallel reaction system.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, existing memory/intention repositories.

---

## Task 1: Social Observation Intention Policy

**Files:**

- Create: `apps/worker/src/socialObservationIntentions.test.ts`
- Create: `apps/worker/src/socialObservationIntentions.ts`
- Modify: `apps/worker/src/index.ts`

- [x] **Step 1: Add failing policy tests**

Add tests proving:

- a conversation observation memory creates one scheduled social follow-up intention;
- a social interaction observation memory creates one scheduled social follow-up intention;
- non-social ambient observations are ignored;
- duplicate memory inputs produce one idempotent intention.

Run:

```bash
pnpm --filter @aivilization/worker test -- socialObservationIntentions.test.ts
```

Expected: FAIL because the module does not exist.

Observed: failed because `./socialObservationIntentions` did not exist. A follow-up red test also
failed because conversation and social-impact memories from the same command produced duplicate
intentions.

- [x] **Step 2: Implement policy**

Implement `createSocialObservationScheduledIntentions` with deterministic ids, bounded reaction
windows, provenance memory ids, and social affinity tags. Export it from `apps/worker/src/index.ts`.

Run:

```bash
pnpm --filter @aivilization/worker test -- socialObservationIntentions.test.ts
pnpm --filter @aivilization/worker typecheck
```

Expected: PASS.

Observed:

- `pnpm --filter @aivilization/worker test -- socialObservationIntentions.test.ts` passed.
- `pnpm --filter @aivilization/worker typecheck` passed.

## Task 2: Worker Tick Wiring

**Files:**

- Modify: `apps/worker/src/tickRunner.test.ts`
- Modify: `apps/worker/src/tickRunner.ts`

- [x] **Step 3: Add failing worker tick test**

Extend the ambient observation test so a bystander who observes a conversation receives a scheduled
social intention with provenance back to the ambient memory record.

Run:

```bash
pnpm --filter @aivilization/worker test -- tickRunner.test.ts
```

Expected: FAIL because `runWorkerSimulationTick` records ambient memory but does not yet upsert
social follow-up intentions.

Observed: failed because the bystander's `scheduledIntentions` stayed empty after ambient
conversation memory was recorded.

- [x] **Step 4: Wire policy into tick runner**

After `recordAmbientObservationMemoryIfConfigured` appends records, call
`createSocialObservationScheduledIntentions` and upsert the returned intentions through
`intentionRepository`.

Run:

```bash
pnpm --filter @aivilization/worker test -- tickRunner.test.ts
pnpm --filter @aivilization/worker typecheck
```

Expected: PASS.

Observed:

- `pnpm --filter @aivilization/worker test -- tickRunner.test.ts` passed.
- `pnpm --filter @aivilization/worker typecheck` passed.

## Task 3: Canonical Objective-Renewal Continuity

**Files:**

- Modify: `apps/worker/src/canonicalActivePlanTick.test.ts`

- [x] **Step 5: Add continuity test**

Add a canonical active-plan test proving a persisted social observation intention is selected as a
`scheduled-routine-social` objective on the next tick.

Run:

```bash
pnpm --filter @aivilization/worker test -- canonicalActivePlanTick.test.ts
```

Expected: PASS if the policy emits ordinary scheduled intentions that existing renewal logic can
consume.

Observed:

- `pnpm --filter @aivilization/worker test -- canonicalActivePlanTick.test.ts` passed.

## Task 4: Full Verification And Commit

- [x] **Step 6: Full checks**

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
- `pnpm test` passed: 147 test files, 725 tests.
- `pnpm build` passed.
- `git diff --check` passed.

- [x] **Step 7: Inspect and commit**

Confirm the diff is limited to observation-driven social intentions, tests, and this slice's docs.

Commit with:

```bash
git add docs/superpowers/specs/2026-06-25-observation-driven-social-intentions-design.md docs/superpowers/plans/2026-06-25-observation-driven-social-intentions-slice.md apps/worker/src/socialObservationIntentions.ts apps/worker/src/socialObservationIntentions.test.ts apps/worker/src/tickRunner.ts apps/worker/src/tickRunner.test.ts apps/worker/src/canonicalActivePlanTick.test.ts apps/worker/src/index.ts
git commit -m "feat: seed social intentions from observations"
```

Observed: diff reviewed and limited to observation-driven social intentions, tests, and this
slice's docs.
