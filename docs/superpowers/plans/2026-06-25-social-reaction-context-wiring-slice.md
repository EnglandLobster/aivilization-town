# Social Reaction Context Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Feed long-term profile and recent short-term memory context into social observation reaction evaluation so LLM reaction decisions can use the same adaptive profile evidence described in the AIvilization paper.

**Architecture:** Keep reaction decision ownership in `apps/worker/src/socialObservationIntentions.ts`. Add optional per-agent context maps to the social observation reaction contract, and have `tickRunner.ts` build those maps from the existing memory repositories immediately after ambient observation records are persisted. This preserves the existing evaluator abstraction and avoids teaching the reaction module how to query storage.

**Tech Stack:** TypeScript, Vitest, pnpm workspace packages, `@aivilization/memory`, `@aivilization/agent-runtime`.

---

### Task 1: Social Observation Reaction Contract

**Files:**

- Modify: `apps/worker/src/socialObservationIntentions.test.ts`
- Modify: `apps/worker/src/socialObservationIntentions.ts`

- [ ] **Step 1: Write the failing test**

Add a test proving injected evaluators receive long-term profile and memory context for the reacting agent:

```ts
test('passes profile and memory context into injected reaction evaluators', async () => {
  const memory = createShortTermMemoryRecord({
    id: 'memory-conversation-party',
    agentId,
    kind: 'observation',
    status: 'observed',
    summary: 'Observed agent-a and agent-c discuss Valentine party at Town Square.',
    occurredAt: 10 * hourMs,
    importanceScore: 0.7,
    source: { eventIds: [asEventId('event-conversation-1')] },
    tags: ['ambient-observation', 'ConversationRecorded', 'agent-a', 'agent-c'],
  });
  const priorMemory = createShortTermMemoryRecord({
    id: 'memory-prior-party',
    agentId,
    kind: 'observation',
    status: 'observed',
    summary: 'agent-bystander heard agent-a needs help preparing food.',
    occurredAt: 9 * hourMs,
    importanceScore: 0.6,
    source: { eventIds: [asEventId('event-prior-party')] },
    tags: ['party', 'agent-a'],
  });

  const seen: unknown[] = [];
  await createSocialObservationScheduledIntentions({
    records: [memory],
    longTermProfileByAgentId: {
      [agentId]: {
        agentId,
        beliefs: [],
        habits: [],
        mood: [],
        values: [
          {
            key: 'community-helper',
            statement: 'Help neighbors coordinate social gatherings.',
            confidence: 0.9,
            updatedAt: 9 * hourMs,
            provenanceRecordIds: [priorMemory.id],
          },
        ],
        personality: [],
        socialRecords: [],
      },
    },
    memoryContextByAgentId: { [agentId]: [priorMemory] },
    reactionEvaluator: (input) => {
      seen.push({
        longTermProfile: input.longTermProfile,
        memoryContext: input.memoryContext,
      });
      return { kind: 'ignore', confidence: 0.9, rationale: 'captured context' };
    },
  });

  expect(seen).toEqual([
    {
      longTermProfile: expect.objectContaining({
        values: [expect.objectContaining({ key: 'community-helper' })],
      }),
      memoryContext: [priorMemory],
    },
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @aivilization/worker test -- socialObservationIntentions.test.ts
```

Expected: FAIL because `longTermProfileByAgentId` and `memoryContextByAgentId` are not part of `SocialObservationScheduledIntentionsInput`.

- [ ] **Step 3: Write minimal implementation**

Update `SocialObservationScheduledIntentionsInput` to include:

```ts
readonly longTermProfileByAgentId?: Readonly<Record<string, LongTermAgentProfile>>;
readonly memoryContextByAgentId?: Readonly<Record<string, readonly ShortTermMemoryRecord[]>>;
```

Then pass those values into `reactionEvaluator`:

```ts
const longTermProfile = input.longTermProfileByAgentId?.[record.agentId];
const memoryContext = input.memoryContextByAgentId?.[record.agentId];
await reactionEvaluator({
  agentId: record.agentId,
  issuedAt: input.createdAt ?? record.occurredAt,
  memory: record,
  ...(worldDecisionContext === undefined ? {} : { worldDecisionContext }),
  ...(longTermProfile === undefined ? {} : { longTermProfile }),
  ...(memoryContext === undefined ? {} : { memoryContext }),
});
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter @aivilization/worker test -- socialObservationIntentions.test.ts
```

Expected: PASS.

### Task 2: Worker Tick Repository Context Wiring

**Files:**

- Modify: `apps/worker/src/tickRunner.test.ts`
- Modify: `apps/worker/src/tickRunner.ts`

