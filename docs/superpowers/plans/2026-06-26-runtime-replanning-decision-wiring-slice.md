# Runtime Replanning Decision Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the `ReplanningDecider` LLM seam through local runtime profile config, server runner, CLI/gate forwarding, worker agent scheduling, and the worker cycle runner so memory-guided replanning can be enabled by profile instead of only by direct library injection.

**Architecture:** Keep `@aivilization/agent-runtime` as the decision seam owner. `apps/server` parses profile config and constructs a traceable LLM replanning decider from provider config. `apps/worker` treats the decider as an optional runtime dependency beside reactive correction and passes it into the async agent cycle without changing deterministic defaults.

**Tech Stack:** TypeScript, Vitest, `@aivilization/llm` provider config, `@aivilization/agent-runtime` `ReplanningDecider`, local runtime profile runner and worker runtime resolver.

---

### Task 1: Profile Config Parser

**Files:**
- Modify: `apps/server/src/localRuntimeTownProfileRuntimeConfig.test.ts`
- Modify: `apps/server/src/localRuntimeTownProfileRuntimeConfig.ts`

- [x] **Step 1: Write failing parser test**

Added a test proving that `replanningDecision` supports top-level config, profile override, profile disabling, env secret resolution, `maxAttempts`, `timeoutMs`, and `pricing`.

- [x] **Step 2: Verify RED**

Ran:

```bash
pnpm vitest run apps/server/src/localRuntimeTownProfileRuntimeConfig.test.ts -t "replanning decision"
```

Initial failure: `replanningDecision` was ignored by the runtime profile config parser.

- [x] **Step 3: Implement parser support**

Implemented `LocalRuntimeTownProfileReplanningDecisionConfig`, `LocalRuntimeTownProfileReplanningDeciderConfig`, `parseReplanningDecisionNode`, `replanningDecision` runtime config return wiring, and `'replanningDecision'` node-name support.

- [x] **Step 4: Verify GREEN**

Parser coverage now passes in the focused and full test suites.

### Task 2: LLM Factory

**Files:**
- Modify: `apps/server/src/localRuntimeTownProfileLlmPlanning.test.ts`
- Modify: `apps/server/src/localRuntimeTownProfileLlmPlanning.ts`

- [x] **Step 1: Write failing factory test**

Added a scripted-provider test proving `createLocalRuntimeTownProfileReplanningDecider` returns a decider that produces `memory-guided-correction` and trace metadata with request ID:

```text
profile-llm-replanning:smoke-25:agent-1:work:333
```

- [x] **Step 2: Verify RED**

Initial failure: `createLocalRuntimeTownProfileReplanningDecider` did not exist.

- [x] **Step 3: Implement factory support**

Added `createTraceableLlmReplanningDecider` factory wiring, config alias, request ID mapping, retry, timeout, and pricing passthrough.

- [x] **Step 4: Verify GREEN**

Factory coverage now passes in the focused and full test suites.

### Task 3: Runner And Worker Binding

**Files:**
- Modify: `apps/worker/src/agentScheduling.test.ts`
- Modify: `apps/worker/src/agentScheduling.ts`
- Modify: `apps/worker/src/canonicalWorkerRuntimeResolver.test.ts`
- Modify: `apps/worker/src/canonicalWorkerRuntimeResolver.ts`
- Modify: `apps/worker/src/tickRunner.ts`
- Modify: `apps/worker/src/agentCycleRunner.ts`
- Modify: `apps/worker/src/agentCycleRunner.test.ts`
- Modify: `apps/server/src/localRuntimeTownProfileRunner.ts`
- Modify: `apps/server/src/localRuntimeTownProfileRunner.test.ts`
- Modify: `apps/server/src/localRuntimeTownProfileRunnerCli.ts`
- Modify: `apps/server/src/localRuntimeTownProfileRunnerCli.test.ts`
- Modify: `apps/server/src/localRuntimeTownProfileGateSuite.ts`
- Modify: `apps/server/src/localRuntimeTownProfileGateSuite.test.ts`

- [x] **Step 1: Write failing worker/runner tests**

Added tests proving:
- `createCanonicalWorkerRuntimeResolver` preserves `runtime.replanningDecider`;
- `buildWorkerTickAgentsFromActivePlans` passes `runtime.replanningDecider` into worker tick agent input;
- `runWorkerAgentCycle` invokes `replanningDecider` after simulator rejection and records the returned replanning decision in the agent-cycle trace;
- `createLocalRuntimeTownProfileAgentProvider`, runner CLI, and gate suite forward `replanningDecision` runtime config into profile runners.

