# World Command Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first server-authoritative command-to-event-to-projection vertical slice for agent actions.

**Architecture:** Add a `packages/world` domain-orchestration package that depends on `sim-core`, `economy`, `society`, and `memory`. `sim-core` stays generic, `agent-runtime` still only produces command drafts, and `world` validates command semantics, emits immutable events, and rebuilds projections from those events.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, `@aivilization/sim-core`, `@aivilization/economy`, `@aivilization/society`, `@aivilization/memory`.

---

## Scope

This plan implements the first backend vertical slice from `docs/superpowers/specs/2026-06-23-aivilization-town-design.md`.

It covers:

- A new `@aivilization/world` package for world projections and command handlers.
- Agent projection state: physiology, education score, balance, residential tier, job, and inventory.
- Event application for `InventoryChanged`, `PhysiologyChanged`, `EducationChanged`, `WagePaid`, `ShortTermMemoryRecorded`, and `ActionRejected`.
- `AgentEat` command handling with inventory consumption, satiety recovery, event emission, and STM writes.
- `AgentStudy` command handling with education accumulation and STM writes.
- `AgentWork` command handling with wage payment, physiology depletion, rejection on incapacitation, and STM writes.
- A dispatcher that routes accepted command envelopes to handlers.

It does not cover production, trade, sleep, doctor recovery, job applications, social interaction, durable storage, API endpoints, or UI.

## File Structure

- Create `packages/world/package.json`: workspace package manifest.
- Create `packages/world/tsconfig.json`: TypeScript config.
- Create `packages/world/vitest.config.ts`: Vitest workspace aliases.
- Create `packages/world/src/index.ts`: public exports.
- Create `packages/world/src/projection.ts`: world projection types and event applier.
- Create `packages/world/src/projection.test.ts`: projection replay tests.
- Create `packages/world/src/events.ts`: world event payload types and envelope helpers.
- Create `packages/world/src/commands.ts`: action command payload types and dispatcher.
- Create `packages/world/src/agentActions.ts`: `AgentEat`, `AgentStudy`, and `AgentWork` handlers.
- Create `packages/world/src/agentActions.test.ts`: command handler tests.
- Modify `packages/sim-core/src/event.ts`: add `InventoryChanged` to `CoreEventType`.
- Modify `tsconfig.base.json`: add `@aivilization/world` alias.
- Modify `vitest.workspace-aliases.ts`: add `@aivilization/world` alias.
- Modify `pnpm-lock.yaml`: add new workspace package dependencies after `pnpm install --lockfile-only`.

## Tasks

### Task 1: World Package And Projection

**Files:**

- Create: `packages/world/package.json`
- Create: `packages/world/tsconfig.json`
- Create: `packages/world/vitest.config.ts`
- Create: `packages/world/src/index.ts`
- Create: `packages/world/src/projection.ts`
- Create: `packages/world/src/projection.test.ts`
- Create: `packages/world/src/events.ts`
- Modify: `packages/sim-core/src/event.ts`
- Modify: `tsconfig.base.json`
- Modify: `vitest.workspace-aliases.ts`
- Modify: `pnpm-lock.yaml`

- [x] Write failing tests for projection event replay:

```ts
import { asAgentId, createEventEnvelope, replayEvents } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import { applyWorldEvent, createWorldProjection } from './index';

describe('world projection', () => {
  test('replays agent state and memory events deterministically', () => {
    const initial = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 100, satiety: 40, health: 100 },
          educationScore: 10,
          balance: 50,
          residentialTier: 1,
          job: 'Cleaner',
          inventory: { Bread: 2 },
        },
      ],
    });

    const events = [
      createEventEnvelope({
        id: 'event-2',
        simulationId: 'sim-1',
        commandId: 'command-1',
        type: 'PhysiologyChanged',
        payload: {
          agentId: asAgentId('agent-1'),
          previous: { energy: 100, satiety: 40, health: 100 },
          next: { energy: 95, satiety: 55, health: 100 },
          reason: 'eat',
        },
        occurredAt: 10,
        sequence: 2,
      }),
      createEventEnvelope({
        id: 'event-1',
        simulationId: 'sim-1',
        commandId: 'command-1',
        type: 'InventoryChanged',
        payload: {
          agentId: asAgentId('agent-1'),
          itemName: 'Bread',
          delta: -1,
          reason: 'eat',
        },
        occurredAt: 10,
        sequence: 1,
      }),
    ];

    const projection = replayEvents(initial, events, applyWorldEvent);
    expect(projection.agents['agent-1']?.inventory).toEqual({ Bread: 1 });
    expect(projection.agents['agent-1']?.physiology.satiety).toBe(55);
  });
});
```

- [x] Run `pnpm --filter @aivilization/world test` and confirm the package or APIs are missing.
- [x] Scaffold the package, add workspace aliases, add `InventoryChanged` event type, and implement projection event application.
- [x] Run `pnpm install --lockfile-only`.
- [x] Run `pnpm --filter @aivilization/world test` and `pnpm --filter @aivilization/world typecheck`.
- [x] Commit with `git commit -m "feat: add world projection package"`.

### Task 2: Eat And Study Command Handlers

**Files:**

- Create: `packages/world/src/commands.ts`
- Create: `packages/world/src/agentActions.ts`
- Create: `packages/world/src/agentActions.test.ts`
- Modify: `packages/world/src/index.ts`

- [x] Write failing tests for `AgentEat` and `AgentStudy`:

```ts
import { asAgentId, createCommandEnvelope } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import { createWorldProjection, handleAgentEatCommand, handleAgentStudyCommand } from './index';

describe('agent action command handlers', () => {
  test('AgentEat consumes inventory, restores satiety, and records STM', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 100, satiety: 40, health: 100 },
          educationScore: 10,
          balance: 50,
          residentialTier: 1,
          job: 'Cleaner',
          inventory: { Bread: 2 },
        },
      ],
    });

    const events = handleAgentEatCommand({
      command: createCommandEnvelope({
        id: 'command-eat',
        simulationId: 'sim-1',
        actorId: 'agent-1',
        type: 'AgentEat',
        payload: { commodityName: 'Bread', quantity: 1 },
        issuedAt: 10,
      }),
      projection,
      satietyRecoveryByCommodity: { Bread: 15 },
      maxSatiety: 100,
      nextSequence: 1,
    });

    expect(events.map((event) => event.type)).toEqual([
      'InventoryChanged',
      'PhysiologyChanged',
      'ShortTermMemoryRecorded',
    ]);
    expect(events[1]?.payload).toMatchObject({
      agentId: 'agent-1',
      next: { energy: 100, satiety: 55, health: 100 },
      reason: 'eat',
    });
  });

  test('AgentStudy increases education and records STM', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 100, satiety: 100, health: 100 },
          educationScore: 10,
          balance: 50,
          residentialTier: 1,
          job: 'Cleaner',
          inventory: {},
        },
      ],
    });

    const events = handleAgentStudyCommand({
      command: createCommandEnvelope({
        id: 'command-study',
        simulationId: 'sim-1',
        actorId: 'agent-1',
        type: 'AgentStudy',
        payload: { durationSeconds: 120, educationRatePerSecond: 0.5 },
        issuedAt: 20,
      }),
      projection,
      nextSequence: 1,
    });

    expect(events.map((event) => event.type)).toEqual([
      'EducationChanged',
      'ShortTermMemoryRecorded',
    ]);
    expect(events[0]?.payload).toMatchObject({
      agentId: 'agent-1',
      previousEducationScore: 10,
      nextEducationScore: 70,
    });
  });
});
```

