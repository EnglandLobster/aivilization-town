# AIvilization Town Design

## Purpose

Build a new large-scale AI town simulation/game that faithfully reconstructs the capabilities
described in `AIvilization v0: Toward Large-Scale Artificial Social Simulation with a Unified
Agent Architecture and Adaptive Agent Profiles` while keeping enough architectural headroom for a
long-lived product.

This is a complete rebuild. The older `a16z-ai-town` and `generative_agents` projects are reference
material only. Their code organization, runtime model, and persistence choices are not inherited.

## Source Scope

Primary source:

- Local paper extraction: `/Users/bytedance/AgentDev/Ai-Town/AIVILIZATION-20260623201223/AIVILIZATION.md`
- arXiv record: `https://arxiv.org/abs/2602.10429`
- arXiv HTML: `https://arxiv.org/html/2602.10429v1`

Reference-only source material:

- `/Users/bytedance/AgentDev/Ai-Town/a16z-ai-town`
- `/Users/bytedance/AgentDev/Ai-Town/generative_agents`

## Non-Negotiable Product Capabilities

The system must represent these AIvilization v0 capabilities as first-class modules rather than
incidental UI behavior:

1. Large-scale artificial society with autonomous agents and human steering.
2. Branch-Thinking Planner that decomposes long-term objectives into parallel branches.
3. Contextual prioritization over active branch subtasks using internal and external state.
4. Domain micro-planners that translate selected subtasks into executable atomic actions.
5. Global synthesis that resolves cross-branch conflicts over time, energy, money, inventory, and
   goal priority.
6. Action Simulator that performs pre-execution validation and counterfactual rollout.
7. Local repair for minor failures and adaptive re-planning for repeated failures or major context
   shifts.
8. Adaptive Agent Profile with dynamic state, short-term memory, and long-term memory.
9. Dual-process memory: high-frequency execution traces in STM and slower semantic consolidation in
   LTM.
10. Social interaction that updates relation, attitude, habits, values, personality, and social
    records.
11. Human-in-the-loop strategic steering through long-horizon objectives.
12. Human-in-the-loop reactive steering through immediate commands.
13. Resource-constrained sandbox economy with physiological survival costs.
14. Energy, satiety, health, education score, currency balance, residential tier, job, and inventory
    as core agent state.
15. Commodity catalog, production recipes, non-substitutable input requirements, and stochastic
    rewards.
16. Automated market maker pricing with constant-product pools, slippage, and money supply coupling.
17. Food, non-food, and overall price-change indices for macroeconomic signals.
18. Education accumulation and education-driven productivity.
19. Occupation tiers with residential gates, knowledge floors, dynamic eligibility thresholds,
    prerequisites, and static/dynamic wage regimes.
20. Labor-consumption feedback loop connecting work, wages, physiological depletion, and market
    demand.
21. Experiment and validation surfaces for stability, wealth stratification, heavy-tail returns,
    volatility clustering, planner ablations, and replayable agent trajectories.

## Recommended Architecture

Use a TypeScript monorepo with apps and packages. The first code milestone should establish
interfaces and tests before implementation depth.

```text
aivilization-town/
  apps/
    web/
    api/
    worker/
  packages/
    sim-core/
    economy/
    society/
    agent-runtime/
    memory/
    llm/
    content/
    observability/
```

## Package Boundaries

### `packages/sim-core`

Owns deterministic simulation mechanics:

- World clock and tick scheduling.
- Entity ids and immutable event records.
- Command validation, command ordering, and event emission.
- Replay, snapshot, and projection interfaces.
- No dependency on UI, LLM, database clients, or network APIs.

The core invariant is command/event determinism. A replay over the same initial snapshot and event
stream must reproduce the same projection.

### `packages/economy`

Owns economic rules:

- Commodity catalog and categories.
- Production recipes and hard resource constraints.
- AMM pools, buy/sell execution, reserve updates, slippage, and quoted prices.
- Price-change indices.
- Inventory valuation and net-worth calculation.
- Stochastic reward hooks with deterministic seeded randomness supplied by `sim-core`.

