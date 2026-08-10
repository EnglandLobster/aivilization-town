# Canonical Social Conversation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route autonomous canonical social plans through replayable conversation transcripts instead of opaque relation-only social actions.

**Architecture:** Keep `@aivilization/world` as the authority for validating and replaying conversations. `apps/worker` remains the content-aware adapter that turns durable social subtasks into `AgentStartConversation` proposals with deterministic topic, turns, target, and social deltas; existing dry-run dispatch and event execution then produce `ConversationRecorded`, bidirectional relation events, and participant STM.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, `@aivilization/agent-runtime`, `@aivilization/world`, `apps/worker`.

---

### Task 1: Canonical Social Runtime Proposal

**Files:**

- Modify: `apps/worker/src/canonicalDomainRuntimes.test.ts`
- Modify: `apps/worker/src/canonicalDomainRuntimes.ts`
- Modify: this plan file

- [x] **Step 1: Write failing canonical runtime tests**

Update social assertions so configured and context-derived social proposals expect:

```ts
expect(firstProposal(binding.microPlanners, 'social')).toMatchObject({
  id: 'canonical-social-step-e',
  commandType: 'AgentStartConversation',
  payload: {
    targetAgentId: agentC,
    topic: 'town plans',
    relationDelta: 3,
    attitudeDelta: 4,
    turns: [
      {
        speakerAgentId: agentA,
        utterance: 'Discuss town plans.',
        intent: 'social-plan',
      },
      {
        speakerAgentId: agentC,
        utterance: 'I will remember this conversation about town plans.',
        intent: 'acknowledge-topic',
      },
    ],
  },
});
```

For defaults, expect `commandType: 'AgentStartConversation'`, topic derived from the selected subtask
description, and two participant turns.

- [x] **Step 2: Run focused test to verify red**

Run:

```bash
pnpm --filter @aivilization/worker test -- canonicalDomainRuntimes.test.ts
```

Expected: FAIL because canonical social still emits `AgentSocialize`.

- [x] **Step 3: Implement canonical conversation proposal**

Change social runtime config from summary-only to conversation-aware fields:

- `topic?: string`
- `openingUtterance?: string`
- `responseUtterance?: string`
- keep `targetAgentId`, `relationDelta`, `attitudeDelta`

Update the canonical social planner to emit `AgentStartConversation` with deterministic turns:

- initiator turn uses actor id, configured/opening utterance, `intent: 'social-plan'`
- response turn uses target id, configured/default response, `intent: 'acknowledge-topic'`
- default topic comes from selected subtask description
- default opening keeps the old summary text

- [x] **Step 4: Verify focused runtime tests**

Run:

```bash
pnpm --filter @aivilization/worker test -- canonicalDomainRuntimes.test.ts
pnpm --filter @aivilization/worker typecheck
```

### Task 2: Active-Plan Conversation Execution

**Files:**

- Modify: `apps/worker/src/canonicalActivePlanTick.test.ts`
- Review: `apps/worker/src/canonicalWorkerRuntimeResolver.ts`
- Modify: this plan file

- [x] **Step 1: Write failing active-plan test**

Add an active social plan test where two agents start co-located at `town-square`; one tick should:

- draft `AgentStartConversation`
- append `ConversationRecorded`, two `SocialInteractionCompleted`, and two `ShortTermMemoryRecorded`
- replay one `conversationRecords` entry and two memory records
- complete the social subtask

- [x] **Step 2: Run active-plan test**

Run:

```bash
pnpm --filter @aivilization/worker test -- canonicalActivePlanTick.test.ts
```

Expected: PASS after Task 1 unless completion policy mishandles conversation actions.

- [x] **Step 3: Fix completion only if needed**

If the social subtask remains in progress unexpectedly, update canonical completion policy to treat
accepted `AgentStartConversation` as a completed non-movement domain action while preserving the
existing movement precondition behavior.

- [x] **Step 4: Verify focused worker tests**

Run:

```bash
pnpm --filter @aivilization/worker test -- canonicalDomainRuntimes.test.ts canonicalActivePlanTick.test.ts
pnpm --filter @aivilization/worker typecheck
pnpm --filter @aivilization/world typecheck
```

### Task 3: Full Verification And Commit

**Files:**

- Review changed worker/world-facing type imports and this plan.

- [x] **Step 1: Run full verification**

Run:

```bash
pnpm check
pnpm build
```

- [x] **Step 2: Commit**

Run:

```bash
git add docs/superpowers/plans/2026-06-24-canonical-social-conversation-slice.md apps/worker/src/canonicalDomainRuntimes.test.ts apps/worker/src/canonicalDomainRuntimes.ts apps/worker/src/canonicalActivePlanTick.test.ts apps/worker/src/canonicalWorkerRuntimeResolver.ts
git commit -m "feat: route canonical social plans through conversations"
```
