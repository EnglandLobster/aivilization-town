# LLM Social Dialogue Generation Slice

## Goal

Replace the hardcoded social transcript as the only production behavior by introducing an optional, traceable LLM social dialogue generator with deterministic fallback.

## Task 1: Agent-Runtime Dialogue Contract

Files:

- `packages/agent-runtime/src/socialDialogueGeneration.ts`
- `packages/agent-runtime/src/socialDialogueGeneration.test.ts`
- `packages/agent-runtime/src/index.ts`

Tests first:

- deterministic result returns the original `AgentStartConversation` payload and a deterministic trace
- valid proposal replaces `topic` and `turns`, preserves target/action metadata, and accepts optional finite deltas
- invalid speaker outside `{agentId,targetAgentId}` throws
- first turn from target throws
- transcript where one participant never speaks throws
- empty topic, empty utterance, or non-finite deltas throw

Implementation:

- define `SocialDialoguePayload`, proposal, trace, result, and generator types
- implement `createDeterministicSocialDialogueGenerationResult`
- implement `applySocialDialogueProposal`
- export the module

## Task 2: LLM Dialogue Compiler

Files:

- `packages/agent-runtime/src/llmSocialDialogueGenerator.ts`
- `packages/agent-runtime/src/llmSocialDialogueGenerator.test.ts`
- `packages/agent-runtime/src/index.ts`

Tests first:

- scripted provider returns a valid two-party conversation and trace status `accepted`
- request JSON includes selected subtask, deterministic payload, memory context, long-term profile, and world decision context
- invalid speaker or invalid transcript falls back to deterministic payload with `failureReason: "schema-invalid"`
- provider failure falls back with provider failure reason
- `createTraceableLlmSocialDialogueGenerator` returns a `SocialDialogueGenerator`

Implementation:

- add structured schema `aivilization_social_dialogue_generation`
- add tool contract `submit_social_dialogue`
- map accepted and fallback traces using existing LLM trace conventions
- keep fallback payload deterministic

## Task 3: Planning Cycle Stage

Files:

- `packages/agent-runtime/src/cycle.ts`
- `packages/agent-runtime/src/cycle.test.ts`

Tests first:

- `runAgentPlanningCycleWithPrioritization` applies social dialogue generation to `AgentStartConversation` before simulator command drafts
- non-social actions are left unchanged
- generator receives selected subtask, plan, signals, memory/profile/world context
- global synthesis sees the dialogue-enriched action payload
- fallback trace appears in `AgentCycleResult.socialDialogueGenerationTraces`

Implementation:

- add optional `socialDialogueGenerator` to async cycle input
- add a helper that scans proposed actions, narrows `AgentStartConversation` payloads, calls the generator, and returns enriched actions plus traces
- pass traces through `finalizeAgentCycleResult`

## Task 4: Worker Trace And Injection

Files:

- `packages/observability/src/agentCycleTrace.ts`
- `apps/worker/src/agentCycleRunner.ts`
- `apps/worker/src/agentScheduling.ts`
- `apps/worker/src/tickRunner.ts`
- `apps/worker/src/canonicalWorkerRuntimeResolver.ts`
- matching worker tests

Tests first:

- worker cycle trace records `socialDialogueGeneration`
- tick runner forwards configured generator into `runWorkerAgentCycle`
- canonical resolver exposes configured generator binding

Implementation:

- add observability trace type for social dialogue generation
- map agent-runtime trace to observability trace
- thread the optional generator through existing worker agent runtime binding paths

## Task 5: Server Runtime Config

Files:

- `apps/server/src/localRuntimeTownProfileLlmPlanning.ts`
- `apps/server/src/localRuntimeTownProfileRuntimeConfig.ts`
- `apps/server/src/localRuntimeTownProfileRunner.ts`
- matching server tests

Tests first:

- runtime config parses `socialDialogue`
- factory constructs `traceable-llm-social-dialogue-generator`
- invalid `kind` errors with a specific message
- local runtime profile runner injects the constructed generator into agent runtime binding

Implementation:

- add config type `LocalRuntimeTownProfileSocialDialogueGenerationConfig`
- add `createLocalRuntimeTownProfileSocialDialogueGenerator`
- include generator in runtime profile agent provider config

## Task 6: Verification And Commit

Commands:

```bash
pnpm --filter @aivilization/agent-runtime test -- socialDialogueGeneration
pnpm --filter @aivilization/agent-runtime test -- llmSocialDialogueGenerator
pnpm --filter @aivilization/agent-runtime test -- cycle
pnpm --filter @aivilization/worker test
pnpm --filter @aivilization/server test
pnpm check
```

Commit message:

```text
feat(agent-runtime): 增加 LLM 社交对话生成链路

- 为什么改：论文要求社交交互产生自然语言对话，现有运行时只有固定模板 transcript
- 改了哪些核心模块：agent-runtime 对话生成契约、LLM compiler、cycle 接入、worker trace 与 server runtime config
- 关键设计/语义决策：world command 仍由模拟器校验，LLM 只替换可验证的 conversation payload，并在失败时确定性 fallback
- 用户可见变化：启用 socialDialogue runtime config 后，社交行动会产生上下文相关的两方对话
- 测试验证情况：记录实际执行的测试命令
```
