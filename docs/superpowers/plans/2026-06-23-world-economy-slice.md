# World Economy Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect production and AMM trading to the server-authoritative world command/event/projection loop.

**Architecture:** Keep `economy` as the source of truth for production constraints and AMM math. `world` orchestrates command payload validation, calls those pure rules, emits immutable events, and rebuilds agent and market projections from event replay.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, `@aivilization/sim-core`, `@aivilization/economy`, `@aivilization/memory`, `@aivilization/society`, `@aivilization/world`.

---

## Scope

This plan extends the existing `@aivilization/world` vertical slice from `docs/superpowers/plans/2026-06-23-world-command-slice.md`.

It covers:

- Market projection state for AMM pools and money supply.
- Replay support for `CommodityProduced` and `TradeExecuted`.
- `AgentProduce` command handling through `economy.planProduction`.
- `AgentTrade` command handling through `economy.buyFromPool` and `economy.sellToPool`.
- Rejection events and failed STM records for infeasible production and trades.
- Dispatcher routing for `AgentProduce` and `AgentTrade`.

It does not cover order books, multi-agent bilateral exchange, market fees, API endpoints, UI panels, or long-run market validation reports.

## File Structure

- Modify `packages/world/src/events.ts`: add `CommodityProducedPayload` and `TradeExecutedPayload`.
- Modify `packages/world/src/projection.ts`: add market pools and money supply to `WorldProjection`, apply commodity and trade events.
- Modify `packages/world/src/projection.test.ts`: add replay tests for production and trade events.
- Modify `packages/world/src/commands.ts`: add `AgentProducePayload`, `AgentTradePayload`, and guards.
- Modify `packages/world/src/agentActions.ts`: add production/trade policies, handlers, and dispatcher routing.
- Modify `packages/world/src/agentActions.test.ts`: add command handler tests.
- Modify `docs/superpowers/plans/2026-06-23-world-economy-slice.md`: track implementation status.

## Tasks

### Task 1: Market Projection Events

**Files:**

- Modify: `packages/world/src/events.ts`
- Modify: `packages/world/src/projection.ts`
- Modify: `packages/world/src/projection.test.ts`

- [x] Write failing tests for replaying production and trade events:

```ts
import { createAmmPool } from '@aivilization/economy';
import { asAgentId, createEventEnvelope, replayEvents } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import { applyWorldEvent, createWorldProjection } from './index';

describe('world economy projection', () => {
  test('replays commodity production into inventory and physiology state', () => {
    const initial = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 100, satiety: 80, health: 100 },
          educationScore: 0,
          balance: 0,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
      ],
    });

    const events = [
      createEventEnvelope({
        id: 'event-produced',
        simulationId: 'sim-1',
        commandId: 'command-produce',
        type: 'CommodityProduced',
        payload: {
          agentId: asAgentId('agent-1'),
          produced: { Apple: 2 },
          consumedInputs: {},
          energyCost: 4,
          satietyCost: 0,
          laborSeconds: 0.2,
        },
        occurredAt: 10,
        sequence: 1,
      }),
    ];

    const projection = replayEvents(initial, events, applyWorldEvent);
    expect(projection.agents['agent-1']?.inventory).toEqual({ Apple: 2 });
    expect(projection.agents['agent-1']?.physiology.energy).toBe(96);
  });

  test('replays AMM trade into agent balance, inventory, pool state, and money supply', () => {
    const initial = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 100, satiety: 80, health: 100 },
          educationScore: 0,
          balance: 1000,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
      ],
      marketPools: [
        createAmmPool({ commodity: 'Apple', commodityReserve: 100, currencyReserve: 1000 }),
      ],
      moneySupply: 1000,
    });

    const events = [
      createEventEnvelope({
        id: 'event-trade',
        simulationId: 'sim-1',
        commandId: 'command-trade',
        type: 'TradeExecuted',
        payload: {
          agentId: asAgentId('agent-1'),
          side: 'buy',
          commodityName: 'Apple',
          commodityQuantity: 10,
          currencyQuantity: 111.1111111111,
          poolAfter: createAmmPool({
            commodity: 'Apple',
            commodityReserve: 90,
            currencyReserve: 1111.1111111111,
          }),
          moneySupplyDelta: -111.1111111111,
        },
        occurredAt: 20,
        sequence: 1,
      }),
    ];

    const projection = replayEvents(initial, events, applyWorldEvent);
    expect(projection.agents['agent-1']?.inventory).toEqual({ Apple: 10 });
    expect(projection.agents['agent-1']?.balance).toBeCloseTo(888.8888888889);
    expect(projection.marketPools['Apple']?.commodityReserve).toBe(90);
    expect(projection.moneySupply).toBeCloseTo(888.8888888889);
  });
});
```

