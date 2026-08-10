# Medical Treatment Cost Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `AgentSeeDoctor` participate in the economy through policy-driven medical treatment costs while preserving server-authoritative command/event semantics.

**Architecture:** `packages/society` owns pure institutional healthcare cost evaluation. `packages/world` owns `MedicalTreatmentCharged` event emission and projection replay. `packages/content` keeps the source-backed default medical policy, and `apps/worker` maps it into the centralized AIvilization world policy factory.

**Tech Stack:** TypeScript, Vitest, pnpm, existing monorepo packages `society`, `world`, `content`, and `worker`.

---

## File Structure

- Create `packages/society/src/healthcare.ts`: pure policy and decision types for medical treatment costs.
- Modify `packages/society/src/index.ts`: export healthcare rules.
- Add `packages/society/src/healthcare.test.ts`: prove charge, free treatment, insufficient balance, and invalid policy behavior.
- Modify `packages/sim-core/src/event.ts`: include the medical treatment charge in the shared event envelope type list.
- Modify `packages/world/src/events.ts`: add `MedicalTreatmentCharged` event payload/type.
- Modify `packages/world/src/projection.ts`: replay medical charges into agent balance and money supply.
- Modify `packages/world/src/projection.test.ts`: prove projection replay.
- Modify `packages/world/src/agentActions.ts`: pass optional `seeDoctor.treatmentCost` policy, charge before health recovery, and reject unaffordable treatment.
- Modify `packages/world/src/agentActions.test.ts`: prove charged see-doctor, insufficient balance rejection, and dispatcher routing.
- Modify `packages/content/src/scenarios.ts`: add default medical treatment policy config.
- Modify `packages/content/src/content.test.ts`: prove default policy source and values.
- Modify `apps/worker/src/aivilizationWorldPolicies.ts`: map default medical policy into `seeDoctor.treatmentCost`.
- Modify `apps/worker/src/aivilizationWorldPolicies.test.ts`: prove centralized factory exposes default medical policy.

### Task 1: Society Healthcare Cost Rule

**Files:**

- Create: `packages/society/src/healthcare.ts`
- Modify: `packages/society/src/index.ts`
- Test: `packages/society/src/healthcare.test.ts`

- [x] **Step 1: Write failing society healthcare tests**

Add tests for:

- `evaluateMedicalTreatmentCost({ balance: 100, durationSeconds: 1800, policy: { currencyCostPerSecond: 0.02 } })` charges `36`.
- zero cost returns an uncharged decision.
- balance `10`, duration `1800`, rate `0.02` rejects with `insufficient-balance`.
- negative rate throws/rejects with `policy-invalid`.

- [x] **Step 2: Verify RED**

Run: `pnpm --filter @aivilization/society test -- healthcare.test.ts`
Expected: FAIL because healthcare functions do not exist.

- [x] **Step 3: Implement healthcare rule**

Add `MedicalTreatmentCostPolicy`, `MedicalTreatmentCostDecision`, and `evaluateMedicalTreatmentCost`.

- [x] **Step 4: Verify GREEN**

Run: `pnpm --filter @aivilization/society test -- healthcare.test.ts`
Expected: PASS.

### Task 2: World Event and Projection

**Files:**

- Modify: `packages/world/src/events.ts`
- Modify: `packages/sim-core/src/event.ts`
- Modify: `packages/world/src/projection.ts`
- Test: `packages/world/src/projection.test.ts`

- [x] **Step 5: Write failing projection replay test**

Add a projection test where `MedicalTreatmentCharged` deducts `36` from agent balance and money supply.

- [x] **Step 6: Verify RED**

Run: `pnpm --filter @aivilization/world test -- projection.test.ts`
Expected: FAIL because `MedicalTreatmentCharged` is not a known event.

- [x] **Step 7: Implement event and replay**

Add `MedicalTreatmentChargedPayload` and replay logic mirroring service-fee currency sinks.

- [x] **Step 8: Verify GREEN**

Run: `pnpm --filter @aivilization/world test -- projection.test.ts`
Expected: PASS.

### Task 3: See Doctor Charge Semantics

**Files:**

- Modify: `packages/world/src/agentActions.ts`
- Test: `packages/world/src/agentActions.test.ts`

- [x] **Step 9: Write failing AgentSeeDoctor tests**

Add tests proving:

