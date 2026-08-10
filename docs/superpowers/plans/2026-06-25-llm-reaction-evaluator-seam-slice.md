# LLM Reaction Evaluator Seam Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a validated, injectable reaction evaluator seam and route social observation
intentions through it.

**Architecture:** Keep worker persistence and de-duplication in `apps/worker`. Move reaction
semantics and LLM fallback behavior into `@aivilization/agent-runtime`, following the existing
strategic/daily planner seam.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, existing `@aivilization/llm` structured
provider utilities.

---

## Task 1: Runtime Reaction Evaluator

**Files:**

- Create: `packages/agent-runtime/src/reactionEvaluation.test.ts`
- Create: `packages/agent-runtime/src/reactionEvaluation.ts`
- Modify: `packages/agent-runtime/src/index.ts`

- [x] **Step 1: Add failing deterministic evaluator tests**

Add tests proving:

- a conversation ambient observation becomes a `follow-up` decision with the existing description,
  priority, tags, and reaction window defaults;
- a non-social observation becomes an `ignore` decision;
- normalization rejects invalid confidence and invalid follow-up scheduling metadata.

Run:

```bash
pnpm --filter @aivilization/agent-runtime test -- reactionEvaluation.test.ts
```

Expected: FAIL because the module does not exist.

Observed: failed because `./reactionEvaluation` did not exist.

- [x] **Step 2: Implement reaction evaluator contract**

Implement reaction decision types, normalization, deterministic social observation evaluator, and
exports.

Run:

```bash
pnpm --filter @aivilization/agent-runtime test -- reactionEvaluation.test.ts
pnpm --filter @aivilization/agent-runtime typecheck
```

Expected: PASS.

Observed:

- `pnpm --filter @aivilization/agent-runtime test -- reactionEvaluation.test.ts` passed.
- `pnpm --filter @aivilization/agent-runtime typecheck` passed.

## Task 2: LLM Reaction Evaluator

**Files:**

- Create: `packages/agent-runtime/src/llmReactionEvaluator.test.ts`
- Create: `packages/agent-runtime/src/llmReactionEvaluator.ts`
- Modify: `packages/agent-runtime/src/index.ts`

- [x] **Step 3: Add failing LLM seam tests**

Add tests proving:

- valid structured LLM output is accepted as a follow-up decision and sends memory context to the
  provider;
- invalid structured output falls back to deterministic reaction evaluation;
- the traceable evaluator preserves request id, provider/model, attempts, and usage.

Run:

```bash
pnpm --filter @aivilization/agent-runtime test -- llmReactionEvaluator.test.ts
```

Expected: FAIL because the module does not exist.

Observed: failed because `./llmReactionEvaluator` did not exist.

- [x] **Step 4: Implement LLM reaction evaluator**

Mirror the existing LLM daily/strategic planner pattern: structured provider call, schema parser,
domain normalization, deterministic fallback, and trace mapping.

Run:

```bash
pnpm --filter @aivilization/agent-runtime test -- llmReactionEvaluator.test.ts
pnpm --filter @aivilization/agent-runtime typecheck
```

Expected: PASS.

Observed:

- `pnpm --filter @aivilization/agent-runtime test -- llmReactionEvaluator.test.ts` passed.
- `pnpm --filter @aivilization/agent-runtime typecheck` passed after fixing the test profile
  fixture to use real `LongTermProfileEntry` objects.

## Task 3: Worker Injection

**Files:**

- Modify: `apps/worker/src/socialObservationIntentions.test.ts`
- Modify: `apps/worker/src/socialObservationIntentions.ts`
- Modify: `apps/worker/src/tickRunner.test.ts`
- Modify: `apps/worker/src/tickRunner.ts`

- [x] **Step 5: Add failing worker injection tests**

Update social observation tests for the async evaluator boundary and add coverage proving:

- an injected evaluator can ignore an otherwise social observation;
- an injected evaluator can customize the scheduled intention description, priority, tags, and
  reaction window;
- worker ambient observation config forwards the injected evaluator.

Run:

```bash
pnpm --filter @aivilization/worker test -- socialObservationIntentions.test.ts tickRunner.test.ts
```

Expected: FAIL until worker code accepts and awaits `ReactionEvaluator`.

Observed:

- `socialObservationIntentions.test.ts` failed because the policy still returned a sync value and
  ignored the injected evaluator.
- `tickRunner.test.ts` failed because the injected evaluator was never called.

- [x] **Step 6: Wire reaction evaluator into worker policy**

Make `createSocialObservationScheduledIntentions` await the evaluator, default to the deterministic
runtime evaluator, and pass the optional evaluator from `runWorkerSimulationTick` ambient
observation config.

Run:

```bash
pnpm --filter @aivilization/worker test -- socialObservationIntentions.test.ts tickRunner.test.ts
pnpm --filter @aivilization/worker typecheck
```

Expected: PASS.

Observed:

- `pnpm --filter @aivilization/worker test -- socialObservationIntentions.test.ts tickRunner.test.ts`
  passed.
- `pnpm --filter @aivilization/worker typecheck` passed.

## Task 4: Full Verification And Commit

- [x] **Step 7: Full checks**

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
- `pnpm test` passed: 149 test files, 735 tests.
- `pnpm build` passed.
- `git diff --check` passed.

- [x] **Step 8: Inspect and commit**

Confirm the diff is limited to reaction evaluator seams, worker injection, tests, and this slice's
docs.

Commit with:

```bash
git add docs/superpowers/specs/2026-06-25-llm-reaction-evaluator-seam-design.md docs/superpowers/plans/2026-06-25-llm-reaction-evaluator-seam-slice.md packages/agent-runtime/src/reactionEvaluation.ts packages/agent-runtime/src/reactionEvaluation.test.ts packages/agent-runtime/src/llmReactionEvaluator.ts packages/agent-runtime/src/llmReactionEvaluator.test.ts packages/agent-runtime/src/index.ts apps/worker/src/socialObservationIntentions.ts apps/worker/src/socialObservationIntentions.test.ts apps/worker/src/tickRunner.ts apps/worker/src/tickRunner.test.ts
git commit -m "feat: add traceable reaction evaluator seam"
```

Observed: diff reviewed and limited to reaction evaluator seams, worker injection, tests, and this
slice's docs.
