# Long-Term Profile Mood Section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Mood as a first-class long-term adaptive profile section so AIvilization profiles match the paper's unified profile structure.

**Architecture:** Keep mood in `@aivilization/memory` as another `LongTermProfileSection`, cloned and persisted through the same repository boundaries as values, habits, personality, and social records. Reflection produces mood insights from repeated positive social interactions, consolidation converts them to LTM patches, and profile influence can bias planning from mood entries without special-casing callers.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, existing memory/profile/repository/reflection boundaries.

---

## File Structure

- Modify `packages/memory/src/profile.ts`: add `mood` to `LongTermProfileSection`, `LongTermAgentProfile`, and empty profile creation.
- Modify `packages/memory/src/profileRepository.ts`: clone mood entries in the in-memory profile repository.
- Modify `packages/memory/src/fileRepositories.ts`: clone mood entries in the file-backed profile repository.
- Modify `packages/memory/src/reflection.ts`: add a `mood` reflective insight kind and convert it to a mood LTM patch.
- Modify `packages/agent-runtime/src/profileInfluence.ts`: include mood entries in profile influence scoring and stable match ordering.
- Modify tests in `packages/memory`, `packages/agent-runtime`, and `apps/worker` to prove schema, repository cloning, reflection, consolidation, and influence behavior.

## Selection Rules

1. `mood` is long-term semantic profile state, not volatile world projection state.
2. Mood entries use the same `LongTermProfileEntry` shape as other semantic profile sections.
3. Positive repeated social interaction with multiple agents produces a mood insight named `cooperative-composure`.
4. Mood contributes to profile influence with a moderate weight between beliefs and values/personality.
5. Existing social values/personality/socialRecords consolidation behavior remains intact.

## Task 1: Mood Profile Schema

**Files:**

- Modify: `packages/memory/src/profile.test.ts`
- Modify: `packages/memory/src/profileRepository.test.ts`
- Modify: `packages/memory/src/fileRepositories.test.ts`
- Modify: `packages/memory/src/profile.ts`
- Modify: `packages/memory/src/profileRepository.ts`
- Modify: `packages/memory/src/fileRepositories.ts`

- [x] **Step 1: Write failing schema and repository tests**

Add assertions that:

- `createEmptyLongTermAgentProfile(agentId)` includes `mood: []`.
- `applyLongTermMemoryPatch(... section: 'mood' ...)` writes a mood entry.
- in-memory and file-backed repositories deep clone mood provenance arrays.

- [x] **Step 2: Verify RED**

Run:

```bash
pnpm --filter @aivilization/memory test -- profile.test.ts profileRepository.test.ts fileRepositories.test.ts
```

Expected before implementation: FAIL because `mood` is not a valid profile section and profiles do not expose `mood`.

- [x] **Step 3: Implement mood profile section**

Add `mood` to `LongTermProfileSection`, `LongTermAgentProfile`, `createEmptyLongTermAgentProfile`, and both clone helpers.

- [x] **Step 4: Verify GREEN**

Run:

```bash
pnpm --filter @aivilization/memory test -- profile.test.ts profileRepository.test.ts fileRepositories.test.ts
```

## Task 2: Mood Reflection and Consolidation

**Files:**

- Modify: `packages/memory/src/reflection.test.ts`
- Modify: `packages/memory/src/consolidation.test.ts`
- Modify: `apps/worker/src/memoryConsolidation.test.ts`
- Modify: `packages/memory/src/reflection.ts`

- [x] **Step 1: Write failing reflection and consolidation tests**

Add tests that repeated positive social memories with multiple targets produce:

- a `mood:cooperative-composure` reflective insight,
- a `section: 'mood', key: 'cooperative-composure'` LTM patch,
- a persisted `profile.mood` entry after worker memory consolidation.

- [x] **Step 2: Verify RED**

Run:

```bash
pnpm --filter @aivilization/memory test -- reflection.test.ts consolidation.test.ts
pnpm --filter @aivilization/worker test -- memoryConsolidation.test.ts
```

Expected before implementation: FAIL because reflection has no mood insight kind or patch target.

- [x] **Step 3: Implement mood reflection**

Add `mood` to `ReflectiveInsightKind`, map it to the mood profile section, and have social profile reflection emit `cooperative-composure` alongside the existing sociable personality and community-cooperation value insights.

- [x] **Step 4: Verify GREEN**

Run:

```bash
pnpm --filter @aivilization/memory test -- reflection.test.ts consolidation.test.ts
pnpm --filter @aivilization/worker test -- memoryConsolidation.test.ts
```

## Task 3: Mood Profile Influence

**Files:**

- Modify: `packages/agent-runtime/src/profileInfluence.test.ts`
- Modify: `packages/agent-runtime/src/profileInfluence.ts`
- Modify any tests that construct `LongTermAgentProfile` literals.

- [x] **Step 1: Write failing influence test**

Add a profile influence test where a mood entry with key `cooperative-composure` contributes when the candidate affinity tag includes `cooperative`.

- [x] **Step 2: Verify RED**

Run:

```bash
pnpm --filter @aivilization/agent-runtime test -- profileInfluence.test.ts
```

Expected before implementation: FAIL because mood entries are not scored.

- [x] **Step 3: Implement mood influence**

Add `mood` to section weights, section order, and the scored profile section list.

- [x] **Step 4: Verify GREEN**

Run:

```bash
pnpm --filter @aivilization/agent-runtime test -- profileInfluence.test.ts
```

## Task 4: Verification and Commit

- [x] **Step 1: Format changed files**

Run:

```bash
pnpm exec prettier --write docs/superpowers/plans/2026-06-25-long-term-profile-mood-section-slice.md packages/memory/src/profile.ts packages/memory/src/profile.test.ts packages/memory/src/profileRepository.ts packages/memory/src/profileRepository.test.ts packages/memory/src/fileRepositories.ts packages/memory/src/fileRepositories.test.ts packages/memory/src/reflection.ts packages/memory/src/reflection.test.ts packages/memory/src/consolidation.test.ts apps/worker/src/memoryConsolidation.test.ts packages/agent-runtime/src/profileInfluence.ts packages/agent-runtime/src/profileInfluence.test.ts
```

- [x] **Step 2: Run focused tests**

Run:

```bash
pnpm --filter @aivilization/memory test -- profile.test.ts profileRepository.test.ts fileRepositories.test.ts reflection.test.ts consolidation.test.ts
pnpm --filter @aivilization/worker test -- memoryConsolidation.test.ts
pnpm --filter @aivilization/agent-runtime test -- profileInfluence.test.ts
pnpm typecheck
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
git add docs/superpowers/plans/2026-06-25-long-term-profile-mood-section-slice.md packages/memory/src/profile.ts packages/memory/src/profile.test.ts packages/memory/src/profileRepository.ts packages/memory/src/profileRepository.test.ts packages/memory/src/fileRepositories.ts packages/memory/src/fileRepositories.test.ts packages/memory/src/reflection.ts packages/memory/src/reflection.test.ts packages/memory/src/consolidation.test.ts apps/worker/src/memoryConsolidation.test.ts packages/agent-runtime/src/profileInfluence.ts packages/agent-runtime/src/profileInfluence.test.ts
git commit -m "feat: add mood to adaptive profiles"
```
