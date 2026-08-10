# Runner CLI Economic Context Preseed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the single-profile runner CLI automatically preseed a market price index when an LLM runtime config is supplied, matching the profile gate suite behavior and preserving complete economic-context gates.

**Architecture:** Keep market price index generation in `LocalRuntimeTownProfileRunner`. Add the same LLM-stage detection boundary to `localRuntimeTownProfileRunnerCli.ts` when converting parsed CLI config into `LocalRuntimeTownProfileRunnerInput`; pure deterministic runtime config such as `replanningPolicy` must remain unchanged.

**Tech Stack:** TypeScript, Vitest, pnpm workspace, `@aivilization/server` runner CLI, `@aivilization/worker` market price index preseed.

---

### Task 1: Runner CLI Runtime Config Wiring

**Files:**

- Modify: `apps/server/src/localRuntimeTownProfileRunnerCli.test.ts`
- Modify: `apps/server/src/localRuntimeTownProfileRunnerCli.ts`

- [x] **Step 1: Write the failing LLM runtime config test**

Add this assertion to the existing `loads LLM planning config files and passes resolved provider config to the runner` test after the `receivedInput?.llmPlanning` assertion:

```ts
expect(receivedInput?.preseedMarketPriceIndex).toBe(true);
```

This test uses a runtime config containing `llmPlanning`, so the CLI should prepare the runner for complete LLM economic context.

- [x] **Step 2: Run RED**

Run:

```bash
pnpm vitest run apps/server/src/localRuntimeTownProfileRunnerCli.test.ts -t "loads LLM planning config"
```

Expected: FAIL because `preseedMarketPriceIndex` is currently `undefined`.

- [x] **Step 3: Write the deterministic policy boundary test**

Add a focused test to `localRuntimeTownProfileRunnerCli.test.ts`:

```ts
test('does not preseed market price index for deterministic runtime policy configs', async () => {
  let receivedInput: LocalRuntimeTownProfileRunnerInput | undefined;
  const configRoot = createRootDir();
  const configPath = join(configRoot, 'profile-runtime-config.json');
  writeFileSync(
    configPath,
    JSON.stringify({
      replanningPolicy: {
        consecutiveFailureThreshold: 2,
      },
    }),
  );

  const exitCode = await runLocalRuntimeTownProfileRunnerCli({
    argv: [
      '--profile',
      'smoke-25',
      '--root-dir',
      '/tmp/town',
      '--cycles',
      '1',
      '--requested-at',
      '100',
      '--runtime-config',
      configPath,
    ],
    stdout: { write: () => undefined },
    runProfile: (input) => {
      receivedInput = input;
      return Promise.resolve(createPassingCliSummary(input));
    },
  });

  expect(exitCode).toBe(0);
  expect(receivedInput?.replanningPolicy).toEqual({
    consecutiveFailureThreshold: 2,
  });
  expect(receivedInput?.preseedMarketPriceIndex).toBeUndefined();
});
```

If there is no shared helper for the summary yet, extract one from the existing injected-runner tests instead of duplicating a large object.

- [x] **Step 4: Implement runner CLI preseed wiring**

In `localRuntimeTownProfileRunnerCli.ts`, add a helper near `createRunnerContext`:

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

Then add this field to `runnerInput`:

```ts
...(hasRuntimeConfigLlmStages(runtimeConfig) ? { preseedMarketPriceIndex: true } : {}),
```

- [x] **Step 5: Run GREEN**

Run:

```bash
pnpm vitest run apps/server/src/localRuntimeTownProfileRunnerCli.test.ts -t "LLM planning config|deterministic runtime policy"
```

Expected: PASS.

### Task 2: Verification and Commit

**Files:**

- Modify: `docs/superpowers/plans/2026-06-26-runner-cli-economic-context-preseed.md`

- [x] **Step 1: Run focused checks**

Run:

```bash
pnpm vitest run apps/server/src/localRuntimeTownProfileRunnerCli.test.ts apps/server/src/localRuntimeTownProfileGateSuite.test.ts
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
  docs/superpowers/plans/2026-06-26-runner-cli-economic-context-preseed.md \
  apps/server/src/localRuntimeTownProfileRunnerCli.ts \
  apps/server/src/localRuntimeTownProfileRunnerCli.test.ts

git commit
```

Commit message:

```text
feat(server): 为 LLM profile runner CLI 自动预置市场价格索引

- 将单 profile runner CLI 的 runtimeConfig 转换路径与 gate suite 对齐，LLM stage 配置会自动传入 preseedMarketPriceIndex
- 保持 deterministic replanningPolicy 配置不触发市场价格索引预置，避免扩大运行语义
- 复用 LocalRuntimeTownProfileRunner 既有价格索引预置能力，让 --runtime-config --require-gate 更稳定满足 complete economic context gate
- 用户可见变化是单 profile CLI 运行 full LLM runtime config 时不再依赖额外手工开关来获得完整经济上下文
- 验证包含 runner CLI、gate suite 测试，以及 typecheck、lint、git diff --check
```

---

### Self-Review

Spec coverage:

- Closes the CLI entrypoint mismatch left after the suite preseed slice.
- Keeps price-index generation and LLM prompt semantics unchanged.
- Protects deterministic runtime configs from accidental behavior changes.

Placeholder scan:

- No TBD/TODO/fill-in placeholders.

Type consistency:

- Existing runner input field remains `preseedMarketPriceIndex`.
- Helper input type uses existing `LocalRuntimeTownProfileRuntimeConfig`.
