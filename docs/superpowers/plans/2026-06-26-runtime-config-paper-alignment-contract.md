# Runtime Config Paper Alignment Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make local repair paper-alignment requirements part of runtime config instead of relying only on suite call-site parameters.

**Architecture:** Add a server-owned `paperAlignment` runtime config section that declares validation requirements, starting with `minimumLocalRepairAcceptedCount`. Gate suite execution merges this config requirement with explicit suite input by taking the stricter maximum, so deployable full-paper profiles cannot silently weaken local repair coverage while CLI/test callers can still demand more. Keep planner semantics unchanged.

**Tech Stack:** TypeScript, Vitest, `@aivilization/server`, `@aivilization/observability`, JSON runtime config fixtures.

---

### Task 1: RED Tests For Config-Owned Local Repair Requirement

**Files:**

- Modify: `apps/server/src/localRuntimeTownProfileRuntimeConfig.test.ts`
- Modify: `apps/server/src/localRuntimeTownProfileGateSuite.test.ts`
- Modify: `apps/server/examples/full-llm-runtime-config.json`
- Modify: `apps/server/examples/full-scripted-llm-runtime-config.json`

- [x] **Step 1: Update full runtime config fixture expectations**

In `localRuntimeTownProfileRuntimeConfig.test.ts`, update the checked-in full LLM fixture test so `Object.keys(config).sort()` includes `actionSynthesis` and `paperAlignment`, then assert:

```ts
expect(config.actionSynthesis).toEqual({
  maxActions: 2,
  candidateSubtasks: {
    maxSubtasks: 2,
  },
});
expect(config.paperAlignment).toEqual({
  minimumLocalRepairAcceptedCount: 1,
});
expect(criteria.minimumLocalRepairAcceptedCount).toBe(1);
```

Update `apps/server/examples/full-llm-runtime-config.json` with:

```json
"actionSynthesis": {
  "maxActions": 2,
  "candidateSubtasks": {
    "maxSubtasks": 2
  }
},
"paperAlignment": {
  "minimumLocalRepairAcceptedCount": 1
}
```

- [x] **Step 2: Update parser hook test**

In the existing runtime-context hook parser test, add:

```json
"paperAlignment": {
  "minimumLocalRepairAcceptedCount": 2
}
```

and assert:

```ts
expect(config.paperAlignment).toEqual({
  minimumLocalRepairAcceptedCount: 2,
});
```

- [x] **Step 3: Make full scripted suite require 12/12 from config alone**

Add to `apps/server/examples/full-scripted-llm-runtime-config.json`:

```json
"paperAlignment": {
  "minimumLocalRepairAcceptedCount": 1
}
```

Update the existing suite test that does not pass `minimumLocalRepairAcceptedCount` so it expects:

```ts
expect(result.bundleManifest?.paperAlignment).toMatchObject({
  schemaVersion: 1,
  capabilityCount: 12,
  configuredCapabilityCount: 12,
  passedConfiguredCapabilityCount: 12,
  failedConfiguredCapabilityCount: 0,
  unconfiguredCapabilityCount: 0,
});
expect(result.profiles[0]?.summary.agentCycleDiagnostics.localRepairAcceptedCount).toBeGreaterThan(
  0,
);
```

- [x] **Step 4: Run RED tests**

Run:

```bash
pnpm vitest run apps/server/src/localRuntimeTownProfileRuntimeConfig.test.ts apps/server/src/localRuntimeTownProfileGateSuite.test.ts -t "full LLM runtime config|runtime context hooks|paper-alignment coverage"
```

Expected: FAIL because runtime config currently ignores `paperAlignment`, so criteria do not derive `minimumLocalRepairAcceptedCount` from config.
Observed: FAIL because `config.paperAlignment` was `undefined` and full scripted suite still reported `configuredCapabilityCount: 11`.

### Task 2: Runtime Config Parser And Gate Merge

**Files:**

- Modify: `apps/server/src/localRuntimeTownProfileRuntimeConfig.ts`
- Modify: `apps/server/src/localRuntimeTownProfileGateSuite.ts`

- [x] **Step 1: Add runtime config type and parser**

Add:

```ts
export type LocalRuntimeTownProfilePaperAlignmentConfig = {
  readonly minimumLocalRepairAcceptedCount?: number;
};
```

Add `readonly paperAlignment?: LocalRuntimeTownProfilePaperAlignmentConfig;` to `LocalRuntimeTownProfileRuntimeConfig`, parse `paperAlignment` from root/profile config, validate `minimumLocalRepairAcceptedCount` with `readOptionalNonNegativeInteger`, and include `paperAlignment` in the returned config only when present.

