# LLM Action Sequence Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a traceable LLM seam for paper Section 2.1.1 Action Sequence Generation while preserving deterministic fallback and simulator authority.

**Architecture:** Keep `DomainMicroPlanner` as the deterministic baseline. Add an optional async `ActionSequenceGenerator` that can replace fallback action proposals for each selected subtask after validation, then continue through existing action synthesis and simulation.

**Tech Stack:** TypeScript, Vitest, `@aivilization/llm` structured gateway, agent-runtime cycle tests, worker orchestration tests, observability trace tests.

---

## File Structure

- Create `packages/agent-runtime/src/actionSequenceGeneration.ts`: action sequence generator types, deterministic helper, validation, and trace contract.
- Create `packages/agent-runtime/src/llmActionSequenceGenerator.ts`: structured LLM schema, prompt input, fallback behavior, trace mapping.
- Create `packages/agent-runtime/src/llmActionSequenceGenerator.test.ts`: RED/GREEN coverage for the LLM compiler.
- Modify `packages/agent-runtime/src/cycle.ts`: optional async action sequence generation path.
- Modify `packages/agent-runtime/src/cycle.test.ts`: async cycle uses generated actions; sync cycle remains deterministic.
- Modify `packages/agent-runtime/src/index.ts`: export new modules.
- Modify `apps/worker/src/agentCycleRunner.ts`: accept generator and map traces to observability.
- Modify `apps/worker/src/agentCycleRunner.test.ts`: worker executes LLM-generated sequence and records trace.
- Modify `apps/worker/src/agentScheduling.ts`, `apps/worker/src/tickRunner.ts`, `apps/worker/src/tickRunner.test.ts`: pass runtime generator through scheduled tick input.
- Modify `packages/observability/src/agentCycleTrace.ts`, repository and tests: persist action sequence generation traces.

## Task 1: Agent-Runtime LLM Action Sequence Compiler

- [x] **Step 1: Write failing compiler tests**

Add `packages/agent-runtime/src/llmActionSequenceGenerator.test.ts` with tests that:

- call `proposeActionSequenceWithLlm` with deterministic fallback actions and `worldDecisionContext`;
- expect a valid response to return LLM-generated actions and an accepted trace;
- assert the provider request contains `worldDecisionContext`, inventory, balance, prices,
  `shortTermMemoryContext`, `longTermProfile`, `selectedSubtask`, and fallback actions;
- expect fallback when the model emits an unknown command type;
- expect fallback when the model emits an invalid resource estimate;
- expect `createTraceableLlmActionSequenceGenerator` to return the traceable result shape.

Run:

```bash
pnpm --filter @aivilization/agent-runtime test -- llmActionSequenceGenerator.test.ts
```

Expected: FAIL because `./llmActionSequenceGenerator` and `./actionSequenceGeneration` do not
exist.

- [x] **Step 2: Implement action sequence contracts**

Create `packages/agent-runtime/src/actionSequenceGeneration.ts` with:

- `ActionSequenceGeneratorInput`
- `ActionSequenceGenerationTrace`
- `ActionSequenceGenerationResult`
- `ActionSequenceGenerator`
- `createDeterministicActionSequenceGenerationResult`
- `applyActionSequenceProposal`

Validation rules:

- generated sequence is non-empty;
- ids and descriptions are non-empty;
- ids are unique;
- command types are in the deterministic fallback command type set;
- priorities and all resource estimate numbers are finite;
- payloads are JSON-serializable;
- synthesis context from the model is ignored because cycle attribution owns it.

- [x] **Step 3: Implement LLM compiler**

Create `packages/agent-runtime/src/llmActionSequenceGenerator.ts` using
`runStructuredLlmRequest` and schema name `aivilization_action_sequence_generation`.

The model output shape:

```ts
{
  actions: Array<{
    id: string;
    description: string;
    commandType: string;
    payload: unknown;
    priority?: number;
    resourceEstimate?: {
      actionSeconds?: number;
      energyCost?: number;
      satietyCost?: number;
      currencyCost?: number;
      inventoryCosts?: Record<string, number>;
    };
    rationale: string;
  }>;
}
```

Fallback on provider failure or validation failure.

- [x] **Step 4: Verify compiler tests pass**

Run:

```bash
pnpm --filter @aivilization/agent-runtime test -- llmActionSequenceGenerator.test.ts
```

Expected: PASS.

## Task 2: Async Cycle Action Sequence Generation

- [x] **Step 1: Write failing cycle tests**

Modify `packages/agent-runtime/src/cycle.test.ts` with tests that:

- `runAgentPlanningCycleWithPrioritization` uses `actionSequenceGenerator` output instead of
  deterministic micro-planner output when configured;
- generated actions still receive selected subtask synthesis context;
- deterministic `runAgentPlanningCycle` remains unchanged.

Run:

```bash
pnpm --filter @aivilization/agent-runtime test -- cycle.test.ts llmActionSequenceGenerator.test.ts
```

Expected: FAIL because cycle input does not accept `actionSequenceGenerator`.

- [x] **Step 2: Implement cycle wiring**

Modify `packages/agent-runtime/src/cycle.ts`:

- add `actionSequenceGenerator?: ActionSequenceGenerator` to async cycle input;
- collect deterministic fallback actions per selected synthesis subtask;
- if no generator is configured, keep existing synchronous behavior;
- if configured, await generator for each selected subtask and collect generated actions;
- add `actionSequenceTraces?: readonly ActionSequenceGenerationTrace[]` to `AgentCycleResult`.

