# Scientific Limitations and Evidence Boundaries

This document defines what results from this repository can and cannot support. It preserves the
limitations stated in Section 7 of the AIvilization v0 paper and turns them into project-level claim
rules. The current implementation and evidence boundary is summarized in
[`PAPER_ALIGNMENT_MATRIX.md`](PAPER_ALIGNMENT_MATRIX.md).

## Limitations inherited from the paper

### LLM reasoning remains a system boundary

Hierarchical planning reduces some forms of long-chain error propagation, but it does not remove the
capability limits of the configured model. Complex dependencies can still produce suboptimal plans,
invented constraints, or otherwise invalid decisions. Schema validation, simulation, repair, retries,
and deterministic fallbacks improve operational reliability; they do not prove that model reasoning is
correct.

Every empirical result involving model-generated cognition must therefore record the provider, model,
prompt-policy version, retry and timeout settings, token usage, and any fallback. Results from different
models or fallback rates are not interchangeable without a controlled comparison.

### Observational trajectory evidence is not causal evidence

The paper reports a correlation between early strategic guidance, education investment, and later
mobility, while explicitly acknowledging that favorable initial conditions or other confounders may
explain the association. This repository preserves that boundary: trajectory reports are descriptive
and must not claim that steering, education, wage, welfare, or planner policy caused an outcome.

A causal claim requires a preregistered controlled intervention, randomized assignment where feasible,
declared treatment and control policies, balance checks, attrition accounting, repeated seeds, effect
sizes with uncertainty, and a machine-readable analysis artifact. That work is a post-replication
extension, not evidence needed to implement the paper mechanism itself.

### Compute cost constrains scale and speed

Memory-augmented LLM agents incur model, storage, scheduling, and replay costs. The paper identifies
concurrent operation at thousands of agents as a bottleneck and million-agent scale as future work.
Local 25-, 80-, 100-, or 1,000-agent profiles do not demonstrate tens-of-thousands or million-agent
operation. Type-level scale parameters and short startup tests are also not throughput evidence.

Scale claims require a sustained run with the claimed population and declared hardware, model mode,
duration, workload, throughput, latency distribution, memory, queue depth, failure/recovery rate, model
usage/cost, and data-growth measurements. Extrapolation must state its model and validated range and may
not be presented as an executed population.

## Evidence classes used by this repository

1. **Mechanism verification** proves formulas, state transitions, replay, invariants, and canonical
   wiring with unit, integration, or process tests. It supports an implementation claim only.
2. **Pipeline verification** proves that a bounded run can collect provenance-complete metrics and emit
   valid artifacts. Synthetic data or a one-cycle smoke matrix belongs here.
3. **Empirical paper reproduction** requires a declared model, duration, configuration, seed policy,
   repeated runs, mature data windows, the paper's cohort and metrics, uncertainty, and direct comparison
   with the published tables or figures.
4. **Causal evaluation** additionally requires controlled treatment assignment and a design capable of
   identifying intervention effects.
5. **Scale validation** requires sustained measurements at the claimed population on declared hardware;
   configuration support or extrapolation alone is insufficient.

Passing a lower evidence class never implies a higher one. In particular:

- passing `pnpm check` and `pnpm build` does not reproduce an empirical result;
- deterministic cognition is useful for repeatable mechanism tests but does not reproduce LLM behavior;
- a generated SVG proves artifact generation, not agreement with a paper figure;
- a content-addressed manifest proves configuration identity, not scientific validity;
- correlations in simulated trajectories do not establish real-world or within-simulation causality.

Action durations omitted by the paper are also not empirical constants. The canonical repository
currently assigns every successful market trade 300 simulated seconds under
`exclusive-agent-activity-time-v2`, serializes that policy in the resolved run manifest, and prevents
new scheduling/objective completion until the Agent becomes available. This is a versioned consistency
decision that stops worker tick frequency from creating unlimited action throughput; it is not evidence
that a real or paper Agent trade takes five minutes. Short diagnostics under this policy can validate
the mechanism and locate storage amplification, but only the declared 30-minute profile matrix and its
resource-envelope assessment can support the repository's SCALE-001 capacity decision.

## Minimum provenance for empirical claims

An empirical artifact must include, either directly or through an immutable referenced run manifest:

- source revision and dirty-worktree state; a dirty source must also carry the deterministic
  `git-workspace-fingerprint-v1` digest and included-path count so `commit + dirty=true` cannot stand
  for multiple incompatible source snapshots;
- run and manifest IDs;
- scenario, cohort, initial conditions, and planner variant;
- seed and stochastic policy;
- model/provider and prompt-policy configuration;
- start/end simulated time, completed cycles, and wall-clock window;
- metric implementation and aggregation versions;
- source event/trace windows and integrity checks;
- failures, fallbacks, exclusions, and known limitations.

Comparative claims additionally require held-constant checks, complete treatment cells, repetition and
uncertainty reporting, and an explicit account of any deviation from the paper. If the paper omits a
parameter, the repository choice must be versioned and labeled as a repository decision rather than a
paper-derived constant.

## Current claim boundary

The repository has substantial mechanism verification and executable artifact pipelines. It does not
yet contain mature runs that reproduce all reported market, stratification, trajectory, or planner-
ablation numbers. It also does not demonstrate the paper's public-deployment population scale, a
million-agent system, causal mobility effects, or a complete user-facing product. The dynamic checklist
must be consulted before making a narrower claim, because this boundary changes as evidence is added.
