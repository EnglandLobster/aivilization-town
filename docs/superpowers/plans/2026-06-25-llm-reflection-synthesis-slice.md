# LLM Reflection Synthesis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a traceable LLM reflection synthesis seam that turns STM records into validated
reflective insights before existing LTM patch conversion.

**Architecture:** Keep reflection semantics in `@aivilization/memory`, lifecycle orchestration in
`apps/worker`, and provider construction in `apps/server`. The LLM can propose bounded
`ReflectiveInsightRecord` data, but the memory domain derives ids, validates evidence, and keeps
`LongTermMemoryPatch` conversion as the only profile mutation boundary.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, `@aivilization/memory`,
`@aivilization/llm`, `apps/worker` lifecycle consolidation, server runtime profile config.

---

## File Structure

- Modify `packages/memory/package.json`: add `@aivilization/llm` workspace dependency.
- Modify `packages/memory/src/reflection.ts`: add synthesizer contracts, deterministic adapter,
  proposal validation, and trace types.
- Create `packages/memory/src/llmReflectionSynthesizer.ts`: structured LLM schema, prompt, accepted
  result, fallback result, and traceable factory.
- Modify `packages/memory/src/reflection.test.ts`: pure validation and deterministic adapter tests.
- Create `packages/memory/src/llmReflectionSynthesizer.test.ts`: scripted-provider accepted and
  fallback tests.
- Modify `packages/memory/src/index.ts`: export the LLM reflection synthesizer.
- Modify `apps/worker/src/memoryConsolidation.ts`: accept optional
  `ReflectiveInsightSynthesizer`, expose `reflectionSynthesisTrace`, and preserve deterministic
  fallback when absent.
- Modify `apps/worker/src/memoryConsolidation.test.ts`: prove injected synthesizer patches LTM and
  trace metadata is returned.
- Modify `apps/worker/src/localSimulationLifecycle.ts`: allow schedule-level synthesizer pass-through
  into scheduled consolidation.
- Modify `apps/worker/src/localSimulationLifecycle.test.ts`: prove lifecycle schedule uses the
  synthesizer.
- Modify `apps/server/src/localRuntimeTownProfileLlmPlanning.ts`: add reflection synthesizer config
  and factory.
- Modify `apps/server/src/localRuntimeTownProfileLlmPlanning.test.ts`: prove scripted provider
  factory behavior.
- Modify `apps/server/src/localRuntimeTownProfileRuntimeConfig.ts`: parse optional
  `reflectionSynthesis` runtime config node.
- Modify `apps/server/src/localRuntimeTownProfileRuntimeConfig.test.ts`: prove top-level,
  profile-specific, null override, env secret, and invalid-kind behavior.
- Modify `apps/server/src/localRuntimeTownProfileRunner.ts`: accept direct/config-backed reflection
  synthesizer and attach it to a provided memory consolidation schedule.
- Modify `apps/server/src/localRuntimeTownProfileRunner.test.ts`: prove profile runner wires
  reflection synthesis into runtime memory consolidation.
- Modify `apps/server/src/localRuntimeTownProfileRunnerCli.ts` and `.test.ts`: map runtime config
  `reflectionSynthesis` into runner input.
- Update this plan with RED/GREEN verification logs before implementation commits.

## Task 1: Memory-Domain Reflection Synthesizer Contract

**Files:**

- Modify: `packages/memory/src/reflection.test.ts`
- Modify: `packages/memory/src/reflection.ts`
- Modify: `packages/memory/src/index.ts`
- Modify: this plan file

- [x] **Step 1: Write failing pure memory tests**

Add tests to `packages/memory/src/reflection.test.ts` proving:

- `createDeterministicReflectiveInsightSynthesizer()` returns existing deterministic insights with
  trace `{ status: 'deterministic', source: 'deterministic' }`;
- `applyReflectiveInsightProposal()` derives stable ids and accepts only evidence ids from the input
  STM window;
- invalid evidence ids throw `reflective insight evidence <id> is not in synthesis records`;
- empty topic keys, statements, tags, or out-of-range confidence fail validation.

Use a desired API like:

```ts
const result = createDeterministicReflectiveInsightSynthesizer()({
  agentId,
  records: [studyOne, studyTwo],
  minEvidenceCount: 2,
  generatedAt: 500,
});

expect(result.trace).toEqual({ status: 'deterministic', source: 'deterministic' });
expect(result.insights.map((insight) => insight.id)).toEqual([
  'reflection-agent-1-habit-study-routine-500',
]);
```

