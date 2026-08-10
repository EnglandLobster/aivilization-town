# Worker Memory Context Routing Design

## Purpose

Paper-style generative agents need a closed perception loop: agents observe world events, store
short-term memories, retrieve relevant context, and let that context shape planning. The worker
already supports short-term memory retrieval inside `runWorkerAgentCycle`, and ambient observation
memory now writes bystander observations into STM. The missing boundary is routing a retrieval
budget from scheduled tick agents into the agent cycle.

This slice makes memory context an explicit worker tick concern instead of a hidden profile-runner
side effect.

## Architecture

Keep retrieval execution inside `runWorkerAgentCycle`, where intention state, long-term profile,
short-term memory context, planning, dispatch, and trace construction already meet. Add a small
contract to the scheduling layer:

```text
active objective + saved plan
  -> buildWorkerTickAgentsFromActivePlans(memoryRetrievalLimit)
  -> WorkerTickAgentInput.memoryRetrievalLimit
  -> runWorkerSimulationTick
  -> runWorkerAgentCycle
  -> runAgentPlanningCycle(shortTermMemoryContext)
```

`buildWorkerTickAgentsFromActivePlans` remains domain-agnostic. It does not retrieve memories or
score records. It only carries the retrieval budget selected by the runtime entrypoint.

## Runtime Defaults

Local runtime profile runs should exercise the full perception loop by default. The profile agent
provider uses a conservative memory retrieval limit so multi-cycle runs can consume prior action
and ambient observation memories. Specialized callers may override the limit or omit it at lower
levels for deterministic no-memory tests.

## Observability

No new trace model is needed. `AgentCycleTrace.memoryContextIds` already records the exact STM
records retrieved by the cycle. The routing is correct when traces show memory ids on cycles whose
tick agent requested a memory retrieval budget.

## Invariants

- Worker tick agents may omit `memoryRetrievalLimit`; omitted means no STM retrieval.
- A configured positive retrieval limit is passed unchanged into `runWorkerAgentCycle`.
- Active-plan scheduling only annotates tick inputs; repositories remain owned by the cycle runner.
- Local runtime profile defaults are explicit at the profile-provider boundary.

## Out Of Scope

- Semantic vector search or embedding-backed memory retrieval.
- Per-agent adaptive retrieval limits.
- LLM summarization of retrieved memory context.
- Changing the shape of `AgentCycleTrace`.
