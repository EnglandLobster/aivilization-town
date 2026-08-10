# Scenario Profile Seeding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seed long-term adaptive profiles from content scenario agent profile seeds during backend startup.

**Architecture:** Keep profile seed data in `@aivilization/content` and durable profile storage in `@aivilization/memory`. `apps/worker` owns the adapter because bootstrap composition crosses content and memory boundaries. Seeding is idempotent and preserves already-evolved profiles across restarts.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, worker orchestration modules.

---

## Scope

This slice creates a worker helper that initializes missing long-term profile personality entries from scenario agent seeds.

It does not implement embeddings, LLM profile generation, social reflection changes, or full simulation bootstrap orchestration.

## File Structure

- Create `apps/worker/src/scenarioProfileSeeding.ts`: scenario-to-long-term-profile seeding adapter.
- Create `apps/worker/src/scenarioProfileSeeding.test.ts`: focused tests for seeding and restart idempotency.
- Modify `apps/worker/src/index.ts`: export the helper.
- Create `docs/superpowers/plans/2026-06-24-scenario-profile-seeding-slice.md`: track this implementation slice.

## Tasks

### Task 1: Failing Profile Seeding Tests

**Files:**

- Create: `apps/worker/src/scenarioProfileSeeding.test.ts`

- [x] **Step 1: Write failing tests**

Add tests that assert:

- `seedLongTermProfilesFromScenario` writes a deterministic `initial-mbti` personality entry for each scenario agent.
- It returns seeded and skipped counts.
- Re-running seeding skips agents whose `initial-mbti` profile entry already exists, preserving existing evolved entries.

- [x] **Step 2: Verify red**

Run:

```bash
pnpm --filter @aivilization/worker test -- scenarioProfileSeeding.test.ts
```

Expected: FAIL because the helper is not exported yet.

### Task 2: Profile Seeding Adapter

**Files:**

- Create: `apps/worker/src/scenarioProfileSeeding.ts`
- Modify: `apps/worker/src/index.ts`

- [x] **Step 1: Implement helper**

Add:

- `ScenarioProfileSeedingInput`
- `ScenarioProfileSeedingResult`
- `seedLongTermProfilesFromScenario`

The helper should call `repository.getOrCreate(agentId)`, append `initial-mbti` only when missing, and `save` only changed profiles.

- [x] **Step 2: Verify green**

Run:

```bash
pnpm --filter @aivilization/worker test -- scenarioProfileSeeding.test.ts
pnpm --filter @aivilization/worker typecheck
```

Expected: PASS.

### Task 3: Verification And Commit

**Files:**

- All files touched in this plan.

- [x] **Step 1: Run full verification**

Run:

```bash
pnpm check
pnpm build
git diff --check
```

Expected: all commands pass.

- [x] **Step 2: Commit**

Run:

```bash
git add docs/superpowers/plans/2026-06-24-scenario-profile-seeding-slice.md apps/worker/src/scenarioProfileSeeding.ts apps/worker/src/scenarioProfileSeeding.test.ts apps/worker/src/index.ts
git commit -m "feat: seed profiles from scenario presets"
```

## Self-Review

- Spec coverage: Connects initial scenario archetypes to adaptive long-term profiles without polluting world state.
- Boundary review: Worker owns cross-package bootstrap composition; content and memory remain decoupled.
- Placeholder scan: No deferred implementation markers remain.
