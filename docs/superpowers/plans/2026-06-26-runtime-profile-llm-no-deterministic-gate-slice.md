# 2026-06-26 Runtime Profile LLM No Deterministic Gate Slice

## Goal

Tighten runtime profile validation so stages configured as LLM-powered cannot pass while mixing deterministic source traces. The previous no-fallback gate proves that the LLM path did not fall back after a failed provider call; this slice also proves that configured LLM stages did not bypass the provider through a direct deterministic implementation.

## Scope

- Add explicit no-deterministic criteria for agent-cycle LLM stages.
- Add explicit no-deterministic criteria for cognition LLM stages.
- Derive these criteria from the local runtime profile `runtimeConfig`.
- Keep this slice at the profile gate layer only; do not change planner semantics or provider construction.

## Non-Goals

- Do not implement new LLM planners.
- Do not change existing trace aggregation semantics.
- Do not make full profile runs part of this slice.

## Design

Add two optional criteria fields to `RuntimeProfileRunGateCriteria`:

- `requiredAgentCycleLlmNoDeterministicStages`
- `requiredCognitionLlmNoDeterministicStages`

For each required stage, the gate fails when `deterministicCount > 0`:

- Agent-cycle failure code: `agent-cycle-llm-stage-deterministic-trace-present`
- Cognition failure code: `cognition-llm-stage-deterministic-trace-present`

Both failures include `stageName`, `actual`, and `maximum: 0`.

In `apps/server`, derive these arrays from the same accepted-stage derivation used by the no-fallback gate. A configured LLM stage must now satisfy all three properties: at least one accepted LLM trace, zero deterministic fallback traces, and zero deterministic direct traces.

## TDD Tasks

1. Add RED tests in `packages/observability/src/runtimeProfileRunGate.test.ts`.
   - Agent-cycle: `contextualPrioritization` with `llmAcceptedCount: 1`, `deterministicFallbackCount: 0`, `deterministicCount: 1` must fail.
   - Cognition: `strategicPlanning` with the same shape must fail.

2. Add RED expectations in `apps/server/src/localRuntimeTownProfileGate.test.ts`.
   - Full runtime config should derive `requiredAgentCycleLlmNoDeterministicStages`.
   - Full runtime config should derive `requiredCognitionLlmNoDeterministicStages`.

3. Run targeted RED tests:
   - `pnpm test -- packages/observability/src/runtimeProfileRunGate.test.ts apps/server/src/localRuntimeTownProfileGate.test.ts`

4. Implement the gate and server criteria derivation.

5. Run GREEN verification:
   - `pnpm test -- packages/observability/src/runtimeProfileRunGate.test.ts apps/server/src/localRuntimeTownProfileGate.test.ts`
   - `pnpm lint`
   - `pnpm typecheck`
   - `pnpm test`
   - `git diff --check`

## Review Notes

This slice is intentionally a validation hardening change. It does not prove that every paper reasoning step is implemented, but it prevents a future "LLM profile" from passing while a configured stage quietly reports deterministic execution.
