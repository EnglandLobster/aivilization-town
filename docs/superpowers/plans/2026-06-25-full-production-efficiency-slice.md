# Full Production Efficiency G(S,E,J,R,H) Slice

## Goal

Bring production efficiency closer to AIvilization Section 3.1.1 by making the existing production efficiency policy depend on satiety, energy, health, residential tier, and education score while preserving the existing economy/world/worker abstraction boundaries.

## Root Cause

The current implementation only models the education-score component of productive efficiency. That keeps the policy extension point small, but it does not yet encode the paper's physiological feedback loop where sleep deprivation, hunger, health, and housing quality all affect productivity.

## Boundaries

- Keep production efficiency owned by `@aivilization/economy`.
- Keep scenario-default policy values owned by `@aivilization/content`.
- Keep world command handling responsible for projecting live agent physiology into the economy input.
- Keep worker canonical runtimes as adapters only.
- Do not introduce a separate event type; continue exposing `CommodityProduced.productionEfficiency` as observability metadata.

## TDD Steps

- [x] Add economy tests for the full monotonic efficiency policy and missing physiology-cap validation.
- [x] Add production-chain tests showing chain totals use the same full efficiency policy.
- [x] Add world command tests proving live physiology and residential state are passed into production planning.
- [x] Update content and worker policy tests for the full AIvilization default policy.
- [x] Implement the full policy in economy, then wire world/worker/content.
- [x] Run focused tests, then full typecheck/lint/test and `git diff --check`.
- [x] Commit the slice and report the branch tree/status.

## Verification

- `pnpm --filter @aivilization/economy test -- production.test.ts`
- `pnpm --filter @aivilization/economy test -- productionChain.test.ts`
- `pnpm --filter @aivilization/world test -- agentActions.test.ts`
- `pnpm --filter @aivilization/content test -- content.test.ts`
- `pnpm --filter @aivilization/worker test -- aivilizationWorldPolicies.test.ts`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `git diff --check`
