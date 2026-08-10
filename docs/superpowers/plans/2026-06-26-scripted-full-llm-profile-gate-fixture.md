# Scripted Full LLM Profile Gate Fixture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a serializable scripted full-LLM runtime config fixture and prove a local profile run can load it from JSON, exercise all configured LLM stage gates, and pass without live model calls.

**Architecture:** Keep the production OpenAI-compatible full runtime config unchanged. Add a separate `full-scripted-llm-runtime-config.json` fixture that uses the existing `scripted` provider config accepted by `localRuntimeTownProfileRuntimeConfig.ts`. The profile runner test should load the JSON through the runtime config loader, pass the parsed stage configs into `runLocalRuntimeTownDaemonScenarioProfile`, then evaluate the report using `createLocalRuntimeTownProfileGateCriteria` so this verifies the same backend entrypoint used by CLI/profile-gate flows. The fixture uses repeatable scripted responses plus request-aware `contentTemplate` fields so stage outputs can preserve real action ids, payloads, fallback replanning decisions, and memory evidence ids from prompts without live LLM calls.

**Tech Stack:** TypeScript, Vitest, `@aivilization/server`, `@aivilization/observability`, scripted `@aivilization/llm` provider configs.

---

### Task 1: Scripted Full LLM Runtime Config Fixture

**Files:**

- Create: `apps/server/examples/full-scripted-llm-runtime-config.json`
- Modify: `apps/server/src/localRuntimeTownProfileRunner.test.ts`
- Modify: `apps/server/src/localRuntimeTownProfileRuntimeConfig.ts`
- Modify: `apps/server/src/localRuntimeTownProfileRuntimeConfig.test.ts`
- Modify: `apps/server/src/localRuntimeTownProfileRunner.ts`
- Modify: `apps/server/src/localRuntimeTownProfileGate.ts`
- Modify: `apps/server/src/localRuntimeTownProfileGate.test.ts`
- Modify: `apps/worker/src/agentCycleRunner.ts`
- Modify: `apps/worker/src/localSimulationRuntimeOperationTrace.ts`
- Modify: `apps/worker/src/localSimulationRuntimeSupervisor.ts`
- Modify: `docs/superpowers/plans/2026-06-26-scripted-full-llm-profile-gate-fixture.md`

- [x] **Step 1: Write the failing fixture-driven profile gate test**

Add a Vitest test to `apps/server/src/localRuntimeTownProfileRunner.test.ts` that:

- loads `../examples/full-scripted-llm-runtime-config.json` with `loadLocalRuntimeTownProfileRuntimeConfig`;
- runs `runLocalRuntimeTownDaemonScenarioProfile` for `profileId: 'smoke-25'`, `cycleCount: 1`, and the loaded stage configs;
- evaluates the produced report with `evaluateRuntimeProfileRunGate` and `createLocalRuntimeTownProfileGateCriteria('smoke-25', { runtimeConfig })`;
- asserts the gate status is `pass`;
- asserts every stage required by the derived criteria has an accepted LLM diagnostic and zero fallback/deterministic counts.

- [x] **Step 2: Verify RED**

Run:

```bash
pnpm vitest apps/server/src/localRuntimeTownProfileRunner.test.ts --run
```

Expected: FAIL because `apps/server/examples/full-scripted-llm-runtime-config.json` does not exist yet.

- [x] **Step 3: Add the scripted JSON fixture**

Create `apps/server/examples/full-scripted-llm-runtime-config.json` with:

- all 11 paper-aligned LLM stages enabled;
- `kind: "scripted"` providers for every stage;
- enough static responses for the `smoke-25` single-cycle profile run;
- strategic response that creates a stable branch/subtask pair;
- prioritization/global/action responses that reference stable ids accepted by current schema validators;
- reflection/social-model responses that produce at least one output artifact when memory synthesis runs.

Do not change production OpenAI-compatible `full-llm-runtime-config.json`.

- [x] **Step 4: Add runtime seams needed by the fixture**

Implemented supporting runtime behavior surfaced by the fixture:

- scripted providers support `repeat` and request-aware `contentTemplate`;
- templates can read `request.*` and the parsed final user JSON as `user.*`;
- templates support scalar placeholders and `{{json ...}}` placeholders for payload-preserving structured output;
- profile runner can pass `domainConfig` and an injected `steeringSimulator`;
- profile runner can preseed a baseline `MarketPriceIndexRecorded` event so first-cycle LLM prompts have complete economic context;
- worker agent-cycle trace mapping preserves `observedStateSummary` and `worldDecisionContext` for all LLM stages;
- supervisor operation traces preserve memory synthesis STM/profile/state/world context and output artifacts;
- cognition STM/profile gate derivation is scoped to stages whose runtime data flow actually carries those contexts.

- [x] **Step 5: Verify GREEN**

Run:

```bash
pnpm vitest apps/server/src/localRuntimeTownProfileRunner.test.ts --run
```

Expected: PASS.

### Task 2: Verification And Commit

**Files:**

- All touched files from Task 1.

- [x] **Step 1: Format touched files**

Run:

```bash
pnpm exec prettier --write apps/server/examples/full-scripted-llm-runtime-config.json apps/server/src/localRuntimeTownProfileRunner.test.ts apps/server/src/localRuntimeTownProfileRuntimeConfig.test.ts apps/server/src/localRuntimeTownProfileRuntimeConfig.ts apps/server/src/localRuntimeTownProfileRunner.ts apps/server/src/localRuntimeTownProfileGate.ts apps/server/src/localRuntimeTownProfileGate.test.ts apps/worker/src/agentCycleRunner.ts apps/worker/src/localSimulationRuntimeOperationTrace.ts apps/worker/src/localSimulationRuntimeSupervisor.ts docs/superpowers/plans/2026-06-26-scripted-full-llm-profile-gate-fixture.md
```

- [x] **Step 2: Run verification**

Run:

```bash
pnpm typecheck
pnpm lint
pnpm vitest apps/server/src/localRuntimeTownProfileRunner.test.ts apps/server/src/localRuntimeTownProfileRuntimeConfig.test.ts apps/server/src/localRuntimeTownProfileGate.test.ts packages/observability/src/runtimeProfileRunReport.test.ts packages/observability/src/agentCycleTraceRepository.test.ts apps/worker/src/localSimulationRuntimeSupervisor.test.ts --run
git diff --check
```

- [x] **Step 3: Commit**

Stage only this slice and commit with a detailed Conventional Commit message.
