# Agent Cycle Observed State Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route the existing `observedStateSummary` from worker traces into agent-runtime cognition inputs and LLM prompts.

**Architecture:** The worker remains responsible for summarizing projection-backed agent state. Agent-runtime treats that summary as a first-class cognition context field and forwards it consistently to prioritization, micro-planning, action generation, social dialogue, global synthesis, reactive correction, and replanning seams without parsing it into a second rules engine.

**Tech Stack:** TypeScript, Vitest, pnpm workspace packages under `apps/worker` and `packages/agent-runtime`.

---

### Task 1: Lock The Missing Context With RED Tests

**Files:**
- Modify: `apps/worker/src/agentCycleRunner.test.ts`
- Modify: `packages/agent-runtime/src/llmSubtaskPrioritizer.test.ts`

- [x] **Step 1: Write the worker/cycle failing test**

Add an assertion to the contextual prioritizer path proving `runWorkerAgentCycle` forwards `observedStateSummary` into `SubtaskPrioritizerInput`.

- [x] **Step 2: Write the LLM prompt failing test**

Add an LLM prioritizer assertion proving `observedStateSummary` appears in the serialized user prompt next to `worldDecisionContext`, `shortTermMemoryContext`, and profile.

- [x] **Step 3: Run RED**

Run:

```bash
pnpm -s vitest run apps/worker/src/agentCycleRunner.test.ts packages/agent-runtime/src/llmSubtaskPrioritizer.test.ts
```

Expected: FAIL because `observedStateSummary` is currently not part of agent-runtime cognition inputs or prompt payloads.

### Task 2: Thread Observed State Through Agent Runtime

**Files:**
- Modify: `packages/agent-runtime/src/cycle.ts`
- Modify: `packages/agent-runtime/src/subtaskPrioritization.ts`
- Modify: `packages/agent-runtime/src/actionSequenceGeneration.ts`
- Modify: `packages/agent-runtime/src/socialDialogueGeneration.ts`
- Modify: `packages/agent-runtime/src/globalSynthesis.ts`
- Modify: `packages/agent-runtime/src/actionRepair.ts`
- Modify: `packages/agent-runtime/src/replanning.ts`
- Modify: `apps/worker/src/agentCycleRunner.ts`

- [x] **Step 1: Add the shared optional field**

Add `readonly observedStateSummary?: string` to the agent-runtime cognition input types listed above.

- [x] **Step 2: Forward it through cycle orchestration**

Forward `input.observedStateSummary` from `runAgentPlanningCycleWithPrioritization` to the prioritizer, from `createDomainMicroPlannerContext` to deterministic micro-planners, and from async cycle orchestration to action sequence, social dialogue, global synthesis, reactive correction, and replanning decider inputs.

- [x] **Step 3: Forward it from worker**

Pass `observedStateSummary: input.observedStateSummary` into `cycleInput` in `runWorkerAgentCycle`.

### Task 3: Put Observed State Into LLM Prompt Payloads

**Files:**
- Modify: `packages/agent-runtime/src/llmSubtaskPrioritizer.ts`
- Modify: `packages/agent-runtime/src/llmActionSequenceGenerator.ts`
- Modify: `packages/agent-runtime/src/llmSocialDialogueGenerator.ts`
- Modify: `packages/agent-runtime/src/llmGlobalSynthesizer.ts`
- Modify: `packages/agent-runtime/src/llmReactiveCorrector.ts`
- Modify: `packages/agent-runtime/src/llmReplanningDecider.ts`

- [x] **Step 1: Add prompt payload field**

Include `observedStateSummary` in each LLM user payload when present.

- [x] **Step 2: Run GREEN**

Run:

```bash
pnpm -s vitest run apps/worker/src/agentCycleRunner.test.ts packages/agent-runtime/src/llmSubtaskPrioritizer.test.ts
```

Expected: PASS.

### Task 4: Verify And Commit

**Files:**
- Modified implementation files, tests, and this plan document only.

- [x] **Step 1: Run full verification**

Run:

```bash
pnpm test
pnpm typecheck
pnpm lint
git diff --check
```

Expected: all pass.

- [x] **Step 2: Commit**

Commit with Conventional Commit format and a body explaining the state-context pipeline defect, affected agent-runtime seams, prompt coverage, user-visible behavior, and executed verification commands.
