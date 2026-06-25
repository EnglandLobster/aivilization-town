# Replanning Runtime Config Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Load adaptive replanning policy from runtime profile config and expose it through profile runner and gate suite CLIs so recovery evidence can be required in backend profile gates.

**Architecture:** `@aivilization/agent-runtime` continues to own replanning semantics. `apps/server` parses profile runtime config, forwards the policy to existing runner inputs, and lets gate suites combine runtime config with existing full-replan materialization criteria. CLI flags describe configuration and gate thresholds; execution layers do not hard-code recovery behavior.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, runtime profile config loader, server profile runner CLI, server gate suite CLI.

---

### Task 1: Runtime Config Replanning Policy

**Files:**

- Modify: `apps/server/src/localRuntimeTownProfileRuntimeConfig.ts`
- Test: `apps/server/src/localRuntimeTownProfileRuntimeConfig.test.ts`

- [x] **Step 1: Write failing runtime config tests**

Add tests that load:

```typescript
{
  replanningPolicy: {
    consecutiveFailureThreshold: 3,
    failureTags: ['eat', 'inventory'],
  },
  profiles: {
    'default-100': {
      replanningPolicy: {
        consecutiveFailureThreshold: 2,
        majorContextShift: {
          key: 'profile-recovery-drill',
          reason: 'profile recovery drill requires a replacement plan',
        },
      },
    },
    'smoke-25': {
      replanningPolicy: null,
    },
  },
}
```

Assert `default-100` receives the profile-specific policy, `headless-stress-1000` receives the top-level policy, and `smoke-25` receives no `replanningPolicy`.

Also add an invalid document assertion:

```typescript
await expect(
  loadLocalRuntimeTownProfileRuntimeConfig({
    profileId: 'default-100',
    path: '/runtime/config.json',
    readTextFile: () =>
      Promise.resolve(
        JSON.stringify({
          replanningPolicy: {
            consecutiveFailureThreshold: 0,
          },
        }),
      ),
  }),
).rejects.toThrow('replanningPolicy.consecutiveFailureThreshold must be a positive integer');
```

- [x] **Step 2: Run runtime config tests to verify RED**

Run: `pnpm --filter @aivilization/server test -- localRuntimeTownProfileRuntimeConfig.test.ts`

Expected: FAIL because runtime config does not parse `replanningPolicy`.

- [x] **Step 3: Implement replanning policy parsing**

Import `type AdaptiveReplanningPolicy` from `@aivilization/agent-runtime`, add `replanningPolicy?: AdaptiveReplanningPolicy` to `LocalRuntimeTownProfileRuntimeConfig`, include `replanningPolicy` in the profile node union, and add parser helpers:

```typescript
function parseReplanningPolicyNode(input: {
  readonly node: unknown;
}): AdaptiveReplanningPolicy | undefined;
```

Validate `consecutiveFailureThreshold`, optional `failureTags`, and optional `majorContextShift.key/reason`.

- [x] **Step 4: Run runtime config tests to verify GREEN**

Run: `pnpm --filter @aivilization/server test -- localRuntimeTownProfileRuntimeConfig.test.ts`

Expected: PASS.

### Task 2: Single Profile Runner CLI Runtime Config

**Files:**

- Modify: `apps/server/src/localRuntimeTownProfileRunnerCli.ts`
- Test: `apps/server/src/localRuntimeTownProfileRunnerCli.test.ts`

- [x] **Step 1: Write failing runner CLI test**

Add a test that writes a runtime config file:

```typescript
{
  profiles: {
    'default-100': {
      replanningPolicy: {
        consecutiveFailureThreshold: 2,
        majorContextShift: {
          key: 'profile-recovery-drill',
          reason: 'profile recovery drill requires a replacement plan',
        },
      },
    },
  },
}
```

Run the CLI with `--runtime-config <path>` and assert the injected `runProfile` receives:

```typescript
expect(receivedInput?.replanningPolicy).toEqual({
  consecutiveFailureThreshold: 2,
  majorContextShift: {
    key: 'profile-recovery-drill',
    reason: 'profile recovery drill requires a replacement plan',
  },
});
```

Also update the parse test so `--runtime-config /runtime/profile-config.json` returns `runtimeConfigPath`.

- [x] **Step 2: Run runner CLI tests to verify RED**

Run: `pnpm --filter @aivilization/server test -- localRuntimeTownProfileRunnerCli.test.ts`

Expected: FAIL because `--runtime-config` is not parsed and loaded replanning policy is not forwarded.

- [x] **Step 3: Implement runner CLI runtime config forwarding**

Replace the internal config path field with `runtimeConfigPath`, parse `--runtime-config`, keep `--llm-planning-config` as a backward-compatible alias, and pass `runtimeConfig.replanningPolicy` into `createRunnerInput`.

- [x] **Step 4: Run runner CLI tests to verify GREEN**

Run: `pnpm --filter @aivilization/server test -- localRuntimeTownProfileRunnerCli.test.ts`

