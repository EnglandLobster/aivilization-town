# Memory Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first testable STM/LTM memory core for AIvilization agents.

**Architecture:** Keep memory as a domain package with stable records, retrieval rules, repository ports, and consolidation outputs. The first store is in-memory for deterministic tests, but callers depend on interfaces that can later be backed by SQLite, Postgres, object storage, or vector search without changing `agent-runtime`.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, `@aivilization/sim-core`.

---

## Scope

This plan implements the first Phase 4 memory slice from `docs/superpowers/specs/2026-06-23-aivilization-town-design.md`.

It covers:

- Short-term memory records for actions, observations, social interactions, and human commands.
- Memory provenance linking records to command ids and event ids.
- Importance validation and deterministic retrieval ordering.
- Repository interfaces plus an in-memory STM repository for tests and early runtime.
- Long-term profile patch proposals from repeated successful patterns, repeated failure patterns, and social interactions.

It does not cover vector embeddings, durable storage, LLM summarization, API endpoints, or UI panels.

## File Structure

- Create `packages/memory/src/records.ts`: STM record types, ids, consolidation hints, and validation factory.
- Create `packages/memory/src/records.test.ts`: record validation and provenance tests.
- Create `packages/memory/src/retrieval.ts`: deterministic STM filtering and ranking.
- Create `packages/memory/src/retrieval.test.ts`: query filtering and ordering tests.
- Create `packages/memory/src/repository.ts`: repository port and in-memory implementation.
- Create `packages/memory/src/repository.test.ts`: append and retrieval isolation tests.
- Create `packages/memory/src/profile.ts`: LTM profile and patch types.
- Create `packages/memory/src/consolidation.ts`: deterministic consolidation proposal rules.
- Create `packages/memory/src/consolidation.test.ts`: habit, caution, and social patch tests.
- Modify `packages/memory/src/index.ts`: export public memory API.

## Tasks

### Task 1: Short-Term Memory Records

**Files:**

- Create: `packages/memory/src/records.ts`
- Create: `packages/memory/src/records.test.ts`
- Modify: `packages/memory/src/index.ts`

- [x] Write failing tests for STM record creation and validation:

```ts
import { asAgentId, asCommandId, asEventId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import { createShortTermMemoryRecord } from './index';

describe('short-term memory records', () => {
  test('keeps command and event provenance with a validated importance score', () => {
    const record = createShortTermMemoryRecord({
      id: 'memory-1',
      agentId: asAgentId('agent-1'),
      kind: 'action',
      status: 'succeeded',
      summary: 'Produced one unit of grain.',
      occurredAt: 1000,
      importanceScore: 0.8,
      source: {
        commandId: asCommandId('command-1'),
        eventIds: [asEventId('event-1')],
      },
      tags: ['production', 'grain'],
    });

    expect(record.id).toBe('memory-1');
    expect(record.source.commandId).toBe('command-1');
    expect(record.source.eventIds).toEqual(['event-1']);
    expect(record.tags).toEqual(['production', 'grain']);
  });

  test('rejects empty summaries and out-of-range importance scores', () => {
    expect(() =>
      createShortTermMemoryRecord({
        id: 'memory-2',
        agentId: asAgentId('agent-1'),
        kind: 'observation',
        status: 'observed',
        summary: '',
        occurredAt: 1000,
        importanceScore: 0.5,
        source: { eventIds: [] },
      }),
    ).toThrow(/summary/);

    expect(() =>
      createShortTermMemoryRecord({
        id: 'memory-3',
        agentId: asAgentId('agent-1'),
        kind: 'action',
        status: 'failed',
        summary: 'Failed to work due to low energy.',
        occurredAt: 1000,
        importanceScore: 1.2,
        source: { eventIds: [] },
      }),
    ).toThrow(/importanceScore/);
  });
});
```

- [x] Run `pnpm --filter @aivilization/memory test` and confirm the new APIs are missing.
- [x] Implement `MemoryRecordId`, `ShortTermMemoryRecord`, `MemoryConsolidationHint`, and `createShortTermMemoryRecord`.
- [x] Run `pnpm --filter @aivilization/memory test` and `pnpm --filter @aivilization/memory typecheck`.
- [x] Commit with `git commit -m "feat: add short-term memory records"`.

### Task 2: Retrieval And Repository Port

**Files:**

- Create: `packages/memory/src/retrieval.ts`
- Create: `packages/memory/src/retrieval.test.ts`
- Create: `packages/memory/src/repository.ts`
- Create: `packages/memory/src/repository.test.ts`
- Modify: `packages/memory/src/index.ts`

- [ ] Write failing tests for deterministic retrieval ordering:

```ts
import { asAgentId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import { createShortTermMemoryRecord, retrieveShortTermMemory } from './index';

describe('short-term memory retrieval', () => {
  test('filters by agent, kind, status, and tags before ordering by importance then recency', () => {
    const agentId = asAgentId('agent-1');
    const records = [
      createShortTermMemoryRecord({
        id: 'low-recent',
        agentId,
        kind: 'action',
        status: 'succeeded',
        summary: 'Recent minor action.',
        occurredAt: 3000,
        importanceScore: 0.2,
        source: { eventIds: [] },
        tags: ['work'],
      }),
      createShortTermMemoryRecord({
        id: 'high-old',
        agentId,
        kind: 'action',
        status: 'succeeded',
        summary: 'Important older action.',
        occurredAt: 1000,
        importanceScore: 0.9,
        source: { eventIds: [] },
        tags: ['work'],
      }),
      createShortTermMemoryRecord({
        id: 'other-agent',
        agentId: asAgentId('agent-2'),
        kind: 'action',
        status: 'succeeded',
        summary: 'Other agent action.',
        occurredAt: 4000,
        importanceScore: 1,
        source: { eventIds: [] },
        tags: ['work'],
      }),
    ];

    expect(
      retrieveShortTermMemory(records, {
        agentId,
        kinds: ['action'],
        statuses: ['succeeded'],
        requiredTags: ['work'],
        limit: 2,
      }).map((record) => record.id),
    ).toEqual(['high-old', 'low-recent']);
  });
});
```

- [ ] Write failing tests for `ShortTermMemoryRepository` and `InMemoryShortTermMemoryRepository`:

```ts
import { asAgentId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import { InMemoryShortTermMemoryRepository, createShortTermMemoryRecord } from './index';

describe('in-memory short-term memory repository', () => {
  test('appends records and retrieves an agent-isolated defensive copy', async () => {
    const repository = new InMemoryShortTermMemoryRepository();
    await repository.append(
      createShortTermMemoryRecord({
        id: 'memory-1',
        agentId: asAgentId('agent-1'),
        kind: 'human-command',
        status: 'observed',
        summary: 'Human requested restaurant work.',
        occurredAt: 1000,
        importanceScore: 0.7,
        source: { eventIds: [] },
        tags: ['steering'],
      }),
    );

    const firstResult = await repository.retrieve({
      agentId: asAgentId('agent-1'),
      limit: 10,
    });
    firstResult.pop();

    const secondResult = await repository.retrieve({
      agentId: asAgentId('agent-1'),
      limit: 10,
    });
    expect(secondResult).toHaveLength(1);
  });
});
```

- [ ] Run `pnpm --filter @aivilization/memory test` and confirm retrieval and repository APIs are missing.
- [ ] Implement `ShortTermMemoryQuery`, `retrieveShortTermMemory`, `ShortTermMemoryRepository`, and `InMemoryShortTermMemoryRepository`.
- [ ] Run `pnpm --filter @aivilization/memory test` and `pnpm --filter @aivilization/memory typecheck`.
- [ ] Commit with `git commit -m "feat: add short-term memory retrieval"`.

### Task 3: Long-Term Memory Consolidation

**Files:**

- Create: `packages/memory/src/profile.ts`
- Create: `packages/memory/src/consolidation.ts`
- Create: `packages/memory/src/consolidation.test.ts`
- Modify: `packages/memory/src/index.ts`

- [ ] Write failing tests for habit, caution, and social consolidation:

```ts
import { asAgentId } from '@aivilization/sim-core';
import { describe, expect, test } from 'vitest';
import { createShortTermMemoryRecord, proposeLongTermMemoryPatches } from './index';

describe('long-term memory consolidation', () => {
  test('promotes repeated successful patterns into habit patches', () => {
    const agentId = asAgentId('agent-1');
    const records = [1, 2, 3].map((index) =>
      createShortTermMemoryRecord({
        id: `memory-${index}`,
        agentId,
        kind: 'action',
        status: 'succeeded',
        summary: 'Completed study session.',
        occurredAt: index,
        importanceScore: 0.6,
        source: { eventIds: [] },
        consolidationHint: {
          kind: 'habit',
          patternKey: 'study-before-work',
          statement: 'Studies before starting work.',
        },
      }),
    );

    expect(
      proposeLongTermMemoryPatches({
        agentId,
        records,
        minPatternCount: 3,
        proposedAt: 10,
      }),
    ).toEqual([
      {
        id: 'ltm-patch-agent-1-habit-study-before-work-10',
        agentId,
        section: 'habits',
        key: 'study-before-work',
        statement: 'Studies before starting work.',
        confidence: 0.6,
        provenanceRecordIds: ['memory-1', 'memory-2', 'memory-3'],
        proposedAt: 10,
      },
    ]);
  });
});
```

- [ ] Add tests in the same file that repeated failed action hints become `beliefs` caution patches and social hints become `socialRecords` patches with aggregated relation and attitude deltas.
- [ ] Run `pnpm --filter @aivilization/memory test` and confirm consolidation APIs are missing.
- [ ] Implement `LongTermMemoryPatch`, `LongTermProfileSection`, and `proposeLongTermMemoryPatches`.
- [ ] Run `pnpm --filter @aivilization/memory test`, `pnpm --filter @aivilization/memory typecheck`, `pnpm check`, and `pnpm build`.
- [ ] Commit with `git commit -m "feat: add memory consolidation rules"`.

## Self-Review

- Spec coverage: This plan covers STM records, provenance, retrieval, repository interfaces, and deterministic LTM patch proposals from the memory section of the design spec.
- Red-flag scan: No forbidden marker strings remain in this plan.
- Type consistency: The planned tests use the same exported function and type names as the task descriptions.
