# LLM Reflection Synthesis Design

## Paper Anchor

AIvilization treats reflection as a core part of the agent cognition loop. Section 2.2.1 says each
social event triggers post-interaction reflection, and Section 2.2.2 says STM experiences are slowly
integrated into an LTM profile that shapes values, personality, habits, and future decisions. The
current backend has the STM, LTM patch boundary, social reflection artifacts, and deterministic
reflection rules. The missing paper-faithful piece is the LLM synthesis step that turns raw
experience into semantic reflective insights.

## Current Gap

`packages/memory/src/reflection.ts` currently synthesizes insights through fixed deterministic
factories: study routine, work-energy caution, social routine, mood, personality, and value. This is
useful as a bootstrap fallback, but it is still pattern matching rather than LLM reflection. The
worker consolidation path calls `proposeReflectiveInsights()` directly, so there is no injectable
LLM seam for STM-to-LTM synthesis.

The previous agent-cycle LLM work fixed state and price flow for planning. Reflection now needs the
same architectural discipline:

- LLM output must be bounded and validated.
- Existing deterministic reflection must remain the fallback.
- LLMs may propose `ReflectiveInsightRecord` objects, but must not write LTM patches directly.
- Worker and server runtime wiring must make the seam usable outside unit tests.

## Goals

- Add a memory-domain `ReflectiveInsightSynthesizer` contract.
- Add a traceable LLM synthesizer using `@aivilization/llm` structured requests.
- Preserve the existing deterministic proposer as the fallback implementation.
- Validate LLM insights before they become LTM patches:
  - only known insight kinds are accepted;
  - evidence ids must come from the provided STM window for the same agent;
  - statements, topic keys, and tags must be non-empty;
  - confidence must stay in `[0, 1]`;
  - ids are derived by the memory domain, not trusted from model output.
- Let worker memory consolidation use an optional synthesizer and expose synthesis trace metadata.
- Add server/runtime profile wiring so profile runs can configure LLM reflection synthesis through
  the same OpenAI-compatible provider mechanism as planning stages.

## Non-Goals

- Do not make LLM reflection default-on without explicit runtime config or injected hook.
- Do not let the LLM produce `LongTermMemoryPatch` records directly.
- Do not change STM or LTM repository persistence semantics.
- Do not add vector retrieval in this slice.
- Do not generate natural-language conversation transcripts in this slice.
- Do not change world command execution, simulator validation, or agent-cycle planning.

## Architecture

`packages/memory` remains the owner of reflection semantics. It adds a small pure validation layer
and an optional LLM adapter:

```text
ShortTermMemoryRecord[]
  -> ReflectiveInsightSynthesizer
       -> LLM proposal or deterministic fallback
       -> validated ReflectiveInsightRecord[]
  -> convertReflectiveInsightsToLongTermMemoryPatches()
  -> LongTermProfileRepository.applyPatches()
```

The package-level boundary is intentional. Planning systems consume LTM profile entries later; they
do not own the slow identity synthesis step.

`apps/worker` remains orchestration. Memory consolidation retrieves STM records, asks the configured
synthesizer for reflective insights, converts them to patches, and applies patches. When no
synthesizer is configured, it keeps the current deterministic behavior.

`apps/server` owns provider construction. A new `reflectionSynthesis` runtime config node constructs
a traceable LLM synthesizer and can attach it to a profile run's memory consolidation schedule.
Provider concerns stay out of the worker execution core.

## New Contracts

The memory package adds:

```ts
export type ReflectiveInsightSynthesisTrace = {
  readonly status: 'accepted' | 'fallback' | 'deterministic';
  readonly source: 'llm' | 'deterministic-fallback' | 'deterministic';
  readonly requestId?: string;
  readonly providerId?: string;
  readonly model?: string;
  readonly failureReason?: string;
  readonly message?: string;
  readonly attempts?: readonly ReflectiveInsightSynthesisAttemptTrace[];
  readonly usage?: ReflectiveInsightSynthesisUsage;
};

export type ReflectiveInsightSynthesisResult = {
  readonly insights: readonly ReflectiveInsightRecord[];
  readonly trace: ReflectiveInsightSynthesisTrace;
};

export type ReflectiveInsightSynthesizer = (
  input: ReflectiveInsightSynthesizerInput,
) => ReflectiveInsightSynthesisResult | Promise<ReflectiveInsightSynthesisResult>;
```