- [x] **Step 2: Merge suite and config local repair requirements**

In `runLocalRuntimeTownProfileGateSuite`, compute the effective minimum before calling `createLocalRuntimeTownProfileGateCriteria`:

```ts
const minimumLocalRepairAcceptedCount = resolveMinimumLocalRepairAcceptedCount({
  suiteMinimum: input.minimumLocalRepairAcceptedCount,
  runtimeConfig,
});
```

Use that value instead of `input.minimumLocalRepairAcceptedCount` when building criteria. Implement:

```ts
function resolveMinimumLocalRepairAcceptedCount(input: {
  readonly suiteMinimum: number | undefined;
  readonly runtimeConfig: LocalRuntimeTownProfileRuntimeConfig | undefined;
}): number | undefined {
  const configMinimum = input.runtimeConfig?.paperAlignment?.minimumLocalRepairAcceptedCount;
  if (input.suiteMinimum === undefined && configMinimum === undefined) {
    return undefined;
  }
  return Math.max(input.suiteMinimum ?? 0, configMinimum ?? 0);
}
```

Observed: implemented the merge in `createLocalRuntimeTownProfileGateCriteria` instead of the suite so direct criteria callers also inherit the runtime config contract.

- [x] **Step 3: Run GREEN tests**

Run:

```bash
pnpm vitest run apps/server/src/localRuntimeTownProfileRuntimeConfig.test.ts apps/server/src/localRuntimeTownProfileGateSuite.test.ts -t "full LLM runtime config|runtime context hooks|paper-alignment coverage"
```

Expected: PASS.
Observed: PASS, with `apps/server/src/localRuntimeTownProfileGate.test.ts` included for the stricter local-repair merge boundary.

### Task 3: Final Verification And Commit

**Files:**

- All files modified above.

- [x] **Step 1: Run focused server checks**

Run:

```bash
pnpm vitest run apps/server/src/localRuntimeTownProfileRuntimeConfig.test.ts apps/server/src/localRuntimeTownProfileGateSuite.test.ts apps/server/src/localRuntimeTownProfileRunner.test.ts
```

Expected: PASS.
Observed: PASS.

- [x] **Step 2: Run workspace checks**

Run:

```bash
pnpm typecheck
pnpm lint
pnpm prettier --check apps/server/src/localRuntimeTownProfileRuntimeConfig.ts apps/server/src/localRuntimeTownProfileRuntimeConfig.test.ts apps/server/src/localRuntimeTownProfileGateSuite.ts apps/server/src/localRuntimeTownProfileGateSuite.test.ts apps/server/examples/full-llm-runtime-config.json apps/server/examples/full-scripted-llm-runtime-config.json docs/superpowers/plans/2026-06-26-runtime-config-paper-alignment-contract.md
git diff --check
```

Expected: all PASS.
Observed: all PASS after formatting `localRuntimeTownProfileRuntimeConfig.ts` and this plan document.

- [x] **Step 3: Commit**

Commit message:

```text
feat(server): 将论文对齐验证要求纳入 runtime config

- 为什么改：full scripted suite 已能通过真实 local repair 证明 12/12，但 local repair 阈值仍依赖调用方手动传参，部署合同不够自描述
- 核心改动：扩展 server runtime config schema/parser、profile gate suite criteria 合并逻辑，并更新 full LLM/full scripted runtime fixtures
- 关键设计：paperAlignment.minimumLocalRepairAcceptedCount 作为验证合同进入 runtime config，suite 入参只能加严不能削弱配置要求
- 用户可见变化：直接使用 full-scripted-llm-runtime-config.json 运行 suite 即可得到 12/12 paper-alignment coverage
- 测试验证：运行 runtime config、gate suite、profile runner focused tests，以及 typecheck、lint、prettier、git diff --check
```

Observed: committed with this implementation phase.

---

### Self-Review

Spec coverage:

- Moves local repair paper-alignment gating from external suite input into runtime config.
- Keeps canonical local repair behavior unchanged.
- Keeps full LLM runtime fixture as an explicit deployable contract for all paper-alignment requirements.

Placeholder scan:

- No TBD/TODO/fill-in placeholders.

Type consistency:

- `paperAlignment.minimumLocalRepairAcceptedCount` maps directly to existing `RuntimeProfileRunGateCriteria.minimumLocalRepairAcceptedCount`.
- `actionSynthesis` keeps using the existing `WorldStateActionSynthesisPolicyConfig`.
