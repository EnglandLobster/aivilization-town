# Reaction Trace Observability Design

## Goal

Persist every ambient social reaction evaluation as queryable observability data, including ignored
decisions, accepted follow-ups, deterministic defaults, LLM metadata, and fallback reasons.

## Context

The runtime can now inject a traceable LLM `ReactionEvaluator` into ambient social observation
handling. The remaining failure mode is structural: `createSocialObservationScheduledIntentions`
uses the evaluator result only to decide whether to create a scheduled intention, then drops the
decision evidence. That means operators can see that an intention did or did not appear, but cannot
answer why a bystander ignored a conversation, whether the LLM or deterministic fallback made the
choice, or which source memory triggered the decision.

This slice promotes reaction evaluation from a local control-flow detail into append-only
observability state. It intentionally does not add a frontend, Godot integration, or HTTP query
surface yet.

## Architecture

Follow the existing observability repositories:

```text
ReactionEvaluator result
  -> traceable social observation intention creation
  -> WorkerReactionEvaluationTraceSink
  -> FileReactionEvaluationTraceRepository
  -> local runtime observability directory
```

`@aivilization/agent-runtime` remains responsible for reaction decision semantics.
`apps/worker` maps evaluated memories to scheduled intentions and trace records.
`@aivilization/observability` owns durable storage, validation, cloning, and query filtering.

## Trace Contract

Each record stores one evaluated source memory.

```ts
type ReactionEvaluationTrace = {
  traceId: string;
  simulationId: string;
  partitionKey: string;
  agentId: string;
  memoryRecordId: string;
  decision: {
    kind: 'ignore' | 'follow-up';
    confidence: number;
    rationale: string;
    description?: string;
    priority?: number;
    reactionWindowMs?: number;
    affinityTags?: readonly string[];
  };
  reactionTrace?: {
    status: 'accepted' | 'fallback' | 'deterministic';
    source: 'llm' | 'deterministic-fallback' | 'deterministic';
    requestId?: string;
    providerId?: string;
    model?: string;
    failureReason?: string;
    message?: string;
    attempts?: readonly ReactionEvaluationAttemptTrace[];
    usage?: ReactionEvaluationUsageTrace;
  };
  scheduledIntentionId?: string;
  issuedAt: number;
};
```

Trace ids use:

```text
reaction-evaluation:{simulationId}:{partitionKey}:{agentId}:{memoryRecordId}:{issuedAt}
```

The repository can query by simulation, partition, agent, source memory, decision kind, time range,
and limit. Results sort latest first.

## Runtime Wiring

Add a worker-level `reactionEvaluationTraceSink` option with `simulationId`, `partitionKey`, and a
repository-like `record` method. Worker ticks pass it into social observation intention seeding.
Local runtime steps build that sink from `storage.reactionEvaluationTraceRepository`, so profile
runs record reaction decisions automatically.

## Backward Compatibility

Keep `createSocialObservationScheduledIntentions` returning only `ScheduledIntention[]` for existing
callers. Add a traceable companion that returns both intentions and evaluation metadata, then make
the existing function delegate to it.

## Testing

- Repository tests cover idempotent record, restart persistence, latest-first queries, decision-kind
  filters, and defensive clones.
- Social observation tests cover follow-up and ignore evaluation records without requiring file I/O.
- Worker tick tests cover trace sink writes for ambient conversation observations.
- Local runtime storage and profile runner tests prove file-backed persistence through the
  production wiring path.

## Out Of Scope

- HTTP API endpoints for querying reaction traces.
- UI/Godot inspectors.
- New reaction kinds beyond `ignore` and `follow-up`.
- Changing the LLM prompt or decision schema.
