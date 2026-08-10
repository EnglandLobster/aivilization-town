# Education Production Efficiency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make education score affect productive efficiency through a policy-driven production cost multiplier, so study has a concrete long-horizon return in the industrial economy.

**Architecture:** `packages/economy` owns pure production-efficiency math and applies it to production costs. `packages/world` passes each producing agent's education score into production planning and emits the applied efficiency for observability. `packages/content` owns source-backed default production-efficiency tuning. `apps/worker` maps the default policy into world command policies and canonical production resource estimates.

**Tech Stack:** TypeScript, Vitest, pnpm, existing monorepo packages `economy`, `world`, `content`, and `worker`.

---

## File Structure

- Modify `packages/economy/src/production.ts`: add `ProductionEfficiencyPolicy`, pure efficiency calculation, and policy-aware cost scaling.
- Modify `packages/economy/src/productionChain.ts`: apply the same policy to chain step and aggregate resource estimates.
- Modify `packages/economy/src/production.test.ts`: prove education reduces production cost when policy is present and preserves existing behavior when absent.
- Modify `packages/economy/src/productionChain.test.ts`: prove chain totals use the same efficiency policy.
- Modify `packages/world/src/events.ts`: add optional production-efficiency metadata to `CommodityProduced`.
- Modify `packages/world/src/agentActions.ts`: pass agent education score and production efficiency policy into `planProduction`.
- Modify `packages/world/src/agentActions.test.ts`: prove `AgentProduce` emits policy-scaled costs and applied efficiency metadata.
- Modify `packages/content/src/scenarios.ts`: add default source-backed production efficiency policy.
- Modify `packages/content/src/content.test.ts`: prove default policy values and source.
- Modify `apps/worker/src/aivilizationWorldPolicies.ts`: map default policy into centralized world command policies.
- Modify `apps/worker/src/aivilizationWorldPolicies.test.ts`: prove default production efficiency policy is exposed without source metadata.
- Modify `apps/worker/src/canonicalDomainRuntimes.ts`: pass policy into canonical production estimates.
- Modify `apps/worker/src/canonicalDomainRuntimes.test.ts`: prove production resource estimates account for education efficiency.

### Task 1: Economy Production Efficiency Rule

**Files:**

- Modify: `packages/economy/src/production.ts`
- Modify: `packages/economy/src/productionChain.ts`
- Test: `packages/economy/src/production.test.ts`
- Test: `packages/economy/src/productionChain.test.ts`

- [x] **Step 1: Write failing economy production-efficiency tests**

Add tests for:

- production without policy preserves existing recipe costs;
- production with zero education and `{ minEfficiency: 0.5, educationScoreForMaxEfficiency: 500 }` doubles energy, satiety, and labor costs;
- production with max education keeps base costs;
- invalid policy values reject with `policy-invalid`;
- production chain totals and first-step estimates use the same policy.

- [x] **Step 2: Verify RED**

Run:
`pnpm --filter @aivilization/economy test -- production.test.ts`
`pnpm --filter @aivilization/economy test -- productionChain.test.ts`

Expected: FAIL because production efficiency policy is not implemented.

- [x] **Step 3: Implement economy efficiency policy**

Add pure calculation and apply it to per-unit production plans and production-chain step resource totals. Omitted policy remains exactly backward compatible.

- [x] **Step 4: Verify GREEN**

Run:
`pnpm --filter @aivilization/economy test -- production.test.ts`
`pnpm --filter @aivilization/economy test -- productionChain.test.ts`

Expected: PASS.

### Task 2: World Production Command Wiring

**Files:**

- Modify: `packages/world/src/events.ts`
- Modify: `packages/world/src/agentActions.ts`
- Test: `packages/world/src/agentActions.test.ts`

- [x] **Step 5: Write failing world command test**

Add a test where `AgentProduce` with education score `0` and production efficiency policy emits doubled production costs plus production-efficiency metadata.

- [x] **Step 6: Verify RED**

Run: `pnpm --filter @aivilization/world test -- agentActions.test.ts`
Expected: FAIL because world production does not pass policy or education score into economy planning.

- [x] **Step 7: Implement world wiring**

Extend `WorldCommandPolicies.production` with an optional `efficiency` policy, pass it through dispatch and handler, and add optional metadata on `CommodityProduced`.

- [x] **Step 8: Verify GREEN**

