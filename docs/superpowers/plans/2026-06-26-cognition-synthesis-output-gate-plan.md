# Cognition Synthesis Output Gate Plan

## Objective

Make the runtime profile gate verify that configured cognition synthesis LLM stages produce auditable artifacts, not just provider traces. This closes the paper-alignment gap where reflection/social-model synthesis can be marked as enabled while producing no insight, profile patch, or social reflection evidence.

## Current Finding

- Runtime reports already aggregate accepted/fallback/deterministic cognition LLM traces and context coverage.
- Reflection synthesis traces can carry `choices`.
- Social model synthesis traces can carry `patches` and `reflections`.
- The diagnostics and gate currently ignore those output artifacts, so a run can pass LLM-context gates while failing to demonstrate post-interaction learning output.

## Implementation Steps

1. Extend cognition LLM stage diagnostics with `outputArtifactCount`.
2. Count reflection choices and social-model patches/reflections when building runtime profile diagnostics.
3. Add runtime profile gate criteria for per-stage minimum cognition output artifact counts.
4. Derive default minimum output artifact counts from local runtime config for reflection/social-model synthesis.
5. Cover report aggregation, gate failure, and local gate derivation with tests.
6. Run targeted tests, then typecheck/lint/full tests if the targeted suite is clean.

