# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

AIvilization Town is an open, living AI world: a town of autonomous LLM-driven agents who plan, work,
trade, and form a society — growing release by release toward a Cities: Skylines-class simulation.
It is a simulation **backend**, not a game or a skeleton. The _AIvilization v0_ paper was the 0→1
bootstrap scaffold; the project now develops independently beyond it (1→100), with
`docs/CITY_MECHANISM_GAP_ANALYSIS.md` as the live roadmap. Two sibling directories are references
only, not dependencies: `../a16z-ai-town` (visual/real-time reference) and `../generative_agents`
(paper-era agent reference).

The most important cultural rule here is the **claim boundary**: an implemented mechanism, an executable
pipeline, an empirical reproduction, and a scale claim are four distinct evidence classes. Code and docs
must never promote a lower class to a higher one — deterministic smoke runs and synthetic fixtures do
**not** count as mature-run evidence. `docs/PAPER_ALIGNMENT_MATRIX.md` (the 0→1 milestone record) defines
the evidence classes; `docs/SCIENTIFIC_LIMITATIONS.md` defines the boundaries. Preserve this discipline
in any new code, comments, or documentation. In the open-resident experiments the same rule applies:
prompted `--mode verification` runs, free runs, and model-written text are distinct evidence; only
committed events establish that something happened.

**`AGENTS.md` is the authoritative engineering/DDD constraint document** (bounded-context ownership,
dependency direction, accounting invariants, event/time semantics). Read it before adding a domain
concept; this file is the quick orientation.

## Commands

Prerequisites: Node.js 22+, Corepack, pnpm 10.12.4 (`corepack enable`).

