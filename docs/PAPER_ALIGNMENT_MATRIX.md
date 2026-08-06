# Paper Alignment Matrix

This matrix is the claim boundary for AIvilization Town. A checked implementation
mechanism, an executable pipeline, an empirical reproduction, and a scale claim
are distinct evidence classes. No row may be promoted merely because a lower
class passes.

| Paper claim | Required product semantics | Current implementation evidence | Evidence class required for a paper-equivalent claim | Status |
| --- | --- | --- | --- | --- |
| §2.1 hierarchical planning | Branches, contextual selection, action simulation, repair, and re-planning are on the canonical Agent loop | `agent-runtime` cycle, worker runner, durable traces and tests | Mechanism verification | Implemented |
| §2.2 adaptive profiles | STM and LTM change later planning and social interpretation | Memory repositories, consolidation, profile influence and social reflection | Mechanism verification | Implemented |
| §2.3 human steering | Strategic and reactive commands enter durable cognition rather than prompt-only overrides | Steering APIs, plans, command store, authorization and trace records | Mechanism verification plus deployment review | Implemented locally |
| §3 economy and institutions | A market, locations, relationships, and population thresholds have one simulation-wide authority | `simulation-wide-authority-v1` persists a fenced global ledger for AMM settlement, conversations and ownership transfer, with idempotent operation IDs and partition inbox cursors. The authority, an idempotent per-partition materializer, and a canonical-tick command router are constructed inside the runtime host and settle trade/conversation end-to-end. The authority is now the **default** settlement path (opt out with `--simulation-wide-authority off`); per-partition pools are merged into one global seed pool. | Multi-process integration and recovery verification | In migration |
| §3 market mechanism | Every trade sees and mutates one AMM and one money-supply state | The authority seed sums per-partition pools into one global AMM per commodity (identical seed ratios preserve spot price, depth scales with town size) and sums money supply into the town total. Every routed trade settles against that single pool; agents plan and the market price index derive their values from the authoritative global pools via a read-only overlay that never contaminates the partition checkpoint. Legacy per-partition AMM remains reachable only via explicit opt-out. **Repository extension (off by default):** `--regional-markets on` keeps per-region AMM pools with divergent prices under one settlement authority, with a regional co-location gate on trade; this is a repository-specific multi-region mechanism, not a paper claim, and must not be mixed with §4 single-market evidence when enabled. | Multi-process integration; mature-run empirical comparison | Mechanism verified (default path) |
| §3 spatial and social system | Co-location and ownership survive cross-partition movement and restart | Authority transfer state records source/destination owners and only changes owner after movement commits; social deliveries target both owner partitions and are materialized idempotently with roll-forward on host restart. The legacy cross-partition conversation transaction is intentionally disabled while the authority owns social settlement, so the two paths cannot concurrently own one interaction. The canonical planner now selects co-located Agents from the simulation-wide society directory (not just the local partition projection), and the command router syncs each partition's Agent locations into the authority before settlement, keeping cross-owner co-location and regional trade gating fresh. | Agent owner-transfer runtime handoff (storage migration and replay materialization); cross-owner move routing (moves still append to the partition stream until the handoff exists) | In migration |
| §3 observability | The town view reports one society without silently averaging incompatible shards | Society projection aggregates population, occupancy and relations; under the authority it reports a `unified-authority` market (one global pool and total money supply) sourced from the authority snapshot, and still exposes `partitioned` rather than a fabricated average when the authority is disabled | Authority-backed projection and UI end-to-end test | Mechanism verified (default path) |
| §4 market evidence | One mature society produces a stable, immutable transaction block | Dataset and analysis pipelines bind manifests, ledgers and hashes | Mature source run, repeated analysis and direct comparison | Not yet evidenced |
| §4 inequality and trajectories | Population-wide education, work and wealth observations are extracted from one society | Stratification and trajectory artifact pipelines exist | Mature unified run and cohort review | Not yet evidenced |
| §5 ablations | Complete controlled planner-variant matrix is executed and compared | Bounded 80-Agent runner and comparison artifacts | Declared model, repetitions, uncertainty and paper comparison | Not yet evidenced |
| public deployment / scale | Authenticated participant operation and claimed population are sustained in production | Local auth, recovery and SLO contracts exist | Production deployment and sustained scale measurements | Not yet evidenced |

## Promotion rules

1. **Mechanism verification** proves deterministic state transitions, replay,
   idempotency and canonical wiring. It does not prove a scientific result.
2. **Pipeline verification** proves that a bounded run produces provenance-rich
   artifacts. Synthetic or short data remain non-empirical.
3. **Empirical reproduction** additionally requires a declared model, seed
   policy, mature data window, repetitions, uncertainty and a direct comparison
   to the reported paper result.
4. **Scale validation** requires sustained measurements at the claimed
   population and hardware. Configuration support and extrapolation are not
   measurements.

The migration work routes partition trade/conversation commands through the
authority and materializes authoritative inboxes before each tick. The
canonical planner additionally selects conversation targets from the
simulation-wide society directory, and each routing cycle reports the owning
partition's Agent locations to the authority so global co-location checks
settle against fresh facts. Remaining migration gates before any
multi-partition market, town or scale result can be described as a unified
society: routing cross-owner movement through the authority once the
owner-transfer runtime handoff (Agent storage migration and replay
materialization) exists. The current town projection remains an honest read
model for the local host: with the authority disabled (explicit opt-out) its
AMM pools are still separate, and the unified pool is a read-only settlement
overlay rather than the persisted partition checkpoint.
