# Tiered Action Repair Design

## Paper Anchor

AIvilization Section 2.1.2 describes pre-execution simulation as more than a binary validator. When
the Action Simulator detects an infeasible action, the agent starts a two-stage adaptive repair
process:

1. A cheap local repair mechanism tries pre-defined, computationally inexpensive fixes.
2. If local repair is insufficient, a reactive correction module uses cached experience from
   Short-Term Memory and rapid pattern-based reasoning to produce a viable alternative action or a
   minor plan adjustment.

Only repeated lightweight failures or major context shifts should escalate to full Branch-Thinking
replanning. The current backend has the simulator and a single optional synchronous `repair` hook,
but the hook has no LLM seam, no STM/LTM/world context, no provider trace, and no explicit
reactive-correction stage. This slice turns that single hook into a bounded, observable tiered
repair pipeline.

## Scope

In scope:

- Preserve existing synchronous `CycleRepairPolicy` as the cheap local repair stage.
- Add an async `ReactiveCorrector` port for the second-stage correction.
- Add an LLM reactive-correction compiler that sees the rejected action, rejection reason, local
  repair attempt outcome, selected subtask, plan, signals, STM, LTM profile, and world decision
  context.
- Let the reactive corrector propose one alternative atomic action or explicitly decline to repair.
- Validate LLM action shape and allowed command type before simulation.
- Always run corrected actions through the same Action Simulator before command drafting.
- Keep adaptive replanning as the final escalation path when both local repair and reactive
  correction cannot validate an executable action.
- Add `actionRepairTraces` to cycle results and `actionRepair` to observability traces.
- Route the seam through worker cycle, tick agents, and scheduled active-plan runtime bindings.

Out of scope:

- Full minor branch-plan mutation. The paper allows minor plan modification; this slice limits the
  LLM to one alternative action because the existing cycle finalizer and progress model are
  action-result oriented. Plan-delta correction can be a later slice.
- Provider default wiring in production profiles.
- Replacing full replanning.
- Rewriting reactive human steering; it can adopt this tiered repair utility later.

## Architecture

The planning cycle becomes:

```text
candidate action
  -> Action Simulator
       -> accepted: command draft
       -> rejected:
            -> local repair policy (cheap deterministic heuristic)
                 -> accepted: command draft
                 -> rejected or skipped:
                      -> reactive correction policy (optional LLM seam with STM/context)
                           -> accepted after simulator validation: command draft
                           -> declined/rejected: needs-replan
```

`runAgentPlanningCycle` stays synchronous and keeps the existing local repair behavior. The async
cycle path gains `reactiveCorrector?: ReactiveCorrector`. When configured, simulation uses a new
tiered repair orchestrator that records local and reactive stages.

The LLM is bounded:

1. It may return either `propose-action` or `no-correction`.
2. It may propose only one atomic action.
3. The command type must be present in `allowedCommandTypes`.
4. Payload must be JSON-cloneable.
5. The proposed action is never trusted directly; it must pass the existing simulator.
6. If provider output is invalid or the corrected action fails simulation, the cycle still returns
   `needs-replan`, allowing adaptive replanning to decide whether to use memory-guided correction or
   full replanning.

## Data Flow

The reactive corrector input includes:

- `agentId`
- `issuedAt`
- `plan`
- `signals`
- `selectedSubtask`
- `rejectedAction`
- `rejectionReason`
- `localRepairAttempt`, when local repair proposed an action
- `localRepairRejectionReason`, when local repair failed simulator validation
- `allowedCommandTypes`
- `intentionState`
- `shortTermMemoryContext`
- `longTermProfile`
- `worldDecisionContext`

The prompt must explicitly include STM records because the paper frames reactive correction as
cached-experience reasoning. It also receives world context so it can reason about current
physiology, inventory, balance, location, job, education, residential tier, and market prices when
available.

## Trace Contract

Each repair trace is action-scoped:

- `actionId`
- `rejectionReason`
- `selectedSubtask`
- `localRepair`, with `status`, attempted action id, and simulator rejection reason where relevant
- `reactiveCorrection`, with provider/model/request, decision, proposed action, rationale,
  evidence record ids, attempts, usage, fallback reason, and post-correction simulator result

The trace should prove which tier recovered the action:

- no trace for originally accepted actions;
- local repair trace when deterministic local repair succeeds or fails;
- reactive correction trace when the second-stage seam is invoked.

## Failure Semantics

- If local repair succeeds, reactive correction is not called.
- If local repair is absent, the trace records local repair as skipped before reactive correction.
- If local repair proposes an action that fails simulation, reactive correction receives both the
  original failure and local attempt outcome.
- If reactive correction declines, fails provider/schema validation, proposes an invalid command
  type, or proposes an action that fails simulation, the final action result is `needs-replan`.
- Existing `decideAdaptiveReplanning` remains responsible for choosing `memory-guided-correction`
  versus `full-replan` based on STM evidence and policy thresholds.

## Files

New files:

- `packages/agent-runtime/src/actionRepair.ts`
- `packages/agent-runtime/src/llmReactiveCorrector.ts`
- `packages/agent-runtime/src/llmReactiveCorrector.test.ts`

Modified files:

- `packages/agent-runtime/src/actions.ts`
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

## Test Strategy

- LLM compiler tests verify accepted correction, no-correction, invalid command type fallback, and
  context serialization of STM/world/profile/local repair attempt.
- Action repair tests verify local repair short-circuits reactive correction, local failure escalates
  to reactive correction, and reactive correction must pass simulator validation.
- Cycle tests verify an async reactive corrector can recover a simulator rejection using STM/world
  context while unrecoverable correction still escalates through replanning.
- Worker/tick tests verify `reactiveCorrector` passes through runtime orchestration and appears in
  traces.
- Observability repository tests verify `actionRepair` survives clone and file persistence.

## Architecture Review

After this slice, the simulator and repair loop will match the paper's tiered shape: simulator
failure no longer jumps directly from a narrow synchronous hook to replanning. The remaining
paper-alignment gaps will still include production provider wiring, default canonical repair
heuristics, plan-delta reactive correction, richer STM matching beyond substring evidence, natural
language dialogue, and reflection/insight synthesis.
