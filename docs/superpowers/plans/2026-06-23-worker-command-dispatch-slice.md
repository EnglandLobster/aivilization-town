# Worker Command Dispatch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert agent-runtime command drafts into server-authoritative command envelopes and dispatch them through the world command/event/projection seam.

**Architecture:** `apps/worker` owns this orchestration seam because it coordinates runtime output with world execution without placing world dependencies inside `agent-runtime`. The worker remains adapter-oriented: it returns commands, emitted events, and the next projection, leaving durable event-store persistence for a later slice.

**Tech Stack:** TypeScript, pnpm workspaces, Vitest app project, sim-core command envelopes, world dispatcher/projection contracts.

---

## Scope

This slice advances the runtime-to-world execution path:

- Convert `CommandDraft` into deterministic `CommandEnvelope`.
- Preserve source, actor, simulation id, payload, issued timestamp, idempotency key, and optional expected stream version.
- Dispatch one or more command drafts through `dispatchWorldCommand`.
- Apply emitted world events with `applyWorldEvent`.
- Advance `nextSequence` across multiple drafts so event sequences cannot collide.

It does not implement a durable event log, queue retry, API submission, worker tick loop, or event-stream partition persistence. Those should compose this seam later.

## File Structure

- Modify `apps/worker/package.json`: add `@aivilization/world` dependency.
- Create `apps/worker/src/commandDispatch.ts`: draft-to-envelope conversion and draft dispatch orchestration.
- Create `apps/worker/src/commandDispatch.test.ts`: TDD coverage for envelope conversion, event dispatch, projection update, and sequence advancement.
- Modify `apps/worker/src/index.ts`: export command dispatch contracts.
- Modify this plan file as tasks complete.

## Task 1: Command Dispatch Tests

**Files:**

- Create: `apps/worker/src/commandDispatch.test.ts`
- Modify: `apps/worker/package.json`

- [ ] **Step 1: Add world dependency**

Modify `apps/worker/package.json` dependencies:

```json
{
  "dependencies": {
    "@aivilization/agent-runtime": "workspace:*",
    "@aivilization/content": "workspace:*",
    "@aivilization/memory": "workspace:*",
    "@aivilization/observability": "workspace:*",
    "@aivilization/sim-core": "workspace:*",
    "@aivilization/world": "workspace:*"
  }
}
```

- [ ] **Step 2: Write failing tests for draft conversion and world dispatch**

Create `apps/worker/src/commandDispatch.test.ts`:

```ts
import type { CommandDraft } from '@aivilization/agent-runtime';
import { createAmmPool } from '@aivilization/economy';
import { asAgentId, asSimulationId } from '@aivilization/sim-core';
import { createWorldProjection, type WorldCommandPolicies } from '@aivilization/world';
import { describe, expect, test } from 'vitest';
import { createCommandEnvelopeFromDraft, dispatchCommandDraftsToWorld } from './index';

const policies: WorldCommandPolicies = {
  satietyRecoveryByCommodity: { Bread: 15 },
  maxSatiety: 100,
  wageCalculator: () => 10,
  laborCost: { energyCostPerHour: 10, satietyCostPerHour: 10 },
  criticalThresholds: { energy: 1, health: 1 },
  sleep: { energyRecoveryPerSecond: 1, maxEnergy: 100 },
  jobApplication: {
    populationEducationScores: [0],
    quotaByResidentialTier: [1, 1, 1, 1, 1],
  },
};

function createStudyDraft(): CommandDraft {
  return {
    simulationId: asSimulationId('sim-1'),
    actorId: asAgentId('agent-1'),
    source: 'agent-runtime',
    type: 'AgentStudy',
    payload: { durationSeconds: 120, educationRatePerSecond: 0.5 },
    issuedAt: 100,
  };
}

describe('worker command dispatch seam', () => {
  test('creates deterministic command envelopes from command drafts', () => {
    const envelope = createCommandEnvelopeFromDraft({
      draft: createStudyDraft(),
      commandId: 'draft-command-1',
      idempotencyKey: 'idem-draft-command-1',
      expectedVersion: 7,
    });

    expect(envelope).toEqual({
      id: 'draft-command-1',
      simulationId: 'sim-1',
      idempotencyKey: 'idem-draft-command-1',
      actorId: 'agent-1',
      source: 'agent-runtime',
      type: 'AgentStudy',
      payload: { durationSeconds: 120, educationRatePerSecond: 0.5 },
      issuedAt: 100,
      expectedVersion: 7,
    });
  });

  test('dispatches command drafts through world handlers and applies emitted events', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 50, satiety: 80, health: 100 },
          educationScore: 10,
          balance: 100,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
      ],
    });

    const result = dispatchCommandDraftsToWorld({
      commandDrafts: [createStudyDraft()],
      projection,
      policies,
      startingSequence: 10,
      commandIdPrefix: 'draft-command',
    });

    expect(result.commands.map((command) => command.id)).toEqual(['draft-command-1']);
    expect(result.events.map((event) => [event.sequence, event.type])).toEqual([
      [10, 'EducationChanged'],
      [11, 'ShortTermMemoryRecorded'],
    ]);
    expect(result.projection.agents['agent-1']?.educationScore).toBe(70);
    expect(result.projection.memoryRecords).toHaveLength(1);
  });

  test('advances event sequence across multiple drafts without collisions', () => {
    const projection = createWorldProjection({
      agents: [
        {
          agentId: asAgentId('agent-1'),
          physiology: { energy: 50, satiety: 80, health: 100 },
          educationScore: 10,
          balance: 100,
          residentialTier: 1,
          job: null,
          inventory: {},
        },
      ],
      marketPools: [
        createAmmPool({ commodity: 'Fish', commodityReserve: 100, currencyReserve: 1000 }),
      ],
    });

    const sleepDraft: CommandDraft = {
      simulationId: asSimulationId('sim-1'),
      actorId: asAgentId('agent-1'),
      source: 'agent-runtime',
      type: 'AgentSleep',
      payload: { durationSeconds: 10 },
      issuedAt: 110,
    };

    const result = dispatchCommandDraftsToWorld({
      commandDrafts: [createStudyDraft(), sleepDraft],
      projection,
      policies,
      startingSequence: 5,
      commandIdPrefix: 'draft-command',
    });

    expect(result.commands.map((command) => command.id)).toEqual([
      'draft-command-1',
      'draft-command-2',
    ]);
    expect(result.events.map((event) => event.sequence)).toEqual([5, 6, 7, 8]);
    expect(result.projection.agents['agent-1']?.educationScore).toBe(70);
    expect(result.projection.agents['agent-1']?.physiology.energy).toBe(60);
  });
});
```

