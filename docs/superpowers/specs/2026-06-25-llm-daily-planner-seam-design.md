# LLM Daily Planner Seam Design

## Paper Alignment

The Generative Agents paper generates a broad daily agenda from an agent's summary description and
recent experiences, then saves and decomposes that agenda later. The previous slice added a validated
`DailyPlan` artifact and deterministic compiler. This slice adds the structured LLM seam for
producing that artifact without trusting raw model output.

## Current Gap

`compileDeterministicDailyPlan` is a useful safe baseline, but the paper's planning behavior depends
on language-model synthesis over agent traits, experience, and context. The project already has a
safe model for this in `llmStrategicPlanner`: the LLM proposes structured data, agent-runtime
validates it, and invalid output falls back to deterministic planning with trace data.

## Chosen Approach

Add `packages/agent-runtime/src/llmDailyPlanner.ts`.

The module mirrors the strategic planner seam:

```text
DailyPlanCompilerInput
  -> structured LLM request
  -> llmDailyPlanSchema.parse
  -> createDailyPlan validation
  -> accepted DailyPlan
  -> or deterministic fallback DailyPlan + failure trace
```

The worker does not call the provider directly. Future worker/runtime config can inject a
`DailyPlanCompiler`, exactly as strategic planning injects `StrategicPlanCompiler`.

## Types

Add compiler-level types to `dailyPlanning.ts`:

- `DailyPlanCompilerInput`
- `DailyPlanCompiler`
- `DailyPlanCompilationTrace`
- `DailyPlanCompilationResult`
- `normalizeDailyPlanCompilerOutput`

Add LLM-specific types to `llmDailyPlanner.ts`:

- `LlmDailyPlanProposal`
- `LlmDailyPlanCompilerInput`
- `LlmDailyPlanResult`
- `createLlmDailyPlanCompiler`
- `createTraceableLlmDailyPlanCompiler`
- `proposeDailyPlanWithLlm`

## Validation Boundary

The schema parser must not accept "mostly valid" plans. It reads JSON into a `DailyPlan` candidate
and calls `createDailyPlan`, so duplicate item ids, empty descriptions, invalid time windows, empty
tags, and invalid evidence ids are rejected before any scheduled intention is created.

## Prompt Contract

The LLM receives:

- `agentId`, `issuedAt`, and computed day anchor inputs;
- world-state snapshot such as job, location, and physiology;
- long-term profile sections as plain JSON;
- recent memory summaries with ids, tags, timestamps, and importance.

The request instructs the provider to return only a broad day agenda, not world commands, object
mutations, or 5-15 minute action decomposition.

## Trace Contract

Trace shape mirrors strategic planning:

- accepted/fallback status;
- source: `llm`, `deterministic-fallback`, or `deterministic`;
- request id, provider id, model, failure reason/message;
- attempts and token usage.

This keeps observability uniform across strategic planning and daily planning.

## Out Of Scope

- Runtime config to select the LLM daily compiler.
- Worker lifecycle integration for LLM daily planning.
- Writing accepted/fallback daily plans back into STM as memory records.
- Just-in-time decomposition from agenda item to minute-level actions.
