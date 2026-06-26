# Full Scripted LLM Suite Entrypoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the standard profile gate-suite entrypoint run the full scripted LLM runtime config end-to-end and emit passing paper-alignment bundle coverage without mocked `runProfile` fixtures.

**Architecture:** Keep live provider calls out of tests by reusing `apps/server/examples/full-scripted-llm-runtime-config.json`. Extend only durable runtime configuration seams that represent real backend configuration, such as canonical domain runtime settings and memory consolidation scheduling; do not special-case the test in the suite.

**Tech Stack:** TypeScript, Vitest, pnpm workspace, `@aivilization/server` profile gate suite, `@aivilization/worker` canonical runtime config, scripted `@aivilization/llm` provider.

---

### Task 1: Real Suite RED Test

**Files:**

- Modify: `apps/server/src/localRuntimeTownProfileGateSuite.test.ts`

- [x] **Step 1: Write the failing end-to-end suite test**

Add a test near `writes paper-alignment coverage for full LLM runtime config into bundle manifests`:

```ts
test('passes paper-alignment coverage from the full scripted LLM runtime config through real suite execution', async () => {
  const rootDir = createRootDir();
  const reportRootDir = createRootDir();
  const configPath = fileURLToPath(
    new URL('../examples/full-scripted-llm-runtime-config.json', import.meta.url),
  );

  const result = await runLocalRuntimeTownProfileGateSuite({
    rootDir,
    reportRootDir,
    runtimeConfigPath: configPath,
    requestedAt: 175,
    reportGeneratedAt: 225,
    cycleCount: 1,
    profileIds: ['smoke-25'],
  });

  expect(result.status).toBe('pass');
  expect(result.profiles[0]?.gate.failures).toEqual([]);
  expect(result.bundleManifest?.paperAlignment).toMatchObject({
    schemaVersion: 1,
    capabilityCount: 12,
    configuredCapabilityCount: 11,
    passedConfiguredCapabilityCount: 11,
    failedConfiguredCapabilityCount: 0,
  });
});
```

The expected configured count is 11 because `local-repair` is not part of the scripted LLM runtime config threshold unless the suite is also given `minimumLocalRepairAcceptedCount`.

- [x] **Step 2: Run RED**

Run:

```bash
pnpm vitest run apps/server/src/localRuntimeTownProfileGateSuite.test.ts -t "full scripted LLM runtime config through real suite execution"
```

Observed: FAIL. The standard suite did not inject the social domain target, memory consolidation schedule, or scripted simulator rejection drill that the direct runner test had been passing by hand. Do not replace the real suite call with a mocked `runProfile`.

### Task 2: Runtime Config Backend Seams

**Files:**

- Modify: `apps/server/src/localRuntimeTownProfileRuntimeConfig.ts`
- Modify: `apps/server/src/localRuntimeTownProfileRuntimeConfig.test.ts`
- Modify: `apps/server/src/localRuntimeTownProfileGateSuite.ts`
- Modify: `apps/server/src/localRuntimeTownProfileGateSuite.test.ts`
- Modify: `apps/server/examples/full-scripted-llm-runtime-config.json`

- [x] **Step 1: Add RED parser coverage for runtime context hooks**

If the suite failure shows that the social action is not executable through standard config, add a parser test proving the runtime config can carry canonical domain config plus the existing lifecycle/simulator hooks needed by the fixture:

```ts
expect(config.domainConfig?.social).toEqual({
  targetAgentId: asAgentId('smoke-25-world-main-agent-008'),
  topic: 'town plans',
});
expect(config.memoryConsolidationSchedule?.agentIds).toEqual([
  asAgentId('smoke-25-world-main-agent-001'),
]);
expect(config.steeringSimulator).toBeDefined();
```

Observed: FAIL until runtime config parsing supports `domainConfig`, `memoryConsolidationSchedule`, and `steeringSimulator`.

- [x] **Step 2: Implement runtime context parsing and suite forwarding**

