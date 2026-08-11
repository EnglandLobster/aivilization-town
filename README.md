# AIvilization Town

AIvilization Town is an open, living AI world: a town of autonomous LLM-driven agents who plan,
work, trade, form relationships, and build a society — engineered to grow, release by release,
toward a Cities: Skylines-class simulation whose citizens are genuinely intelligent.

The project was bootstrapped as a ground-up reconstruction of the mechanisms described in
_AIvilization v0: Toward Large-Scale Artificial Social Simulation with a Unified Agent Architecture
and Adaptive Agent Profiles_. That paper was the 0→1 scaffold; the project now develops
independently beyond it (1→100). The paper-era milestone record is preserved in
[`docs/PAPER_ALIGNMENT_MATRIX.md`](docs/PAPER_ALIGNMENT_MATRIX.md) — its evidence-class discipline
still governs all claims — and the public roadmap lives in
[`docs/CITY_MECHANISM_GAP_ANALYSIS.md`](docs/CITY_MECHANISM_GAP_ANALYSIS.md).

The canonical runtime currently integrates hierarchical agent planning, simulation-guided action
selection and repair, dual-process memory, adaptive profiles, human steering, physiological survival,
education and occupation gates, production chains, AMM trading, market observation, durable replay,
and experiment provenance.

This repository is intentionally independent from the two older reference projects in the parent
directory:

- `../a16z-ai-town` is a visual and real-time-game reference only.
- `../generative_agents` is a paper-era agent-simulation reference only.

## Current status

- The backend has one versioned canonical composition with durable state, content-addressed run
  manifests, HTTP/SSE APIs, scheduler, queue worker, recovery host, and graceful shutdown.
- The bootstrap-phase paper mechanisms are implemented and the simulation-wide authority (one
  market, one social graph, cross-owner movement) is the default settlement path. Multi-process
  deployment verification and long-run maturity evidence remain open gates.
- The paper-era benchmark pipelines (mature market dataset, stratification, trajectories, planner
  ablations) remain executable and are kept as regression and validation tools; reproducing the
  paper's reported numbers is no longer a project goal.
- The built-in observatory exposes live runtime/SLO health, town and market state, agent cognition,
  durable plans/profiles/traces, post-bootstrap Agent creation, steering commands, execution feedback,
  and replay. Authenticated mode binds creator IDs to participant principals, restricts steering to the
  owner or an operator, enforces per-participant Agent quotas, and reserves runtime operations for the
  operator role. Explicit loopback-only open mode remains available for local development.
  [`docs/FRONTEND_SYSTEM.md`](docs/FRONTEND_SYSTEM.md) defines its information architecture, visual
  language, component rules, responsive behavior, and accessibility contract.
- Tens-of-thousands-agent deployment, million-agent scaling, and causal effects are not established by
  this repository.

See [`docs/SCIENTIFIC_LIMITATIONS.md`](docs/SCIENTIFIC_LIMITATIONS.md) for the evidence and claim
boundaries enforced by this project.

## Repository structure

- `packages/sim-core`, `content`, `economy`, `society`, and `world`: deterministic simulation state,
  rules, events, replay, and domain mechanics.
- `packages/agent-runtime`, `memory`, and `llm`: planning, action synthesis, steering, profiles, memory,
  and structured model integration.
- `packages/observability`: traces, validation, paper metrics, immutable experiment artifacts, and SVG
  figure generation.
- `apps/worker`, `api`, and `server`: canonical runtime composition, background execution, recovery,
  and external APIs.
- `apps/web`: self-hosted research observatory for town state, economy, cognition, operations, and
  steering; its stable product and design contract lives in `docs/FRONTEND_SYSTEM.md`.

## Development

Prerequisites are Node.js 22 or newer, Corepack, and pnpm 10.12.4.

```sh
corepack enable
pnpm install
pnpm check
pnpm build
```

`pnpm check` runs lint, TypeScript checking, and all tests across the workspace.

## Run the canonical town

Provider mode is the production-semantic default and requires an OpenAI-compatible endpoint and
model:

```sh
export AIVILIZATION_LLM_ENDPOINT=https://example.invalid/v1
export AIVILIZATION_LLM_MODEL=your-model
export AIVILIZATION_LLM_API_KEY=your-key
export AIVILIZATION_LLM_INPUT_TOKEN_COST_MICROS=0.003
export AIVILIZATION_LLM_OUTPUT_TOKEN_COST_MICROS=0.009
pnpm --filter @aivilization/server start -- --profile smoke-25
```

