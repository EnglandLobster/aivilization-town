# Worker Steering Ingress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect `SetLongHorizonObjective` and `IssueReactiveCommand` command envelopes to the worker-side memory/runtime orchestration layer.

**Architecture:** `apps/worker` owns the ingestion seam because it coordinates repositories and agent-runtime routes without becoming a domain rule engine. Strategic steering updates durable intention state; reactive steering invokes the lightweight runtime route and persists returned STM records.

**Tech Stack:** TypeScript, pnpm workspaces, Vitest workspace projects, in-memory repository adapters for tests.

---

## Scope

This slice turns existing steering primitives into an executable worker boundary:

- `SetLongHorizonObjective` command envelopes update `AgentIntentionRepository`.
- `IssueReactiveCommand` command envelopes invoke `runReactiveSteeringRoute`.
- Reactive command STM receipt/outcome records are appended through `ShortTermMemoryRepository`.
- The worker returns command drafts for downstream command submission, but does not mutate world state.
- App-level worker tests become part of the root Vitest workspace.

It does not implement HTTP endpoints, durable database adapters, worker tick loops, or actual world command dispatch. Those should compose this ingress boundary later.

## File Structure

- Modify `vitest.config.ts`: include app-level Vitest projects.
- Create `apps/worker/vitest.config.ts`: worker test project with workspace aliases.
- Modify `apps/worker/package.json`: add `test` script and `@aivilization/memory` dependency.
- Create `apps/worker/src/steering.ts`: worker steering payload validation and orchestration.
- Create `apps/worker/src/steering.test.ts`: TDD coverage for strategic and reactive steering ingress.
- Modify `apps/worker/src/index.ts`: export steering contracts.
- Modify this plan file as tasks complete.

## Task 1: Worker Test Project

**Files:**

- Modify: `vitest.config.ts`
- Create: `apps/worker/vitest.config.ts`
- Modify: `apps/worker/package.json`

- [ ] **Step 1: Add worker Vitest project config**

Create `apps/worker/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import { workspaceAliases } from '../../vitest.workspace-aliases';

export default defineConfig({
  resolve: {
    alias: workspaceAliases,
  },
  test: {
    environment: 'node',
  },
});
```

- [ ] **Step 2: Include app tests in root Vitest workspace**

Modify `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/*/vitest.config.ts', 'apps/*/vitest.config.ts'],
  },
});
```

- [ ] **Step 3: Add worker test script and memory dependency**

Modify `apps/worker/package.json`:

```json
{
  "scripts": {
    "build": "tsup src/index.ts --format esm",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@aivilization/agent-runtime": "workspace:*",
    "@aivilization/content": "workspace:*",
    "@aivilization/memory": "workspace:*",
    "@aivilization/observability": "workspace:*",
    "@aivilization/sim-core": "workspace:*"
  }
}
```

- [ ] **Step 4: Run worker test command**

Run:

```bash
pnpm --filter @aivilization/worker test
```

Expected: PASS with no tests found or no test files after Vitest project initialization. If Vitest treats no tests as failure, continue after adding Task 2 tests.

- [ ] **Step 5: Commit test project setup**

Run:

```bash
git add vitest.config.ts apps/worker/vitest.config.ts apps/worker/package.json
git commit -m "test: add worker vitest project"
```

## Task 2: Steering Ingress Tests

**Files:**

- Create: `apps/worker/src/steering.test.ts`

- [ ] **Step 1: Write failing tests for strategic and reactive steering ingress**

Create `apps/worker/src/steering.test.ts`:

```ts
import {
  InMemoryAgentIntentionRepository,
  InMemoryShortTermMemoryRepository,
} from '@aivilization/memory';
import { createCommandEnvelope } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import { handleWorkerSteeringCommand } from './index';

describe('worker steering ingress', () => {
  test('persists SetLongHorizonObjective as agent intention state', async () => {
    const intentionRepository = new InMemoryAgentIntentionRepository();
    const shortTermMemoryRepository = new InMemoryShortTermMemoryRepository();
    const command = createCommandEnvelope({
      id: 'cmd-objective-study',
      simulationId: 'sim-1',
      actorId: 'agent-1',
      source: 'human',
      type: 'SetLongHorizonObjective',
      payload: {
        objectiveId: 'objective-study',
        statement: 'Study before high-tech production.',
        priority: 2,
        affinityTags: ['study', 'education'],
      },
      issuedAt: 100,
    });

    const result = await handleWorkerSteeringCommand({
      command,
      intentionRepository,
      shortTermMemoryRepository,
      localizedPlanners: [],
      simulate: ({ action }) => ({ status: 'accepted', action }),
    });

    await expect(intentionRepository.getOrCreate(command.actorId!)).resolves.toMatchObject({
      activeObjective: {
        id: 'objective-study',
        statement: 'Study before high-tech production.',
        priority: 2,
        source: 'human',
        affinityTags: ['study', 'education'],
        createdAt: 100,
        updatedAt: 100,
      },
    });
    expect(result).toMatchObject({
      kind: 'long-horizon-objective-set',
      commandDrafts: [],
      shortTermMemoryRecords: [],
    });
  });

  test('routes IssueReactiveCommand through runtime and appends STM records', async () => {
    const intentionRepository = new InMemoryAgentIntentionRepository();
    const shortTermMemoryRepository = new InMemoryShortTermMemoryRepository();
    const command = createCommandEnvelope({
      id: 'cmd-reactive-buy-fish',
      simulationId: 'sim-1',
      actorId: 'agent-1',
      source: 'human',
      type: 'IssueReactiveCommand',
      payload: {
        reactiveCommandId: 'reactive-buy-fish',
        summary: 'buy 10 fish now',
        tags: ['trade', 'fish'],
      },
      issuedAt: 200,
    });

    const result = await handleWorkerSteeringCommand({
      command,
      intentionRepository,
      shortTermMemoryRepository,
      localizedPlanners: [
        {
          domain: 'trade',
          supports: ({ summary }) => summary.includes('fish'),
          propose: () => [
            {
              id: 'buy-fish',
              description: 'buy 10 fish',
              commandType: 'AgentTrade',
              payload: { side: 'buy', commodityName: 'Fish', quantity: 10 },
            },
          ],
        },
      ],
      simulate: ({ action }) => ({ status: 'accepted', action }),
    });

    expect(result.kind).toBe('reactive-command-routed');
    expect(result.commandDrafts).toHaveLength(1);
    await expect(
      shortTermMemoryRepository.retrieve({
        agentId: command.actorId!,
        kinds: ['human-command'],
        requiredTags: ['reactive'],
        limit: 10,
      }),
    ).resolves.toHaveLength(2);
  });

  test('rejects steering commands without an actor agent', async () => {
    const command = createCommandEnvelope({
      id: 'cmd-objective-no-actor',
      simulationId: 'sim-1',
      source: 'human',
      type: 'SetLongHorizonObjective',
      payload: { statement: 'Study.' },
      issuedAt: 100,
    });

    await expect(
      handleWorkerSteeringCommand({
        command,
        intentionRepository: new InMemoryAgentIntentionRepository(),
        shortTermMemoryRepository: new InMemoryShortTermMemoryRepository(),
        localizedPlanners: [],
        simulate: ({ action }) => ({ status: 'accepted', action }),
      }),
    ).rejects.toThrow(/requires actorId/);
  });
});
```

- [ ] **Step 2: Run worker tests and verify RED**

Run:

```bash
pnpm --filter @aivilization/worker test
```

Expected: FAIL because `handleWorkerSteeringCommand` does not exist.

## Task 3: Steering Ingress Implementation

**Files:**

- Create: `apps/worker/src/steering.ts`
- Modify: `apps/worker/src/index.ts`

- [ ] **Step 1: Implement payload validation and command routing**

Create `apps/worker/src/steering.ts` with:

```ts
export type WorkerSteeringResult =
  | {
      readonly kind: 'long-horizon-objective-set';
      readonly intentionState: AgentIntentionState;
      readonly commandDrafts: readonly CommandDraft[];
      readonly shortTermMemoryRecords: readonly ShortTermMemoryRecord[];
    }
  | {
      readonly kind: 'reactive-command-routed';
      readonly routeResult: ReactiveSteeringResult;
      readonly commandDrafts: readonly CommandDraft[];
      readonly shortTermMemoryRecords: readonly ShortTermMemoryRecord[];
    };
```

Implement `handleWorkerSteeringCommand(input)`:

- require `command.actorId`;
- route `SetLongHorizonObjective` to `intentionRepository.setObjective`;
- route `IssueReactiveCommand` to `runReactiveSteeringRoute`;
- append `routeResult.shortTermMemoryRecords` through `shortTermMemoryRepository.appendMany`;
- reject unsupported command types with a clear error.

- [ ] **Step 2: Export steering contracts**

Modify `apps/worker/src/index.ts`:

```ts
export * from './steering';
```

- [ ] **Step 3: Run focused verification**

Run:

```bash
pnpm --filter @aivilization/worker test
pnpm --filter @aivilization/worker typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

Run:

```bash
git add apps/worker/src/steering.ts apps/worker/src/steering.test.ts apps/worker/src/index.ts
git commit -m "feat: add worker steering ingress"
```

## Task 4: Whole-Repo Verification

**Files:**

- Modify: `docs/superpowers/plans/2026-06-23-worker-steering-ingress-slice.md`

- [ ] Run `pnpm check`.
- [ ] Run `pnpm build`.
- [ ] Update this plan's completed checkboxes.
- [ ] Commit the final plan update.

## Acceptance Criteria

- App-level worker tests are part of the root test workspace.
- Strategic steering command envelopes update durable intention state.
- Reactive steering command envelopes call the lightweight runtime route.
- Reactive route STM records are persisted via the STM repository boundary.
- Worker ingress returns command drafts for downstream submission without mutating world state.
- `pnpm check` and `pnpm build` pass.