This package depends on `sim-core` interfaces and `content` config, but not on agents or UI.

### `packages/society`

Owns social and institutional rules:

- Education score accumulation.
- Residential tier eligibility and upgrades.
- Occupation catalog and tier rules.
- Dynamic knowledge thresholds from current population distribution.
- Static and dynamic wage calculation.
- Social relationship graph, relation labels, attitude, and interaction summaries.

This package depends on `sim-core`, `economy`, and `content`.

### `packages/agent-runtime`

Owns AIvilization-style cognition:

- Branch-Thinking Planner.
- Contextual prioritization and selection.
- Domain micro-planners.
- Global synthesis.
- Action Simulator adapter.
- Local repair and adaptive re-planning.
- Strategic steering and reactive steering routing.

The agent runtime may call `llm` for structured proposals, but it never mutates world state directly.
It returns proposed commands or repair requests that must be validated by domain rules.

### `packages/memory`

Owns memory lifecycle:

- Short-term memory records for successful actions, failed actions, observations, and command
  outcomes.
- Long-term memory profile sections: beliefs, mood, values, habits, personality, and social records.
- Consolidation jobs from STM to LTM.
- Retrieval interfaces for semantic search and recency/importance filters.
- Memory provenance, versioning, and reason-for-write metadata.

The first implementation may use an in-process store for tests, but the interfaces must support a
future durable store and vector index without changing agent-runtime contracts.

### `packages/llm`

Owns model integration:

- Provider abstraction for OpenAI-compatible and local models.
- Structured output schemas.
- Retry, timeout, token, and cost accounting.
- Tool contract serialization.
- Safety gates for prompt-injected or invalid actions.

No domain package may call a provider directly. All LLM access goes through this package.

### `packages/content`

Owns source-derived configuration:

- Commodity catalog from paper appendix.
- Activity catalog.
- Production recipes.
- Job tiers.
- Occupation catalog.
- Initial town scenario and default agent archetypes.
- Scenario presets for ablation and validation runs.

This package must keep source references close to each config table so later edits are auditable.

### `packages/observability`

Owns traces and diagnostics:

- Simulation event log formatting.
- Agent cycle trace: observed state, selected branch, candidate actions, simulator result, repair
  decision, emitted commands, and memory writes.
- Economy metrics.
- Validation report inputs.
- Debug snapshot serialization.

This is a core package, not a dashboard afterthought.

### `apps/api`

Owns external server API:

- Query projections.
- Submit strategic objectives.
- Submit reactive commands.
- Start, pause, reset, and replay simulations.
- Stream events or projections to clients.

### `apps/worker`

Owns asynchronous runtime:

- Simulation tick loop.
- Agent planning cycles.
- Memory consolidation jobs.
- Market metric aggregation.
- Experiment and ablation runners.

### `apps/web`

Owns user-facing gameplay and inspection:

- Town map and agents.
- Agent profile panel.
- Planner and memory trace panel.
- Market and commodity dashboard.
- Occupation and education dashboard.
- Human steering controls.
- Replay and experiment views.

The web app reads projections and sends commands. It does not own simulation rules.

## Large Game Backend Requirements

The new project is a full rebuild. The two older repositories are references for product intent and
paper lineage only; their architecture must not be inherited as the foundation.

AIvilization Town should be built as a server-authoritative simulation backend from the first
milestone:

- All world mutations flow through validated commands and immutable events.
- API, worker, web UI, and LLM providers never mutate projections or domain state directly.
- Event streams are scoped by simulation id and partition key so larger worlds can later shard by
  town, region, activity type, or agent cohort.
- Commands carry idempotency keys and expected stream versions so retries, duplicated client
  requests, and worker restarts do not create duplicate facts.