For local mechanism development without a provider, choose deterministic mode explicitly:

```sh
pnpm --filter @aivilization/server start -- \
  --profile smoke-25 \
  --llm-mode deterministic
```

The default server listens on `127.0.0.1:3000`. Runtime state is durable under
`.aivilization/runtime/` unless `--root-dir` is supplied. Run `pnpm --filter @aivilization/server
start -- --help` for profiles, planner variants, ports, roots, seeds, and provider options.

Open access is accepted only on `127.0.0.1`, `localhost`, or `::1`. Before binding another address,
configure participant and operator credentials outside Git:

```sh
export AIVILIZATION_ACCESS_MODE=authenticated
export AIVILIZATION_MAX_AGENTS_PER_PARTICIPANT=16
export AIVILIZATION_ACCESS_CREDENTIALS_JSON='[
  {"keyId":"participant-primary","subjectId":"participant-7","token":"replace-with-at-least-32-random-characters","roles":["participant"]},
  {"keyId":"operator-primary","subjectId":"operator-1","token":"replace-with-another-32-character-secret","roles":["operator"]}
]'
```

For a participant-facing deployment, use external OIDC/JWKS instead of static credentials:

```sh
export AIVILIZATION_ACCESS_MODE=authenticated
export AIVILIZATION_OIDC_ISSUER=https://identity.example.com/
export AIVILIZATION_OIDC_AUDIENCE=aivilization-town
export AIVILIZATION_OIDC_JWKS_URL=https://identity.example.com/.well-known/jwks.json
```

OIDC mode validates issuer, audience, expiry, subject, asymmetric signature algorithm, and mapped
participant/operator roles. The full role-claim and key-rotation configuration is documented in
[`docs/DEPLOYMENT_AND_RECOVERY.md`](docs/DEPLOYMENT_AND_RECOVERY.md).

Static raw tokens are converted to SHA-256 credential digests during configuration parsing; OIDC
Bearer tokens exist only for request verification. Neither form enters durable state or the
content-addressed run manifest. TLS remains the responsibility of the deployment proxy; Bearer
credentials must never cross plaintext public transport.

Every canonical run records its Git commit. When the worktree is dirty, it additionally fingerprints
all tracked and nonignored untracked source paths with `git-workspace-fingerprint-v1`; ignored runtime
state, build output, and dependencies are excluded. This prevents the ambiguous `same commit +
dirty=true` provenance that otherwise makes long-running experiment artifacts impossible to reproduce.
Packaged dirty deployments must provide both `AIVILIZATION_SOURCE_WORKSPACE_SHA256` and
`AIVILIZATION_SOURCE_WORKSPACE_PATH_COUNT` alongside `AIVILIZATION_COMMIT` and
`AIVILIZATION_SOURCE_DIRTY=true`.

Canonical action-time allocation is manifest-bound as `exclusive-agent-activity-time-v2`. In the
repository's default scenario, a successful trade commits 300 simulated seconds of exclusive Agent
activity. While that interval is active, the scheduler does not start another world action and a
finished objective is not published as complete. This prevents wall-clock worker cadence from becoming
unbounded simulated action capacity. The 300-second duration is a repository design choice because the
paper does not specify trade latency; persisted v1 activity events remain replayable.

Open `http://127.0.0.1:3000/` (or `/ui`) for the observatory. It reads only same-origin runtime APIs,
discovers configured partitions, and refreshes from the simulation sync stream. The steering page can
register a post-bootstrap Agent, set a durable long-horizon objective, route a reactive command, run
the next cycles, inspect resulting traces, and replay an event range. `runtime-agent-registration-v3`
records registration identity, creator attribution, deterministic initial state, population capacity,
money-supply impact, replay provenance, and a manifest-bound per-creator quota enforced in
authoritative replayable world state. In authenticated mode,
`participant-access-control-v2` derives the creator from the authenticated subject, requires explicit
versioned participant-data consent, durably attributes human commands, and applies owner/operator
authorization plus durable per-principal mutation rate limits before commands enter the durable store.