- [x] Add a failing test proving invalid `AgentEat` emits `ActionRejected` and failed STM instead of mutating inventory.
- [x] Run `pnpm --filter @aivilization/world test` and confirm handler APIs are missing.
- [x] Implement typed command payloads, payload guards, event emission helpers, and handlers for eat and study.
- [x] Run `pnpm --filter @aivilization/world test` and `pnpm --filter @aivilization/world typecheck`.
- [x] Commit with `git commit -m "feat: add eat and study command handlers"`.

### Task 3: Work Command And Dispatcher

**Files:**

- Modify: `packages/world/src/commands.ts`
- Modify: `packages/world/src/agentActions.ts`
- Modify: `packages/world/src/agentActions.test.ts`
- Modify: `packages/world/src/index.ts`

- [x] Write failing tests for `AgentWork` and dispatcher routing:

```ts
import { asAgentId, createCommandEnvelope } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import { createWorldProjection, dispatchWorldCommand, handleAgentWorkCommand } from './index';

describe('agent work command handling', () => {
  test('AgentWork pays wages, depletes physiology, and records STM', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 100, satiety: 80, health: 100 },
          educationScore: 10,
          balance: 50,
          residentialTier: 1,
          job: 'Cleaner',
          inventory: {},
        },
      ],
    });

    const events = handleAgentWorkCommand({
      command: createCommandEnvelope({
        id: 'command-work',
        simulationId: 'sim-1',
        actorId: 'agent-1',
        type: 'AgentWork',
        payload: { occupationName: 'Cleaner', laborSeconds: 3600 },
        issuedAt: 30,
      }),
      projection,
      wageCalculator: () => 300,
      laborCost: { energyCostPerHour: 10, satietyCostPerHour: 20 },
      criticalThresholds: { energy: 1, health: 1 },
      nextSequence: 1,
    });

    expect(events.map((event) => event.type)).toEqual([
      'WagePaid',
      'PhysiologyChanged',
      'ShortTermMemoryRecorded',
    ]);
    expect(events[0]?.payload).toMatchObject({ agentId: 'agent-1', amount: 300 });
    expect(events[1]?.payload).toMatchObject({
      next: { energy: 90, satiety: 60, health: 100 },
    });
  });

  test('dispatchWorldCommand routes AgentStudy commands through the world handler', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 100, satiety: 100, health: 100 },
          educationScore: 10,
          balance: 50,
          residentialTier: 1,
          job: 'Cleaner',
          inventory: {},
        },
      ],
    });

    const events = dispatchWorldCommand({
      command: createCommandEnvelope({
        id: 'command-study',
        simulationId: 'sim-1',
        actorId: 'agent-1',
        type: 'AgentStudy',
        payload: { durationSeconds: 10, educationRatePerSecond: 1 },
        issuedAt: 40,
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

    expect(events.map((event) => event.type)).toEqual([
      'EducationChanged',
      'ShortTermMemoryRecorded',
    ]);
  });
});
```

- [x] Add a failing test proving incapacitated agents cannot work and receive `ActionRejected` plus failed STM only.
- [x] Run `pnpm --filter @aivilization/world test` and confirm work/dispatcher APIs are missing.
- [x] Implement `WorldCommandPolicies`, `dispatchWorldCommand`, and `handleAgentWorkCommand`.
- [x] Run `pnpm --filter @aivilization/world test`, `pnpm --filter @aivilization/world typecheck`, `pnpm check`, and `pnpm build`.
- [x] Commit with `git commit -m "feat: add work command dispatcher"`.

## Self-Review

- Spec coverage: This plan covers the first server-authoritative command/event slice, replayable projections, action rejection observability, STM writes, eating, studying, and work wage/physiology coupling.
- Red-flag scan: No forbidden marker strings remain in this plan.
- Type consistency: Planned tests consistently use `createWorldProjection`, `applyWorldEvent`, `handleAgentEatCommand`, `handleAgentStudyCommand`, `handleAgentWorkCommand`, and `dispatchWorldCommand`.