Run: `pnpm --filter @aivilization/world test -- agentActions.test.ts`
Expected: PASS.

### Task 3: Default Policy and Worker Estimates

**Files:**

- Modify: `packages/content/src/scenarios.ts`
- Modify: `packages/content/src/content.test.ts`
- Modify: `apps/worker/src/aivilizationWorldPolicies.ts`
- Modify: `apps/worker/src/aivilizationWorldPolicies.test.ts`
- Modify: `apps/worker/src/canonicalDomainRuntimes.ts`
- Modify: `apps/worker/src/canonicalDomainRuntimes.test.ts`

- [x] **Step 9: Write failing content and worker tests**

Expect `aivilizationProductionPolicyDefaults.educationEfficiency` to carry the source-backed default tuning, expect `createAivilizationWorldCommandPolicies().production.efficiency` to expose pure policy values, and expect canonical production resource estimates to use the policy.

- [x] **Step 10: Verify RED**

Run:
`pnpm --filter @aivilization/content test -- content.test.ts`
`pnpm --filter @aivilization/worker test -- aivilizationWorldPolicies.test.ts`
`pnpm --filter @aivilization/worker test -- canonicalDomainRuntimes.test.ts`

Expected: FAIL because defaults and worker estimate wiring are not implemented.

- [x] **Step 11: Implement default wiring**

Add content defaults, worker world-policy mapping, and policy-aware canonical production resource estimates.

- [x] **Step 12: Verify GREEN**

Run:
`pnpm --filter @aivilization/content test -- content.test.ts`
`pnpm --filter @aivilization/worker test -- aivilizationWorldPolicies.test.ts`
`pnpm --filter @aivilization/worker test -- canonicalDomainRuntimes.test.ts`

Expected: PASS.

### Task 4: Verification and Commit

**Files:**

- Modify: `docs/superpowers/plans/2026-06-25-education-production-efficiency-slice.md`

- [x] **Step 13: Format changed files**

Run: `pnpm exec prettier --write docs/superpowers/plans/2026-06-25-education-production-efficiency-slice.md packages/economy/src/production.ts packages/economy/src/production.test.ts packages/economy/src/productionChain.ts packages/economy/src/productionChain.test.ts packages/world/src/events.ts packages/world/src/agentActions.ts packages/world/src/agentActions.test.ts packages/content/src/scenarios.ts packages/content/src/content.test.ts apps/worker/src/aivilizationWorldPolicies.ts apps/worker/src/aivilizationWorldPolicies.test.ts apps/worker/src/canonicalDomainRuntimes.ts apps/worker/src/canonicalDomainRuntimes.test.ts`

- [x] **Step 14: Run focused and repo checks**

Run:
`pnpm --filter @aivilization/economy test -- production.test.ts`
`pnpm --filter @aivilization/economy test -- productionChain.test.ts`
`pnpm --filter @aivilization/world test -- agentActions.test.ts`
`pnpm --filter @aivilization/content test -- content.test.ts`
`pnpm --filter @aivilization/worker test -- aivilizationWorldPolicies.test.ts`
`pnpm --filter @aivilization/worker test -- canonicalDomainRuntimes.test.ts`
`pnpm typecheck`
`pnpm lint`
`pnpm test`
`git diff --check`

- [x] **Step 15: Commit**

Run:
`git add docs/superpowers/plans/2026-06-25-education-production-efficiency-slice.md packages/economy/src/production.ts packages/economy/src/production.test.ts packages/economy/src/productionChain.ts packages/economy/src/productionChain.test.ts packages/world/src/events.ts packages/world/src/agentActions.ts packages/world/src/agentActions.test.ts packages/content/src/scenarios.ts packages/content/src/content.test.ts apps/worker/src/aivilizationWorldPolicies.ts apps/worker/src/aivilizationWorldPolicies.test.ts apps/worker/src/canonicalDomainRuntimes.ts apps/worker/src/canonicalDomainRuntimes.test.ts`
`git commit -m "feat: apply education production efficiency"`

## Self-Review

- Spec coverage: This slice addresses the paper's requirement that education improves long-run production efficiency while preserving the existing hard recipe and residential constraints.
- Boundary review: The formula lives in economy, default tuning lives in content, world remains event-authoritative, and worker composition owns runtime defaults and estimates.
- Placeholder scan: No placeholder tasks or values; balancing constants are explicit policy defaults with source metadata.
