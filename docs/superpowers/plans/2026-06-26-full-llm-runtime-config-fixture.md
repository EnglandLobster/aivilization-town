# Full LLM Runtime Config Fixture Implementation Plan

**Goal:** Make the runtime-config path for a fully LLM-backed town profile concrete, checked in,
and verified against the profile gate contract.

**Architecture:** Keep provider construction and runtime parsing in the existing server-owned runtime
config loader. Add a repository-level example JSON fixture that enables every current LLM stage, uses
environment-backed provider secrets, and can be passed to `--runtime-config`. Test it through the real
disk loader, then derive gate requirements from the parsed config.

**Scope:**

- Add `apps/server/examples/full-llm-runtime-config.json`.
- Add a runtime-config test that reads the checked-in fixture through `loadLocalRuntimeTownProfileRuntimeConfig`.
- Assert the fixture enables all 11 runtime stages:
  - strategic planning, daily planning, reaction evaluation;
  - contextual prioritization, action sequence generation, social dialogue generation;
  - global synthesis, reactive correction, replanning decision;
  - reflection synthesis and social model synthesis.
- Assert the parsed config drives the expected profile-gate requirements for accepted LLM calls,
  economic context, observed-state context, and cognition output artifacts.

**Non-goals:**

- Do not change prompt wording or LLM semantics.
- Do not make live model calls in the test suite.
- Do not claim the runtime is paper-complete; this only turns the full runtime profile into an explicit
  deployable contract.

## Verification

- RED: `pnpm vitest apps/server/src/localRuntimeTownProfileRuntimeConfig.test.ts --run` failed because
  `apps/server/examples/full-llm-runtime-config.json` did not exist.
- GREEN: the same command passed after adding the checked-in fixture.
