# Runtime Config Economic Context Preseed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure profile gate suite runs launched from an LLM runtime config automatically include a latest market price index, so every configured LLM stage can receive complete economic context by default.

**Architecture:** Keep market price index generation owned by `LocalRuntimeTownProfileRunner`; the gate suite should only decide when a runtime config implies LLM economic-context requirements and pass `preseedMarketPriceIndex: true`. This preserves the existing explicit `preseedMarketPriceIndex` runner escape hatch while making the higher-level suite path safe for paper-alignment validation.

**Tech Stack:** TypeScript, Vitest, pnpm workspace, `@aivilization/server` profile gate suite, `@aivilization/worker` market price index preseed.

---

### Task 1: Gate Suite Runner Input Wiring

**Files:**

- Modify: `apps/server/src/localRuntimeTownProfileGateSuite.test.ts`
- Modify: `apps/server/src/localRuntimeTownProfileGateSuite.ts`

- [x] **Step 1: Write the failing runner-input test**

Add a focused test near the existing runtime config tests in `localRuntimeTownProfileGateSuite.test.ts`:

```ts
test('preseeds market price index for LLM runtime configs', async () => {
  const rootDir = createRootDir();
  const configPath = join(rootDir, 'llm-profile-runtime-config.json');
  writeFileSync(
    configPath,
    JSON.stringify({
      subtaskPrioritization: createLlmStageNode({
        kind: 'traceable-llm-subtask-prioritizer',
        model: 'priority-model',
        providerId: 'priority-provider',
      }),
    }),
  );
  const inputs: LocalRuntimeTownProfileRunnerInput[] = [];

  await runLocalRuntimeTownProfileGateSuite({
    rootDir,
    runtimeConfigPath: configPath,
    requestedAt: 100,
    cycleCount: 1,
    profileIds: ['smoke-25'],
    runProfile: (input) => {
      inputs.push(input);
      return Promise.resolve(createPassingSummary(input));
    },
  });

  expect(inputs[0]?.preseedMarketPriceIndex).toBe(true);
});
```

- [x] **Step 2: Run RED**

Run:

```bash
pnpm vitest run apps/server/src/localRuntimeTownProfileGateSuite.test.ts -t "preseeds market price index"
```

Expected: FAIL because `createProfileRunnerInput` currently forwards each LLM runtime config node but does not set `preseedMarketPriceIndex`.

- [x] **Step 3: Implement runtime config preseed wiring**

In `localRuntimeTownProfileGateSuite.ts`, add a local helper near `createProfileRunnerInput`:

```ts
function hasRuntimeConfigLlmStages(
  runtimeConfig: LocalRuntimeTownProfileRuntimeConfig | undefined,
): boolean {
  return (
    runtimeConfig?.strategicPlanning !== undefined ||
    runtimeConfig?.dailyPlanning !== undefined ||
    runtimeConfig?.reactionPlanning !== undefined ||
    runtimeConfig?.subtaskPrioritization !== undefined ||
    runtimeConfig?.actionSequenceGeneration !== undefined ||
    runtimeConfig?.socialDialogue !== undefined ||
    runtimeConfig?.globalSynthesis !== undefined ||
    runtimeConfig?.reactiveCorrection !== undefined ||
    runtimeConfig?.replanningDecision !== undefined ||
    runtimeConfig?.reflectionSynthesis !== undefined ||
    runtimeConfig?.socialModelSynthesis !== undefined
  );
}
```

Then include this field in `createProfileRunnerInput`:

```ts
...(hasRuntimeConfigLlmStages(input.runtimeConfig) ? { preseedMarketPriceIndex: true } : {}),
```

Do not set it for a runtime config containing only `replanningPolicy`; that policy is deterministic and does not require LLM economic-context prompts.

- [x] **Step 4: Run GREEN**

Run:

```bash
pnpm vitest run apps/server/src/localRuntimeTownProfileGateSuite.test.ts -t "preseeds market price index"
```

Expected: PASS.

### Task 2: Regression Coverage and Verification

**Files:**

- Modify: `docs/superpowers/plans/2026-06-26-runtime-config-economic-context-preseed.md`

- [x] **Step 1: Run focused suite checks**

Run:

```bash
pnpm vitest run apps/server/src/localRuntimeTownProfileGateSuite.test.ts apps/server/src/localRuntimeTownProfileRunner.test.ts
```

Expected: PASS.

- [x] **Step 2: Run workspace checks**

Run:

```bash
pnpm typecheck
pnpm lint
git diff --check
```

Expected: all PASS.

- [x] **Step 3: Commit**

Run:

```bash
git add \
  docs/superpowers/plans/2026-06-26-runtime-config-economic-context-preseed.md \
  apps/server/src/localRuntimeTownProfileGateSuite.ts \
  apps/server/src/localRuntimeTownProfileGateSuite.test.ts

git commit
```

Commit message:

```text
feat(server): 为 LLM profile suite 自动预置市场价格索引

- 为 runtimeConfigPath 驱动的 LLM profile suite 自动打开 preseedMarketPriceIndex，避免完整经济上下文依赖调用方额外记忆开关
- 将判定边界收敛在 gate suite 输入转换层，仅在存在 LLM stage 配置时预置价格索引，保持 replanningPolicy 等确定性配置不受影响
- 复用 LocalRuntimeTownProfileRunner 既有市场价格索引预置能力，不改动经济引擎和 worker 投影语义
- 用户可见变化是完整 LLM runtime config 的 profile gate 更稳定地满足 paper-alignment 的 economic context 要求
- 验证包含 profile gate suite、profile runner 测试，以及 typecheck、lint、git diff --check
```

---

### Self-Review

Spec coverage:

- Covers the current production-path gap between runtimeConfig LLM stages and complete economic-context gate requirements.
- Does not change LLM prompts, world decision context shape, or price calculation semantics.
- Leaves direct runner callers able to pass `preseedMarketPriceIndex: false | true` explicitly.

Placeholder scan:

- No TBD/TODO/fill-in placeholders.

Type consistency:

- Existing runner field remains `preseedMarketPriceIndex`.
- Helper input type uses existing `LocalRuntimeTownProfileRuntimeConfig`.