- [ ] **Step 1: Write the failing test**

Add a tick-level test near existing ambient reaction tests proving the worker retrieves profile and recent STM before invoking the ambient reaction evaluator:

```ts
test('hydrates ambient reaction evaluator with profile and memory context from repositories', async () => {
  const eventStore = new InMemoryEventStore<WorldEvent>();
  const repositories = createRepositories();
  const captured: unknown[] = [];
  const priorMemory = createShortTermMemoryRecord({
    id: 'agent-2-prior-party-help',
    agentId: agentTwo,
    kind: 'observation',
    status: 'observed',
    summary: 'agent-2 previously noticed agent-1 preparing Valentine party food.',
    occurredAt: 50,
    importanceScore: 0.8,
    source: { eventIds: ['prior-party-event'] },
    tags: ['party', 'agent-1'],
  });
  await repositories.shortTermMemoryRepository.appendMany([priorMemory]);
  await repositories.longTermProfileRepository.applyPatches(agentTwo, [
    {
      id: 'agent-2-community-value',
      agentId: agentTwo,
      section: 'values',
      key: 'community-helper',
      statement: 'Help neighbors coordinate social gatherings.',
      confidence: 0.9,
      provenanceRecordIds: [priorMemory.id],
      proposedAt: 60,
    },
  ]);

  await runWorkerSimulationTick({
    tickId: 'tick-social-observation-reaction-context',
    simulationId,
    issuedAt: 100,
    projection: createCoLocatedConversationProjection(),
    policies,
    eventStore,
    streamName: partition.eventStreamName,
    expectedVersion: 0,
    ambientObservationMemory: {
      enabled: true,
      reactionEvaluator: (input) => {
        captured.push({
          agentId: input.agentId,
          longTermProfile: input.longTermProfile,
          memoryContext: input.memoryContext,
          worldDecisionContext: input.worldDecisionContext,
        });
        return { kind: 'ignore', confidence: 0.95, rationale: 'captured context' };
      },
    },
    agents: [
      {
        agentId: agentOne,
        observedStateSummary: 'agent-1 discusses a party while agent-2 listens nearby',
        plan: createSocialPlan(),
        signals: [],
        microPlanners: [createConversationPlanner()],
        simulate: ({ action }) => ({ status: 'accepted', action }),
      },
    ],
    ...repositories,
  });

  expect(captured).toEqual([
    expect.objectContaining({
      agentId: agentTwo,
      longTermProfile: expect.objectContaining({
        values: [expect.objectContaining({ key: 'community-helper' })],
      }),
      memoryContext: expect.arrayContaining([priorMemory]),
      worldDecisionContext: expect.objectContaining({
        agent: expect.objectContaining({ agentId: agentTwo }),
      }),
    }),
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @aivilization/worker test -- tickRunner.test.ts
```

Expected: FAIL because `tickRunner.ts` currently only forwards `worldDecisionContextByAgentId`.

- [ ] **Step 3: Write minimal implementation**

Add helper functions in `tickRunner.ts`:

```ts
async function createLongTermProfileByAgentId(input: {
  readonly longTermProfileRepository: LongTermProfileRepository;
  readonly records: readonly ShortTermMemoryRecord[];
}): Promise<Readonly<Record<string, LongTermAgentProfile>>> { ... }

async function createMemoryContextByAgentId(input: {
  readonly shortTermMemoryRepository: ShortTermMemoryRepository;
  readonly records: readonly ShortTermMemoryRecord[];
  readonly limit: number;
}): Promise<Readonly<Record<string, readonly ShortTermMemoryRecord[]>>> { ... }
```

Call both helpers after appending ambient records and pass the maps into `upsertSocialObservationIntentions`.

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter @aivilization/worker test -- tickRunner.test.ts
```

Expected: PASS.

### Task 3: Verification and Commit

**Files:**

- Verify: all modified files

- [ ] **Step 1: Run focused worker tests**

```bash
pnpm --filter @aivilization/worker test -- socialObservationIntentions.test.ts tickRunner.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full workspace check**

```bash
pnpm check
```

Expected: PASS.

- [ ] **Step 3: Inspect git diff**

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; only this stage's plan/test/source files modified plus pre-existing untracked paper/report directories.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-06-25-social-reaction-context-wiring-slice.md apps/worker/src/socialObservationIntentions.ts apps/worker/src/socialObservationIntentions.test.ts apps/worker/src/tickRunner.ts apps/worker/src/tickRunner.test.ts
git commit -m "feat(worker): 补齐社交观察反应的记忆上下文"
```

Expected: commit succeeds.