`GET /runtime/daemon/status` returns component health and the versioned production SLO snapshot for
queue/checkpoint lag, LLM reliability and cost, market observation freshness, recovery readiness, and
registered artifact integrity. Thresholds and response rules are documented in
[`docs/OPERATIONS_SLOS.md`](docs/OPERATIONS_SLOS.md).
The supported single-node service path, safe recovery drill, backup boundary, and fail-closed data
migration contract are documented in
[`docs/DEPLOYMENT_AND_RECOVERY.md`](docs/DEPLOYMENT_AND_RECOVERY.md).
The same runbook covers replay-safe participant pseudonymization and the
`participant-data-lifecycle-v1` audit/retention executor, which records deletion requests without raw
subject IDs and retires only registered, unchanged, deadline-expired source or backup roots after a
healthy anonymized target is explicitly activated.

Layout v2 is the only writable runtime format. After stopping and backing up a layout-v1 writer,
migrate into a new path with:

```sh
pnpm migrate:runtime-data-v1-to-v2 -- \
  --source-root-dir /absolute/path/to/stopped-layout-v1 \
  --target-root-dir /absolute/path/to/new-layout-v2 \
  --confirm-source-stopped
```

The command never mutates the source. It verifies source-tree stability, compact idempotency records,
relocated projection snapshot references, target hydration, and an immutable migration artifact before
the target is accepted. Rollback restores the untouched v1 copy with its compatible binary.

## Produce backend soak evidence

Run each SCALE-001 profile against a new dedicated runtime root. The canonical observation protocol
is 30 minutes with no sampling gap above 10 seconds:

```sh
pnpm --filter @aivilization/server runtime-soak -- \
  --profile smoke-25 \
  --soak-run-id smoke-25-30m \
  --sample-interval-ms 5000 \
  --runtime-root-dir /absolute/path/to/soak-runs/smoke-25 \
  --artifact-root-dir /absolute/path/to/soak-artifacts
```

Repeat with `default-100` and `headless-stress-1000`. Each run writes a manifest-bound,
content-addressed artifact containing raw point samples and completed-job timings, plus derived
throughput, queue/execution/end-to-end latency, process-memory peak and growth, queue depth, recovery
counts, failure rate, and recursive durable-data growth. The command defaults to explicit
deterministic cognition so the report measures the single-process backend; `--llm-mode provider` is
available but this artifact does not by itself establish full model-provider capacity. Short runs are
useful contract checks but are machine-labeled noncanonical and do not close SCALE-001 or establish
the paper's tens-of-thousands-agent scale.

After all three immutable canonical artifacts exist, apply the separately versioned reference-capacity
decision without rewriting the source observations:

```sh
pnpm regrade:runtime-resource-envelope -- \
  --artifact-root-dir /absolute/path/to/soak-artifacts \
  --source-artifact-id runtime-soak-evidence:sha256:<smoke-25-hash> \
  --source-artifact-id runtime-soak-evidence:sha256:<default-100-hash> \
  --source-artifact-id runtime-soak-evidence:sha256:<headless-stress-1000-hash>
```

`runtime-resource-envelope-v2` is a repository design decision, not a paper constant. It evaluates
observed process usage against a 4-vCPU/4-GiB/25-GiB reference class with 25% memory/storage reserve,
an observed-peak hard cap plus one-hour positive final-third memory-trend projection, and a 24-hour
conservative storage projection. The final-third window excludes allocator/JIT warm-up while a
sustained late leak still produces a positive slope. The derived
content-addressed assessment proves only whether the single-process backend observations fit that
reference envelope; it does not prove resource-limit enforcement, model-provider capacity, or the
paper's deployed scale.

## Freeze a mature market dataset

Long-running collection defaults to one persistent simulation whose canonical partitions are owned
by separate runtime processes:

```sh
pnpm --filter @aivilization/server paper-market-collect -- \
  --collection-root-dir /absolute/path/to/collection \
  --profile default-100 \
  --collection-seed market-2026-01 \
  --shard-count 2 \
  --epoch-cycle-count 100 \
  --target-epoch-count 1000 \
  --max-parallel-shards 2
```

