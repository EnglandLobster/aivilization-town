# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

AIvilization Town is a ground-up, executable reconstruction of the mechanisms in the _AIvilization v0_
paper (large-scale artificial social simulation with a unified agent architecture). It is a simulation
**backend**, not a game or a skeleton. Two sibling directories are references only, not dependencies:
`../a16z-ai-town` (visual/real-time reference) and `../generative_agents` (paper-era agent reference).

The most important cultural rule here is the **claim boundary**: an implemented mechanism, an executable
pipeline, an empirical reproduction, and a scale claim are four distinct evidence classes. Code and docs
must never promote a lower class to a higher one — deterministic smoke runs and synthetic fixtures do
**not** count as reproducing the paper's numbers. `docs/PAPER_ALIGNMENT_MATRIX.md` is the authoritative
status ledger; `docs/SCIENTIFIC_LIMITATIONS.md` defines the boundaries. Preserve this discipline in any
new code, comments, or documentation.

## Commands

Prerequisites: Node.js 22+, Corepack, pnpm 10.12.4 (`corepack enable`).

```sh
pnpm install
pnpm check        # lint + typecheck + test across the whole workspace (the gate to run before finishing)
pnpm build        # tsup build of every package/app, topologically sorted
pnpm lint         # eslint . (type-checked rules; consistent-type-imports and no-floating-promises are errors)
pnpm typecheck    # tsc --noEmit in every package
pnpm test         # vitest run across all projects
pnpm format       # prettier --write .
```

Tests use a single Vitest root config (`vitest.config.ts`) that aggregates each package's
`vitest.config.ts` as a project. Cross-package imports resolve to **source** via aliases in
`vitest.workspace-aliases.ts` (and `tsconfig.base.json` `paths`), so tests run without building first.

```sh
# Run one project's tests, or a single file / test name:
pnpm --filter @aivilization/worker test
pnpm --filter @aivilization/worker exec vitest run src/tickRunner.test.ts
pnpm --filter @aivilization/worker exec vitest run -t "roll-forward"
```

Test files are colocated with sources as `*.test.ts` (there is no separate test dir).

## Running the town

`apps/server` (`@aivilization/server`) is the composition root and owns all CLIs. Provider mode is the
production-semantic default and needs an OpenAI-compatible endpoint; deterministic mode is for local
mechanism work and must be selected explicitly:

```sh
# Fast local dev: builds server + deps, runs deterministic cognition on 127.0.0.1:3000
pnpm --filter @aivilization/server dev

# Explicit profile / mode
pnpm --filter @aivilization/server start -- --profile smoke-25 --llm-mode deterministic
pnpm --filter @aivilization/server start -- --help     # profiles, planner variants, ports, roots, seeds
```

Durable runtime state lives under `.aivilization/runtime/` (git-ignored) unless `--root-dir` is passed.
The observatory UI is served at `http://127.0.0.1:3000/` (or `/ui`). The paper-evidence and operational
CLIs (`paper-ablation`, `paper-market-*`, `paper-stratification`, `paper-trajectory`, `runtime-soak`,
`recovery-drill`, `migrate-data-v1-to-v2`, participant-data lifecycle) are documented with their exact
provenance constraints in `README.md` — read it before invoking them, since most fail closed unless the
source run is stopped/quiescent and manifest-bound.

## Architecture

### Workspace layering (dependencies point downward; never upward)

- **`packages/sim-core`** — foundation, no internal deps. Event sourcing primitives: append-only JSONL
  event/command stores, projection snapshots + checkpoints, partitions, deterministic RNG, replay, time,
  content-addressed IDs, source-revision fingerprinting. Everything durable flows through here.
- **`packages/content`, `economy`, `society`, `world`** — deterministic domain state and rules.
  `world` is server-authoritative: **commands → events → projection** (`applyWorldEvent`, `WorldProjection`).
- **`packages/agent-runtime`, `memory`, `llm`** — the cognitive layer. `agent-runtime` owns the hierarchical
  planning **cycle** (branch plans, subtask prioritization, action synthesis, simulation + repair, adaptive
  replanning, social dialogue). `llm` stages have deterministic fallbacks so the whole cycle runs without a
  provider. `memory` holds STM/LTM, consolidation, and profile influence.
