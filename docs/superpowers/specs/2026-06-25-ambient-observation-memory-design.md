# Ambient Observation Memory Design

## Purpose

AIvilization agents should not only remember their own actions. In the paper-style town loop,
agents also perceive nearby activity and later use those observations during retrieval, reflection,
and planning. Current action handlers already emit `ShortTermMemoryRecorded` events for the acting
agent or direct conversation participants, but co-located bystanders do not remember what they saw.

This slice adds a worker-level ambient observation propagation step. It converts visible world
events into short-term observation memories for nearby non-acting agents without changing command
validation or event determinism.

## Architecture

Keep world command handlers focused on domain state transitions and first-party memory events.
Add a pure worker module that derives observation memory records from:

- the ordered world events produced during a tick;
- the tick's final projection, used to resolve current co-location;
- the existing `ShortTermMemoryRepository`, used as the memory stream sink.

`runWorkerSimulationTick` owns the optional propagation hook after event dispatch and market
metrics, before checkpointing. `runLocalWorldRuntimeStep` enables it by default for local runtime
profiles and allows explicit disabling for tests or specialized runs.

```text
runWorkerSimulationTick
  -> dispatch actor commands
  -> collect WorldEvent[]
  -> createAmbientObservationMemoryRecords(events, projection)
  -> shortTermMemoryRepository.appendMany(observer records)
  -> return ambientObservationMemory summary
```

## Observable Events

The initial policy observes high-signal social and economic actions:

- `ConversationRecorded`: observers at the conversation location remember the topic and participants.
- `SocialInteractionCompleted`: observers at the source agent location remember the interaction
  summary.
- `TradeExecuted`: observers at the trader's location remember the trade.
- `CommodityProduced`: observers at the producer's location remember production.
- `WagePaid`: observers at the worker's location remember work being paid.
- `EducationChanged`: observers at the learner's location remember study progress.
- `AgentLocationChanged`: observers at the next location remember the arrival.

The policy ignores `ShortTermMemoryRecorded`, `SimulationTimeAdvanced`, and aggregate market index
events to avoid recursive or low-signal memory spam.

## Memory Shape

Generated records use:

- `kind: "observation"`
- `status: "observed"`
- `source.eventIds` containing the triggering event id
- tags including `ambient-observation`, event type, location id, and visible agent ids
- deterministic ids of the form
  `<tick-id>:ambient:<event-id>:<observer-agent-id>`

Records are not emitted as world events in this slice. The event stream remains a deterministic
record of world facts, while the memory repository remains the cognition stream used by planning
and consolidation.

## Invariants

- Acting agents and direct conversation participants are excluded from bystander observations.
- Observers must be co-located with the visible event.
- Duplicate observer records are not produced for the same event and observer.
- Empty observer sets are valid and produce zero records.
- The propagation result reports generated record count and observed event count for diagnostics.

## Out Of Scope

- Field-of-view geometry, private rooms, hearing radius, and visibility permissions.
- LLM summarization of observed events.
- Cross-partition observation propagation.
- Emitting bystander observation records into the world event stream.