Every process owns exactly one disjoint profile partition, uses the shared collection seed and writes
only its dedicated runtime root. A single coordinator leases epochs and enforces a global barrier:
no partition may start epoch N+1 until every partition has completed epoch N. Child processes disable
daemon scheduling and execute the exact cycle count with stable operation IDs. Restart with
`--collection-id <id>` to resume. Completion freezes a v2 source manifest with one content-addressed
global run identity, exact ownership, per-ledger hashes and the rule
`merge-owned-partitions-after-global-epoch-barrier`.

Recovery is exact across process termination boundaries: the file event store writes a pending
append before changing the event stream and rolls it forward on restart, interrupted lifecycle
batches replay every already-durable tick through the observed stream tail, and a completed cycle's
operation ID prevents the lifecycle from advancing twice if the process dies before run-session
bookkeeping. Lease timeout uses `SIGKILL` intentionally so an interrupted durable session remains
recoverable instead of being terminalized as a graceful partition failure.

To run independent canonical replicates instead, pass `--topology replicates`; those manifests use
`per-shard-only-never-merge-as-one-persistent-society`, and extraction must name one `--shard-id`.
Replicate trades can never be pooled merely to satisfy the paper's volume gate. The partitioned mode
establishes one simulation/time/provenance boundary, but it does not itself add cross-partition travel
or a shared order book; that mechanism difference must remain explicit in paper comparisons.

Extract a completed collection with:

```sh
pnpm --filter @aivilization/server paper-market-collection-dataset -- \
  --collection-root-dir /absolute/path/to/collection \
  --collection-id paper-market-collection:sha256:<hash> \
  --confirm-quiescent-source
```

Single-society extraction always reads every owned partition, verifies it against the frozen ledger
hash and uses the global barrier boundary. Replicate extraction additionally requires
`--shard-id <id>`.

After stopping a durable source run, extract the paper-constrained market block with:

```sh
pnpm --filter @aivilization/server paper-market-dataset -- \
  --root-dir /absolute/path/to/runtime \
  --simulation-id aivilization-default-100 \
  --run-manifest-id resolved-run-manifest:sha256:<hash> \
  --collection-ended-at <exclusive-simulated-time-ms> \
  --confirm-quiescent-source
```

The command fails unless the source has more than 600,000 participant-attributed trades, finds a
versioned stable complete-day window, and has 400,000 subsequent trades. It writes an immutable,
content-addressed JSON manifest and JSONL transaction block under the runtime artifact directory.
Extraction is a bounded-memory two-pass stream: pass one K-way merges the manifest partitions to
compute source hashes, exact disk-bucketed identity uniqueness, and daily maturity metrics; pass two
reopens the unchanged ledgers and writes only the selected block. Source SHA-256 values are checked
before, between, and after the passes, so an appending or replaced ledger fails closed.
The paper defines the volume, participant, and block constraints but not the stability formula; the
seven-day 10% coefficient-of-variation rule is explicitly a repository decision. Producing a small or
synthetic contract artifact does not satisfy the mature-run evidence requirement.

Use the emitted dataset ID to derive the paper's market evidence from that exact frozen block:

```sh
pnpm --filter @aivilization/server paper-market-analysis -- \
  --root-dir /absolute/path/to/runtime \
  --dataset-id paper-mature-market-dataset:sha256:<hash> \
  --analysis-run-id market-analysis-2025-09 \
  --real-world-window-started-at 2025-09-09T00:00:00Z \
  --real-world-window-ended-at 2025-09-15T00:00:00Z
```

The analysis command verifies the transaction hash before deriving five-minute OHLC bars. One
content-addressed artifact then carries the source dataset ID and bar hash into the ten-commodity
Table 1 CSV, Fish stability diagnostics, and standalone Figures 4-8. It also preserves the paper's
rendered reference values and discloses the source inconsistency where Table 1 reports every p-value
as `<1e-6` while the surrounding prose describes Copper Ingot as `<0.001`.

Generate the paper's end-run stratification and longitudinal artifacts from the same stopped,
manifest-bound runtime root:

```sh
pnpm --filter @aivilization/server paper-stratification -- \
  --root-dir /absolute/path/to/runtime \
  --simulation-id aivilization-default-100 \
  --run-manifest-id resolved-run-manifest:sha256:<hash> \
  --analysis-run-id stratification-main \
  --confirm-quiescent-source

pnpm --filter @aivilization/server paper-trajectory -- \
  --root-dir /absolute/path/to/runtime \
  --simulation-id aivilization-default-100 \
  --run-manifest-id resolved-run-manifest:sha256:<hash> \
  --analysis-run-id trajectory-main \
  --confirm-quiescent-source
```