The deterministic adapter returns:

```ts
{
  insights: proposeReflectiveInsights(input),
  trace: { status: 'deterministic', source: 'deterministic' }
}
```

The LLM adapter returns `accepted` when the provider response parses and validates. It returns
`fallback` with deterministic insights when the provider fails, the schema is invalid, or validation
rejects the proposal.

## LLM Prompt Boundary

The LLM receives:

- `agentId`
- `generatedAt`
- bounded STM records with id, kind, status, summary, occurredAt, importance, tags, and hints
- optional current LTM profile when the worker has it available
- deterministic fallback insights as guardrails
- allowed insight kinds

The LLM must return:

```json
{
  "insights": [
    {
      "kind": "value",
      "topicKey": "community-cooperation",
      "statement": "The agent appears to value cooperative community routines.",
      "confidence": 0.82,
      "evidenceRecordIds": ["memory-1", "memory-2"],
      "tags": ["social", "community", "value"],
      "rationale": "Repeated positive social records support this interpretation."
    }
  ]
}
```

`rationale` is stored in trace choices, not in the durable `ReflectiveInsightRecord`.

## Failure Model

- Provider error: fallback to deterministic insights and trace the provider failure.
- Invalid JSON/schema: fallback to deterministic insights and trace `schema-invalid`.
- Unknown evidence id: fallback to deterministic insights and trace `evidence-invalid`.
- Empty insight list: accepted only when deterministic fallback is also empty; otherwise fallback.
- Duplicate kind/topic pairs: keep the highest-confidence proposal, then stable-sort by kind/topic.
- LTM patch conversion remains unchanged and is the only path that mutates long-term profile state.

## Runtime Wiring

The combined runtime config gains an optional node:

```json
{
  "reflectionSynthesis": {
    "kind": "traceable-llm-reflective-insight-synthesizer",
    "model": "reflection-model",
    "provider": {
      "kind": "openai-compatible",
      "providerId": "reflection-provider",
      "endpoint": "https://llm.example.test/v1/chat/completions",
      "apiKey": { "env": "AIVILIZATION_LLM_API_KEY" }
    }
  }
}
```

The same profile override rules apply:

- top-level node is the default;
- `profiles[profileId].reflectionSynthesis` overrides the top-level node;
- `null` disables LLM reflection for that profile;
- `maxAttempts`, `timeoutMs`, and `pricing` use the existing validation rules.

## Test Strategy

- Memory tests prove proposal validation, stable id generation, deterministic fallback traces, and
  LLM accepted/fallback behavior with a scripted provider.
- Worker tests prove memory consolidation can use an injected synthesizer and still applies patches
  only through `convertReflectiveInsightsToLongTermMemoryPatches()`.
- Lifecycle tests prove `LocalSimulationLifecycleMemoryConsolidationSchedule` passes the optional
  synthesizer into scheduled consolidation.
- Server tests prove runtime config parses `reflectionSynthesis`, constructs the LLM synthesizer,
  and profile runner attaches it to a memory consolidation schedule.
- Full verification remains `pnpm check` plus `git diff --check`.

## Architecture Review

After this slice, reflection will no longer be only fixed keyword factories. The backend will have a
paper-faithful LLM seam for slow STM-to-LTM synthesis, with deterministic fallback, provenance, cost
traceability, and server runtime configuration. Remaining gaps after this slice will be
memory-guided correction reasoning, natural-language dialogue generation, richer semantic retrieval,
and experiment ablations that compare LLM reflection against deterministic reflection.
