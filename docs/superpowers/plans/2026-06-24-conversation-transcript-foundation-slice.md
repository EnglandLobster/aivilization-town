# Conversation Transcript Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a server-authoritative conversation transcript foundation so social dialogue becomes replayable world state and durable STM evidence instead of a UI or LLM side effect.

**Architecture:** Keep conversation recording in `@aivilization/world`: `AgentStartConversation` validates the actor, target, co-location, topic, and turn speakers; emits a single `ConversationRecorded` event with deterministic conversation id and ordered turns; updates bidirectional social relations through existing society rules; and writes observation/social STM for both participants. `@aivilization/sim-core` owns the branded `ConversationId`, while future LLM dialogue generation can plug into the command payload without mutating world state directly.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, `@aivilization/sim-core`, `@aivilization/society`, `@aivilization/world`, `@aivilization/memory`.

---

### Task 1: Conversation Event And Projection

**Files:**

- Modify: `packages/sim-core/src/ids.ts`
- Modify: `packages/sim-core/src/command.ts`
- Modify: `packages/sim-core/src/event.ts`
- Modify: `packages/world/src/events.ts`
- Modify: `packages/world/src/projection.ts`
- Modify: `packages/world/src/projection.test.ts`

- [x] **Step 1: Write failing projection tests**

Add projection coverage proving `ConversationRecorded` is replayed into a `conversationRecords`
array without mutating agent state.

- [x] **Step 2: Run projection tests to verify red**

Run:

```bash
pnpm --filter @aivilization/world test -- projection.test.ts
```

Expected: FAIL because `ConversationRecorded` and `conversationRecords` do not exist.

- [x] **Step 3: Implement core event/id and projection state**

Add `ConversationId`/`asConversationId`, `AgentStartConversation`, `ConversationRecorded`, world
payload types, `WorldConversationRecordState`, and projection replay cloning.

### Task 2: Conversation Command Handler

**Files:**

- Modify: `packages/world/src/commands.ts`
- Modify: `packages/world/src/agentActions.ts`
- Modify: `packages/world/src/agentActions.test.ts`

- [x] **Step 1: Write failing command handler tests**

Add tests proving:

- A co-located actor and target can record a two-turn conversation.
- The handler emits `ConversationRecorded`, two `SocialInteractionCompleted` events, and two STM
  records.
- The projection replays transcript, bidirectional social relation updates, and both participants'
  STM records.
- A turn spoken by a non-participant is rejected.
- `dispatchWorldCommand` routes `AgentStartConversation`.

- [x] **Step 2: Run command tests to verify red**

Run:

```bash
pnpm --filter @aivilization/world test -- agentActions.test.ts
```

Expected: FAIL because command parsing and dispatch do not support `AgentStartConversation`.

- [x] **Step 3: Implement command parsing and handler**

Implement `assertAgentStartConversationPayload`, dispatch routing, deterministic conversation id
from command id, co-location validation, turn speaker validation, bidirectional social relation
updates, and per-participant STM records.

- [x] **Step 4: Verify focused tests**

Run:

```bash
pnpm --filter @aivilization/world test -- projection.test.ts
pnpm --filter @aivilization/world test -- agentActions.test.ts
pnpm --filter @aivilization/world typecheck
pnpm --filter @aivilization/sim-core typecheck
```

### Task 3: Full Verification And Commit

**Files:**

- Review changed sim-core/world files and this plan.

- [x] **Step 1: Run full verification**

Run:

```bash
pnpm check
pnpm build
```

- [x] **Step 2: Commit**

Run:

```bash
git add docs/superpowers/plans/2026-06-24-conversation-transcript-foundation-slice.md packages/sim-core/src/ids.ts packages/sim-core/src/command.ts packages/sim-core/src/event.ts packages/world/src/commands.ts packages/world/src/events.ts packages/world/src/projection.ts packages/world/src/projection.test.ts packages/world/src/agentActions.test.ts packages/world/src/agentActions.ts
git commit -m "feat: add conversation transcript foundation"
```
