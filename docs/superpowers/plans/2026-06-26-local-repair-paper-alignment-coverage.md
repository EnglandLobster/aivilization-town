# Local Repair Paper Alignment Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface paper Section 2.1.2 local repair as an explicit paper-aligned backend capability in profile coverage manifests.

**Architecture:** Keep local repair behavior unchanged and build on the existing `minimumLocalRepairAcceptedCount` gate. Extend paper-alignment coverage with one non-LLM agent-cycle capability named `localRepair`, and pass the suite-level minimum into profile gate criteria so bundle manifests can mark local repair configured/pass/fail.

**Tech Stack:** TypeScript, Vitest, pnpm workspace, `@aivilization/server` profile gate suite, `@aivilization/observability` runtime profile gate criteria.

---

### Task 1: Paper Coverage Capability

**Files:**

- Modify: `apps/server/src/localRuntimeTownProfileGateSuite.test.ts`
- Modify: `apps/server/src/localRuntimeTownPaperAlignmentCoverage.ts`

- [x] **Step 1: Write the failing coverage test**

Update the existing `writes paper-alignment coverage for full LLM runtime config into bundle manifests` test to configure local repair evidence:

```ts
minimumLocalRepairAcceptedCount: 1,
```

Pass the accepted count into the summary fixture:

```ts
localRepairAcceptedCount: 1,
```

Change expected totals from 11 to 12 and include `local-repair` in the sorted capability ids. Assert the stage:

```ts
expect(profileCoverage?.stages).toEqual(
  expect.arrayContaining([
    expect.objectContaining({
      paperCapabilityId: 'local-repair',
      paperSection: '2.1.2 Action Simulator And Tiered Replanning',
      stageFamily: 'agent-cycle',
      stageName: 'localRepair',
      runtimeConfigured: true,
      gateStatus: 'pass',
      requirements: expect.objectContaining({
        localRepairAcceptedCount: 1,
      }),
    }),
  ]),
);
```

- [x] **Step 2: Run RED**

Run: `pnpm vitest run apps/server/src/localRuntimeTownProfileGateSuite.test.ts -t "paper-alignment coverage"`

Expected: FAIL because paper-alignment coverage still lists only the 11 LLM stages and suite input does not forward local repair criteria.

- [x] **Step 3: Implement local repair coverage**

In `localRuntimeTownPaperAlignmentCoverage.ts`:

- Add `'localRepair'` to the non-LLM stage definition with `paperCapabilityId: 'local-repair'`.
- Add `localRepairAcceptedCount` to `LocalRuntimeTownPaperAlignmentRequirements`.
- Treat local repair as configured when `criteria.minimumLocalRepairAcceptedCount` is greater than zero.
- Mark local repair failed when `gate.failures` contains `code === 'local-repair-accepted-count-too-low'`.
- Keep all existing LLM stages unchanged.

- [x] **Step 4: Run GREEN**

Run: `pnpm vitest run apps/server/src/localRuntimeTownProfileGateSuite.test.ts -t "paper-alignment coverage"`

Expected: PASS.

### Task 2: Suite Criteria Wiring

**Files:**

- Modify: `apps/server/src/localRuntimeTownProfileGateSuite.test.ts`
- Modify: `apps/server/src/localRuntimeTownProfileGateSuite.ts`
- Modify: `apps/server/src/localRuntimeTownProfileGateSuiteCli.test.ts`
- Modify: `apps/server/src/localRuntimeTownProfileGateSuiteCli.ts`

- [x] **Step 1: Write the failing suite wiring assertion**

In the paper-alignment test, the `minimumLocalRepairAcceptedCount: 1` suite input should make the generated gate criteria include local repair and make coverage configured.

If additional coverage is useful, add a focused test near other suite gate requirement tests:

```ts
test('forwards local repair minimum into profile gate criteria', async () => {
  // use runProfile summary with localRepairAcceptedCount 0
  // expect suite status fail and gate failure code local-repair-accepted-count-too-low
});
```