- [x] **Step 3: Verify cycle tests pass**

Run:

```bash
pnpm --filter @aivilization/agent-runtime test -- cycle.test.ts llmActionSequenceGenerator.test.ts
```

Expected: PASS.

## Task 3: Worker And Observability Wiring

- [x] **Step 1: Write failing worker and observability tests**

Modify worker tests to prove:

- `runWorkerAgentCycle` chooses async cycle when only `actionSequenceGenerator` is configured;
- generated actions are dispatched;
- `trace.actionSequenceGeneration` records accepted or fallback evidence.

Modify observability tests to prove:

- `createAgentCycleTrace` accepts action sequence traces;
- repository cloning preserves and deep-clones trace arrays.

Run:

```bash
pnpm --filter @aivilization/worker test -- agentCycleRunner.test.ts tickRunner.test.ts
pnpm --filter @aivilization/observability test -- agentCycleTrace.test.ts agentCycleTraceRepository.test.ts
```

Expected: FAIL because worker and trace schemas do not yet pass or persist the new field.

- [x] **Step 2: Implement worker pass-through**

Modify:

- `apps/worker/src/agentCycleRunner.ts`
- `apps/worker/src/agentScheduling.ts`
- `apps/worker/src/tickRunner.ts`

Pass `actionSequenceGenerator` through runtime binding, tick input, and worker cycle input.

- [x] **Step 3: Implement trace schema and repository cloning**

Modify:

- `packages/observability/src/agentCycleTrace.ts`
- `packages/observability/src/agentCycleTraceRepository.ts`
- related tests

Add `actionSequenceGeneration` as an optional trace field.

- [x] **Step 4: Verify worker and observability tests pass**

Run:

```bash
pnpm --filter @aivilization/worker test -- agentCycleRunner.test.ts tickRunner.test.ts
pnpm --filter @aivilization/observability test -- agentCycleTrace.test.ts agentCycleTraceRepository.test.ts
```

Expected: PASS.

## Task 4: Full Verification And Commit

- [x] **Step 1: Format touched files**

Run:

```bash
pnpm exec prettier --write docs/superpowers/specs/2026-06-25-llm-action-sequence-generation-design.md docs/superpowers/plans/2026-06-25-llm-action-sequence-generation-slice.md packages/agent-runtime/src/actionSequenceGeneration.ts packages/agent-runtime/src/llmActionSequenceGenerator.ts packages/agent-runtime/src/llmActionSequenceGenerator.test.ts packages/agent-runtime/src/cycle.ts packages/agent-runtime/src/cycle.test.ts packages/agent-runtime/src/index.ts apps/worker/src/agentCycleRunner.ts apps/worker/src/agentCycleRunner.test.ts apps/worker/src/agentScheduling.ts apps/worker/src/tickRunner.ts apps/worker/src/tickRunner.test.ts packages/observability/src/agentCycleTrace.ts packages/observability/src/agentCycleTrace.test.ts packages/observability/src/agentCycleTraceRepository.ts packages/observability/src/agentCycleTraceRepository.test.ts
```

- [x] **Step 2: Run full verification**

Run:

```bash
pnpm check
git diff --check
```

Expected: both pass.

- [x] **Step 3: Commit implementation**

Stage only files from this slice, leaving unrelated untracked paper/report folders untouched.

Commit message title:

```text
feat(planning): 增加 LLM 动作序列生成阶段
```

Commit body must mention paper alignment, modified modules, bounded LLM semantics, user-visible
trace behavior, and exact verification commands that were actually run.

## Self-Review

- Spec coverage: covers paper Action Sequence Generation seam, async cycle wiring, worker pass-through,
  fallback semantics, and observability.
- Placeholder scan: no TODO/TBD placeholders.
- Scope check: intentionally excludes provider default wiring, global synthesis, repair, dialogue, and
  reflection so each missing paper capability remains auditable.

## Verification Log

- RED compiler: `pnpm --filter @aivilization/agent-runtime test -- llmActionSequenceGenerator.test.ts`
  failed because `./llmActionSequenceGenerator` did not exist.
- GREEN compiler: `pnpm --filter @aivilization/agent-runtime test -- llmActionSequenceGenerator.test.ts`
  passed after adding `actionSequenceGeneration` and `llmActionSequenceGenerator`.
- RED cycle: `pnpm --filter @aivilization/agent-runtime test -- cycle.test.ts llmActionSequenceGenerator.test.ts`
  failed because async cycle still used the deterministic fallback action.
- GREEN cycle: `pnpm --filter @aivilization/agent-runtime test -- cycle.test.ts llmActionSequenceGenerator.test.ts`
  passed after async action sequence generation wiring.
- RED worker/observability:
  `pnpm --filter @aivilization/worker test -- agentCycleRunner.test.ts tickRunner.test.ts` failed
  because worker/tick still executed fallback actions; `pnpm --filter @aivilization/observability
test -- agentCycleTrace.test.ts agentCycleTraceRepository.test.ts` failed because repository clone
  dropped `actionSequenceGeneration`.
- GREEN worker/observability:
  `pnpm --filter @aivilization/worker test -- agentCycleRunner.test.ts tickRunner.test.ts` and
  `pnpm --filter @aivilization/observability test -- agentCycleTrace.test.ts
agentCycleTraceRepository.test.ts` passed after pass-through and trace cloning.
- Full verification: `pnpm check` passed with 158 test files and 813 tests after lint, typecheck,
  and Vitest.
