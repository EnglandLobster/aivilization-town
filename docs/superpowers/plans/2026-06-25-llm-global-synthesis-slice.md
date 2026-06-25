# LLM Global Synthesis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a bounded LLM Global Synthesis seam that orchestrates existing cross-branch action candidates before deterministic resource synthesis.

**Architecture:** The LLM ranks every existing candidate action exactly once and may assign bounded synthesis scores. Existing `synthesizeActionCandidates` remains the resource ledger and final accept/reject authority.

**Tech Stack:** TypeScript, Vitest, `@aivilization/llm` structured gateway, agent-runtime async cycle, worker orchestration, observability trace repositories.

---

## File Structure

- Create `packages/agent-runtime/src/globalSynthesis.ts`: contract, trace types, deterministic helper, choice validation, and bounded choice application.
- Create `packages/agent-runtime/src/llmGlobalSynthesizer.ts`: structured LLM schema, prompt compiler, fallback behavior, trace mapping.
- Create `packages/agent-runtime/src/llmGlobalSynthesizer.test.ts`: compiler RED/GREEN tests.
- Modify `packages/agent-runtime/src/cycle.ts`: optional async global synthesis stage before deterministic `synthesizeActionCandidates`.
- Modify `packages/agent-runtime/src/cycle.test.ts`: async cycle behavior tests.
- Modify `packages/agent-runtime/src/index.ts`: export new modules.
- Modify worker and tick files to pass `globalSynthesizer`.
- Modify observability trace files and tests to persist `globalSynthesis`.

## Task 1: Agent-Runtime LLM Global Synthesis Compiler

- [ ] **Step 1: Write failing compiler tests**

Add `packages/agent-runtime/src/llmGlobalSynthesizer.test.ts` with tests that:

- call `proposeGlobalSynthesisWithLlm` with candidate actions, deterministic synthesis result,
  world context, STM, and LTM profile;
- accept a complete ranking of existing action ids;
- assert the provider request includes deterministic accepted/rejected actions, world decision
  context, inventory, balance, market price, memory, profile, and candidate actions;
- fallback on unknown action id;
- fallback on incomplete ranking;
- expose `createTraceableLlmGlobalSynthesizer`.

Run:

