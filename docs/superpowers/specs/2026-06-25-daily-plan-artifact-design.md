# Daily Plan Artifact Design

## Paper Alignment

Generative Agents use planning as the bridge from memory/reflection to behavior. The paper creates
a broad daily agenda from the agent summary and recent experience, saves that plan back into the
memory stream, then recursively decomposes the near future into finer-grained actions. Agents can
also react to observations and revise the plan when the current situation no longer fits.

This slice builds the backend seam for the broad daily agenda. It does not implement LLM prompting,
memory-stream plan persistence, or 5-15 minute action decomposition yet.

## Current Gap

`apps/worker/src/dailyRoutineSchedule.ts` already creates stable scheduled intentions, and can
adjust a few slots from profile/job state. That is useful as a deterministic baseline, but it is not
yet a first-class plan artifact:

- there is no explicit daily plan object with provenance and generated summary;
- scheduled intentions do not carry which plan/evidence produced them;
- planner logic lives directly in worker orchestration instead of an agent-runtime planning boundary.

## Chosen Approach

Add `packages/agent-runtime/src/dailyPlanning.ts` as the owner of high-level daily plan proposal
validation and deterministic compilation.

The worker remains responsible for repository orchestration:

```text
projection + long-term profile + short-term memory
  -> worker gathers agent context
  -> agent-runtime compiles DailyPlan
  -> agent-runtime maps DailyPlanItem to ScheduledIntention
  -> worker upserts scheduled intentions
```

This keeps planning algorithms replaceable. The deterministic compiler becomes the safe fallback
for a later LLM daily planner, just like `llmStrategicPlanner` falls back to deterministic strategic
planning.

## Data Model

`DailyPlan`:

- `id`: stable `daily-plan:<agentId>:<dayStart>` key.
- `agentId`, `dayStart`, `generatedAt`.
- `summary`: natural-language broad-strokes plan summary.
- `items`: sorted high-level agenda chunks.

`DailyPlanItem`:

- `id`, `description`, `priority`.
- `startsAtOffsetMs`, `endsAtOffsetMs`.
- `affinityTags`.
- `source`: `baseline-routine`, `world-state`, `long-term-profile`, or `memory-context`.
- optional `evidenceRecordIds`.

`ScheduledIntention` gains optional:

- `sourcePlanId`;
- `provenanceRecordIds`.

Existing consumers keep working because both fields are optional.

## Deterministic Compiler

`compileDeterministicDailyPlan` starts with broad baseline routine chunks, then adds context-driven
items:

- job state adds a work shift;
- low health/satiety/energy adds recovery items;
- study habits add evening study;
- extroverted/social profile or recent social memory adds social follow-up;
- memory-backed items carry evidence record ids.

The compiler validates plan shape through `createDailyPlan` so future LLM output can share the same
schema gate.

## Testing

Add focused tests in `packages/agent-runtime/src/dailyPlanning.test.ts`:

- plan generation combines world state, long-term profile, and memory context;
- scheduled intention mapping preserves timing, plan id, source tags, and memory provenance;
- invalid plan items are rejected before they can reach repositories.

Add worker tests in `apps/worker/src/dailyRoutineSchedule.test.ts`:

- repository-backed renewal can use the daily plan compiler and upsert plan-backed scheduled
  intentions.

## Out Of Scope

- LLM daily planner prompting and fallback trace.
- Durable daily plan repository.
- Writing the plan artifact back into short-term memory.
- Just-in-time hourly / 5-15 minute decomposition.
- Plan invalidation and partial revision after observations.