- charged treatment emits `MedicalTreatmentCharged`, `PhysiologyChanged`, `ShortTermMemoryRecorded`;
- insufficient balance rejects with no physiology or balance change;
- dispatcher passes `seeDoctor.treatmentCost`.

- [x] **Step 10: Verify RED**

Run: `pnpm --filter @aivilization/world test -- agentActions.test.ts`
Expected: FAIL because `AgentSeeDoctor` does not charge treatment costs.

- [x] **Step 11: Implement charging in AgentSeeDoctor**

Use `evaluateMedicalTreatmentCost` after payload/cap validation and before `applyHealthRecovery`. Cost policy is optional; omitting it preserves existing free treatment behavior.

- [x] **Step 12: Verify GREEN**

Run: `pnpm --filter @aivilization/world test -- agentActions.test.ts`
Expected: PASS.

### Task 4: Default Policy Wiring

**Files:**

- Modify: `packages/content/src/scenarios.ts`
- Modify: `packages/content/src/content.test.ts`
- Modify: `apps/worker/src/aivilizationWorldPolicies.ts`
- Modify: `apps/worker/src/aivilizationWorldPolicies.test.ts`

- [x] **Step 13: Write failing content and worker tests**

Expect `aivilizationHealthcarePolicyDefaults.seeDoctorTreatmentCost` to be `{ currencyCostPerSecond: 0.02 }` with a Section 3.1.1 healthcare source, and expect `createAivilizationWorldCommandPolicies().seeDoctor.treatmentCost` to expose the policy without source metadata.

- [x] **Step 14: Verify RED**

Run:
`pnpm --filter @aivilization/content test -- content.test.ts`
`pnpm --filter @aivilization/worker test -- aivilizationWorldPolicies.test.ts`

Expected: FAIL because defaults are not exported/mapped.

- [x] **Step 15: Implement default wiring**

Add content defaults and worker mapping into the existing `seeDoctor` policy object.

- [x] **Step 16: Verify GREEN**

Run:
`pnpm --filter @aivilization/content test -- content.test.ts`
`pnpm --filter @aivilization/worker test -- aivilizationWorldPolicies.test.ts`

Expected: PASS.

### Task 5: Verification and Commit

**Files:**

- Modify: `docs/superpowers/plans/2026-06-25-medical-treatment-cost-slice.md`

- [x] **Step 17: Format changed files**

Run: `pnpm exec prettier --write docs/superpowers/plans/2026-06-25-medical-treatment-cost-slice.md packages/society/src/healthcare.ts packages/society/src/healthcare.test.ts packages/society/src/index.ts packages/sim-core/src/event.ts packages/world/src/events.ts packages/world/src/projection.ts packages/world/src/projection.test.ts packages/world/src/agentActions.ts packages/world/src/agentActions.test.ts packages/content/src/scenarios.ts packages/content/src/content.test.ts apps/worker/src/aivilizationWorldPolicies.ts apps/worker/src/aivilizationWorldPolicies.test.ts`

- [x] **Step 18: Run focused and repo checks**

Run:
`pnpm --filter @aivilization/society test -- healthcare.test.ts`
`pnpm --filter @aivilization/world test -- projection.test.ts`
`pnpm --filter @aivilization/world test -- agentActions.test.ts`
`pnpm --filter @aivilization/content test -- content.test.ts`
`pnpm --filter @aivilization/worker test -- aivilizationWorldPolicies.test.ts`
`pnpm typecheck`
`pnpm lint`
`pnpm test`
`git diff --check`

- [x] **Step 19: Commit**

Run:
`git add docs/superpowers/plans/2026-06-25-medical-treatment-cost-slice.md packages/society/src/healthcare.ts packages/society/src/healthcare.test.ts packages/society/src/index.ts packages/sim-core/src/event.ts packages/world/src/events.ts packages/world/src/projection.ts packages/world/src/projection.test.ts packages/world/src/agentActions.ts packages/world/src/agentActions.test.ts packages/content/src/scenarios.ts packages/content/src/content.test.ts apps/worker/src/aivilizationWorldPolicies.ts apps/worker/src/aivilizationWorldPolicies.test.ts`
`git commit -m "feat: charge medical treatment costs"`

## Self-Review

- Spec coverage: This advances the paper's healthcare recovery action from a free health refill into a resource-constrained economic service.
- Boundary review: Society owns cost math, world owns event truth, content owns defaults, worker owns runtime assembly.
- Placeholder scan: No placeholder tasks or values; medical price is explicit default tuning and remains policy-driven.
