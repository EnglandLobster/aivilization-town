# Full Scripted 12 Of 12 Paper Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the real full scripted LLM profile gate suite prove all 12 paper-alignment capabilities, including canonical local repair.

**Architecture:** Use the existing canonical repair path instead of synthetic counters. Expose the already-supported action synthesis policy as runtime configuration so the suite can evaluate two branch candidates in one cycle: a social branch for dialogue/reactive correction and an eat branch that intentionally reaches the world simulator without inventory, allowing canonical local repair to buy the missing Apple from market context.

**Tech Stack:** TypeScript, Vitest, `@aivilization/agent-runtime`, `@aivilization/worker`, `@aivilization/server`, scripted `@aivilization/llm` providers.

---

### Task 1: Real 12/12 Suite RED Test

**Files:**

- Modify: `apps/server/src/localRuntimeTownProfileGateSuite.test.ts`

- [x] **Step 1: Write the failing end-to-end test**

Add a test beside the existing full scripted suite test:

```ts
test('passes all paper-alignment capabilities from the full scripted LLM runtime config through real suite execution', async () => {
  const rootDir = createRootDir();
  const reportRootDir = createRootDir();
  const configPath = fileURLToPath(
    new URL('../examples/full-scripted-llm-runtime-config.json', import.meta.url),
  );

  const result = await runLocalRuntimeTownProfileGateSuite({
    rootDir,
    reportRootDir,
    runtimeConfigPath: configPath,
    requestedAt: 275,
    reportGeneratedAt: 325,
    cycleCount: 1,
    profileIds: ['smoke-25'],
    minimumLocalRepairAcceptedCount: 1,
  });

  expect(result.profiles[0]?.gate.failures).toEqual([]);
  expect(result.status).toBe('pass');
  expect(result.bundleManifest?.paperAlignment).toMatchObject({
    schemaVersion: 1,
    capabilityCount: 12,
    configuredCapabilityCount: 12,
    passedConfiguredCapabilityCount: 12,
    failedConfiguredCapabilityCount: 0,
    unconfiguredCapabilityCount: 0,
  });
  expect(
    result.profiles[0]?.summary.agentCycleDiagnostics.localRepairAcceptedCount,
  ).toBeGreaterThan(0);
});
```

- [x] **Step 2: Run RED**

Run:

```bash
pnpm vitest run apps/server/src/localRuntimeTownProfileGateSuite.test.ts -t "all paper-alignment capabilities"
```

Expected: FAIL because the current full scripted fixture configures only one social subtask and produces no accepted local repair.
Observed: FAIL with `local-repair-accepted-count-too-low` and `localRepairAcceptedCount: 0`.

### Task 2: Runtime Action Synthesis Config

**Files:**

- Modify: `apps/worker/src/actionSynthesisPolicy.ts`
- Modify: `apps/worker/src/actionSynthesisPolicy.test.ts`
- Modify: `apps/server/src/localRuntimeTownProfileRuntimeConfig.ts`
- Modify: `apps/server/src/localRuntimeTownProfileRuntimeConfig.test.ts`
- Modify: `apps/server/src/localRuntimeTownProfileGateSuite.ts`
- Modify: `apps/server/src/localRuntimeTownProfileGateSuite.test.ts`
- Modify: `apps/server/src/localRuntimeTownProfileRunner.ts`

- [x] **Step 1: Write failing worker policy test**

Add:

```ts
test('propagates configured candidate subtask window into action synthesis policy', () => {
  const policy = deriveActionSynthesisPolicyFromWorldState({
    agent: createAgent(),
    config: {
      maxActions: 2,
      candidateSubtasks: { maxSubtasks: 2 },
    },
  });

  expect(policy).toMatchObject({
    maxActions: 2,
    candidateSubtasks: { maxSubtasks: 2 },
  });
});
```

Expected: FAIL because `WorldStateActionSynthesisPolicyConfig` does not expose `candidateSubtasks`.
Observed: FAIL because `candidateSubtasks` was not returned by the derived action synthesis policy.

- [x] **Step 2: Write failing runtime config parser/forwarding tests**

In `localRuntimeTownProfileRuntimeConfig.test.ts`, add:

```ts
expect(config.actionSynthesis).toEqual({
  maxActions: 2,
  candidateSubtasks: { maxSubtasks: 2 },
});
```

In `localRuntimeTownProfileGateSuite.test.ts`, extend the runtime context forwarding test with:

```ts
actionSynthesis: {
  maxActions: 2,
  candidateSubtasks: { maxSubtasks: 2 },
},
```

and assert:

```ts
expect(inputs[0]?.actionSynthesis).toEqual({
  maxActions: 2,
  candidateSubtasks: { maxSubtasks: 2 },
});
```

Expected: FAIL because runtime config does not parse or forward `actionSynthesis`.
Observed: FAIL because `config.actionSynthesis` and forwarded runner input were `undefined`.

- [x] **Step 3: Implement action synthesis config plumbing**

Add to `WorldStateActionSynthesisPolicyConfig`:

```ts
readonly candidateSubtasks?: {
  readonly maxSubtasks?: number;
};
```

Validate `candidateSubtasks.maxSubtasks` as a positive integer, return it from `deriveActionSynthesisPolicyFromWorldState`, add `actionSynthesis?: WorldStateActionSynthesisPolicyConfig | false` to `LocalRuntimeTownProfileRuntimeConfig` and `LocalRuntimeTownProfileRunnerInput`, parse `false` or an object, and forward it through `createProfileRunnerInput` into `createLocalRuntimeTownProfileAgentProvider` and `createCanonicalWorkerRuntimeResolver`.