Both commands verify the canonical profile and exact partition directory set, restore every final
projection from checkpoint plus event tail, and fail closed when paper-required cohorts are absent.
Trajectory extraction converts wall-clock event/trace timestamps to partition-sequenced simulated
time before comparing them with experiment boundaries. The commands do not manufacture employed or
early-guidance cohorts when a source run lacks them.

## Run the planner ablation pipeline

Each run must select the controlled `ablation-80` cohort, one paper task, one planner variant, an
explicit cycle count, and a fresh root. For example:

```sh
pnpm --filter @aivilization/server paper-ablation -- \
  --profile ablation-80 \
  --paper-ablation-task task-1 \
  --planner-variant default \
  --cycles 100 \
  --llm-mode deterministic
```

This command demonstrates the executable interface; deterministic mode and an arbitrary 100-cycle
window do not constitute a paper reproduction. A complete comparison requires all four tasks crossed
with `default`, `without-branch`, and `without-objective-decomposition`. After producing those 12 run
artifacts, use:

```sh
paper_run_artifacts=(
  /absolute/path/to/run-01/artifact.json
  /absolute/path/to/run-02/artifact.json
  /absolute/path/to/run-03/artifact.json
  /absolute/path/to/run-04/artifact.json
  /absolute/path/to/run-05/artifact.json
  /absolute/path/to/run-06/artifact.json
  /absolute/path/to/run-07/artifact.json
  /absolute/path/to/run-08/artifact.json
  /absolute/path/to/run-09/artifact.json
  /absolute/path/to/run-10/artifact.json
  /absolute/path/to/run-11/artifact.json
  /absolute/path/to/run-12/artifact.json
)
paper_comparison_args=()
for paper_run_artifact in "${paper_run_artifacts[@]}"; do
  paper_comparison_args+=(--run-artifact "$paper_run_artifact")
done
pnpm --filter @aivilization/server paper-ablation-compare -- \
  --comparison-id my-comparison \
  --output-root /absolute/path/to/comparison \
  "${paper_comparison_args[@]}"
```

The comparison command rejects missing, duplicate, and within-task-confounded matrices, then writes
immutable JSON tables and SVG figures.

## Project documents

- [`docs/PAPER_ALIGNMENT_MATRIX.md`](docs/PAPER_ALIGNMENT_MATRIX.md): the 0→1 bootstrap milestone
  record against the AIvilization v0 paper; its four evidence classes still govern all claims.
- [`docs/CITY_MECHANISM_GAP_ANALYSIS.md`](docs/CITY_MECHANISM_GAP_ANALYSIS.md): public roadmap —
  eight layers of city-simulation gaps versus Cities: Skylines, ordered by ROI, with the
  evidence-boundary rules that govern extensions.
- [`docs/SCIENTIFIC_LIMITATIONS.md`](docs/SCIENTIFIC_LIMITATIONS.md): scientific evidence, causality,
  compute, and scaling boundaries.
- [`docs/OPERATIONS_SLOS.md`](docs/OPERATIONS_SLOS.md): production SLI/SLO semantics, alert thresholds,
  and first-response runbook.
- [`docs/DEPLOYMENT_AND_RECOVERY.md`](docs/DEPLOYMENT_AND_RECOVERY.md): single-node deployment,
  checkpoint/dead-letter drills, backup/rollback, and data-layout compatibility.
- [`docs/Aivilization-paper/AIVILIZATION.md`](docs/Aivilization-paper/AIVILIZATION.md): local paper text
  used for alignment.
- `docs/superpowers/specs/2026-06-23-aivilization-town-design.md`: original product design.
- `docs/superpowers/plans/2026-06-23-architecture-skeleton.md`: historical initial implementation plan,
  not the current project-state report.

## Contributing

Contributions are welcome — see [`CONTRIBUTING.md`](CONTRIBUTING.md) for the ground rules
(paper-aligned defaults, evidence honesty, determinism/replay/idempotency gates), the development
setup, and where to start. Notable changes are tracked in [`CHANGELOG.md`](CHANGELOG.md); releases
are semver tags cut from `main`.

## License

[Apache-2.0](LICENSE) © the AIvilization Town contributors.
