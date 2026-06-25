# Tiered Action Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a bounded, observable local repair plus STM-backed reactive correction stage after
Action Simulator rejection.

**Architecture:** Keep existing synchronous `CycleRepairPolicy` as the cheap local repair stage.
Add an async `ReactiveCorrector` seam that can propose one simulator-validated replacement action
using STM/world/profile context. Replanning remains the final authority when repair cannot validate.

**Tech Stack:** TypeScript, Vitest, `@aivilization/llm` structured gateway, agent-runtime async
cycle, worker orchestration, observability trace repositories.

---

## File Structure

- Create `packages/agent-runtime/src/actionRepair.ts`: tiered repair contracts,
  `ReactiveCorrector`, repair traces, command type allow-list, and
  `simulateActionWithTieredRepair`.
- Create `packages/agent-runtime/src/actionRepair.test.ts`: local/ reactive repair orchestrator
  tests.
- Create `packages/agent-runtime/src/llmReactiveCorrector.ts`: structured LLM compiler, schema,
  prompt, fallback/no-correction handling.
- Create `packages/agent-runtime/src/llmReactiveCorrector.test.ts`: compiler tests.
- Modify `packages/agent-runtime/src/cycle.ts`: async cycle input and simulation path for
  `reactiveCorrector`.
- Modify `packages/agent-runtime/src/cycle.test.ts`: cycle recovery and escalation tests.
- Modify `packages/agent-runtime/src/index.ts`: export new modules.
- Modify worker/tick/scheduling files to pass `reactiveCorrector`.
- Modify observability trace files and tests to persist `actionRepair`.

## Task 1: LLM Reactive Corrector Compiler

- [ ] **Step 1: Write failing compiler tests**

Create `packages/agent-runtime/src/llmReactiveCorrector.test.ts` with tests that:

- accept a `propose-action` decision and return one `AtomicActionProposal`;
- include rejected action, local repair attempt outcome, STM, LTM profile, world context, and
  allowed command types in the provider request;
- accept `no-correction` with a trace and no action;
- fallback when the LLM proposes a command type outside `allowedCommandTypes`;
- expose `createTraceableLlmReactiveCorrector`.

Run:

```bash
pnpm --filter @aivilization/agent-runtime test -- llmReactiveCorrector.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 2: Implement action repair contract**

Create `packages/agent-runtime/src/actionRepair.ts` with:

- `AGENT_ACTION_COMMAND_TYPES`
- `ReactiveCorrectionGeneratedAction`
- `ReactiveCorrectionTrace`
- `ReactiveCorrectionResult`
- `ReactiveCorrectorInput`
- `ReactiveCorrector`
- `ActionRepairTrace`
- `applyReactiveCorrectionDecision`

Validation rules:

- action id, description, commandType, and rationale are non-empty;
- commandType appears in `allowedCommandTypes`;
- payload is JSON-cloneable;
- priority and resource estimate numbers are finite;
- evidence record ids are copied, not shared.

- [ ] **Step 3: Implement LLM compiler**

Create `packages/agent-runtime/src/llmReactiveCorrector.ts` with schema
`aivilization_reactive_correction`.

Output shape:

```ts
{
  decision: {
    kind: 'propose-action' | 'no-correction';
    rationale: string;
    evidenceRecordIds?: string[];
    action?: {
      id: string;
      description: string;
      commandType: string;
      payload: unknown;
      priority?: number;
      resourceEstimate?: ActionResourceEstimate;
    };
  };
}
```

Fallback behavior:

- provider/schema failure returns `{ action: undefined }`;
- trace status is `fallback`;
- choices record `no-correction` rationale.

- [ ] **Step 4: Verify compiler tests pass**

Run:

```bash
pnpm --filter @aivilization/agent-runtime test -- llmReactiveCorrector.test.ts
```

Expected: PASS.

## Task 2: Tiered Repair Orchestrator

- [ ] **Step 1: Write failing orchestrator tests**

Create `packages/agent-runtime/src/actionRepair.test.ts` with tests that:

- local repair success short-circuits reactive correction;
- local repair simulator rejection escalates to reactive correction with local attempt evidence;
- reactive correction success returns `status: 'repaired'`;
- reactive correction rejection returns `needs-replan` with repair trace.

Run:

```bash
pnpm --filter @aivilization/agent-runtime test -- actionRepair.test.ts llmReactiveCorrector.test.ts
```

Expected: FAIL before `simulateActionWithTieredRepair` exists.

- [ ] **Step 2: Implement `simulateActionWithTieredRepair`**

Add to `actionRepair.ts`:

- run original simulator first;
- try local repair if provided;
- if local repair succeeds, return repaired result and local trace;
- if local repair is skipped or rejected, call `reactiveCorrector` when provided;
- simulate the reactive action when one is returned;
- return `needs-replan` when both stages fail or decline.

- [ ] **Step 3: Verify orchestrator tests pass**

Run:

```bash
pnpm --filter @aivilization/agent-runtime test -- actionRepair.test.ts llmReactiveCorrector.test.ts
```

Expected: PASS.

## Task 3: Async Cycle Wiring

- [ ] **Step 1: Write failing cycle tests**

Modify `packages/agent-runtime/src/cycle.test.ts` with tests that:

- `runAgentPlanningCycleWithPrioritization` invokes `reactiveCorrector` after simulator rejection
  when local repair cannot fix the action;
- the corrector receives selected subtask, STM, LTM profile, world context, and local attempt
  rejection reason;
- a simulator-accepted reactive action produces a command draft and `actionRepairTraces`;
- a simulator-rejected reactive action still produces `needsReplan` and adaptive replanning.

Run:

```bash
pnpm --filter @aivilization/agent-runtime test -- cycle.test.ts actionRepair.test.ts llmReactiveCorrector.test.ts
```

Expected: FAIL before cycle accepts `reactiveCorrector`.

- [ ] **Step 2: Implement cycle wiring**

Modify `packages/agent-runtime/src/cycle.ts`:

- add `reactiveCorrector?: ReactiveCorrector` to `AgentPlanningCycleWithPrioritizationInput`;
- route to async stages when only `reactiveCorrector` is configured;
- use `simulateActionWithTieredRepair` for candidate simulation when configured;
- preserve existing sync `runAgentPlanningCycle` behavior;
- add `actionRepairTraces?: readonly ActionRepairTrace[]` to `AgentCycleResult`.

- [ ] **Step 3: Verify cycle tests pass**

Run:

```bash
pnpm --filter @aivilization/agent-runtime test -- cycle.test.ts actionRepair.test.ts llmReactiveCorrector.test.ts
```

Expected: PASS.

## Task 4: Worker And Observability Wiring

- [ ] **Step 1: Write failing worker and observability tests**

Modify tests to prove:

- `runWorkerAgentCycle` passes `reactiveCorrector` into async cycle and trace;
- `runWorkerSimulationTick` passes per-agent `reactiveCorrector`;
- `buildWorkerTickAgentsFromActivePlans` preserves resolver-provided `reactiveCorrector`;
- `createAgentCycleTrace` and repositories preserve `actionRepair`.

Run:

```bash
pnpm --filter @aivilization/worker test -- agentCycleRunner.test.ts tickRunner.test.ts agentScheduling.test.ts
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
pnpm --filter @aivilization/worker test -- agentCycleRunner.test.ts tickRunner.test.ts agentScheduling.test.ts
pnpm --filter @aivilization/observability test -- agentCycleTrace.test.ts agentCycleTraceRepository.test.ts
```

Expected: PASS.

## Task 5: Full Verification And Commit

- [ ] **Step 1: Format touched files**

Run:

```bash
pnpm exec prettier --write docs/superpowers/specs/2026-06-25-tiered-action-repair-design.md docs/superpowers/plans/2026-06-25-tiered-action-repair-slice.md packages/agent-runtime/src/actionRepair.ts packages/agent-runtime/src/actionRepair.test.ts packages/agent-runtime/src/llmReactiveCorrector.ts packages/agent-runtime/src/llmReactiveCorrector.test.ts packages/agent-runtime/src/cycle.ts packages/agent-runtime/src/cycle.test.ts packages/agent-runtime/src/index.ts apps/worker/src/agentCycleRunner.ts apps/worker/src/agentCycleRunner.test.ts apps/worker/src/agentScheduling.ts apps/worker/src/agentScheduling.test.ts apps/worker/src/tickRunner.ts apps/worker/src/tickRunner.test.ts packages/observability/src/agentCycleTrace.ts packages/observability/src/agentCycleTrace.test.ts packages/observability/src/agentCycleTraceRepository.ts packages/observability/src/agentCycleTraceRepository.test.ts
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
feat(planning): 增加分层动作修复与反应式纠正
```

Commit body must mention paper alignment, local repair versus reactive correction boundaries,
simulator authority, affected modules, user-visible trace behavior, and exact verification commands
that were actually run.

## Self-Review

- Spec coverage: covers paper §2.1.2 local repair, reactive correction, STM/context input,
  simulator validation, replanning fallback, worker pass-through, and trace persistence.
- Placeholder scan: no TBD/TODO placeholders.
- Scope check: deliberately excludes plan-delta correction, production provider default wiring,
  canonical heuristic repair defaults, and richer STM semantic retrieval.