Expected: PASS.

### Task 3: Profile Gate Suite Runtime Config And CLI Flags

**Files:**

- Modify: `apps/server/src/localRuntimeTownProfileGateSuite.ts`
- Test: `apps/server/src/localRuntimeTownProfileGateSuite.test.ts`
- Modify: `apps/server/src/localRuntimeTownProfileGateSuiteCli.ts`
- Test: `apps/server/src/localRuntimeTownProfileGateSuiteCli.test.ts`

- [x] **Step 1: Write failing gate suite test**

Add a test that writes a runtime config with profile-specific `replanningPolicy`, runs `runLocalRuntimeTownProfileGateSuite` with `runtimeConfigPath`, and asserts the captured profile runner input receives the policy. Use a summary whose diagnostics include `fullReplanMaterializationCount: 1` when `minimumFullReplanMaterializationCount: 1` is supplied so the suite passes.

- [x] **Step 2: Run gate suite tests to verify RED**

Run: `pnpm --filter @aivilization/server test -- localRuntimeTownProfileGateSuite.test.ts`

Expected: FAIL because suite input does not load runtime config or forward replanning policy.

- [x] **Step 3: Implement gate suite runtime config forwarding**

Add `runtimeConfigPath?: string` to `LocalRuntimeTownProfileGateSuiteInput`, load `loadLocalRuntimeTownProfileRuntimeConfig({ profileId, path: runtimeConfigPath, env: process.env })` per profile, and pass all loaded config fields to `LocalRuntimeTownProfileRunnerInput`.

- [x] **Step 4: Write failing gate suite CLI test**

Extend CLI parse coverage with:

```typescript
'--runtime-config', '/runtime/profile-config.json',
'--minimum-full-replan-materializations', '1',
```

Assert parsed and captured suite input include `runtimeConfigPath` and `minimumFullReplanMaterializationCount: 1`.

- [x] **Step 5: Run gate suite CLI tests to verify RED**

Run: `pnpm --filter @aivilization/server test -- localRuntimeTownProfileGateSuiteCli.test.ts`

Expected: FAIL because CLI does not parse the new flags.

- [x] **Step 6: Implement gate suite CLI flags**

Parse `--runtime-config` as an optional non-empty string and `--minimum-full-replan-materializations` as a non-negative integer, then pass both through the suite config.

- [x] **Step 7: Run gate suite tests to verify GREEN**

Run:

- `pnpm --filter @aivilization/server test -- localRuntimeTownProfileGateSuite.test.ts`
- `pnpm --filter @aivilization/server test -- localRuntimeTownProfileGateSuiteCli.test.ts`

Expected: PASS.

### Task 4: Verification And Commit

**Files:**

- Verify this plan and all files changed in Tasks 1-3.

- [x] **Step 1: Run focused tests**

Run:

- `pnpm --filter @aivilization/server test -- localRuntimeTownProfileRuntimeConfig.test.ts localRuntimeTownProfileRunnerCli.test.ts localRuntimeTownProfileGateSuite.test.ts localRuntimeTownProfileGateSuiteCli.test.ts`

- [x] **Step 2: Run type and format checks**

Run:

- `pnpm --filter @aivilization/server typecheck`
- `pnpm exec prettier --check docs/superpowers/specs/2026-06-25-replanning-runtime-config-gate-design.md docs/superpowers/plans/2026-06-25-replanning-runtime-config-gate-slice.md apps/server/src/localRuntimeTownProfileRuntimeConfig.ts apps/server/src/localRuntimeTownProfileRuntimeConfig.test.ts apps/server/src/localRuntimeTownProfileRunnerCli.ts apps/server/src/localRuntimeTownProfileRunnerCli.test.ts apps/server/src/localRuntimeTownProfileGateSuite.ts apps/server/src/localRuntimeTownProfileGateSuite.test.ts apps/server/src/localRuntimeTownProfileGateSuiteCli.ts apps/server/src/localRuntimeTownProfileGateSuiteCli.test.ts`

- [x] **Step 3: Run full repository verification**

Run:

- `pnpm check`
- `git diff --check`

- [x] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-06-25-replanning-runtime-config-gate-design.md docs/superpowers/plans/2026-06-25-replanning-runtime-config-gate-slice.md apps/server/src/localRuntimeTownProfileRuntimeConfig.ts apps/server/src/localRuntimeTownProfileRuntimeConfig.test.ts apps/server/src/localRuntimeTownProfileRunnerCli.ts apps/server/src/localRuntimeTownProfileRunnerCli.test.ts apps/server/src/localRuntimeTownProfileGateSuite.ts apps/server/src/localRuntimeTownProfileGateSuite.test.ts apps/server/src/localRuntimeTownProfileGateSuiteCli.ts apps/server/src/localRuntimeTownProfileGateSuiteCli.test.ts
git commit -m "feat(replanning): 配置化 profile recovery gate"
```
