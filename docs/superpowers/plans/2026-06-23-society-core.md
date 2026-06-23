# Society Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the first deterministic AIvilization society core: education accumulation, physiological labor costs, dynamic occupation eligibility, application quotas, and wage formulas.

**Architecture:** Keep society rules in `packages/society` as pure functions over source-derived `content` config and economy price-index outputs. Formula coefficients that the paper leaves unspecified, such as labor cost rates and the dynamic-wage knowledge premium function, are explicit function inputs so future scenario presets can configure them without changing domain code.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, `@aivilization/content`, `@aivilization/economy`.

---

## Scope

This plan implements the first Phase 3 slice from `docs/superpowers/specs/2026-06-23-aivilization-town-design.md`.

It covers:

- Education accumulation from Equation 9: `H(t + dt) = H(t) + eta * dt`.
- Physiological labor depletion for energy and satiety with explicit per-hour rates.
- Incapacitation checks for energy and health thresholds.
- Dynamic knowledge thresholds from Equations 11 and 12.
- Occupation eligibility from Equation 10 using residential tier and effective knowledge threshold.
- Residential-tier application quotas as an explicit non-decreasing policy.
- Static wages from Equation 14.
- Dynamic wages from Equation 15 with an injected non-decreasing knowledge premium.

It does not cover social relationship graphs, memory, planner behavior, API endpoints, persistence, or UI.

## File Structure

- Create `packages/society/src/education.ts`: education accumulation.
- Create `packages/society/src/education.test.ts`: education tests.
- Create `packages/society/src/physiology.ts`: work cost and incapacitation checks.
- Create `packages/society/src/physiology.test.ts`: physiology tests.
- Create `packages/society/src/occupation.ts`: thresholds, eligibility, and application quota policy.
- Create `packages/society/src/occupation.test.ts`: occupation eligibility tests.
- Create `packages/society/src/wage.ts`: static and dynamic wage formulas.
- Create `packages/society/src/wage.test.ts`: wage tests.
- Modify `packages/society/src/index.ts`: export society public API.
- Modify `packages/society/package.json`: depend on content and economy packages.

## Tasks

### Task 1: Education And Physiology

**Files:**

- Create: `packages/society/src/education.ts`
- Create: `packages/society/src/education.test.ts`
- Create: `packages/society/src/physiology.ts`
- Create: `packages/society/src/physiology.test.ts`
- Modify: `packages/society/src/index.ts`

- [x] Write failing tests for education accumulation, labor depletion, and incapacitation.
- [x] Run `pnpm --filter @aivilization/society test` and confirm the new APIs are missing.
- [x] Implement education and physiology pure functions.
- [x] Run `pnpm --filter @aivilization/society test` and `pnpm --filter @aivilization/society typecheck`.
- [x] Commit with `git commit -m "feat: add education and physiology rules"`.

### Task 2: Occupation Eligibility

**Files:**

- Create: `packages/society/src/occupation.ts`
- Create: `packages/society/src/occupation.test.ts`
- Modify: `packages/society/src/index.ts`
- Modify: `packages/society/package.json`

- [x] Write failing tests for quantile threshold, effective threshold floor, residential gates, and application quota.
- [x] Run `pnpm --filter @aivilization/society test` and confirm the occupation APIs are missing.
- [x] Implement dynamic thresholds and eligibility against source-derived occupation config.
- [x] Run `pnpm --filter @aivilization/society test` and `pnpm --filter @aivilization/society typecheck`.
- [x] Commit with `git commit -m "feat: add occupation eligibility rules"`.

### Task 3: Wage Formulas

**Files:**

- Create: `packages/society/src/wage.ts`
- Create: `packages/society/src/wage.test.ts`
- Modify: `packages/society/src/index.ts`

- [x] Write failing tests for static wage, dynamic wage, bounded shock validation, and occupation lookup.
- [x] Run `pnpm --filter @aivilization/society test` and confirm wage APIs are missing.
- [x] Implement Equation 14 and Equation 15 as pure functions.
- [x] Run `pnpm --filter @aivilization/society test`, `pnpm --filter @aivilization/society typecheck`, `pnpm check`, and `pnpm build`.
- [x] Commit with `git commit -m "feat: add society wage formulas"`.

## Self-Review

- Spec coverage: This plan covers the first society-layer slice for education, physiology thresholds, occupation eligibility, application quotas, static wages, dynamic wages, and labor-consumption coupling inputs.
- Red-flag scan: No forbidden marker strings remain in this plan.
- Type consistency: Function names, result fields, and imported package boundaries are consistent across the planned tests and implementation.