- Query views are projections rebuilt from event streams, not primary truth.
- Snapshots and replay checkpoints are first-class contracts, not later migration chores.
- Persistence starts with local event-log files and SQLite projections behind repository
  interfaces; Postgres, Redis, queue workers, object storage, and vector stores must enter through
  adapters.
- Simulation workers own ticks, agent cycles, consolidation jobs, and experiment runners. The web
  app is an observer and command surface.
- Observability is part of the backend contract: every agent cycle, simulator decision, command
  rejection, repair, memory write, and projection checkpoint must be traceable.
- LLM output is untrusted proposal data. It can create candidate plans or command drafts only after
  schema validation; domain packages decide whether those drafts become accepted commands.

## Primary Data Flow

```text
human objective / human command / scheduled tick
  -> API or worker creates Command
  -> sim-core orders and validates Command envelope
  -> domain package validates command semantics
  -> domain package emits Events
  -> projections update world, agent, market, and trace views
  -> agent-runtime observes projections
  -> agent-runtime retrieves STM/LTM context
  -> Branch-Thinking Planner proposes candidate actions
  -> Action Simulator validates or repairs actions
  -> validated candidate actions become Commands
```

## Command and Event Model

Commands express intent:

- `AgentProduce`
- `AgentTrade`
- `AgentEat`
- `AgentSleep`
- `AgentSeeDoctor`
- `AgentStudy`
- `AgentApplyJob`
- `AgentWork`
- `AgentSocialize`
- `SetLongHorizonObjective`
- `IssueReactiveCommand`
- `AdvanceSimulationTime`

Events express facts:

- `CommodityProduced`
- `TradeExecuted`
- `PhysiologyChanged`
- `EducationChanged`
- `JobApplicationSubmitted`
- `JobAssigned`
- `WagePaid`
- `SocialInteractionCompleted`
- `ShortTermMemoryRecorded`
- `LongTermMemoryConsolidated`
- `PlannerBranchUpdated`
- `ActionRejected`
- `ActionRepaired`

Commands can fail validation. Failed attempts should still be observable through trace records and,
when relevant, STM failure records.

## Memory Design

STM records are tactical and high frequency:

- Action attempted.
- Preconditions checked.
- Result status.
- Failure reason.
- Repair attempted.
- Final outcome.
- Associated command id and event ids.

LTM records are semantic and slower:

- Beliefs.
- Mood.
- Values.
- Habits.
- Personality.
- Social interaction summaries.
- Stable preferences inferred from repeated STM patterns.

Consolidation rules:

- Repeated successful action patterns may become habits.
- Repeated failure patterns may become caution rules.
- Social interactions may update relation and attitude.
- Human strategic objectives are stored as durable goal context.
- Human reactive commands enter STM immediately and may later affect LTM if repeated or significant.

## Planning Design

The Branch-Thinking Planner works in layers:

1. Strategic decomposition creates branches such as personal development, production/resource
   management, trading/market analysis, and social engagement.
2. Branch decomposition creates abstract subtasks per branch.
3. Contextual prioritization scores subtasks using agent state, market state, social state, and LTM
   profile.
4. Domain micro-planners generate concrete action sequences.
5. Global synthesis resolves conflicts and creates a final action candidate list.
6. Action Simulator validates feasibility.
7. Local repair modifies invalid actions when cheap and safe.
8. Adaptive re-planning escalates to the full planner after repeated failures or major state shifts.

## Economy Design

The economy must implement the paper's core mechanics:

- Constant-product AMM pools for each commodity.
- Buy and sell operations with slippage.
- Money supply coupling through AMM reserves.
- Food and non-food price-change ratios.
- Overall macro price index.
- Net worth from currency balance plus inventory marked at current prices.
- Production with hard constraints over materials, energy, satiety, labor time, and residential tier.
- Stochastic special rewards using deterministic seeded randomness.

## Society Design

The society layer must implement:

