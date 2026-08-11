# Contributing to AIvilization Town

Thanks for helping build a living AI town. This document is the contribution
contract; it exists so that a growing contributor base strengthens the
simulation's invariants instead of eroding them.

## Ground rules

1. **The constitution: the canonical default path stays stable and honest.**
   The default configuration is the town we ship and measure. Experimental or
   direction-changing mechanics ship behind explicit opt-in flags
   (precedent: `--regional-markets`) until they are promoted by evidence, and
   long-running evidence runs must declare which flags were active.
2. **Evidence honesty.** Mechanism verification, pipeline verification,
   empirical reproduction, and scale validation are distinct evidence
   classes (defined in `docs/PAPER_ALIGNMENT_MATRIX.md`, our 0→1 milestone
   record whose discipline still governs). PRs and docs must not promote a
   claim to a higher class than the evidence supports.
3. **Determinism, replay, idempotency.** Every world state transition must
   be deterministic, replayable from the event log, and idempotent under
   redelivery. LLM outputs are proposals recorded in command payloads;
   they never directly adjudicate authoritative state.
4. **No new third-party dependencies** without prior discussion in an issue.
   Workspace-internal dependencies are fine when they do not create cycles.

## Development setup

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm check   # lint + typecheck + test — must pass before every PR
pnpm build
```

Node.js 22 or newer (CI runs on 24) and pnpm 10 (via corepack) are required.
No LLM API key is needed for development: the full test suite runs on
deterministic fallbacks and mock providers, and the canonical town can be
started with `--llm-mode deterministic`.

## How to change things safely

- The test suite (1200+ tests) is the specification of the canonical
  behavior. If your change turns tests red, either the old behavior was a
  bug (say so in the PR and update the tests deliberately) or your change
  is wrong. Never weaken an assertion just to go green.
- **Coverage gate.** CI runs `pnpm test:coverage` and fails below 80% on
  lines, statements, functions, and branches (workspace-wide, measured by
  `@vitest/coverage-v8`). Thresholds are a ratchet: they may only move up.
  Coverage is a floor for "untested code", not a quality proof — weak
  assertions with high line coverage are still reviewable defects. Keep
  `pnpm test` (fast, no instrumentation) for the local dev loop.
- World-authoritative commands live in `packages/world`; cognition lives in
  `packages/agent-runtime`; social/institution models live in
  `packages/society`. Keep that layering.
- Durable payloads and events are append-compatible only: add optional
  fields, never repurpose or remove existing ones without a migration plan.
- Commit messages follow the repo's conventional style
  (`feat(scope): ...`, `fix(scope): ...`, `docs(scope): ...`).

## Where to contribute

The public roadmap is `docs/CITY_MECHANISM_GAP_ANALYSIS.md` — eight layers
of city-simulation gaps ordered by ROI, plus the evidence-boundary rules
that govern them. Issues labeled `good-first-issue` are scoped to be
landable without deep knowledge of the authority/durability stack.

## Pull requests

- One concern per PR. Refactors separate from behavior changes.
- Describe the evidence class your PR establishes (see ground rule 2).
- CI runs lint, typecheck, tests, and build on Node 24; all must pass.

## Releases

Releases are cut from `main` as semver tags with `CHANGELOG.md` entries.
See "Release process" in `CHANGELOG.md`.
