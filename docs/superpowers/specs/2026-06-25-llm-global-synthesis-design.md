# LLM Global Synthesis Design

## Paper Anchor

AIvilization Section 2.1.1 describes Global Synthesis as the layer that integrates action
sequences from active branches. It is not a concatenation step. It resolves inter-branch conflicts,
strategically interleaves actions, and keeps the final plan coherent with the overarching long-term
objective while respecting shared resources such as time and energy.

The backend already has `synthesizeActionCandidates`, which ranks proposals and applies resource
budgets. That is a useful safety gate, but it is still deterministic. This slice adds a bounded LLM
orchestration seam before deterministic synthesis so the agent can reason over cross-branch action
tradeoffs without bypassing resource accounting or simulation.

## Scope

In scope:

- Add a traceable async `GlobalActionSynthesizer` port in `@aivilization/agent-runtime`.
- Add an LLM compiler that receives candidate actions, deterministic synthesis results, branch plan,
  signals, memory, profile, world decision context, and action synthesis policy.
- Require the LLM to rank every existing action exactly once and provide rationale. It may assign
  global priority, strategic alignment, and branch urgency scores.
- Apply LLM choices by reordering existing action proposals and updating only bounded synthesis
  scoring fields.
- Continue through existing deterministic `synthesizeActionCandidates` so max actions, branch caps,
  inventory, currency, time, energy, and satiety budgets remain authoritative.
- Route the seam through async cycle, worker, tick scheduling, and observability traces.

Out of scope:

- Letting the LLM invent new world actions.
- Letting the LLM delete actions before deterministic resource synthesis.
- Replacing the deterministic budget ledger.
- Replacing pre-execution simulation.
- Provider default wiring.
- Local Repair / Reactive Correction.

## Architecture

The orchestration stack becomes:

```text
Contextual Prioritization
  -> Action Sequence Generation
  -> Global Synthesis (optional LLM ranking over existing actions)
  -> deterministic synthesizeActionCandidates
  -> Action Simulator / Repair
  -> command dispatch
```

`GlobalActionSynthesizer` is only used by the async planning cycle. The synchronous
`runAgentPlanningCycle` remains deterministic.

The LLM is bounded to this contract:

1. It sees all candidate actions and deterministic synthesis output.
2. It returns a complete ordered list of existing action ids.
3. It may set `priorityScore`, `strategicAlignment`, and `branchUrgency`.
4. It cannot create actions, remove actions, mutate payloads, alter command types, or bypass
   deterministic budget validation.

This gives the paper's "sophisticated orchestration" a real reasoning seam while keeping the
backend's stable authority boundaries.

## Data Flow

```text
runAgentPlanningCycleWithPrioritization
  -> collect proposed actions from selected synthesis subtasks
  -> deterministic preview via synthesizeActionCandidates
  -> optional GlobalActionSynthesizer
       -> LLM complete action ranking
       -> validate all action ids exactly once
       -> apply bounded scoring metadata
  -> synthesizeActionCandidates on ranked actions
  -> simulator and repair
```

The prompt input must include:

- `plan`
- `signals`
- `selectedCandidateActions`
- `deterministicSynthesisResult`
- `actionSynthesisPolicy`
- `intentionState`
- `shortTermMemoryContext`
- `longTermProfile`
- `worldDecisionContext`
- constraints that forbid action invention, deletion, payload mutation, and simulator assumptions

The trace must include:

- status: `deterministic`, `accepted`, or `fallback`
- source: `deterministic`, `llm`, or `deterministic-fallback`
- request/provider/model where available
- action choices with `actionId`, `priorityScore`, `rationale`, optional alignment/urgency
- attempts and usage where available
- fallback reason and message when invalid or failed

## Files

New files:

- `packages/agent-runtime/src/globalSynthesis.ts`
- `packages/agent-runtime/src/llmGlobalSynthesizer.ts`
- `packages/agent-runtime/src/llmGlobalSynthesizer.test.ts`

Modified files:

- `packages/agent-runtime/src/cycle.ts`
- `packages/agent-runtime/src/cycle.test.ts`
- `packages/agent-runtime/src/index.ts`
- `apps/worker/src/agentCycleRunner.ts`
- `apps/worker/src/agentCycleRunner.test.ts`
- `apps/worker/src/agentScheduling.ts`
- `apps/worker/src/tickRunner.ts`
- `apps/worker/src/tickRunner.test.ts`
- `packages/observability/src/agentCycleTrace.ts`
- `packages/observability/src/agentCycleTrace.test.ts`
- `packages/observability/src/agentCycleTraceRepository.ts`
- `packages/observability/src/agentCycleTraceRepository.test.ts`

## Failure Semantics

- Provider failure, timeout, content filtering, JSON parse failure, schema failure, unknown action id,
  duplicate action id, incomplete coverage, empty rationale, or non-finite scores all fall back to
  deterministic synthesis input ordering.
- Deterministic `synthesizeActionCandidates` still produces final accepted and rejected actions.
- Simulator remains the authority for projected execution validity.

## Test Strategy

- Agent-runtime LLM tests prove valid complete rankings are accepted and invalid rankings fall back.
- Cycle tests prove LLM global synthesis can select a lower local-priority survival action before a
  higher local-priority production action, while resource budgets still reject over-budget choices.
- Worker/tick tests prove the seam is passed through orchestration and trace evidence is emitted.
- Observability tests prove traces survive clone and file-backed repository boundaries.

## Architecture Review

After this slice, the three paper layers inside BTP Section 2.1.1 have LLM-capable seams:
Contextual Prioritization, Action Sequence Generation, and Global Synthesis. This still does not
complete the paper: Local Repair, Memory-guided Correction, production provider wiring, natural
language dialogue, and LLM reflection remain separate gaps.