- Energy, satiety, and health thresholds.
- Incapacitation when critical thresholds are crossed.
- Eating, sleeping, and seeing a doctor as recovery actions.
- Study actions that increase education score over time.
- Education as both job credential and production efficiency factor.
- Occupation eligibility from residential tier and dynamic knowledge thresholds.
- Job application quotas based on residential tier.
- Static wages for lower tiers.
- Dynamic wages for higher tiers using the macro price index and effective knowledge threshold.

## Web Product Shape

The first visible product should be a workbench/game surface, not a marketing page:

- Main town viewport with agents and locations.
- Right-side selected-agent profile and memory panel.
- Bottom or side panel for market prices, inventory, jobs, education, and traces.
- Steering controls for long-term objective and immediate command.
- Simulation controls for speed, pause, replay, and scenario reset.

The UI must make internal state inspectable because the project is a simulation platform, not merely
an animated chat room.

## Extensibility Requirements

- Adding a new commodity should only require content config plus optional renderer metadata.
- Adding a new action should require a command, domain validator, event, projection update, and
  optional micro-planner support.
- Adding a new LLM provider must not touch domain packages.
- Adding a new persistence backend must not touch domain packages.
- Adding a new experiment should compose scenarios and validation metrics without changing core
  simulation logic.

## Verification Strategy

Early verification must focus on rules and boundaries:

- Unit tests for AMM invariants and slippage.
- Unit tests for production hard constraints.
- Unit tests for education thresholds and occupation eligibility.
- Unit tests for static and dynamic wage calculations.
- Unit tests for STM/LTM consolidation rules.
- Unit tests for planner repair and escalation behavior.
- Replay determinism tests for command/event streams.
- Integration tests for strategic objective and reactive command flows.
- Browser tests for key inspection panels after the web app exists.

Longer-term validation should include:

- Market stability reports.
- Heavy-tail and volatility-clustering checks from generated OHLC data.
- Wealth stratification reports by education and occupation.
- Planner ablation runs for default, without-branch, and without-objective-decomposition variants.

## Implementation Phases

### Phase 1: Architecture Skeleton

Create monorepo tooling, package boundaries, shared TypeScript config, linting, tests, and minimal
typed interfaces for commands, events, projections, and content config.

### Phase 2: Deterministic Simulation and Economy

Implement `sim-core`, commodity content, AMM, production, physiological constraints, and replay tests.

### Phase 3: Society Layer

Implement education, residential tier, occupation eligibility, job applications, wage regimes, and
labor-consumption feedback.

### Phase 4: Agent Runtime and Memory

Implement STM/LTM interfaces, deterministic rule-based planner baseline, Action Simulator, repair,
re-planning, and LLM provider abstraction.

### Phase 5: Apps

Implement API, worker, and web inspection/game surface.

### Phase 6: Fidelity and Validation

Add AIvilization scenario presets, ablation runners, market reports, profile evolution reports, and
visual polish.

## Explicit Non-Goals for the First Implementation Plan

- Do not fork either reference repository.
- Do not couple simulation rules to the web UI.
- Do not let LLM calls mutate world state directly.
- Do not start with a purely visual town that lacks the economic and cognitive substrate.
- Do not hide planner and memory internals from operators.

## Locked Initial Decisions

1. Package manager: `pnpm` workspaces.
2. Runtime language: TypeScript across apps and packages.
3. Persistence for the first runnable milestone: append-only event-log files plus SQLite
   projections behind repository interfaces. Postgres and vector stores must be supported later by
   replacing adapters, not domain code.
4. Frontend renderer: staged hybrid with a Canvas town viewport and DOM-first workbench panels.
5. Initial population presets: 25-agent smoke scenario, 100-agent default scenario, and 1000-agent
   headless stress scenario once the worker exists.
6. LLM mode for initial development: deterministic rule-based planner and mock structured LLM
   provider first. Live providers are added only after the command/event, Action Simulator, and trace
   boundaries are tested.
7. First implementation plan scope: build the monorepo skeleton and deterministic core interfaces
   before any rich UI or live model integration.
