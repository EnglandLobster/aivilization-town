# Non-Cycle Observed State Context Slice

## Goal

Route the already-normalized observed agent state summary into non-cycle cognition surfaces:
strategic branch planning, daily planning, social reaction evaluation, reflective insight synthesis,
and social model synthesis.

This closes the remaining state-pipeline gap after Agent Cycle already receives
`observedStateSummary`: the same compact state view must be visible to LLM prompts outside the
tick-level action-selection loop.

## Architecture

- Worker owns observed-state summary production because it has the world projection and agent state.
- Agent-runtime and memory packages treat `observedStateSummary` as optional cognition context, not as
  deterministic rule input.
- A shared worker helper replaces the private `agentScheduling` summary function so all worker call
  sites serialize energy, satiety, health, education, balance, residential tier, job, and inventory
  consistently.
- LLM prompt payloads include `observedStateSummary` when present, next to `worldDecisionContext`.

## Tasks

1. Add RED tests proving prompt payloads include `observedStateSummary` for strategic, daily,
   reaction, reflection, and social model LLM compilers.
2. Add RED worker tests proving objective renewal, daily-plan renewal, social-observation reaction,
   and memory consolidation pass the summary into injected cognition hooks.
3. Add optional `observedStateSummary` fields to the relevant input types.
4. Add a shared worker `summarizeObservedAgentState` helper and replace the private cycle-only copy.
5. Wire worker call sites to derive the summary from the current agent or world-decision agent context.
6. Run focused tests first, then full `pnpm test`, `pnpm typecheck`, `pnpm lint`, and `git diff --check`.

## Out Of Scope

- Adding new LLM seams for deterministic-only stages.
- Changing fallback planner behavior.
- Changing world-decision market/rules context shape.
- Frontend or report rendering changes.
