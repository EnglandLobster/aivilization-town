# Observation-Driven Social Intentions Design

## Goal

Turn co-located social observations into durable scheduled intentions so a bystander can later
react through the existing objective-renewal and canonical social runtime path.

## Context

The backend already records ambient observation memories after visible world events. That gives
agents a memory stream, but it does not yet create an actionable bridge from "I observed a social
event" to "I should follow up socially." Paper-style town behavior needs this propagation loop:
social events become memories, memories influence planning, and future behavior can spread through
the town.

This slice adds the deterministic backend seam for that loop. It does not add UI, Godot behavior,
or LLM reaction generation. A later LLM reaction evaluator can replace or augment the deterministic
policy through the same worker boundary.

## Architecture

Add a focused worker policy that consumes newly-created ambient observation memory records and emits
scheduled intentions. `tickRunner` remains an orchestrator: it records ambient memories, asks the
policy for social follow-up intentions, and upserts those intentions through the existing intention
repository.

The generated intentions are ordinary `ScheduledIntention` records. On the next canonical
active-plan tick, `renewMissingActiveObjectives` can select the active social scheduled intention,
compile a social branch plan, and use the existing social domain runtime to observe or start a
conversation.

## Policy Rules

The default policy creates one social follow-up intention per observed social memory when:

- memory kind is `observation`;
- memory status is `observed`;
- memory tags include `ambient-observation`;
- memory tags include `ConversationRecorded` or `SocialInteractionCompleted`.

The intention should:

- be idempotent by memory id;
- start at the observation occurrence time and last for a bounded reaction window;
- keep provenance back to the observed memory record;
- include social affinity tags plus observed agent/topic tags so later planning can retrieve the
  right context;
- avoid writing intentions for non-social observations such as study, trade, wage, or production.

## Data Flow

```text
WorldEvent(ConversationRecorded / SocialInteractionCompleted)
  -> createAmbientObservationMemoryRecords(...)
  -> shortTermMemoryRepository.appendMany(...)
  -> createSocialObservationScheduledIntentions(...)
  -> intentionRepository.upsertScheduledIntentions(...)
  -> next canonical active-plan tick
  -> scheduled-routine-social objective
  -> strategic social branch
  -> canonical social runtime
```

## Error Handling

Invalid timing or policy configuration should fail close to the policy call. Empty memory batches
return an empty result. The policy should be deterministic and idempotent so worker retries do not
duplicate intentions.

## Testing

- Unit tests for the policy prove it creates social follow-up intentions for conversation and social
  interaction observations.
- Unit tests prove non-social observations are ignored.
- Worker tick tests prove ambient social memories are persisted and scheduled intentions are
  upserted in the same tick.
- Canonical active-plan tests prove the scheduled social intention is selected by objective renewal
  on the next tick.

## Out Of Scope

- LLM-generated reaction scoring.
- Multi-hop rumor propagation metrics.
- UI inspection panels.
- Changing social conversation command semantics.