- [x] **Step 2: Verify RED**

Initial failures confirmed the decider was dropped by runtime bindings and not invoked by `runWorkerAgentCycle`.

- [x] **Step 3: Implement bindings**

Added optional `replanningDecider?: ReplanningDecider` to worker runtime binding, worker tick agent input, canonical runtime resolver config, worker cycle input, profile runner input, profile agent provider input, runner CLI forwarding, and gate suite forwarding.

- [x] **Step 4: Verify GREEN**

Worker and server focused tests now pass.

### Task 4: Regression And Commit

**Files:**
- Modify: `docs/superpowers/plans/2026-06-26-runtime-replanning-decision-wiring-slice.md`

- [x] **Step 1: Run focused regression**

Ran:

```bash
pnpm vitest run apps/server/src/localRuntimeTownProfileRuntimeConfig.test.ts apps/server/src/localRuntimeTownProfileLlmPlanning.test.ts apps/server/src/localRuntimeTownProfileRunner.test.ts apps/server/src/localRuntimeTownProfileRunnerCli.test.ts apps/server/src/localRuntimeTownProfileGateSuite.test.ts apps/worker/src/canonicalWorkerRuntimeResolver.test.ts apps/worker/src/agentScheduling.test.ts apps/worker/src/agentCycleRunner.test.ts apps/worker/src/tickRunner.test.ts
pnpm --filter @aivilization/server typecheck
pnpm --filter @aivilization/worker typecheck
pnpm --filter @aivilization/observability typecheck
pnpm lint
git diff --check
pnpm typecheck
pnpm test
```

Result: all commands passed. Full test suite passed with 167 files and 906 tests.

- [x] **Step 2: Stage and commit**

Stage only this slice:

```bash
git add docs/superpowers/plans/2026-06-26-runtime-replanning-decision-wiring-slice.md apps/server/src/localRuntimeTownProfileRuntimeConfig.ts apps/server/src/localRuntimeTownProfileRuntimeConfig.test.ts apps/server/src/localRuntimeTownProfileLlmPlanning.ts apps/server/src/localRuntimeTownProfileLlmPlanning.test.ts apps/server/src/localRuntimeTownProfileRunner.ts apps/server/src/localRuntimeTownProfileRunner.test.ts apps/server/src/localRuntimeTownProfileRunnerCli.ts apps/server/src/localRuntimeTownProfileRunnerCli.test.ts apps/server/src/localRuntimeTownProfileGateSuite.ts apps/server/src/localRuntimeTownProfileGateSuite.test.ts apps/worker/src/agentScheduling.ts apps/worker/src/agentScheduling.test.ts apps/worker/src/canonicalWorkerRuntimeResolver.ts apps/worker/src/canonicalWorkerRuntimeResolver.test.ts apps/worker/src/tickRunner.ts apps/worker/src/agentCycleRunner.ts apps/worker/src/agentCycleRunner.test.ts
git commit
```

Commit message:

```text
feat(runtime): 接通 LLM 重规划决策 profile 配置

- 为 memory-guided replanning seam 增加 profile runtime 配置入口，避免能力只停留在 agent-runtime 库层
- 在 server LLM factory、profile runner、CLI/gate forwarding 和 worker scheduling/cycle 中传递 replanningDecider
- 保留未配置时的 deterministic fallback 语义，只在 profile 明确配置时启用 LLM 决策
- 用户可见变化是 runtime profile 可配置 traceable-llm-replanning-decider，并在 agent-cycle trace 的 replanningDecision 中观测决策结果
- 已通过 server/worker 聚焦回归、全仓 typecheck、lint、全仓 test 和 diff 检查
```

---

### Self-Review

- Spec coverage: this slice advances the paper-aligned Local Repair / Memory-guided Correction gap by wiring the LLM seam into runtime config and worker execution.
- Placeholder scan: no TBD/TODO placeholders.
- Type consistency: config naming uses `replanningDecision` for profile config and `replanningDecider` for runtime dependency injection.
- Deferred observability: runtime profile LLM-stage diagnostics still cannot distinguish replanning provider traces because `AgentCycleTrace` currently stores only `replanningDecision`, not provider trace metadata. That should be a follow-up slice before gating on LLM-accepted replanning decisions.
