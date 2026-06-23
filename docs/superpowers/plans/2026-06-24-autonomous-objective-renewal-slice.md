# Autonomous Objective Renewal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let idle agents generate a new durable long-horizon objective and branch plan so canonical ticks keep agent lives moving after objective completion.

**Architecture:** Keep objective storage and completion in `@aivilization/memory`, and add objective renewal as a worker orchestration seam. The worker renewal module reads world state, intention state, and long-term profile, then uses an injectable proposer and strategic plan compiler to create an active objective plus durable branch plan. `runCanonicalWorkerActivePlanTick` calls renewal before scheduling, so generated objectives can execute in the same tick while remaining replaceable by future LLM/reflection-based proposers.

**Tech Stack:** TypeScript, Vitest, `@aivilization/memory`, `@aivilization/agent-runtime`, `apps/worker`.

---

## Scope

This slice adds autonomous goal renewal:

- Add an `AutonomousObjectiveProposer` worker contract.
- Add a deterministic default proposer based on current world state.
- Add `renewMissingActiveObjectives` that sets objectives and saves compiled branch plans for agents with no active objective.
- Allow custom proposers and custom strategic plan compilers.
- Invoke renewal before canonical active-plan scheduling.
- Keep agents with existing active objectives untouched.

It does not implement LLM reflection, multi-objective queues, social coordination, or cross-agent goal negotiation. Those are later slices that can plug into the proposer seam.

## File Structure

- Create `apps/worker/src/objectiveRenewal.test.ts`: cover proposer behavior, durable plan creation, and canonical integration.
- Create `apps/worker/src/objectiveRenewal.ts`: implement proposer contract and renewal orchestration.
- Modify `apps/worker/src/canonicalActivePlanTick.test.ts`: cover canonical ticks for agents without active objectives.
- Modify `apps/worker/src/canonicalActivePlanTick.ts`: call renewal before scheduling and expose proposer/compiler inputs.
- Modify `apps/worker/src/index.ts`: export renewal module.
- Modify this plan file as tasks complete.

## Task 1: Tests

**Files:**

- Create: `apps/worker/src/objectiveRenewal.test.ts`
- Modify: `apps/worker/src/canonicalActivePlanTick.test.ts`

- [ ] **Step 1: Write failing tests for autonomous objective renewal**

Add tests that require:

- `createDefaultAutonomousObjective` proposes a study objective for low-education agents with no active objective.
- `renewMissingActiveObjectives` sets the generated objective and saves a branch plan.
- `renewMissingActiveObjectives` skips agents that already have an active objective.
- `runCanonicalWorkerActivePlanTick` renews an idle agent before scheduling, runs the generated plan in the same tick, and persists the active objective.

Run:

```bash
pnpm test -- apps/worker/src/objectiveRenewal.test.ts apps/worker/src/canonicalActivePlanTick.test.ts
```

Expected before implementation: tests fail because objective renewal exports and canonical renewal integration do not exist.

## Task 2: Worker Renewal Implementation

**Files:**

- Create: `apps/worker/src/objectiveRenewal.ts`
- Modify: `apps/worker/src/index.ts`

- [ ] **Step 2: Implement standalone renewal orchestration**

Behavior:

- Define `AutonomousObjectiveProposer(input)` returning `LongHorizonObjective | undefined | Promise<LongHorizonObjective | undefined>`.
- `createDefaultAutonomousObjective(input)` returns deterministic objectives:
  - low `energy`, `satiety`, or `health`: wellbeing/maintenance objective.
  - education below 100: study/education objective.
  - balance below 50: work/income objective.
  - otherwise: routine maintenance objective.
- Objective ids are deterministic per agent and issued time, using `auto-objective-${agentId}-${issuedAt}`.
- `renewMissingActiveObjectives(input)`:
  - loops projection agents in sorted id order.
  - reads intention state and skips agents with active objectives.
  - reads long-term profile for future proposer context.
  - calls the proposer.
  - saves the objective through `intentionRepository.setObjective`.
  - compiles and saves a branch plan through `planRepository`.
  - returns renewed objective ids.

## Task 3: Canonical Integration

**Files:**

- Modify: `apps/worker/src/canonicalActivePlanTick.ts`

- [ ] **Step 3: Renew idle objectives before scheduling**

Behavior:

- Add optional `objectiveProposer?: AutonomousObjectiveProposer`.
- Add optional `strategicPlanCompiler?: StrategicPlanCompiler`.
- Before `buildWorkerTickAgentsFromActivePlans`, call `renewMissingActiveObjectives` with projection, repositories, issuedAt, proposer, and compiler.
- Scheduling then sees newly created objectives and durable plans in the same tick.

## Task 4: Verification

**Files:**

- Modify: this plan file

- [ ] **Step 4: Run focused and full verification**

Run:

```bash
pnpm test -- apps/worker/src/objectiveRenewal.test.ts apps/worker/src/canonicalActivePlanTick.test.ts
pnpm --filter @aivilization/worker test
pnpm --filter @aivilization/worker typecheck
pnpm check
pnpm build
```

Commit the implementation and update this plan when the checks pass.
