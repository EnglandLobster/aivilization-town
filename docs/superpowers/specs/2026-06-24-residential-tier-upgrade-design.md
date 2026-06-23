# Residential Tier Upgrade Design

## Purpose

Add a server-authoritative residential-tier upgrade path. The paper treats residential tier as a
core dynamic state that gates production technologies and occupations, but the current system only
stores it as a static agent field. Without an upgrade command, high-tier commodity chains such as
Chip production cannot emerge from long-horizon planning.

## Source Grounding

AIvilization v0 describes residential tier as a discrete status gate for production and occupation
eligibility, and frames upward mobility as an intertemporal trade-off among material investment,
education, and access constraints. The paper does not provide a fixed residential-upgrade cost table,
so this slice keeps costs policy-driven instead of inventing hard-coded economics.

## Design Goals

- Make residential-tier changes command/event sourced, not direct projection mutation.
- Keep upgrade eligibility in `@aivilization/society` as a pure policy evaluator.
- Keep world command handling in `@aivilization/world`.
- Support future scenario/content adapters by injecting upgrade costs through
  `WorldCommandPolicies`.
- Consume currency and inventory atomically with the tier upgrade event.
- Preserve observability through rejection events and STM records.

## Proposed Architecture

`@aivilization/society` adds:

```ts
export type ResidentialTierUpgradePolicy = {
  readonly maxResidentialTier?: number;
  readonly costs: readonly ResidentialTierUpgradeCost[];
};
```

The evaluator accepts only sequential upgrades (`current + 1`). That prevents action proposals from
skipping infrastructure progression and keeps future multi-step planners honest.

`@aivilization/world` adds:

- `AgentUpgradeResidentialTier` command type.
- `AgentUpgradeResidentialTierPayload`.
- `ResidentialTierUpgraded` event.
- Projection replay that updates `residentialTier`, subtracts balance, and consumes inventory.
- Dispatcher routing through `dispatchWorldCommand`.

## Out Of Scope

- Canonical worker domain runtime for proactively choosing upgrades.
- Scenario-derived default cost tables.
- UI/API endpoints.
- Retrofitting occupation prerequisite-commodity consumption.