- [x] **Step 2: Run RED**

Run: `pnpm vitest run apps/server/src/localRuntimeTownProfileGateSuite.test.ts -t "local repair|paper-alignment coverage"`

Expected: FAIL until `LocalRuntimeTownProfileGateSuiteInput` forwards `minimumLocalRepairAcceptedCount`.

- [x] **Step 3: Implement suite input forwarding**

Add optional field:

```ts
readonly minimumLocalRepairAcceptedCount?: number;
```

Validate it through the existing gate criteria path, pass it to
`createLocalRuntimeTownProfileGateCriteria`, and expose the same non-negative
integer threshold from the profile gate suite CLI.

- [x] **Step 4: Run GREEN**

Run: `pnpm vitest run apps/server/src/localRuntimeTownProfileGateSuite.test.ts -t "local repair|paper-alignment coverage"`

Expected: PASS.

### Task 3: Verification and Commit

**Files:**

- Modify: `docs/superpowers/plans/2026-06-26-local-repair-paper-alignment-coverage.md`

- [x] **Step 1: Format touched files**

Run:

```bash
pnpm exec prettier --write \
  docs/superpowers/plans/2026-06-26-local-repair-paper-alignment-coverage.md \
  apps/server/src/localRuntimeTownPaperAlignmentCoverage.ts \
  apps/server/src/localRuntimeTownProfileGateSuite.ts \
  apps/server/src/localRuntimeTownProfileGateSuite.test.ts \
  apps/server/src/localRuntimeTownProfileGateSuiteCli.ts \
  apps/server/src/localRuntimeTownProfileGateSuiteCli.test.ts
```

- [x] **Step 2: Run targeted verification**

Run:

```bash
pnpm vitest run \
  apps/server/src/localRuntimeTownProfileGateSuite.test.ts \
  apps/server/src/localRuntimeTownProfileGateSuiteCli.test.ts \
  apps/server/src/localRuntimeTownProfileGate.test.ts \
  packages/observability/src/runtimeProfileRunGate.test.ts
```

- [x] **Step 3: Run workspace checks**

Run:

```bash
pnpm typecheck
pnpm lint
git diff --check
```

- [x] **Step 4: Commit**

Run:

```bash
git add \
  docs/superpowers/plans/2026-06-26-local-repair-paper-alignment-coverage.md \
  apps/server/src/localRuntimeTownPaperAlignmentCoverage.ts \
  apps/server/src/localRuntimeTownProfileGateSuite.ts \
  apps/server/src/localRuntimeTownProfileGateSuite.test.ts \
  apps/server/src/localRuntimeTownProfileGateSuiteCli.ts \
  apps/server/src/localRuntimeTownProfileGateSuiteCli.test.ts

git commit
```

Commit message:

```text
feat(server): 将 local repair 纳入论文能力覆盖矩阵

- 将论文 2.1.2 的 local repair 从隐藏 gate 指标提升为 paper-alignment manifest 中的独立 agent-cycle 能力
- 扩展 profile gate suite 与 CLI 输入，支持把 minimumLocalRepairAcceptedCount 透传到每个 profile 的 gate criteria
- 保持 LLM stage 覆盖逻辑不变，local repair 使用非 LLM capability 分支和专用 failure code 判定
- 用户可见变化是 bundle manifest 会展示 local-repair 的 configured/pass/fail 状态，阶段复盘能直接对齐论文清单
- 验证包含 profile gate suite、profile gate、observability gate 测试，以及 typecheck、lint、git diff --check
```

---

### Self-Review

Spec coverage:

- Covers the missing paper-alignment visibility for local repair.
- Keeps local repair distinct from reactive correction and memory-guided replanning.
- Does not claim local repair is LLM reasoning; it reports the implemented cheap repair tier.

Placeholder scan:

- No TBD/TODO/fill-in placeholders.

Type consistency:

- New capability id is `local-repair`.
- New stage name is `localRepair`.
- Existing gate criterion remains `minimumLocalRepairAcceptedCount`.