Run:

```bash
pnpm --filter @aivilization/memory test -- reflection.test.ts
```

Expected: FAIL because the synthesizer contract and proposal validator do not exist.

- [x] **Step 2: Implement the minimal memory contract**

In `packages/memory/src/reflection.ts`:

- add `ReflectiveInsightSynthesizerInput`;
- add `ReflectiveInsightSynthesisTrace`;
- add `ReflectiveInsightSynthesisResult`;
- add `ReflectiveInsightSynthesizer`;
- add `createDeterministicReflectiveInsightSynthesizer()`;
- add `applyReflectiveInsightProposal()` that derives ids through the existing reflection id format
  and returns sorted `ReflectiveInsightRecord[]`;
- export the new symbols through `packages/memory/src/index.ts`.

- [x] **Step 3: Verify memory contract tests pass**

Run:

```bash
pnpm --filter @aivilization/memory test -- reflection.test.ts
pnpm --filter @aivilization/memory typecheck
```

Expected: PASS.

### Verification Log

- RED: `pnpm --filter @aivilization/memory test -- reflection.test.ts` failed with four expected
  failures because `createDeterministicReflectiveInsightSynthesizer` and
  `applyReflectiveInsightProposal` were not exported functions.
- GREEN: `pnpm --filter @aivilization/memory test -- reflection.test.ts` passed with 11 files and
  44 tests after adding the memory-domain synthesis contract and proposal validator.
- GREEN: `pnpm --filter @aivilization/memory typecheck` passed after making the deterministic
  synthesizer test await the async-capable contract.

## Task 2: Traceable LLM Reflection Synthesizer

**Files:**

- Modify: `packages/memory/package.json`
- Create: `packages/memory/src/llmReflectionSynthesizer.ts`
- Create: `packages/memory/src/llmReflectionSynthesizer.test.ts`
- Modify: `packages/memory/src/index.ts`
- Modify: this plan file

- [x] **Step 1: Write failing LLM synthesizer tests**

Create `packages/memory/src/llmReflectionSynthesizer.test.ts` with tests proving:

- a scripted provider can return one `value` insight and the synthesizer returns an accepted trace
  with request id, provider id, model, attempts, usage, and LLM source;
- provider failure returns deterministic fallback insights and a fallback trace;
- a provider response that cites an unknown evidence id returns deterministic fallback insights and
  a fallback trace with `failureReason: 'evidence-invalid'`;
- the provider request content includes STM records, deterministic fallback insights, allowed kinds,
  and optional long-term profile.

Use a desired factory like:

```ts
const synthesizer = createTraceableLlmReflectiveInsightSynthesizer({
  provider: scripted.provider,
  model: 'reflection-model',
  requestId: ({ agentId, generatedAt }) => `reflection:${agentId}:${generatedAt}`,
});
```

Run:

```bash
pnpm --filter @aivilization/memory test -- llmReflectionSynthesizer.test.ts
```

Expected: FAIL because `llmReflectionSynthesizer.ts` does not exist.

- [x] **Step 2: Implement the LLM synthesizer**

In `packages/memory/src/llmReflectionSynthesizer.ts`:

- import `runStructuredLlmRequest` and `LlmStructuredProvider` from `@aivilization/llm`;
- define schema `aivilization_reflective_insight_synthesis`;
- parse `{ insights: [...] }` proposals;
- build prompts that instruct the model to synthesize values, habits, beliefs, mood, and personality
  only from the provided STM window;
- call `applyReflectiveInsightProposal()` for validation;
- fallback through `createDeterministicReflectiveInsightSynthesizer()` on provider/schema/validation
  failure;
- add `@aivilization/llm` to `packages/memory/package.json`.

- [x] **Step 3: Verify LLM synthesizer tests pass**

Run:

```bash
pnpm --filter @aivilization/memory test -- llmReflectionSynthesizer.test.ts reflection.test.ts
pnpm --filter @aivilization/memory typecheck
```

Expected: PASS.

### Verification Log

- RED: `pnpm --filter @aivilization/memory test -- llmReflectionSynthesizer.test.ts` failed
  with four expected failures because `proposeReflectiveInsightsWithLlm` and
  `createTraceableLlmReflectiveInsightSynthesizer` were not exported functions.
- GREEN: `pnpm --filter @aivilization/memory test -- llmReflectionSynthesizer.test.ts` passed
  after adding the structured LLM reflection synthesizer, schema parser, grounded prompt, validation
  fallback, and traceable factory.
