# Observation Driven Social Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make autonomous canonical social plans observe nearby agents before selecting a conversation target.

**Architecture:** Keep `@aivilization/world` authoritative for observation and conversation events. `apps/worker` owns the social-domain adapter: when no target is explicitly configured, it first emits `AgentObserveLocation`; after replay hydration provides `locationObservations`, it selects a deterministic observed co-located target and emits `AgentStartConversation`. Configured targets still bypass discovery and retain the existing movement precondition.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, `@aivilization/world`, `apps/worker`, `@aivilization/agent-runtime`.

---

### Task 1: Runtime Proposal Behavior

**Files:**

- Modify: `apps/worker/src/canonicalDomainRuntimes.test.ts`
- Modify: `apps/worker/src/canonicalDomainRuntimes.ts`
- Modify: this plan file

- [x] **Step 1: Write failing runtime tests**

Add coverage proving:

- unconfigured social plans at a known social location emit `AgentObserveLocation` with `focus` equal to the selected subtask description;
- after a replayed `locationObservations` entry exists for the current location, the same social planner emits `AgentStartConversation` targeting the first observed co-located agent;
- configured social targets still move toward the configured target's known location.

- [x] **Step 2: Run focused runtime test to verify red**

Run:

```bash
pnpm --filter @aivilization/worker test -- canonicalDomainRuntimes.test.ts
```

Expected: FAIL because unconfigured social still picks a target directly from projected agents.

- [x] **Step 3: Implement observation-driven target resolution**

Update canonical social runtime so:

- `config.targetAgentId` preserves the existing explicit-target behavior;
- no configured target and no matching observation returns `AgentObserveLocation`;
- matching observations are filtered by `agentId` and current `locationId`;
- target candidates must exist in the projection, differ from the actor, and still be co-located;
- candidates are sorted deterministically before selecting the first.

- [x] **Step 4: Verify focused runtime tests**

Run:

```bash
pnpm --filter @aivilization/worker test -- canonicalDomainRuntimes.test.ts
pnpm --filter @aivilization/worker typecheck
```

### Task 2: Active-Plan Observe-To-Conversation Flow

**Files:**

- Modify: `apps/worker/src/canonicalActivePlanTick.test.ts`
- Review: `apps/worker/src/canonicalWorkerRuntimeResolver.ts`
- Modify: this plan file

- [x] **Step 1: Write failing two-tick active-plan test**

Add a durable social plan with two agents co-located at `town-square` and no configured target:

- first tick drafts `AgentObserveLocation`, writes `LocationObserved`, and leaves the social subtask in progress;
- second hydrated tick drafts `AgentStartConversation`, writes `ConversationRecorded`, bidirectional social relation events, and two STM records;
- the social objective completes only after the conversation tick.

- [x] **Step 2: Run active-plan test to verify red**

Run:

```bash
pnpm --filter @aivilization/worker test -- canonicalActivePlanTick.test.ts
```

Expected: FAIL until Task 1 is implemented and movement/observation completion remains in-progress.

- [x] **Step 3: Fix completion only if needed**

If observing completes the subtask too early, update canonical subtask completion so accepted
`AgentObserveLocation` behaves like movement: `status: 'in-progress'`.

- [x] **Step 4: Verify focused worker tests**

Run:

```bash
pnpm --filter @aivilization/worker test -- canonicalDomainRuntimes.test.ts canonicalActivePlanTick.test.ts
pnpm --filter @aivilization/worker typecheck
pnpm --filter @aivilization/world typecheck
```

### Task 3: Full Verification And Commit

**Files:**

- Review changed worker files and this plan.

- [x] **Step 1: Run full verification**

Run:

```bash
pnpm check
pnpm build
```

- [x] **Step 2: Commit**

Run:

```bash
git add docs/superpowers/plans/2026-06-24-observation-driven-social-runtime-slice.md apps/worker/src/canonicalDomainRuntimes.test.ts apps/worker/src/canonicalDomainRuntimes.ts apps/worker/src/canonicalActivePlanTick.test.ts apps/worker/src/canonicalWorkerRuntimeResolver.ts
git commit -m "feat: drive social targets from observations"
```
