# Worker Daily Plan Compiler Injection Design

## Paper Alignment

The backend now has two daily planning paths:

- deterministic `compileDeterministicDailyPlan`;
- traceable structured LLM daily planning through `DailyPlanCompiler`.

The worker still hardcodes deterministic daily planning inside `renewDailyPlanScheduledIntentions`.
That prevents runtime code from using the paper-faithful LLM daily planner in the actual renewal
path. This slice connects the abstraction without adding provider/config loading yet.

## Chosen Approach

Update `apps/worker/src/dailyRoutineSchedule.ts` so daily plan renewal accepts an optional
`compileDailyPlan?: DailyPlanCompiler`.

Data flow:

```text
projection + repositories
  -> worker gathers agent daily planning context
  -> injected DailyPlanCompiler or deterministic fallback
  -> normalizeDailyPlanCompilerOutput
  -> dailyPlanToScheduledIntentions
  -> intention repository
  -> renewal result with optional planningTrace
```

This keeps worker orchestration provider-agnostic. Server/runtime config can later pass
`createTraceableLlmDailyPlanCompiler(...)`, but the worker does not know whether the compiler is
deterministic, scripted, OpenAI-compatible, or another future provider.

## API Change

`renewDailyPlanScheduledIntentions` input gains:

- `compileDailyPlan?: DailyPlanCompiler`

`DailyPlanRenewalResult` gains:

- `planningTrace?: DailyPlanCompilationTrace`

Existing callers keep deterministic behavior when no compiler is supplied.

## Trace Handling

If a compiler returns a `DailyPlanCompilationResult`, the worker includes `planningTrace` in the
renewal result. If it returns a plain `DailyPlan`, the result omits the trace. The worker never
interprets provider attempts or LLM details.

## Testing

Add a worker test that injects a compiler returning `{ plan, planningTrace }` and asserts:

- the compiler receives `agentId`, world-state snapshot, long-term profile, recent memory context,
  and `issuedAt`;
- scheduled intentions are materialized from the injected plan;
- result includes `dailyPlanId`, scheduled intention ids, and the trace.

Keep the existing deterministic repository-backed renewal test to prove default behavior remains.

## Out Of Scope

- Server/runtime profile config for LLM daily planning.
- Provider factory wiring.
- Persisting daily plans or traces to a durable repository.
- Writing generated plans into the short-term memory stream.