- GREEN: `pnpm --filter @aivilization/memory test -- llmReflectionSynthesizer.test.ts
reflection.test.ts` passed with 12 files and 48 tests.
- GREEN: `pnpm --filter @aivilization/memory typecheck` passed after fixing the
  `LongTermAgentProfile` test fixture.
- GREEN: `pnpm exec prettier --check packages/memory/src/llmReflectionSynthesizer.ts
packages/memory/src/llmReflectionSynthesizer.test.ts packages/memory/src/reflection.ts
packages/memory/src/index.ts packages/memory/package.json` passed.

## Task 3: Worker Memory Consolidation Injection

**Files:**

- Modify: `apps/worker/src/memoryConsolidation.test.ts`
- Modify: `apps/worker/src/memoryConsolidation.ts`
- Modify: this plan file

- [x] **Step 1: Write failing worker tests**

Add tests proving:

- `runWorkerMemoryConsolidation()` uses an injected synthesizer result instead of deterministic
  reflection;
- the returned `reflectionSynthesisTrace` is exposed;
- patches are still produced through `convertReflectiveInsightsToLongTermMemoryPatches()`;
- `runWorkerMemoryConsolidationSchedule()` passes the synthesizer through each agent run.

Use a synthesizer like:

```ts
const synthesizer: ReflectiveInsightSynthesizer = () => ({
  insights: [
    {
      id: 'reflection-agent-1-value-market-patience-500',
      agentId,
      kind: 'value',
      topicKey: 'market-patience',
      statement: 'The agent values waiting for better market conditions.',
      confidence: 0.8,
      evidenceRecordIds: [asMemoryRecordId('trade-memory-1')],
      generatedAt: 500,
      tags: ['trade', 'market', 'value'],
    },
  ],
  trace: {
    status: 'accepted',
    source: 'llm',
    requestId: 'reflection-agent-1-500',
    providerId: 'scripted-reflection',
    model: 'reflection-model',
  },
});
```

Run:

```bash
pnpm --filter @aivilization/worker test -- memoryConsolidation.test.ts
```

Expected: FAIL because consolidation input has no synthesizer field and result has no trace field.

- [x] **Step 2: Implement worker consolidation pass-through**

In `apps/worker/src/memoryConsolidation.ts`:

- import `ReflectiveInsightSynthesizer` and
  `createDeterministicReflectiveInsightSynthesizer`;
- add optional `reflectiveInsightSynthesizer` to worker consolidation input, batch input, and schedule
  input;
- call the provided synthesizer in `applyWorkerMemoryConsolidation()`, otherwise call the
  deterministic synthesizer;
- add `reflectionSynthesisTrace` to `WorkerMemoryConsolidationResult`;
- keep hint patches and social reflections unchanged.

- [x] **Step 3: Verify worker consolidation tests pass**

Run:

```bash
pnpm --filter @aivilization/worker test -- memoryConsolidation.test.ts
pnpm --filter @aivilization/worker typecheck
```

Expected: PASS.

### Verification Log

- RED: `pnpm --filter @aivilization/worker test -- memoryConsolidation.test.ts` failed with
  two expected failures because the injected synthesizer was not called and scheduled
  consolidation still produced zero LLM-derived patches.
- GREEN: `pnpm --filter @aivilization/worker test -- memoryConsolidation.test.ts` passed with
  52 files and 301 tests after adding optional synthesizer injection, profile-aware synthesis
  input, and `reflectionSynthesisTrace` output.
- GREEN: `pnpm --filter @aivilization/worker typecheck` passed.
- GREEN: `pnpm exec prettier --check apps/worker/src/memoryConsolidation.ts
apps/worker/src/memoryConsolidation.test.ts
docs/superpowers/plans/2026-06-25-llm-reflection-synthesis-slice.md` passed.

## Task 4: Lifecycle Schedule Wiring

**Files:**

- Modify: `apps/worker/src/localSimulationLifecycle.test.ts`
- Modify: `apps/worker/src/localSimulationLifecycle.ts`
- Modify: this plan file

- [ ] **Step 1: Write failing lifecycle test**

Add a test proving `LocalSimulationLifecycleMemoryConsolidationSchedule` accepts
`reflectiveInsightSynthesizer` and the lifecycle passes it into `runWorkerMemoryConsolidationSchedule`
after a completed loop.

Run:

```bash
pnpm --filter @aivilization/worker test -- localSimulationLifecycle.test.ts
```

