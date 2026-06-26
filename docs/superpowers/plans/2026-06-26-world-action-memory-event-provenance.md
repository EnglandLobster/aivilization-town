# World Action Memory Event Provenance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make world-generated short-term action memories point to the real world events they summarize.

**Architecture:** Keep provenance at the world-event boundary: `@aivilization/world` already creates both domain events and `ShortTermMemoryRecorded`, so it should attach same-command event IDs before emitting the memory event. Agent planning packages remain unaware of event-store mechanics.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, `@aivilization/world`, `@aivilization/memory`, `@aivilization/sim-core`.

---

### Task 1: Prove Action Memory Is Missing Event Provenance

**Files:**

- Modify: `packages/world/src/agentActions.test.ts`

- [x] **Step 1: Write the failing test**

Add a test near the existing study/action-memory tests:

```ts
test('records action memory with source event ids for the events it summarizes', () => {
  const command = studyCommand({ id: 'cmd-study-provenance' });
  const projection = createWorldProjection({
    agents: [
      {
        agentId: agentOne,
        physiology: { energy: 100, satiety: 100, health: 100 },
        educationScore: 0,
        balance: 100,
        residentialTier: 1,
        job: null,
        inventory: {},
      },
    ],
  });

  const events = dispatchWorldCommand({
    command,
    projection,
    policies,
    nextSequence: 1,
  });

  const memory = events.find((event) => event.type === 'ShortTermMemoryRecorded');
  expect(memory?.payload.record.source.eventIds).toEqual(['cmd-study-provenance:event:0']);
});
```

- [x] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm vitest run packages/world/src/agentActions.test.ts
```

Expected: FAIL because the memory record currently has `source.eventIds: []`.

### Task 2: Attach Same-Command Event IDs in World Memory Events

**Files:**

- Modify: `packages/world/src/agentActions.ts`
- Test: `packages/world/src/agentActions.test.ts`

- [x] **Step 1: Implement minimal provenance helper**

Update `makeMemoryEvent` so its record source contains all prior same-command event IDs up to the memory event offset:

```ts
eventIds: createPriorCommandEventIds(input.command.id, offset),
```

Add this helper near `makeMemoryEvent`:

```ts
function createPriorCommandEventIds(
  commandId: CommandEnvelope<CoreCommandType, unknown>['id'],
  offset: number,
) {
  return Array.from({ length: offset }, (_, index) => asEventId(`${commandId}:event:${index}`));
}
```

If imports need adjustment, import `asEventId` from `@aivilization/sim-core`.

- [x] **Step 2: Run focused test**

Run:

```bash
pnpm vitest run packages/world/src/agentActions.test.ts
```

Expected: PASS.

### Task 3: Verify Integration Surface and Commit

**Files:**

- Modify: `docs/superpowers/plans/2026-06-26-world-action-memory-event-provenance.md`

- [x] **Step 1: Run broader checks**

Run:

```bash
pnpm vitest run packages/world/src/agentActions.test.ts apps/worker/src/agentCycleRunner.test.ts apps/worker/src/commandDispatch.test.ts
pnpm typecheck
pnpm lint
pnpm prettier --check packages/world/src/agentActions.ts packages/world/src/agentActions.test.ts docs/superpowers/plans/2026-06-26-world-action-memory-event-provenance.md
git diff --check
```

Expected: all commands exit 0. If full-repo prettier remains blocked by unrelated existing files, use the targeted prettier check above as this stage's formatting gate.

- [x] **Step 2: Stage and commit**

Run:

```bash
git add packages/world/src/agentActions.ts packages/world/src/agentActions.test.ts docs/superpowers/plans/2026-06-26-world-action-memory-event-provenance.md
git commit -m "feat(world): 让 action memory 追踪真实世界事件"
```

Commit body must explain why STM provenance matters for paper alignment, the world-layer boundary decision, user-visible traceability, and exact verification commands.