```sh
pnpm install
pnpm check        # lint + typecheck + test across the whole workspace (the gate to run before finishing)
pnpm build        # tsup build of every package/app, topologically sorted
pnpm lint         # eslint . (type-checked rules; consistent-type-imports and no-floating-promises are errors)
pnpm typecheck    # tsc --noEmit in every package
pnpm test         # builds the web client (vite) first, then vitest run across all projects
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

### Open-resident society (experimental, separate runtime)

`apps/residents` (`pnpm residents …` = `node apps/residents/dist/cli.js`) runs LLM residents through
OpenCode. Requires OpenCode installed and authenticated for the chosen model.

```sh
pnpm --filter @aivilization/residents... build
pnpm residents init --root .local/open-residents/my-town --count 2   # --profile society-integrated-v1, --initialization newcomers
pnpm residents run --root .local/open-residents/my-town --mode free --turns 6 --model <provider/model>
pnpm residents serve --root .local/open-residents/my-town --port 4320  # observer + resident HTTP; admin token in credentials.json
node apps/server/dist/localRuntimeTownCliMain.js resident-society --root DIR --port 4320 --model <m>  # daemon
pnpm --filter @aivilization/residents verify:<feature>   # compiled-CLI acceptance scripts in apps/residents/scripts/
```

Only one writer may open a town directory at a time; stop `serve`/daemon before other CLI writers.
Town directories contain credentials and private resident records (git-ignored). Historical towns keep
their manifests; new features are enabled on them only by explicit `pnpm residents enable-*` opt-in.

## Architecture

### Workspace layering (dependencies point downward; never upward)

- **`packages/sim-core`** — foundation, no internal deps. Event sourcing primitives: append-only JSONL
  event/command stores, projection snapshots + checkpoints, partitions, deterministic RNG, replay, time,
  content-addressed IDs, source-revision fingerprinting. Everything durable flows through here.
- **`packages/authority`** — no internal deps. Principals and resource-control primitives (offer/accept
  control handover, bound control, principal snapshots/operations) shared by the domain packages below.
- **Domain packages (pure decisions + event appliers, no I/O, never depend on `world` or apps):**
  - `content` — scenarios, locations, seeded guides/defaults.
  - `economy` — accounts/double-entry, inventory math, AMM/pricing, recipes/production chains, external trade.
  - `enterprise` — firm aggregate: cash, ownership shares, membership, solvency, bankruptcy, dividends.
  - `credit` — the single town bank: deposits, loans, amortization, default, reserve ratio.
  - `society` — physiology, consumption, education, occupations, wages, tax, welfare, housing,
    succession.
  - `commerce` (offers/orders/payment requests/deposits with escrow), `collaboration` (versioned
    multi-party proposals, consent, resident programs/actions), `information` (spaces, documents,
    ACL/revisions, messages, read receipts), `governance` (public proposals/votes/policy enactment),
    `materials`, `premises` (sites, construction, buildings, facility use).
- **`packages/world`** — server-authoritative application/integration boundary over all domain packages:
  **commands → events → projection** (`applyWorldEvent`, `WorldProjection`), cross-aggregate
  orchestration, location/busy-state authorization, cadence scheduling. It must not absorb domain
  algorithms that can live in a domain package.
- **`packages/agent-runtime`, `memory`, `llm`** — the cognitive layer. `agent-runtime` owns the hierarchical
  planning **cycle** (branch plans, subtask prioritization, action synthesis, simulation + repair, adaptive
  replanning, social dialogue) and the `openAgent` driver contract for open residents. `llm` stages have
  deterministic fallbacks so the whole cycle runs without a provider. `memory` holds STM/LTM,
  consolidation, profile influence, and open-resident private cognition.
- **`packages/observability`** — traces, validation, paper metrics, immutable experiment artifacts, SVG figures.
- **`apps/api`** — pure HTTP/SSE handlers + participant access control (auth, roles, quotas, rate limits). No I/O ownership.
- **`apps/worker`** — the runtime engine (see below), including `src/openSociety/` for open residents.
- **`apps/residents`** — HTTP/CLI/OpenCode adapter for open residents (identity-bound `town` CLI,
  generated Skill, daemon, partition compute, replica).
- **`apps/server`** — composition root: wires worker + api + web + llm + residents into CLIs, HTTP server,
  scheduler, queue worker, recovery host, graceful shutdown.
- **`apps/web`** — the self-hosted research observatory: a React + TypeScript app (`apps/web/client/`)
  with a PixiJS 8 WebGL map, built by Vite to `dist/client` and served same-origin under `/ui/` via
  `createTownWebAssets()` (`src/index.ts`). It is a presentation adapter only: it reads same-origin
  runtime APIs and owns no domain decisions. `client/store.ts` is a `useSyncExternalStore` store (Pixi's
  frame loop does not trigger React renders); `client/map/logic/` holds framework-independent map logic
  covered by Node tests. `pnpm --filter @aivilization/web dev` runs Vite on :4318, proxying the API to
  :4317. Its product/design contract is `docs/FRONTEND_SYSTEM.md`.

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

### Open-resident society (`apps/worker/src/openSociety` + `apps/residents`)

A second agent mode alongside the canonical planner. There is **no candidate-action menu**: each
resident is an OpenCode session whose only tool is a restricted command executor that runs the
identity-bound `town` CLI (no pipes/redirection/host commands; identity comes from the token, never
from a model-supplied actor ID). Residents set their own goals.

- **Capability catalog**: `openSociety/catalog.ts` aggregates per-area `*Catalog.ts` files into
  `OPEN_SOCIETY_TOOLS` (versioned `OPEN_CAPABILITY_CATALOG_VERSION`); `*Tools.ts` implement them by
  calling domain decisions and world events. CLI groups map 1:1 to catalog prefixes (`town <group> <op>`).
  Adding a capability = catalog entry + tool implementation + capability boundary
  (`capabilityBoundaries.ts`) + Skill page + version bump; keep it default-off behind a versioned policy.
- **Skill**: `apps/residents/skills/town-resident/` is **generated** by `writeSkill.ts` (run on
  `build` / `skill:generate`) from `residentSkill.ts` / `societySkill.ts`; edit those sources, not the
  generated Markdown (which is committed). Residents read it on demand via `town find` / `town wiki`.
- **Society kernel** (resident-authored institutions): `registers`/`records` (shared claims, never
  authoritative balances), `programs` + `mandates` (≤8-step atomic procedures, each principal
  personally authorizes an exact revision), `collectives` (charters + votes), `governance`
  (public proposals that can enact tax/budget/subsidy/procedure changes).
- **Persistence**: a separate single-writer journal (`journal.ts`, `journalRecovery.ts`), not the
  canonical partition authority. An explicit partition compute mode (`serve --partition-config` +
  `partition-run`/`partition-daemon`) runs residents in independent local processes against one
  authority server; multi-host deployment is not established.
- **Context**: default resident context is bounded (`contextDelivery.ts`, `lifeContext.ts`); more
  information must come from authorized queries. Additions to canonical planner context must not
  leak into resident prompts and vice versa.
- Text never creates facts: posts, messages, wiki pages and private cognition cannot change money,
  ownership, inventory, bodies or locations. The city-app wiki indexes original text only (no
  auto-summaries, consensus, scoring or ranking).

## Conventions

- **DDD layering is a hard rule** (full rules in `AGENTS.md`). Domain layer (`economy`, `enterprise`,
  `credit`, `society`, `commerce`, `collaboration`, `information`, `governance`, `materials`,
  `premises`, `memory`, and pure modules in `world`):
  pure types + pure functions + validators, zero side effects (see `weather.ts`, `matters.ts`,
  `conflict.ts`, `conditions.ts` for the shape). Application layer (command handlers in
  `packages/world/src/handlers/`, authority settlement, materializers): orchestrates domain calls
  and emits events, holds no domain rules. Interface layer (`apps/api`, `apps/web`, CLIs): parsing
  and presentation only. Domain modules never import from application/interface layers.
- **World command handlers live in `packages/world/src/handlers/` by domain area**
  (conversation/matters/conflict/bulletin/physiology/economic/movement/timeAdvance), sharing
  helpers from `handlers/shared.ts`. `agentActions.ts` is only the dispatch/re-export seam — never
  add handler logic there.
- **Experimental features register once** in `apps/worker/src/experimentalFeatures.ts`: one spec
  entry (`key`, `policyVersion`, `cliFlag`, `envVar`, `createManifestParameters`, optional
  `withCommandPolicy`) drives CLI parsing, manifest declaration, and the policies factory. A new
  feature should touch: the registry, its content defaults, its settlement/exposure wiring, and
  `runtime.env.example` — nothing else. Default-off is mandatory until evidence promotes it.
- TypeScript is strict with `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, and
  `verbatimModuleSyntax`. Use `import type` for type-only imports (enforced), and never leave floating
  promises (enforced).
- Prettier: single quotes, trailing commas, width 100.
- Each package exposes a single `src/index.ts` barrel; keep cross-package imports going through the
  `@aivilization/*` package name, not deep relative paths.
- Prefer adding a versioned, content-addressed artifact/contract (the pattern used throughout, e.g.
  `runtime-agent-registration-v3`, `exclusive-agent-activity-time-v2`) over ad-hoc mutation, and keep
  persisted older versions replayable.
