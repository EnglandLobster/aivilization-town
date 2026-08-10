# Profile-Aware Social Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make autonomous social plans choose conversation targets and topics from the agent's long-term adaptive profile, not only static config or a raw observation list.

**Architecture:** Keep long-term profile storage in `@aivilization/memory` and runtime composition in `apps/worker`. `buildWorkerTickAgentsFromActivePlans` will optionally attach a read-only `LongTermAgentProfile` to the runtime resolver context, and canonical social micro-planners will use that context to rank observed co-located agents and derive profile-shaped conversation topics.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, existing branch-plan/runtime resolver boundaries.

---

## File Structure

- Modify `apps/worker/src/agentScheduling.ts`: add optional profile context to `WorkerAgentRuntimeResolver` and fetch profile when a repository is supplied.
- Modify `apps/worker/src/agentScheduling.test.ts`: prove the scheduler passes a cloned long-term profile into runtime resolution.
- Modify `apps/worker/src/canonicalActivePlanTick.ts`: pass the existing `longTermProfileRepository` into active-plan agent scheduling.
- Modify `apps/worker/src/canonicalDomainRuntimes.ts`: rank social candidates by social profile evidence and derive topic/opening text from values/personality.
- Modify `apps/worker/src/canonicalDomainRuntimes.test.ts`: prove direct social proposal uses profile evidence.
- Modify `apps/worker/src/canonicalActivePlanTick.test.ts`: prove active-plan social execution uses profile-aware target/topic after observation hydration.
- Create this plan file.

## Selection Rules

1. Configured `social.targetAgentId` and `social.topic` stay authoritative.
2. Without configured target, use the latest same-location observation as the candidate set.
3. If a candidate has matching `longTermProfile.socialRecords[key === candidateAgentId]`, score by `relationDelta + attitudeDelta + confidence`.
4. If no candidate has social evidence, preserve deterministic lexical ordering.
5. Without configured topic, prefer the highest-confidence `values` entry, then highest-confidence `personality` entry, then the selected subtask description.
6. When the topic comes from profile, default opening becomes `Discuss <topic>.`; existing default opening stays unchanged for non-profile topics.

## Task 1: Runtime Resolver Profile Context

**Files:**

- Modify: `apps/worker/src/agentScheduling.ts`
- Modify: `apps/worker/src/agentScheduling.test.ts`

- [x] **Step 1: Write failing scheduler test**

Add a test that creates an `InMemoryLongTermProfileRepository`, saves a `values` entry for `agent-a`, calls `buildWorkerTickAgentsFromActivePlans({ longTermProfileRepository, resolveRuntime })`, and expects `resolveRuntime` to receive `longTermProfile.values[0].key === 'community-cooperation'`.

- [x] **Step 2: Verify RED**

Run:

```bash
pnpm --filter @aivilization/worker test -- agentScheduling.test.ts
```

Expected before implementation: FAIL at type/runtime level because the scheduler does not accept or pass `longTermProfileRepository`.

- [x] **Step 3: Implement profile context**

Add `longTermProfile?: LongTermAgentProfile` to `WorkerAgentRuntimeResolver` input. Add optional `longTermProfileRepository?: LongTermProfileRepository` to `buildWorkerTickAgentsFromActivePlans`; fetch `getOrCreate(agent.agentId)` only when supplied and pass the profile to `resolveRuntime`.

- [x] **Step 4: Verify GREEN**

Run:

```bash
pnpm --filter @aivilization/worker test -- agentScheduling.test.ts
```

## Task 2: Profile-Aware Social Proposal

**Files:**

- Modify: `apps/worker/src/canonicalDomainRuntimes.ts`
- Modify: `apps/worker/src/canonicalDomainRuntimes.test.ts`

- [x] **Step 1: Write failing direct social runtime test**

Add a canonical domain runtime test with observed co-located agents `[agent-c, agent-b]` and a long-term profile containing:

