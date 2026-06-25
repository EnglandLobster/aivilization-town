# Runtime Profile Accepted Context Completeness Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require every accepted LLM trace in configured profile stages to have complete world and rules context, not merely one representative trace.

**Architecture:** Keep the invariant inside `@aivilization/observability` because profile reports already aggregate accepted LLM counts and context coverage counts. The gate compares `completeWorldDecisionContextCount` and `completeRulesContextCount` against `llmAcceptedCount` for required stages, preserving the existing server criteria shape and runtime config derivation.

**Tech Stack:** TypeScript, Vitest, pnpm workspace, existing runtime profile report and gate contracts.

---

### Task 1: Agent-Cycle Accepted Trace Context Coverage

**Files:**
- Modify: `packages/observability/src/runtimeProfileRunGate.test.ts`
- Modify: `packages/observability/src/runtimeProfileRunGate.ts`

- [ ] **Step 1: Write failing tests**

Add two tests to `runtimeProfileRunGate.test.ts`:

```ts
test('requires complete world decision context for every accepted agent-cycle LLM trace', () => {
  const result = evaluateRuntimeProfileRunReport(
    createRuntimeProfileRunReport({
      ...createReport(),
      agentCycleDiagnostics: {
        ...createAgentCycleDiagnostics(5),
        llmStageDiagnostics: [
          {
            stageName: 'contextualPrioritization',
            traceCount: 2,
            llmAcceptedCount: 2,
            deterministicFallbackCount: 0,
            deterministicCount: 0,
            missingCycleCount: 0,
            shortTermMemoryContextCount: 2,
            longTermProfileContextCount: 2,
            worldDecisionContextCount: 2,
            completeWorldDecisionContextCount: 1,
            rulesContextCount: 2,
            completeRulesContextCount: 2,
          },
        ],
      },
    }),
    {
      ...createCriteria(),
      requiredAgentCycleLlmWorldContextStages: ['contextualPrioritization'],
    },
  );

  expect(result.status).toBe('fail');
  expect(result.failures).toContainEqual({
    code: 'agent-cycle-llm-stage-complete-world-context-count-too-low',
    message:
      'agent-cycle LLM stage contextualPrioritization completeWorldDecisionContextCount must be at least 2',
    evidence: {
      stageName: 'contextualPrioritization',
      actual: 1,
      worldDecisionContextCount: 2,
      llmAcceptedCount: 2,
      minimum: 2,
    },
  });
});

test('requires complete rules context for every accepted agent-cycle LLM trace', () => {
  const result = evaluateRuntimeProfileRunReport(
    createRuntimeProfileRunReport({
      ...createReport(),
      agentCycleDiagnostics: {
        ...createAgentCycleDiagnostics(5),
        llmStageDiagnostics: [
          {
            stageName: 'globalSynthesis',
            traceCount: 2,
            llmAcceptedCount: 2,
            deterministicFallbackCount: 0,
            deterministicCount: 0,
            missingCycleCount: 0,
            shortTermMemoryContextCount: 2,
            longTermProfileContextCount: 2,
            worldDecisionContextCount: 2,
            completeWorldDecisionContextCount: 2,
            rulesContextCount: 2,
            completeRulesContextCount: 1,
          },
        ],
      },
    }),
    {
      ...createCriteria(),
      requiredAgentCycleLlmRulesContextStages: ['globalSynthesis'],
    },
  );

  expect(result.status).toBe('fail');
  expect(result.failures).toContainEqual({
    code: 'agent-cycle-llm-stage-complete-rules-context-count-too-low',
    message:
      'agent-cycle LLM stage globalSynthesis completeRulesContextCount must be at least 2',
    evidence: {
      stageName: 'globalSynthesis',
      actual: 1,
      rulesContextCount: 2,
      llmAcceptedCount: 2,
      minimum: 2,
    },
  });
});
```

- [ ] **Step 2: Run RED**

Run:

```bash
pnpm test -- packages/observability/src/runtimeProfileRunGate.test.ts
```

Expected: both new tests fail because the gate currently only requires count `>= 1`.

- [ ] **Step 3: Implement minimal gate change**

In `addRequiredAgentCycleLlmWorldContextStageFailures`, compute:

```ts
const minimum = stage?.llmAcceptedCount ?? 1;
```

Fail when `completeWorldDecisionContextCount < Math.max(1, minimum)`.

In `addRequiredAgentCycleLlmRulesContextStageFailures`, apply the same rule using `completeRulesContextCount`.