Expected: FAIL because the schedule type and lifecycle call do not pass the synthesizer.

- [ ] **Step 2: Implement schedule pass-through**

In `apps/worker/src/localSimulationLifecycle.ts`:

- add `reflectiveInsightSynthesizer?: ReflectiveInsightSynthesizer` to
  `LocalSimulationLifecycleMemoryConsolidationSchedule`;
- pass it to `runWorkerMemoryConsolidationSchedule()` when defined.

- [ ] **Step 3: Verify lifecycle tests pass**

Run:

```bash
pnpm --filter @aivilization/worker test -- localSimulationLifecycle.test.ts memoryConsolidation.test.ts
```

Expected: PASS.

## Task 5: Server Runtime Config and Factory Wiring

**Files:**

- Modify: `apps/server/src/localRuntimeTownProfileLlmPlanning.test.ts`
- Modify: `apps/server/src/localRuntimeTownProfileLlmPlanning.ts`
- Modify: `apps/server/src/localRuntimeTownProfileRuntimeConfig.test.ts`
- Modify: `apps/server/src/localRuntimeTownProfileRuntimeConfig.ts`
- Modify: `apps/server/src/localRuntimeTownProfileRunner.test.ts`
- Modify: `apps/server/src/localRuntimeTownProfileRunner.ts`
- Modify: `apps/server/src/localRuntimeTownProfileRunnerCli.test.ts`
- Modify: `apps/server/src/localRuntimeTownProfileRunnerCli.ts`
- Modify: this plan file

- [ ] **Step 1: Write failing server tests**

Add tests proving:

- runtime config parses `reflectionSynthesis`;
- profile-specific `reflectionSynthesis: null` disables it;
- invalid kind throws `reflectionSynthesis.kind must be traceable-llm-reflective-insight-synthesizer`;
- `createLocalRuntimeTownProfileReflectiveInsightSynthesizer()` works with scripted providers;
- profile runner attaches config-created synthesizer to a provided memory consolidation schedule;
- CLI runtime config mapping forwards `reflectionSynthesis`.

Run:

```bash
pnpm --filter @aivilization/server test -- localRuntimeTownProfileLlmPlanning.test.ts localRuntimeTownProfileRuntimeConfig.test.ts localRuntimeTownProfileRunner.test.ts localRuntimeTownProfileRunnerCli.test.ts
```

Expected: FAIL because server reflection synthesis config and factory do not exist.

- [ ] **Step 2: Implement server factory and config parser**

In `apps/server/src/localRuntimeTownProfileLlmPlanning.ts`:

- import `createTraceableLlmReflectiveInsightSynthesizer` and
  `ReflectiveInsightSynthesizer` from `@aivilization/memory`;
- add `LocalRuntimeTownProfileReflectionSynthesisConfig`;
- add `createLocalRuntimeTownProfileReflectiveInsightSynthesizer()`;
- use request id
  `profile-llm-reflection-synthesis:{profileId}:{agentId}:{generatedAt}`.

In `apps/server/src/localRuntimeTownProfileRuntimeConfig.ts`:

- add optional `reflectionSynthesis`;
- parse kind `traceable-llm-reflective-insight-synthesizer`;
- reuse provider, pricing, max-attempt, and timeout validation helpers.

- [ ] **Step 3: Implement runner and CLI wiring**

In `apps/server/src/localRuntimeTownProfileRunner.ts`:

- add optional direct `reflectiveInsightSynthesizer`;
- add optional config-backed `reflectionSynthesis`;
- add optional `memoryConsolidationSchedule`;
- attach the resolved synthesizer to the schedule before calling `createLocalRuntimeTownApi()`.

In `apps/server/src/localRuntimeTownProfileRunnerCli.ts`:

- forward parsed `runtimeConfig.reflectionSynthesis` into `LocalRuntimeTownProfileRunnerInput`.

- [ ] **Step 4: Verify server tests pass**

Run:

```bash
pnpm --filter @aivilization/server test -- localRuntimeTownProfileLlmPlanning.test.ts localRuntimeTownProfileRuntimeConfig.test.ts localRuntimeTownProfileRunner.test.ts localRuntimeTownProfileRunnerCli.test.ts
pnpm --filter @aivilization/server typecheck
```

Expected: PASS.

## Task 6: Full Verification and Commit

**Files:**

- Modify: this plan file with verification logs.

- [ ] **Step 1: Format touched files**

Run:

```bash
pnpm exec prettier --write \
  docs/superpowers/specs/2026-06-25-llm-reflection-synthesis-design.md \
  docs/superpowers/plans/2026-06-25-llm-reflection-synthesis-slice.md \
  packages/memory/package.json \
  packages/memory/src/reflection.ts \
  packages/memory/src/reflection.test.ts \
  packages/memory/src/llmReflectionSynthesizer.ts \
  packages/memory/src/llmReflectionSynthesizer.test.ts \
  packages/memory/src/index.ts \
  apps/worker/src/memoryConsolidation.ts \
  apps/worker/src/memoryConsolidation.test.ts \
  apps/worker/src/localSimulationLifecycle.ts \
  apps/worker/src/localSimulationLifecycle.test.ts \
  apps/server/src/localRuntimeTownProfileLlmPlanning.ts \
  apps/server/src/localRuntimeTownProfileLlmPlanning.test.ts \
  apps/server/src/localRuntimeTownProfileRuntimeConfig.ts \
  apps/server/src/localRuntimeTownProfileRuntimeConfig.test.ts \
  apps/server/src/localRuntimeTownProfileRunner.ts \
  apps/server/src/localRuntimeTownProfileRunner.test.ts \
  apps/server/src/localRuntimeTownProfileRunnerCli.ts \
  apps/server/src/localRuntimeTownProfileRunnerCli.test.ts
```

Expected: files are formatted.

- [ ] **Step 2: Run full workspace verification**

Run:

```bash
pnpm check
git diff --check
```

Expected: PASS.

- [ ] **Step 3: Commit implementation**

Run:

```bash
git add \
  docs/superpowers/specs/2026-06-25-llm-reflection-synthesis-design.md \
  docs/superpowers/plans/2026-06-25-llm-reflection-synthesis-slice.md \
  packages/memory/package.json \
  packages/memory/src/reflection.ts \
  packages/memory/src/reflection.test.ts \
  packages/memory/src/llmReflectionSynthesizer.ts \
  packages/memory/src/llmReflectionSynthesizer.test.ts \
  packages/memory/src/index.ts \
  apps/worker/src/memoryConsolidation.ts \
  apps/worker/src/memoryConsolidation.test.ts \
  apps/worker/src/localSimulationLifecycle.ts \
  apps/worker/src/localSimulationLifecycle.test.ts \
  apps/server/src/localRuntimeTownProfileLlmPlanning.ts \
  apps/server/src/localRuntimeTownProfileLlmPlanning.test.ts \
  apps/server/src/localRuntimeTownProfileRuntimeConfig.ts \
  apps/server/src/localRuntimeTownProfileRuntimeConfig.test.ts \
  apps/server/src/localRuntimeTownProfileRunner.ts \
  apps/server/src/localRuntimeTownProfileRunner.test.ts \
  apps/server/src/localRuntimeTownProfileRunnerCli.ts \
  apps/server/src/localRuntimeTownProfileRunnerCli.test.ts
git commit
```

Commit message:

```text
feat(memory): 接入 LLM 反思洞察合成链路

- 为了补齐论文中 STM 到 LTM 的慢速反思合成能力，新增可审计的 LLM reflection synthesis seam，并保留确定性 fallback
- 核心修改覆盖 memory 反思契约、LLM structured provider、worker memory consolidation 调度，以及 server runtime config/provider wiring
- 关键设计上禁止 LLM 直接写入 LTM patch，只允许生成经 memory 域验证的 ReflectiveInsightRecord，继续由既有 patch 边界落库
- 用户可见变化是本地 runtime profile 可通过 reflectionSynthesis 配置启用 LLM 反思，trace 中可区分 accepted/fallback/deterministic 来源
- 验证执行 pnpm check 与 git diff --check，确保类型、测试、lint 和格式检查通过
```

Expected: commit succeeds and unrelated untracked directories remain unstaged.

## Phase Review Checklist

After implementation, update the final report with:

- Paper capabilities now covered: LLM-backed reflection synthesis, STM provenance validation, LTM
  patch boundary preservation, runtime config hook.
- Capabilities still missing: memory-guided correction LLM reasoning, natural-language dialogue
  generation, semantic/vector retrieval for reflection, experiment ablations that compare LLM vs
  deterministic reflection.
- Short-term next step: memory-guided correction reasoning seam in `replanning.ts`.
- Long-term target: full paper-faithful cognition loop with LLM planning, action, observation,
  reflection, social dialogue, and reproducible ablation profiles.
