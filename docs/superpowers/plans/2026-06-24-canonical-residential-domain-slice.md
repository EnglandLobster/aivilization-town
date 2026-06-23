# Canonical Residential Domain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let durable active plans execute residential-tier upgrade actions through the canonical worker runtime.

**Architecture:** Append a `residential` canonical domain that proposes `AgentUpgradeResidentialTier`. The worker domain runtime may attach resource estimates from the injected residential upgrade policy, but world command simulation remains the authority for acceptance, rejection, and mutation.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, `@aivilization/agent-runtime`, `@aivilization/world`, `@aivilization/worker`.

---

### Task 1: Domain Runtime Proposal

**Files:**
- Modify: `apps/worker/src/canonicalDomainRuntimes.test.ts`
- Modify: `apps/worker/src/canonicalDomainRuntimes.ts`

- [x] **Step 1: Write failing domain runtime tests**

Update deterministic domain order to include `residential`, and assert a residential subtask proposes
`AgentUpgradeResidentialTier` with default target `current residentialTier + 1` and policy-derived
resource estimate.

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aivilization/worker test -- canonicalDomainRuntimes.test.ts`

Expected: FAIL because the canonical residential domain is not registered.

- [x] **Step 3: Implement residential registration**

Add `ResidentialDomainRuntimeConfig`, append `residential` to `CanonicalDomainName`, include
`AgentUpgradeResidentialTierPayload` in canonical proposals, and create a contextual domain
micro-planner.

- [x] **Step 4: Run domain runtime tests**

Run: `pnpm --filter @aivilization/worker test -- canonicalDomainRuntimes.test.ts`

Expected: PASS.

### Task 2: Active Plan Tick Integration

**Files:**
- Modify: `apps/worker/src/canonicalActivePlanTick.test.ts`

- [x] **Step 1: Write failing active-plan test**

Add an active plan whose subtask has the `residential` affinity tag. The tick should dispatch
`AgentUpgradeResidentialTier`, emit `ResidentialTierUpgraded`, update projection tier/balance, and
complete the objective.

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aivilization/worker test -- canonicalActivePlanTick.test.ts`

Expected: FAIL until the residential domain registration is available to the canonical resolver.

- [x] **Step 3: Confirm integration through existing resolver**

No separate resolver branch should be needed; the new registration should flow through
`createCanonicalWorkerRuntimeResolver`.

- [x] **Step 4: Run targeted worker tests**

Run: `pnpm --filter @aivilization/worker test -- canonicalDomainRuntimes.test.ts canonicalActivePlanTick.test.ts`

Expected: PASS.

### Task 3: Verify And Commit

**Files:**
- Review: `apps/worker/src/canonicalDomainRuntimes.ts`
- Review: `apps/worker/src/canonicalActivePlanTick.test.ts`
- Review: `docs/superpowers/plans/2026-06-24-canonical-residential-domain-slice.md`

- [x] **Step 1: Typecheck worker**

Run: `pnpm --filter @aivilization/worker typecheck`

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
git add docs/superpowers/plans/2026-06-24-canonical-residential-domain-slice.md apps/worker/src/canonicalDomainRuntimes.ts apps/worker/src/canonicalDomainRuntimes.test.ts apps/worker/src/canonicalActivePlanTick.test.ts
git commit -m "feat: add canonical residential upgrade domain"
```
