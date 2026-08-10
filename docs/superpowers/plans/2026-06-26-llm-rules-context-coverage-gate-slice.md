# LLM Rules Context Coverage Gate Slice

## Goal

Make rule-level world context a first-class, testable requirement for LLM-backed decision surfaces. The previous slice routed occupation and production rules into agent-cycle planning contexts, but cognition paths and profile gates still cannot prove that enabled LLM stages saw those rules.

## Scope

- Add observability diagnostics for `rulesContextCount` and `completeRulesContextCount` on agent-cycle and cognition LLM stages.
- Add runtime profile gate criteria and failures for required rules-context coverage.
- Derive rules-context gate requirements from enabled local runtime LLM config.
- Route world command policies into strategic objective renewal, daily planning, and reaction evaluation cognition contexts.

## Out of Scope

- Memory synthesis LLM rules context. Reflection and social-model synthesis currently use memory-package contexts, not the worker world-decision-context builder.
- Prompt wording changes beyond existing trace/context contract.
- New production rules or economic behavior.

## Tasks

### 1. Observability Diagnostics and Gate

1. Add RED tests in `packages/observability/src/runtimeProfileRunReport.test.ts` proving both agent-cycle and cognition diagnostics count rules-bearing world contexts separately from complete world contexts.
2. Add RED tests in `packages/observability/src/runtimeProfileRunGate.test.ts` proving required agent-cycle and cognition rules stages fail when `completeRulesContextCount` is missing or zero.
3. Implement `rulesContextCount` and `completeRulesContextCount` in diagnostics cloning, validation, and trace aggregation.
4. Implement criteria fields:
   - `requiredAgentCycleLlmRulesContextStages`
   - `requiredCognitionLlmRulesContextStages`
5. Implement failure codes:
   - `agent-cycle-llm-stage-complete-rules-context-count-too-low`
   - `cognition-llm-stage-complete-rules-context-count-too-low`

### 2. Local Runtime Gate Derivation

1. Add RED tests in `apps/server/src/localRuntimeTownProfileGate.test.ts` proving runtime config derives rules-context requirements.
2. Agent-cycle rules stages should mirror enabled agent-cycle LLM stages.
3. Cognition rules stages should include strategic planning, daily planning, and reaction evaluation only.
4. Keep reflection and social-model synthesis out of rules-context requirements until their memory synthesis context is explicitly wired to world rules.

### 3. Worker Cognition Policy Wiring

1. Add RED tests for:
   - `apps/worker/src/objectiveRenewal.test.ts`: strategic compiler receives `worldDecisionContext.rules` when policies are provided.
   - `apps/worker/src/dailyRoutineSchedule.test.ts`: daily compiler receives `worldDecisionContext.rules` when policies are provided.
   - `apps/worker/src/tickRunner.test.ts`: reaction evaluator receives `worldDecisionContext.rules` through ambient social observation context.
2. Add optional `policies` inputs where needed and pass them into `createWorldDecisionContextFromProjection`.
3. Wire local runtime and canonical active-plan orchestration callers to pass policy sources into objective and daily renewal.

### 4. Verification and Commit

1. Run focused RED tests before implementation.
2. Run focused GREEN tests after implementation.
3. Run full verification:
   - `pnpm lint`
   - `pnpm typecheck`
   - `pnpm test`
   - `git diff --check`
4. Stage only relevant files and commit with a detailed Conventional Commit message in Chinese.
