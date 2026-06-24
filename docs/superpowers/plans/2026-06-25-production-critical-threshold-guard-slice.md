# Production Critical Threshold Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent incapacitated agents from producing commodities, matching the paper's physiological constraint that agents below critical energy or health cannot engage in labor or production.

**Architecture:** `packages/society` already owns `isIncapacitated`. `packages/world` should apply that rule at the `AgentProduce` command boundary using the existing `WorldCommandPolicies.criticalThresholds`, the same way `AgentWork` does. Worker and server layers continue to supply policy through the existing centralized policy factory; no new runtime subsystem is needed.

**Tech Stack:** TypeScript, Vitest, pnpm, existing `world` command/event flow.

---

## File Structure

- Modify `packages/world/src/agentActions.ts`: pass `criticalThresholds` into `handleAgentProduceCommand` from `dispatchWorldCommand`, and reject incapacitated agents before production planning.
- Modify `packages/world/src/agentActions.test.ts`: prove direct handler and dispatcher reject incapacitated production without mutating projection.

### Task 1: AgentProduce Incapacitation Guard

**Files:**

- Modify: `packages/world/src/agentActions.ts`
- Test: `packages/world/src/agentActions.test.ts`

- [x] **Step 1: Write failing AgentProduce incapacity tests**

Add tests proving:

- `handleAgentProduceCommand` rejects a health-incapacitated agent with `ActionRejected` and failed STM;
- `dispatchWorldCommand` passes `criticalThresholds` into `AgentProduce`.

- [x] **Step 2: Verify RED**

Run: `pnpm --filter @aivilization/world test -- agentActions.test.ts`
Expected: FAIL because `AgentProduce` does not currently check `criticalThresholds`.

- [x] **Step 3: Implement world guard**

Add optional `criticalThresholds` to `handleAgentProduceCommand`, pass it from dispatcher, and reject with `agent is incapacitated` before production planning.

- [x] **Step 4: Verify GREEN**

Run: `pnpm --filter @aivilization/world test -- agentActions.test.ts`
Expected: PASS.

### Task 2: Verification and Commit

**Files:**

- Modify: `docs/superpowers/plans/2026-06-25-production-critical-threshold-guard-slice.md`

- [x] **Step 5: Format changed files**

Run: `pnpm exec prettier --write docs/superpowers/plans/2026-06-25-production-critical-threshold-guard-slice.md packages/world/src/agentActions.ts packages/world/src/agentActions.test.ts`

- [x] **Step 6: Run focused and repo checks**

Run:
`pnpm --filter @aivilization/world test -- agentActions.test.ts`
`pnpm typecheck`
`pnpm lint`
`pnpm test`
`git diff --check`

- [x] **Step 7: Commit**

Run:
`git add docs/superpowers/plans/2026-06-25-production-critical-threshold-guard-slice.md packages/world/src/agentActions.ts packages/world/src/agentActions.test.ts`
`git commit -m "fix: block incapacitated production"`

## Self-Review

- Spec coverage: This closes a direct paper constraint: agents below critical energy or health cannot perform production.
- Boundary review: The guard reuses society's pure incapacity rule and world's existing command policy boundary.
- Placeholder scan: No placeholder values or future-only requirements.
