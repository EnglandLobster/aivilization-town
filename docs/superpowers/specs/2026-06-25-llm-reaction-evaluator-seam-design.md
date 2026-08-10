# LLM Reaction Evaluator Seam Design

## Goal

Move observation-driven social follow-up from a hard-coded worker rule into an agent-runtime
reaction evaluator seam that can later be backed by an LLM.

## Context

The current worker records ambient observation memories and deterministically turns observed
conversations or social interactions into scheduled intentions. That gives the town a useful
memory-to-behavior loop, but the decision is still encoded as "every qualifying social observation
must become a follow-up intention."

Paper-like behavior needs a richer reaction step: an agent can ignore an event, follow up, defer,
or later choose a reaction based on profile, memory, relationship context, and model judgment. The
backend should therefore expose a narrow reaction decision boundary before wiring real provider
configuration.

## Architecture

Add `packages/agent-runtime/src/reactionEvaluation.ts` as the domain seam:

```text
ShortTermMemoryRecord
  -> ReactionEvaluatorInput
  -> ReactionDecision(ignore | follow-up)
  -> optional ReactionEvaluationTrace
  -> worker maps follow-up decisions to ScheduledIntention
```

Add `packages/agent-runtime/src/llmReactionEvaluator.ts` following the existing LLM planner pattern:

```text
ReactionEvaluatorInput
  -> structured LLM request
  -> llmReactionDecisionSchema.parse
  -> normalizeReactionDecision validation
  -> accepted ReactionDecision
  -> or deterministic fallback ReactionDecision + failure trace
```

The worker owns orchestration and persistence. Agent-runtime owns reaction semantics, validation,
fallback behavior, and trace shape. The LLM provider is injected; worker code does not import
provider-specific clients.

## Decision Contract

`ReactionDecision` supports:

- `kind: "ignore"` for memories that should not become behavior;
- `kind: "follow-up"` for memories that should become a scheduled intention;
- `confidence` in `[0, 1]`;
- `rationale` for observability;
- optional `description`, `priority`, `affinityTags`, and `reactionWindowMs` for follow-up
  scheduling.

The deterministic evaluator preserves the existing behavior for social ambient observations:

- only observed ambient memories tagged `ConversationRecorded` or `SocialInteractionCompleted`
  become follow-up decisions;
- non-social observations become ignore decisions;
- follow-up decisions keep social affinity tags and source event tags;
- invalid timing, priority, confidence, or empty follow-up description fails at the evaluator
  boundary.

## Worker Integration

`createSocialObservationScheduledIntentions` remains the worker policy entrypoint, but it accepts an
optional `ReactionEvaluator`. It still performs social-event de-duplication by source command before
creating scheduled intentions. For each selected memory, it calls the evaluator and only persists
`follow-up` decisions.

This keeps idempotency and repository writes in the worker while allowing future runtime profiles to
inject deterministic, LLM, scripted, or experiment-specific reaction evaluators.

## Trace Contract

Trace shape mirrors strategic and daily planning:

- accepted or fallback status;
- source: `llm`, `deterministic-fallback`, or `deterministic`;
- request id, provider id, model, failure reason, message;
- attempts and token usage.

Worker scheduled intentions do not persist traces yet. The traceable evaluator returns them so a
later observability slice can store or expose reaction traces without changing the decision API.

## Out Of Scope

- Runtime profile configuration for selecting a real LLM reaction evaluator.
- Persisting reaction traces to the observability repository.
- Adding defer or direct-command reaction kinds.
- Godot/frontend inspection panels.
- Relationship graph scoring beyond current tags and memory summary.
