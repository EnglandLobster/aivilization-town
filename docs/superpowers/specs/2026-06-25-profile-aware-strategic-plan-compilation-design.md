# Profile-Aware Strategic Plan Compilation Design

## Purpose

The paper says long-horizon objectives and Long-Term Memory should reshape how the
Branch-Thinking Planner constructs and weights parallel branches. The backend already uses
long-term profile evidence during per-cycle subtask selection, but strategic plan compilation still
only receives the objective and timestamp. This leaves a structural gap: a profile value such as
"study before high-tech production" can bias a subtask after a study branch exists, but it cannot
help create that branch when the objective only says "produce chips."

This slice makes strategic plan compilation profile-aware while keeping the BTP boundary stable.

## Current Boundary

- `StrategicPlanCompilerInput` contains `objective` and `issuedAt`.
- Deterministic strategic compilation maps objective text and objective affinity tags into domain
  branches.
- LLM strategic planning receives only the objective payload and generic planner constraints.
- Worker steering can now write a human-set objective into long-term profile values.
- Autonomous objective renewal already loads long-term profiles before proposing objectives, but
  does not pass that profile into strategic plan compilation.

## Design

Extend `StrategicPlanCompilerInput` with optional `longTermProfile`.

Deterministic compilation will treat high-confidence profile `values` and `habits` as planning
context. If those profile entries mention a domain handled by the deterministic BTP rules, the
compiler may construct that domain branch even when the objective text itself does not mention it.
The generated branch keeps the normal domain affinity tags so later intention, memory, and profile
scoring continue to work through existing planner seams.

The first concrete behavior is delayed-investment planning:

1. Objective: "Craft Chip for the electronics market."
2. Objective affinity: `production`.
3. Long-term profile value: "Human steering set long-horizon objective: Study before high-tech
   production."
4. Strategic plan: include both `development/study` and `production/produce-target` branches, with
   the study branch scoring as part of the same production objective.

LLM strategic planning will include the optional profile in the user message. Fallback compilation
must preserve the same input so LLM and deterministic paths share semantics.

Worker integration:

- Strategic steering passes the just-updated profile into the compiler when a profile repository is
  present.
- Autonomous objective renewal passes the loaded profile into the compiler.
- Full replanning remains unchanged in this slice because its input currently lacks a profile
  repository; adding that belongs to a later failure-recovery slice.

## Non-Goals

- Do not change world execution commands.
- Do not add a new planner abstraction.
- Do not introduce unbounded profile-to-branch expansion; this slice uses only values and habits.
- Do not require profile context for custom compilers; the new field is optional.
- Do not solve full replanning profile context yet.

## Verification

- Agent runtime tests prove profile values can create a study branch for a production objective.
- LLM strategic planner tests prove profile context appears in the structured planner request and
  fallback receives it.
- Worker steering tests prove human strategic steering passes the updated long-term profile into
  custom compilers.
- Worker objective renewal tests prove autonomous objective plan compilation receives the profile
  already loaded for proposal.
- Full workspace checks remain the phase gate.