- [ ] **Step 4: Run GREEN**

Run:

```bash
pnpm test -- packages/observability/src/runtimeProfileRunGate.test.ts
```

Expected: all runtime profile gate tests pass.

### Task 2: Cognition Accepted Trace Context Coverage

**Files:**
- Modify: `packages/observability/src/runtimeProfileRunGate.test.ts`
- Modify: `packages/observability/src/runtimeProfileRunGate.ts`

- [ ] **Step 1: Write failing tests**

Add two cognition tests with `llmAcceptedCount: 2` and only one complete context count:

```ts
test('requires complete world decision context for every accepted cognition LLM trace', () => {
  const result = evaluateRuntimeProfileRunReport(
    createRuntimeProfileRunReport({
      ...createReport(),
      cognitionLlmStageDiagnostics: [
        {
          stageName: 'reflectionSynthesis',
          traceCount: 2,
          llmAcceptedCount: 2,
          deterministicFallbackCount: 0,
          deterministicCount: 0,
          missingProviderTraceCount: 0,
          worldDecisionContextCount: 2,
          completeWorldDecisionContextCount: 1,
          rulesContextCount: 2,
          completeRulesContextCount: 2,
        },
      ],
    }),
    {
      ...createCriteria(),
      requiredCognitionLlmWorldContextStages: ['reflectionSynthesis'],
    },
  );

  expect(result.status).toBe('fail');
  expect(result.failures).toContainEqual({
    code: 'cognition-llm-stage-complete-world-context-count-too-low',
    message:
      'cognition LLM stage reflectionSynthesis completeWorldDecisionContextCount must be at least 2',
    evidence: {
      stageName: 'reflectionSynthesis',
      actual: 1,
      worldDecisionContextCount: 2,
      llmAcceptedCount: 2,
      minimum: 2,
    },
  });
});

test('requires complete rules context for every accepted cognition LLM trace', () => {
  const result = evaluateRuntimeProfileRunReport(
    createRuntimeProfileRunReport({
      ...createReport(),
      cognitionLlmStageDiagnostics: [
        {
          stageName: 'dailyPlanning',
          traceCount: 2,
          llmAcceptedCount: 2,
          deterministicFallbackCount: 0,
          deterministicCount: 0,
          missingProviderTraceCount: 0,
          worldDecisionContextCount: 2,
          completeWorldDecisionContextCount: 2,
          rulesContextCount: 2,
          completeRulesContextCount: 1,
        },
      ],
    }),
    {
      ...createCriteria(),
      requiredCognitionLlmRulesContextStages: ['dailyPlanning'],
    },
  );

  expect(result.status).toBe('fail');
  expect(result.failures).toContainEqual({
    code: 'cognition-llm-stage-complete-rules-context-count-too-low',
    message:
      'cognition LLM stage dailyPlanning completeRulesContextCount must be at least 2',
    evidence: {
      stageName: 'dailyPlanning',
      actual: 1,
      rulesContextCount: 2,
      llmAcceptedCount: 2,
      minimum: 2,
    },
  });
});
```

- [ ] **Step 2: Run RED**

Run:

```bash
pnpm test -- packages/observability/src/runtimeProfileRunGate.test.ts
```

Expected: cognition tests fail for the same `>= 1` reason.

- [ ] **Step 3: Implement minimal cognition gate change**

In `addRequiredCognitionLlmWorldContextStageFailures` and `addRequiredCognitionLlmRulesContextStageFailures`, compute the minimum from `llmAcceptedCount` and include `llmAcceptedCount` in failure evidence.

- [ ] **Step 4: Run GREEN**

Run:

```bash
pnpm test -- packages/observability/src/runtimeProfileRunGate.test.ts
```

Expected: all runtime profile gate tests pass.

### Task 3: Verification And Commit

**Files:**
- Modify: `docs/superpowers/plans/2026-06-26-runtime-profile-accepted-context-completeness-gate-slice.md`

- [ ] **Step 1: Run full verification**

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test
git diff --check
```

- [ ] **Step 2: Commit**

Stage only the plan and observability files:

```bash
git add docs/superpowers/plans/2026-06-26-runtime-profile-accepted-context-completeness-gate-slice.md packages/observability/src/runtimeProfileRunGate.ts packages/observability/src/runtimeProfileRunGate.test.ts
git commit -m "test(profile): 收紧 LLM 上下文完整性门禁"
```