- [ ] **Step 3: Run worker tests and verify RED**

Run:

```bash
pnpm --filter @aivilization/worker test
```

Expected: FAIL because `createCommandEnvelopeFromDraft` and `dispatchCommandDraftsToWorld` do not exist.

## Task 2: Command Dispatch Implementation

**Files:**

- Create: `apps/worker/src/commandDispatch.ts`
- Modify: `apps/worker/src/index.ts`

- [ ] **Step 1: Implement draft-to-envelope conversion**

Create `createCommandEnvelopeFromDraft(input)` that calls `createCommandEnvelope` with:

- `id: input.commandId`
- `simulationId: draft.simulationId`
- `idempotencyKey: input.idempotencyKey ?? input.commandId`
- `actorId: draft.actorId`
- `source: draft.source`
- `type: draft.type`
- `payload: draft.payload`
- `issuedAt: draft.issuedAt`
- optional `expectedVersion`

- [ ] **Step 2: Implement world dispatch orchestration**

Create `dispatchCommandDraftsToWorld(input)` that:

- starts from `input.projection` and `input.startingSequence`;
- creates command ids as `${input.commandIdPrefix}-${index + 1}`;
- dispatches each envelope through `dispatchWorldCommand`;
- applies each emitted event to the current projection with `applyWorldEvent`;
- increments the next sequence by `events.length` after each draft;
- returns `{ commands, events, projection }`.

- [ ] **Step 3: Export command dispatch contracts**

Modify `apps/worker/src/index.ts`:

```ts
export * from './commandDispatch';
```

- [ ] **Step 4: Run focused verification**

Run:

```bash
pnpm --filter @aivilization/worker test
pnpm --filter @aivilization/worker typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add apps/worker/package.json apps/worker/src/commandDispatch.ts apps/worker/src/commandDispatch.test.ts apps/worker/src/index.ts
git commit -m "feat: add worker command dispatch seam"
```

## Task 3: Whole-Repo Verification

**Files:**

- Modify: `docs/superpowers/plans/2026-06-23-worker-command-dispatch-slice.md`

- [ ] Run `pnpm check`.
- [ ] Run `pnpm build`.
- [ ] Update this plan's completed checkboxes.
- [ ] Commit the final plan update.

## Acceptance Criteria

- Worker can deterministically convert runtime command drafts into sim-core command envelopes.
- Worker dispatches draft envelopes through world handlers, not direct projection mutation.
- Event sequences advance monotonically across multiple dispatched drafts.
- World projection is updated only by applying emitted world events.
- `pnpm check` and `pnpm build` pass.