```ts
values: [
  {
    key: 'community-cooperation',
    statement: 'Agent values cooperative community routines.',
    confidence: 0.9,
    updatedAt: 90,
    provenanceRecordIds: [],
  },
];
socialRecords: [
  {
    key: 'agent-b',
    statement: 'Agent B is a trusted work partner.',
    confidence: 0.8,
    updatedAt: 80,
    provenanceRecordIds: [],
    relationDelta: 0.4,
    attitudeDelta: 0.3,
  },
];
```

Expect `AgentStartConversation` to target `agent-b`, use topic `community cooperation`, and default opening `Discuss community cooperation.`

- [x] **Step 2: Verify RED**

Run:

```bash
pnpm --filter @aivilization/worker test -- canonicalDomainRuntimes.test.ts
```

Expected before implementation: FAIL because social target selection ignores long-term profile and topic falls back to subtask text.

- [x] **Step 3: Implement social ranking and topic derivation**

Add small pure helpers in `canonicalDomainRuntimes.ts`:

- `resolveSocialTargetAgentId(context)` to rank observed co-located candidates by social profile evidence.
- `resolveProfileSocialTopic(context)` to convert the best value/personality key into a readable topic.
- `createDefaultSocialOpening(topic, source)` so profile topics get `Discuss <topic>.` while plan topics keep the existing default utterance.

- [x] **Step 4: Verify GREEN**

Run:

```bash
pnpm --filter @aivilization/worker test -- canonicalDomainRuntimes.test.ts
```

## Task 3: Active-Plan Integration

**Files:**

- Modify: `apps/worker/src/canonicalActivePlanTick.ts`
- Modify: `apps/worker/src/canonicalActivePlanTick.test.ts`

- [x] **Step 1: Write failing active-plan test**

Add an active social plan test that:

- Runs one tick to observe `agent-b` and `agent-c` at the town square.
- Saves long-term profile evidence preferring `agent-b` and value topic `community-cooperation`.
- Runs a second hydrated tick.
- Expects the generated conversation to target `agent-b` and topic `community cooperation`, even if the observation listed `agent-c` first.

- [x] **Step 2: Verify RED**

Run:

```bash
pnpm --filter @aivilization/worker test -- canonicalActivePlanTick.test.ts
```

Expected before implementation: FAIL because active-plan scheduling does not pass long-term profile into runtime resolution.

- [x] **Step 3: Wire active-plan scheduling**

Pass `longTermProfileRepository: input.longTermProfileRepository` into `buildWorkerTickAgentsFromActivePlans` from `runCanonicalWorkerActivePlanTick`.

- [x] **Step 4: Verify GREEN**

Run:

```bash
pnpm --filter @aivilization/worker test -- canonicalActivePlanTick.test.ts
```

## Task 4: Verification and Commit

- [x] **Step 1: Format changed files**

Run:

```bash
pnpm exec prettier --write docs/superpowers/plans/2026-06-25-profile-aware-social-runtime-slice.md apps/worker/src/agentScheduling.ts apps/worker/src/agentScheduling.test.ts apps/worker/src/canonicalDomainRuntimes.ts apps/worker/src/canonicalDomainRuntimes.test.ts apps/worker/src/canonicalActivePlanTick.ts apps/worker/src/canonicalActivePlanTick.test.ts
```

- [x] **Step 2: Run focused tests**

Run:

```bash
pnpm --filter @aivilization/worker test -- agentScheduling.test.ts canonicalDomainRuntimes.test.ts canonicalActivePlanTick.test.ts
pnpm --filter @aivilization/worker typecheck
```

- [x] **Step 3: Run repo checks**

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test
git diff --check
```

- [x] **Step 4: Commit**

Run:

```bash
git add docs/superpowers/plans/2026-06-25-profile-aware-social-runtime-slice.md apps/worker/src/agentScheduling.ts apps/worker/src/agentScheduling.test.ts apps/worker/src/canonicalDomainRuntimes.ts apps/worker/src/canonicalDomainRuntimes.test.ts apps/worker/src/canonicalActivePlanTick.ts apps/worker/src/canonicalActivePlanTick.test.ts
git commit -m "feat: make social runtime profile-aware"
```
