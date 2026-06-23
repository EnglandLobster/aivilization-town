# World Job Application Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect `AgentApplyJob` to the server-authoritative world command/event/projection loop.

**Architecture:** Keep `society` as the source of truth for occupation eligibility and residential-tier application quotas. `world` owns command orchestration, immutable job-application facts, assignment projection state, rejected-action observability, and STM records.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, `@aivilization/sim-core`, `@aivilization/society`, `@aivilization/memory`, `@aivilization/world`.

---

## Scope

This plan extends the existing `@aivilization/world` vertical slice from `docs/superpowers/plans/2026-06-23-world-command-slice.md` and `docs/superpowers/plans/2026-06-23-world-economy-slice.md`.

It covers:

- Replay support for `JobApplicationSubmitted` and `JobAssigned`.
- A `jobApplications` projection stream keyed by agent and occupation.
- `AgentApplyJob` command payload validation.
- Application quota enforcement through `society.calculateApplicationQuota`.
- Occupation eligibility enforcement through `society.isEligibleForOccupation`.
- Rejection events and failed STM records for quota or eligibility failures.
- Dispatcher routing for `AgentApplyJob`.

It does not cover employer capacity, interviews, employer-side selection, salary negotiation, dynamic wage calculation at assignment time, API endpoints, UI panels, or long-run stratification reports.

## File Structure

- Modify `packages/world/src/events.ts`: add job application and assignment payloads.
- Modify `packages/world/src/projection.ts`: add job-application projection state and job assignment replay.
- Modify `packages/world/src/projection.test.ts`: add replay tests for application and assignment events.
- Modify `packages/world/src/commands.ts`: add `AgentApplyJobPayload` and guard.
- Modify `packages/world/src/agentActions.ts`: add job application policy, handler, and dispatcher routing.
- Modify `packages/world/src/agentActions.test.ts`: add command handler and dispatcher tests.
- Modify `docs/superpowers/plans/2026-06-23-world-job-application-slice.md`: track implementation status.

## Tasks

### Task 1: Job Projection Events

**Files:**

- Modify: `packages/world/src/events.ts`
- Modify: `packages/world/src/projection.ts`
- Modify: `packages/world/src/projection.test.ts`

- [ ] Write failing tests for replaying job application and assignment events.
- [ ] Run `pnpm --filter @aivilization/world test` and confirm event payload support is missing.
- [ ] Implement `JobApplicationSubmitted` and `JobAssigned` payload types plus projection replay.
- [ ] Run `pnpm --filter @aivilization/world test` and `pnpm --filter @aivilization/world typecheck`.
- [ ] Commit with `git commit -m "feat: add world job projection events"`.

### Task 2: Apply Job Command Handler

**Files:**

- Modify: `packages/world/src/commands.ts`
- Modify: `packages/world/src/agentActions.ts`
- Modify: `packages/world/src/agentActions.test.ts`

- [ ] Write failing tests for `AgentApplyJob` success, eligibility rejection, quota rejection, and dispatcher routing.
- [ ] Run `pnpm --filter @aivilization/world test` and confirm handler support is missing.
- [ ] Implement payload validation and handler orchestration.
- [ ] Enforce quota through `calculateApplicationQuota` without duplicating society rules.
- [ ] Enforce occupation eligibility through `isEligibleForOccupation` without duplicating occupation catalog rules.
- [ ] Emit `JobApplicationSubmitted`, `JobAssigned`, and successful STM for accepted applications.
- [ ] Emit `ActionRejected` and failed STM for rejected applications.
- [ ] Route `AgentApplyJob` through `dispatchWorldCommand`.
- [ ] Run `pnpm --filter @aivilization/world test` and `pnpm --filter @aivilization/world typecheck`.
- [ ] Commit with `git commit -m "feat: add job application command handler"`.

### Task 3: Whole-Repo Verification

**Files:**

- Modify: `docs/superpowers/plans/2026-06-23-world-job-application-slice.md`

- [ ] Run `pnpm check`.
- [ ] Run `pnpm build`.
- [ ] Update this plan's completed checkboxes.
- [ ] Commit the final plan update if needed.

## Acceptance Criteria

- Event replay deterministically records application attempts and updates the assigned job.
- `AgentApplyJob` accepts valid applications and rejects quota or eligibility failures with observable domain events.
- The world package consumes society APIs for quota and eligibility instead of reimplementing those formulas.
- Dispatcher coverage proves `AgentApplyJob` is part of the same server-authoritative command loop as eat, study, work, produce, and trade.
- Full repo checks remain green.