- [x] **Step 4: Run policy/config tests to verify GREEN**

Run:

```bash
pnpm vitest run apps/worker/src/actionSynthesisPolicy.test.ts apps/server/src/localRuntimeTownProfileRuntimeConfig.test.ts apps/server/src/localRuntimeTownProfileGateSuite.test.ts
```

Expected: PASS.
Observed: PASS.

### Task 3: Full Scripted Fixture Repair Drill

**Files:**

- Modify: `apps/server/examples/full-scripted-llm-runtime-config.json`

- [x] **Step 1: Add two-branch scripted plan**

Update `llmPlanning.provider.responses[0].content` to include both branches:

```json
{
  "objective": "Scripted full LLM social and repair objective",
  "branches": [
    {
      "id": "social",
      "objective": "Coordinate social interaction through LLM planning.",
      "subtasks": [
        {
          "id": "socialize",
          "description": "Socialize with a nearby neighbor about town plans.",
          "basePriority": 20,
          "signalKeys": ["social"],
          "intentionAffinityTags": ["social"],
          "memoryAffinityTags": ["social"],
          "profileAffinityTags": ["social"]
        }
      ]
    },
    {
      "id": "eat",
      "objective": "Exercise canonical local repair using market-backed missing inventory.",
      "subtasks": [
        {
          "id": "eat-repair-drill",
          "description": "Eat an Apple through simulator-backed local repair.",
          "basePriority": 19,
          "signalKeys": ["eat"],
          "intentionAffinityTags": ["eat"],
          "memoryAffinityTags": ["eat"],
          "profileAffinityTags": ["eat"]
        }
      ]
    }
  ]
}
```

- [x] **Step 2: Rank both subtasks and synthesize both actions**

Update `subtaskPrioritization` to rank both `social/socialize` and `eat/eat-repair-drill`. Update `actionSequenceGeneration.contentTemplate` to create ids using `{{user.selectedSubtask.subtaskId}}` and omit inventory costs so simulator, not action synthesis, detects missing inventory. Update `globalSynthesis.contentTemplate` to rank `candidateActions.0` and `candidateActions.1`.

- [x] **Step 3: Configure two candidate subtasks**

Add:

```json
"actionSynthesis": {
  "maxActions": 2,
  "candidateSubtasks": {
    "maxSubtasks": 2
  }
}
```

Update `steeringSimulator.actionIdPrefix` to the new social action id prefix.

- [x] **Step 4: Run RED suite test to verify GREEN**

Run:

```bash
pnpm vitest run apps/server/src/localRuntimeTownProfileGateSuite.test.ts -t "all paper-alignment capabilities"
```

Expected: PASS with `configuredCapabilityCount: 12` and `localRepairAcceptedCount > 0`.
Observed: PASS.

### Task 4: Final Verification And Commit

**Files:**

- All files modified above.

- [x] **Step 1: Run focused checks**

Run:

```bash
pnpm vitest run \
  apps/worker/src/actionSynthesisPolicy.test.ts \
  apps/server/src/localRuntimeTownProfileRuntimeConfig.test.ts \
  apps/server/src/localRuntimeTownProfileGateSuite.test.ts \
  apps/server/src/localRuntimeTownProfileRunner.test.ts
```

Expected: PASS.
Observed: PASS.

- [x] **Step 2: Run workspace checks**

Run:

```bash
pnpm typecheck
pnpm lint
pnpm prettier --check apps/worker/src/actionSynthesisPolicy.ts apps/worker/src/actionSynthesisPolicy.test.ts apps/server/src/localRuntimeTownProfileRuntimeConfig.ts apps/server/src/localRuntimeTownProfileRuntimeConfig.test.ts apps/server/src/localRuntimeTownProfileGateSuite.ts apps/server/src/localRuntimeTownProfileGateSuite.test.ts apps/server/src/localRuntimeTownProfileRunner.ts apps/server/examples/full-scripted-llm-runtime-config.json docs/superpowers/plans/2026-06-26-full-scripted-12-of-12-paper-suite.md
git diff --check
```

Expected: all PASS.
Observed: all PASS.

- [x] **Step 3: Commit**

Commit message:

```text
feat(server): 让 full scripted LLM suite 覆盖全部论文能力

- 将 action synthesis 的候选子任务窗口暴露到 runtime config，使标准 suite 能在一轮中保留跨分支候选动作
- 更新 full scripted LLM fixture，同时执行社交对话/响应修复链路和 eat 缺库存 local repair drill
- 保持 local repair 证据来自 canonical world dry-run 与 repair policy，不使用 mocked summary 或手工计数替代
- 用户可见变化是 paper-alignment bundle 可在真实 suite 入口证明 12/12 configured capabilities
- 验证包含 action synthesis policy、runtime config、gate suite、profile runner 测试，以及 typecheck、lint、prettier、git diff --check
```

Observed: committed with this implementation phase.

---

### Self-Review

Spec coverage:

- Covers the previously unconfigured `local-repair` paper capability in the real full scripted suite.
- Preserves LLM stage evidence from the previous 11/12 suite.
- Adds a general action synthesis configuration seam useful for future game-backend orchestration, not a test-only branch.

Placeholder scan:

- No TBD/TODO/fill-in placeholders.

Type consistency:

- `actionSynthesis` uses existing `WorldStateActionSynthesisPolicyConfig`.
- `candidateSubtasks.maxSubtasks` maps directly to `ActionSynthesisPolicy.candidateSubtasks.maxSubtasks`.
- Suite forwarding targets existing runner/provider/resolver architecture with a new typed field.