- [x] Run `pnpm --filter @aivilization/world test` and confirm event payload support is missing.
- [x] Implement market projection state and replay logic for `CommodityProduced` and `TradeExecuted`.
- [x] Run `pnpm --filter @aivilization/world test` and `pnpm --filter @aivilization/world typecheck`.
- [x] Commit with `git commit -m "feat: add world economy projection events"`.

### Task 2: Produce Command Handler

**Files:**

- Modify: `packages/world/src/commands.ts`
- Modify: `packages/world/src/agentActions.ts`
- Modify: `packages/world/src/agentActions.test.ts`

- [x] Write failing tests for `AgentProduce` success and rejection:

```ts
import { asAgentId, createCommandEnvelope } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import { applyWorldEvent, createWorldProjection, handleAgentProduceCommand } from './index';

describe('agent produce command handling', () => {
  test('AgentProduce uses production rules and records produced commodities', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 100, satiety: 80, health: 100 },
          educationScore: 0,
          balance: 0,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
      ],
    });

    const events = handleAgentProduceCommand({
      command: createCommandEnvelope({
        id: 'command-produce',
        simulationId: 'sim-1',
        actorId: 'agent-1',
        type: 'AgentProduce',
        payload: { commodityName: 'Apple', quantity: 2, availableLaborSeconds: 1 },
        issuedAt: 50,
      }),
      projection,
      nextSequence: 1,
    });

    expect(events.map((event) => event.type)).toEqual([
      'CommodityProduced',
      'ShortTermMemoryRecorded',
    ]);

    const updated = events.reduce(applyWorldEvent, projection);
    expect(updated.agents['agent-1']?.inventory).toEqual({ Apple: 2 });
    expect(updated.agents['agent-1']?.physiology.energy).toBe(96);
  });

  test('AgentProduce rejects missing inputs without changing projection state', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 100, satiety: 80, health: 100 },
          educationScore: 0,
          balance: 0,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
      ],
    });

    const events = handleAgentProduceCommand({
      command: createCommandEnvelope({
        id: 'command-produce',
        simulationId: 'sim-1',
        actorId: 'agent-1',
        type: 'AgentProduce',
        payload: { commodityName: 'Bread', quantity: 1, availableLaborSeconds: 10 },
        issuedAt: 50,
      }),
      projection,
      nextSequence: 1,
    });

    expect(events.map((event) => event.type)).toEqual([
      'ActionRejected',
      'ShortTermMemoryRecorded',
    ]);
    expect(events[0]?.payload).toMatchObject({ commandType: 'AgentProduce' });
    expect(events[1]).toMatchObject({ payload: { record: { status: 'failed' } } });
  });
});
```

- [x] Run `pnpm --filter @aivilization/world test` and confirm produce APIs are missing.
- [x] Implement `assertAgentProducePayload` and `handleAgentProduceCommand`.
- [x] Run `pnpm --filter @aivilization/world test` and `pnpm --filter @aivilization/world typecheck`.
- [x] Commit with `git commit -m "feat: add produce command handler"`.

