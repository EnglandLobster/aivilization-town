# Profile memory synthesis LLM diagnostics slice

## Goal

Make reflection synthesis and social-model synthesis first-class profile LLM verification stages.

The runtime can already inject traceable LLM synthesizers into memory consolidation. This slice preserves their provider traces in supervisor operation traces, aggregates them into profile run reports, and maps runtime config to gate-required cognition stages. It does not change planner behavior, prompts, or memory consolidation semantics.

## Scope

- Extend worker supervisor operation traces with compact per-agent memory synthesis provider traces.
- Extend runtime profile cognition diagnostics with `reflectionSynthesis` and `socialModelSynthesis`.
- Feed memory synthesis traces from profile runner operation traces into profile report aggregation.
- Require those stages in profile gates when runtime config enables `reflectionSynthesis` or `socialModelSynthesis`.

## Tests First

- Add worker supervisor test coverage proving operation traces retain reflection and social-model synthesis `status/source/requestId` facts.
- Add observability report tests for aggregating accepted, deterministic fallback, and deterministic memory synthesis traces.
- Add profile runner/gate tests proving configured reflection/social-model LLM stages appear as accepted cognition diagnostics and are required by runtime-config-derived gates.

## Non-goals

- Do not modify LLM prompts.
- Do not change memory consolidation output semantics.
- Do not overload social reflection observations with provider trace metadata.
- Do not add a new durable repository unless existing operation trace persistence is insufficient.