```bash
pnpm --filter @aivilization/agent-runtime test -- llmGlobalSynthesizer.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 2: Implement global synthesis contract**

Create `packages/agent-runtime/src/globalSynthesis.ts` with:

- `GlobalSynthesisChoice`
- `GlobalSynthesisTrace`
- `GlobalSynthesisResult`
- `GlobalSynthesizerInput`
- `GlobalActionSynthesizer`
- `createDeterministicGlobalSynthesisResult`
- `applyGlobalSynthesisChoices`

Validation:

- every candidate action id appears exactly once;
- no unknown action ids;
- no duplicate ids;
- `priorityScore`, `strategicAlignment`, and `branchUrgency` are finite when present;
- rationale is non-empty;
- payload and command type are preserved from the original action.

- [ ] **Step 3: Implement LLM compiler**

Create `packages/agent-runtime/src/llmGlobalSynthesizer.ts` using schema
`aivilization_global_synthesis`.

Output shape:

```ts
{
  rankedActions: Array<{
    actionId: string;
    priorityScore: number;
    rationale: string;
    strategicAlignment?: number;
    branchUrgency?: number;
  }>;
}
```

Fallback to deterministic candidate ordering on failure.

- [ ] **Step 4: Verify compiler tests pass**

Run:

```bash
pnpm --filter @aivilization/agent-runtime test -- llmGlobalSynthesizer.test.ts
```

Expected: PASS.

## Task 2: Async Cycle Global Synthesis

- [ ] **Step 1: Write failing cycle tests**

Modify `packages/agent-runtime/src/cycle.test.ts` with tests that:

- `runAgentPlanningCycleWithPrioritization` uses `globalSynthesizer` to rank lower local-priority
  survival actions before higher local-priority production actions;
- deterministic `synthesizeActionCandidates` still rejects actions that exceed resource budget;
- sync `runAgentPlanningCycle` remains deterministic.

Run:

```bash
pnpm --filter @aivilization/agent-runtime test -- cycle.test.ts llmGlobalSynthesizer.test.ts
```

Expected: FAIL because cycle does not accept `globalSynthesizer`.

- [ ] **Step 2: Implement cycle wiring**

Modify `packages/agent-runtime/src/cycle.ts`:

- add `globalSynthesizer?: GlobalActionSynthesizer` to async cycle input;
- compute deterministic synthesis preview before calling the global synthesizer;
- call global synthesizer with plan, signals, candidate actions, preview result, policy, memory,
  profile, intention state, and world decision context;
- pass synthesized/ranked actions through existing `synthesizeActionCandidates`;
- include `globalSynthesisTrace?: GlobalSynthesisTrace` on `AgentCycleResult`.

- [ ] **Step 3: Verify cycle tests pass**

Run:

```bash
pnpm --filter @aivilization/agent-runtime test -- cycle.test.ts llmGlobalSynthesizer.test.ts
```

Expected: PASS.

## Task 3: Worker And Observability Wiring

- [ ] **Step 1: Write failing worker and observability tests**

Modify worker tests to prove:

- `runWorkerAgentCycle` chooses async cycle when only `globalSynthesizer` is configured;
- worker dispatches the LLM-ranked accepted action;
- `trace.globalSynthesis` records accepted/fallback evidence.

Modify tick tests to prove per-agent `globalSynthesizer` passes through scheduled ticks.

Modify observability tests to prove `globalSynthesis` survives create and repository clone.

Run:

```bash
pnpm --filter @aivilization/worker test -- agentCycleRunner.test.ts tickRunner.test.ts
pnpm --filter @aivilization/observability test -- agentCycleTrace.test.ts agentCycleTraceRepository.test.ts
```

Expected: FAIL before pass-through and trace schema exist.

- [ ] **Step 2: Implement pass-through and trace mapping**

Modify:

- `apps/worker/src/agentCycleRunner.ts`
- `apps/worker/src/agentScheduling.ts`
- `apps/worker/src/tickRunner.ts`
- `packages/observability/src/agentCycleTrace.ts`
- `packages/observability/src/agentCycleTraceRepository.ts`

- [ ] **Step 3: Verify worker and observability tests pass**

Run:

```bash
pnpm --filter @aivilization/worker test -- agentCycleRunner.test.ts tickRunner.test.ts
pnpm --filter @aivilization/observability test -- agentCycleTrace.test.ts agentCycleTraceRepository.test.ts
```

Expected: PASS.

## Task 4: Full Verification And Commit

- [ ] **Step 1: Format touched files**

Run:

```bash
pnpm exec prettier --write docs/superpowers/specs/2026-06-25-llm-global-synthesis-design.md docs/superpowers/plans/2026-06-25-llm-global-synthesis-slice.md packages/agent-runtime/src/globalSynthesis.ts packages/agent-runtime/src/llmGlobalSynthesizer.ts packages/agent-runtime/src/llmGlobalSynthesizer.test.ts packages/agent-runtime/src/cycle.ts packages/agent-runtime/src/cycle.test.ts packages/agent-runtime/src/index.ts apps/worker/src/agentCycleRunner.ts apps/worker/src/agentCycleRunner.test.ts apps/worker/src/agentScheduling.ts apps/worker/src/tickRunner.ts apps/worker/src/tickRunner.test.ts packages/observability/src/agentCycleTrace.ts packages/observability/src/agentCycleTrace.test.ts packages/observability/src/agentCycleTraceRepository.ts packages/observability/src/agentCycleTraceRepository.test.ts
```

- [ ] **Step 2: Run full verification**

Run:

```bash
pnpm check
git diff --check
```

Expected: both pass.

- [ ] **Step 3: Commit implementation**

Commit title:

```text
feat(planning): 增加 LLM 全局动作综合阶段
```

Commit body must mention paper alignment, bounded LLM semantics, affected modules, trace behavior,
and exact verification commands that were actually run.

## Self-Review

- Spec coverage: covers paper Global Synthesis orchestration, inter-branch ranking, shared resource
  constraints, fallback, cycle routing, worker pass-through, and trace persistence.
- Placeholder scan: no TODO/TBD placeholders.
- Scope check: intentionally excludes local repair, memory-guided correction, provider default wiring,
  social dialogue, and reflection.
