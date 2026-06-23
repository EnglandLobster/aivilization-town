# Canonical Domain Adapters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add worker-owned canonical domain runtime registrations for study, work, trade, sleep, and social activity.

**Architecture:** `apps/worker` owns the adapter layer because adapters bind world context to generic agent-runtime micro-planners. Each domain registration uses `createMicroPlanners` so it can close over the current agent, projection, objective, and plan record while still returning ordinary `DomainMicroPlanner` instances to the cycle executor. This slice provides deterministic defaults and configuration seams, not a full strategic policy engine.

**Tech Stack:** TypeScript, Vitest, `@aivilization/agent-runtime`, `@aivilization/world`, `apps/worker`.

---

## Scope

This slice introduces a canonical adapter surface:

- Add `createCanonicalDomainRuntimeRegistrations`.
- Add individual helpers:
  - `createStudyDomainRuntimeRegistration`
  - `createWorkDomainRuntimeRegistration`
  - `createTradeDomainRuntimeRegistration`
  - `createSleepDomainRuntimeRegistration`
  - `createSocialDomainRuntimeRegistration`
- Return `WorkerDomainRuntimeRegistration` objects that can be passed into `createDomainRuntimeResolver`.
- Use context-aware factories for all canonical domains.
- Let micro-planners support selected subtasks by checking branch id, subtask id, subtask description, branch objective, and subtask affinity tags from the original `BranchPlanRecord`.
- Emit valid world command proposals:
  - study -> `AgentStudy`
  - sleep -> `AgentSleep`
  - work with current job -> `AgentWork`
  - work without current job -> `AgentApplyJob`
  - trade -> `AgentTrade`
  - social -> `AgentSocialize`
- Provide deterministic defaults and configuration overrides for durations, commodity, quantity, occupation, social target, social summary, and social deltas.

It does not implement LLM policy selection, utility scoring, map navigation, relationship-aware target ranking, or production chains. Those need their own policy modules after this registration boundary exists.

## File Structure

- Add `apps/worker/src/canonicalDomainRuntimes.test.ts`: TDD coverage for registrations and proposed commands.
- Add `apps/worker/src/canonicalDomainRuntimes.ts`: canonical domain runtime registration factories.
- Modify `apps/worker/src/index.ts`: export the canonical adapter APIs.
- Modify this plan file as tasks complete.

## Task 1: Canonical Adapter Tests

**Files:**

- Add: `apps/worker/src/canonicalDomainRuntimes.test.ts`

- [ ] **Step 1: Write failing tests for canonical domain adapters**

Create tests that require:

- `createCanonicalDomainRuntimeRegistrations()` returns domains in this order: `study`, `work`, `trade`, `sleep`, `social`.
- A plan with all five domain tags resolves through `createDomainRuntimeResolver` into five micro-planners.
- Each planner supports selected subtasks when the matching domain appears only in the original subtask affinity tags.
- Study planner proposes `AgentStudy` with default or configured `durationSeconds` and `educationRatePerSecond`.
- Sleep planner proposes `AgentSleep` with configured `durationSeconds`.
- Work planner proposes `AgentWork` when the agent has a current job and `AgentApplyJob` with `defaultOccupationName` when the agent has no job.
- Trade planner chooses the configured commodity when present, otherwise the first sorted market pool commodity.
- Social planner chooses the configured target, otherwise the first sorted non-self projected agent.

Run:

```bash
pnpm --filter @aivilization/worker test
```

Expected before implementation: tests fail because `createCanonicalDomainRuntimeRegistrations` does not exist.

## Task 2: Canonical Adapter Implementation

**Files:**

- Add: `apps/worker/src/canonicalDomainRuntimes.ts`
- Modify: `apps/worker/src/index.ts`

- [ ] **Step 2: Implement canonical domain adapters**

Behavior:

- Export `CanonicalDomainRuntimeConfig`.
- Export `createCanonicalDomainRuntimeRegistrations(config?: CanonicalDomainRuntimeConfig)`.
- Export the five individual domain registration helpers.
- Registration domains must be exactly `study`, `work`, `trade`, `sleep`, `social`.
- Use a shared `createContextualDomainMicroPlanner` helper that:
  - sets `planner.domain` to the canonical domain.
  - implements `supports(selectedSubtask)` by finding the original branch/subtask in `planRecord`.
  - tokenizes branch id, branch objective, subtask id, subtask description, and subtask affinity tags.
  - returns true when the canonical domain token appears.
- Default config:
  - study: `durationSeconds = 1800`, `educationRatePerSecond = 1`
  - work: `laborSeconds = 3600`, `defaultOccupationName = 'Cleaner'`
  - trade: `side = 'buy'`, `quantity = 1`
  - sleep: `durationSeconds = 28800`
  - social: `summary = 'Socialized during planned activity.'`, `relationDelta = 1`, `attitudeDelta = 1`
- Trade commodity resolution:
  - use configured `commodityName` when supplied.
  - otherwise use the first sorted key from `projection.marketPools`.
  - otherwise fall back to `'Apple'`.
- Social target resolution:
  - use configured `targetAgentId` when supplied.
  - otherwise use the first sorted projected agent id that is not the current agent.
  - throw `social domain requires targetAgentId or another projected agent` when no target is available.
- Action ids must be deterministic: `canonical-${domain}-${selectedSubtask.subtaskId}`.

## Task 3: Verification

**Files:**

- Modify: this plan file

- [ ] **Step 3: Run focused and full verification**

Run:

```bash
pnpm --filter @aivilization/worker test
pnpm --filter @aivilization/worker typecheck
pnpm check
pnpm build
```

Commit the implementation and update this plan when the checks pass.