### Task 3: Trade Command Handler And Dispatcher

**Files:**

- Modify: `packages/world/src/commands.ts`
- Modify: `packages/world/src/agentActions.ts`
- Modify: `packages/world/src/agentActions.test.ts`

- [ ] Write failing tests for `AgentTrade` and dispatcher routing:

```ts
import { createAmmPool } from '@aivilization/economy';
import { asAgentId, createCommandEnvelope } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import {
  applyWorldEvent,
  createWorldProjection,
  dispatchWorldCommand,
  handleAgentTradeCommand,
} from './index';

describe('agent trade command handling', () => {
  test('AgentTrade buy updates balance, inventory, AMM pool, money supply, and STM', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 100, satiety: 80, health: 100 },
          educationScore: 0,
          balance: 1000,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
      ],
      marketPools: [
        createAmmPool({ commodity: 'Apple', commodityReserve: 100, currencyReserve: 1000 }),
      ],
      moneySupply: 1000,
    });

    const events = handleAgentTradeCommand({
      command: createCommandEnvelope({
        id: 'command-trade',
        simulationId: 'sim-1',
        actorId: 'agent-1',
        type: 'AgentTrade',
        payload: { side: 'buy', commodityName: 'Apple', quantity: 10 },
        issuedAt: 60,
      }),
      projection,
      nextSequence: 1,
    });

    expect(events.map((event) => event.type)).toEqual(['TradeExecuted', 'ShortTermMemoryRecorded']);

    const updated = events.reduce(applyWorldEvent, projection);
    expect(updated.agents['agent-1']?.inventory).toEqual({ Apple: 10 });
    expect(updated.agents['agent-1']?.balance).toBeCloseTo(888.8888888889);
    expect(updated.marketPools['Apple']?.commodityReserve).toBe(90);
  });

  test('dispatchWorldCommand routes AgentTrade commands through the world handler', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 100, satiety: 80, health: 100 },
          educationScore: 0,
          balance: 1000,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
      ],
      marketPools: [
        createAmmPool({ commodity: 'Apple', commodityReserve: 100, currencyReserve: 1000 }),
      ],
      moneySupply: 1000,
    });

    const events = dispatchWorldCommand({
      command: createCommandEnvelope({
        id: 'command-trade',
        simulationId: 'sim-1',
        actorId: 'agent-1',
        type: 'AgentTrade',
        payload: { side: 'buy', commodityName: 'Apple', quantity: 1 },
        issuedAt: 60,
      }),
      projection,
      policies: {
        satietyRecoveryByCommodity: {},
        maxSatiety: 100,
        wageCalculator: () => 0,
        laborCost: { energyCostPerHour: 10, satietyCostPerHour: 10 },
        criticalThresholds: { energy: 1, health: 1 },
      },
      nextSequence: 1,
    });

    expect(events.map((event) => event.type)).toEqual(['TradeExecuted', 'ShortTermMemoryRecorded']);
  });
});
```

- [ ] Add tests proving `AgentTrade` rejects insufficient balance on buy and insufficient inventory on sell.
- [ ] Run `pnpm --filter @aivilization/world test` and confirm trade APIs are missing.
- [ ] Implement `assertAgentTradePayload`, `handleAgentTradeCommand`, and dispatcher route.
- [ ] Run `pnpm --filter @aivilization/world test`, `pnpm --filter @aivilization/world typecheck`, `pnpm check`, and `pnpm build`.
- [ ] Commit with `git commit -m "feat: add trade command dispatcher"`.

## Self-Review

- Spec coverage: This plan covers production constraints, non-substitutable inputs, AMM trading, money supply coupling, replayable market projections, rejection observability, and STM writes.
- Red-flag scan: No forbidden marker strings remain in this plan.
- Type consistency: Planned tests use the exported world functions and existing economy rule names consistently.
