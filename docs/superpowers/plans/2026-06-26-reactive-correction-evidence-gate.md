# Reactive Correction Evidence Gate

## Context

The runtime now has LLM seams for the paper-aligned action cycle stages, and
reactive correction receives short-term memory, profile, observed state, and
world decision context. The remaining weakness in this stage is verifiability:
an accepted reactive correction can be counted as LLM-backed even when its
decision does not cite any cached short-term-memory evidence.

The paper requires local repair / reactive correction to use cached experience
for fast pattern-based correction. For profile gates, "the LLM was called" is
therefore weaker than "the accepted correction was grounded in STM evidence."

## Scope

- Add runtime profile diagnostics for accepted agent-cycle LLM traces that cite
  evidence record IDs.
- Add a gate criterion that requires configured agent-cycle LLM stages to be
  evidence-backed.
- Wire the full AI Town runtime config so `reactiveCorrection` is required to
  pass that evidence-backed gate.
- Keep this stage focused on observability and gate semantics; do not change
  simulation behavior or LLM providers.

## Test Plan

1. Add failing observability tests for:
   - report diagnostics counting accepted evidence-backed `reactiveCorrection`
     traces;
   - gate failure when a configured stage has accepted LLM traces but zero
     evidence-backed accepted traces.
2. Add/update server runtime config tests so the checked-in full LLM profile
   derives `requiredAgentCycleLlmEvidenceBackedStages: ['reactiveCorrection']`.
3. Run targeted tests, typecheck, lint, and formatting checks before commit.