Add `domainConfig?: CanonicalDomainRuntimeConfig`, `memoryConsolidationSchedule?: LocalSimulationLifecycleMemoryConsolidationSchedule`, and `steeringSimulator?: ReactiveActionSimulator` to `LocalRuntimeTownProfileRuntimeConfig`. Parse all three JSON nodes with the same profile/global selection behavior as LLM nodes, and forward them from `createProfileRunnerInput` into `LocalRuntimeTownProfileRunnerInput`.

Only parse fields already represented by existing runtime types; keep validation explicit and fail fast on malformed strings, unknown command types, or non-finite numeric fields. The simulator config is limited to a deterministic fixture drill: reject actions whose ids match a configured prefix until a configured repaired suffix is present.

- [x] **Step 3: Update scripted fixture**

Add `domainConfig.social`, `memoryConsolidationSchedule`, and `steeringSimulator` blocks to `apps/server/examples/full-scripted-llm-runtime-config.json`:

```json
"domainConfig": {
  "social": {
    "targetAgentId": "smoke-25-world-main-agent-008",
    "topic": "town plans"
  }
}
```

- [x] **Step 4: Re-run RED test and inspect remaining failure**

Run the same end-to-end suite test. Result: PASS after the three missing runtime context hooks are configured through the fixture and forwarded by the suite.

### Task 3: Verification and Commit

**Files:**

- Modify: `docs/superpowers/plans/2026-06-26-full-scripted-llm-suite-entrypoint.md`

- [x] **Step 1: Run focused checks**

Run:

```bash
pnpm vitest run \
  apps/server/src/localRuntimeTownProfileRuntimeConfig.test.ts \
  apps/server/src/localRuntimeTownProfileGateSuite.test.ts \
  apps/server/src/localRuntimeTownProfileRunner.test.ts
```

Observed: `localRuntimeTownProfileRuntimeConfig.test.ts`, `localRuntimeTownProfileGateSuite.test.ts`, and `localRuntimeTownProfileRunner.test.ts` PASS.

- [x] **Step 2: Run workspace checks**

Run:

```bash
pnpm typecheck
pnpm lint
git diff --check
```

Expected: all PASS.

Observed: `pnpm typecheck`, `pnpm lint`, `git diff --check`, and targeted `pnpm prettier --check` PASS.

- [ ] **Step 3: Commit**

Run:

```bash
git add \
  docs/superpowers/plans/2026-06-26-full-scripted-llm-suite-entrypoint.md \
  apps/server/examples/full-scripted-llm-runtime-config.json \
  apps/server/src/localRuntimeTownProfileRuntimeConfig.ts \
  apps/server/src/localRuntimeTownProfileRuntimeConfig.test.ts \
  apps/server/src/localRuntimeTownProfileGateSuite.ts \
  apps/server/src/localRuntimeTownProfileGateSuite.test.ts

git commit
```

Commit message:

```text
feat(server): 打通 full scripted LLM profile suite 入口

- 让 profile gate suite 通过真实 runner 跑 full scripted LLM runtime config，并产出 paper-alignment bundle 证据
- 扩展 runtime config 的后端配置边界，支持将 canonical domain runtime 配置随 runtimeConfigPath 透传到 profile runner
- 将 scripted full LLM fixture 的 social domain 目标内聚到配置文件，减少测试和运行入口对手工参数拼装的依赖
- 用户可见变化是 suite/CLI 路径更接近论文能力验收入口，可直接验证 LLM stages 的状态、经济、规则和记忆上下文覆盖
- 验证包含 runtime config、profile gate suite、profile runner 测试，以及 typecheck、lint、git diff --check
```

---

### Self-Review

Spec coverage:

- Moves full LLM profile validation from mocked summary fixtures toward real backend suite execution.
- Keeps scripted providers deterministic and avoids live network/provider dependency.
- Adds real runtime configuration seams instead of test-only special casing.

Placeholder scan:

- No TBD/TODO/fill-in placeholders.

Type consistency:

- `domainConfig` uses existing `CanonicalDomainRuntimeConfig`.
- `memoryConsolidationSchedule` uses existing `LocalSimulationLifecycleMemoryConsolidationSchedule`.
- `steeringSimulator` resolves to the existing `ReactiveActionSimulator` function boundary.
- Suite forwarding targets existing `LocalRuntimeTownProfileRunnerInput` fields.
