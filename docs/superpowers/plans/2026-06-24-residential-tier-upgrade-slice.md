# Residential Tier Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add policy-driven residential-tier upgrades as a command/event/projection vertical slice.

**Architecture:** `@aivilization/society` owns pure upgrade eligibility and cost evaluation. `@aivilization/world` owns payload validation, command handling, events, projection replay, rejection observability, and STM records. `@aivilization/sim-core` only extends the command type union.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, `@aivilization/sim-core`, `@aivilization/society`, `@aivilization/world`.

---

### Task 1: Society Upgrade Policy

**Files:**
- Create: `packages/society/src/residential.ts`
- Create: `packages/society/src/residential.test.ts`
- Modify: `packages/society/src/index.ts`

- [x] **Step 1: Write failing pure-rule tests**

Cover accepted sequential upgrades, rejection for non-sequential targets, insufficient balance,
insufficient inventory, and insufficient education.

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aivilization/society test -- residential.test.ts`

Expected: FAIL because `evaluateResidentialTierUpgrade` does not exist.

- [x] **Step 3: Implement policy evaluator**

Add `evaluateResidentialTierUpgrade` with policy-driven target costs, sequential upgrade enforcement,
and non-mutating accepted/rejected decisions.

- [x] **Step 4: Run society tests**

Run: `pnpm --filter @aivilization/society test -- residential.test.ts`

Expected: PASS.

### Task 2: World Command/Event Slice

**Files:**
- Modify: `packages/sim-core/src/command.ts`
- Modify: `packages/sim-core/src/event.ts`
- Modify: `packages/world/src/commands.ts`
- Modify: `packages/world/src/events.ts`
- Modify: `packages/world/src/projection.ts`
- Modify: `packages/world/src/agentActions.ts`
- Modify: `packages/world/src/agentActions.test.ts`

- [x] **Step 1: Write failing world tests**

Cover successful `AgentUpgradeResidentialTier`, rejection when policy costs cannot be paid,
dispatcher routing, and projection replay of balance/inventory/tier changes.

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aivilization/world test -- agentActions.test.ts`

Expected: FAIL because command/event support is missing.

- [x] **Step 3: Implement command, event, projection, and handler**

Wire `AgentUpgradeResidentialTier` through sim-core command type, world payload guards, event types,
projection replay, command dispatch, and STM observability.

- [x] **Step 4: Run world tests**

Run: `pnpm --filter @aivilization/world test -- agentActions.test.ts`

Expected: PASS.

### Task 3: Verify And Commit

**Files:**
- Review: `packages/society/src/residential.ts`
- Review: `packages/world/src/agentActions.ts`
- Review: `docs/superpowers/specs/2026-06-24-residential-tier-upgrade-design.md`
- Review: `docs/superpowers/plans/2026-06-24-residential-tier-upgrade-slice.md`

- [x] **Step 1: Typecheck touched packages**

Run:

```bash
pnpm --filter @aivilization/society typecheck
pnpm --filter @aivilization/world typecheck
```

Expected: PASS.

- [x] **Step 2: Run full repo checks**

Run: `pnpm check`

Expected: PASS.

- [x] **Step 3: Run build**

Run: `pnpm build`

Expected: PASS.

- [x] **Step 4: Commit**

Run:

```bash
git add docs/superpowers/specs/2026-06-24-residential-tier-upgrade-design.md docs/superpowers/plans/2026-06-24-residential-tier-upgrade-slice.md packages/society/src/residential.ts packages/society/src/residential.test.ts packages/society/src/index.ts packages/sim-core/src/command.ts packages/sim-core/src/event.ts packages/world/src/commands.ts packages/world/src/events.ts packages/world/src/projection.ts packages/world/src/agentActions.ts packages/world/src/agentActions.test.ts
git commit -m "feat: add residential tier upgrade command"
```