- **`packages/observability`** — traces, validation, paper metrics, immutable experiment artifacts, SVG figures.
- **`apps/api`** — pure HTTP/SSE handlers + participant access control (auth, roles, quotas, rate limits). No I/O ownership.
- **`apps/worker`** — the runtime engine (see below).
- **`apps/server`** — composition root: wires worker + api + web + llm into CLIs, HTTP server, scheduler,
  queue worker, recovery host, graceful shutdown.
- **`apps/web`** — the self-hosted research observatory. It is mostly static assets in `apps/web/public/`
  (`app.js`, `app.css`) served by the server; it reads only same-origin runtime APIs. Its product/design
  contract is `docs/FRONTEND_SYSTEM.md`.

### Event-sourced, replayable, deterministic

State is never mutated in place. The authoritative record is the event stream; projections are derived and
checkpointed, and any state is reconstructable by replaying events on top of a snapshot. Consequences that
matter when editing:

- Writes must be **idempotent** (stable operation/idempotency keys + expected stream version) and support
  **roll-forward** recovery: a durable "pending" marker is written before the stream changes and completed
  on restart. Partial-write recovery paths are tested heavily — preserve them.
- Cognition uses deterministic RNG and deterministic LLM fallbacks so runs are reproducible from a seed.
- Every canonical run records provenance: git commit, and when the worktree is dirty, a
  `git-workspace-fingerprint-v1` over tracked + non-ignored source. Run manifests are content-addressed.

### The runtime engine (`apps/worker`)

The unit of execution is a **tick** (`tickRunner.ts`) that runs per-agent cognitive cycles
(`agentCycleRunner.ts` → `agent-runtime` cycle), synthesizes world commands, and dispatches them to the
event stream. A `LocalSimulationRuntimeHost` composes storage, projections, the agent provider, scheduler,
run queue, and recovery. `localScenarioBootstrap` + profiles seed a simulation.

### Partitions and the simulation-wide authority

The single largest architectural fact to know: a **partition** is the scaling boundary, but the town
settles as **one unified society** through the simulation-wide authority. The claim boundary and
remaining deployment/empirical gates are tracked in `docs/PAPER_ALIGNMENT_MATRIX.md`.

- `simulation-wide-authority-v1` (`simulationWideAuthority.ts`) is a file-backed, lease-fenced global
  ledger that settles AMM trades, cross-owner conversations, and ownership transfer with idempotent
  operation IDs and per-partition inbox cursors. It is **on by default**
  (`--simulation-wide-authority off` opts out to the legacy per-partition path).
- When enabled, `simulationCommandRouter.ts` routes trade/conversation/move drafts to the authority
  (settled via a per-partition idempotent `simulationWideAuthorityMaterializer.ts`), while
  produce/sleep/study/work stay partition-local. The authority journal is a genesis-anchored SHA-256
  hash chain verified fail-closed before further settlement.
- Cross-owner movement uses the runtime handoff: `agent-cognitive-snapshot-v1`, paired
  `AgentOwnershipDeparted`/`AgentOwnershipArrived` events, and idempotent destination hydration.
- Remaining gates (do not assume otherwise): multi-process deployment verification of the handoff
  (the verified path is the single-process file-backed authority), journal compaction/archival, and
  the mature-run empirical evidence tracked in the matrix.

When touching cross-partition, authority, materializer, or recovery code, read
`docs/PAPER_ALIGNMENT_MATRIX.md` first — it documents which paths are verified, which are in
migration, and the fail-closed contracts that must not regress.

## Conventions

- TypeScript is strict with `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, and
  `verbatimModuleSyntax`. Use `import type` for type-only imports (enforced), and never leave floating
  promises (enforced).
- Prettier: single quotes, trailing commas, width 100.
- Each package exposes a single `src/index.ts` barrel; keep cross-package imports going through the
  `@aivilization/*` package name, not deep relative paths.
- Prefer adding a versioned, content-addressed artifact/contract (the pattern used throughout, e.g.
  `runtime-agent-registration-v3`, `exclusive-agent-activity-time-v2`) over ad-hoc mutation, and keep
  persisted older versions replayable.
