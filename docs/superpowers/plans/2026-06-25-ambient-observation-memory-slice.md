# Ambient Observation Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let co-located agents receive short-term observation memories from visible world events.

**Architecture:** Add a focused worker module that derives bystander observation memory records from
world events plus projection state. Wire it into worker ticks as an optional hook and enable it by
default for local runtime steps, keeping world command handlers deterministic and first-party.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, `apps/worker`, `@aivilization/memory`,
`@aivilization/world`.

---

## Scope

- Create pure ambient observation memory derivation in `apps/worker`.
- Return compact propagation diagnostics from `runWorkerSimulationTick`.
- Enable propagation by default in `runLocalWorldRuntimeStep`.
- Keep generated memories repository-only, not world events.

## Task 1: Pure Observation Memory Derivation

**Files:**

- Create: `apps/worker/src/ambientObservationMemory.ts`
- Create: `apps/worker/src/ambientObservationMemory.test.ts`
- Modify: `apps/worker/src/index.ts`

- [x] **Step 1: Write failing pure derivation tests**

Create tests that:

- build a projection with `agent-1`, `agent-2`, and `agent-3` at `town-square`;
- pass a `ConversationRecorded` event for `agent-1` and `agent-2`;
- assert only `agent-3` gets one `observation` memory record;
- assert `TradeExecuted` at a trader's location creates observer memories for co-located
  non-traders;
- assert events with no co-located observers create no records.

Run:

```bash
pnpm --filter @aivilization/worker test -- ambientObservationMemory.test.ts
```

Expected: FAIL because the module does not exist.

- [x] **Step 2: Implement pure derivation**

Add:

```ts
export type WorkerAmbientObservationMemoryResult = {
  readonly observedEventCount: number;
  readonly recordCount: number;
  readonly records: readonly ShortTermMemoryRecord[];
};

export function createAmbientObservationMemoryRecords(input: {
  readonly tickId: string;
  readonly events: readonly WorldEvent[];
  readonly projection: WorldProjection;
  readonly occurredAt: number;
  readonly importanceScore?: number;
  readonly maxObserversPerEvent?: number;
}): WorkerAmbientObservationMemoryResult
```

The function should use deterministic record ids, exclude actors/participants, and sort observers by
agent id for stable output.

## Task 2: Worker Tick Hook

**Files:**

- Modify: `apps/worker/src/tickRunner.ts`
- Modify: `apps/worker/src/tickRunner.test.ts`

- [x] **Step 3: Write failing tick integration test**

Add a test that runs `runWorkerSimulationTick` with:

- two co-located agents;
- agent 1 executing a study action;
- `ambientObservationMemory: { enabled: true }`;
- an in-memory short-term memory repository.

Assert:

```ts
expect(result.ambientObservationMemory).toMatchObject({
  observedEventCount: 1,
  recordCount: 1,
});
await expect(shortTermMemoryRepository.retrieve({
  agentId: agentTwo,
  kinds: ['observation'],
  requiredTags: ['ambient-observation', 'EducationChanged'],
  limit: 10,
})).resolves.toHaveLength(1);
```

Run:

```bash
pnpm --filter @aivilization/worker test -- tickRunner.test.ts
```

Expected: FAIL because the tick hook is not implemented.

- [x] **Step 4: Implement tick hook**

Add `ambientObservationMemory` input to `runWorkerSimulationTick`, call
`createAmbientObservationMemoryRecords`, append generated records to `shortTermMemoryRepository`,
and return the summary on `WorkerTickResult` when enabled.

## Task 3: Local Runtime Default Wiring

**Files:**

- Modify: `apps/worker/src/localRuntimeStep.ts`
- Modify: `apps/worker/src/localRuntimeStep.test.ts`

- [x] **Step 5: Write failing local runtime test**

Add a test that calls `runLocalWorldRuntimeStep` with a co-located bystander and no explicit
ambient config. Assert the bystander receives an `ambient-observation` memory record. Add a
separate call with `ambientObservationMemory: { enabled: false }` and assert no bystander record is
written.

Run:

```bash
pnpm --filter @aivilization/worker test -- localRuntimeStep.test.ts
```

Expected: FAIL because local runtime does not pass the hook.

- [x] **Step 6: Implement local runtime wiring**

Add optional `ambientObservationMemory` to `LocalWorldRuntimeStepInput` and pass it to the tick.
When omitted, enable ambient observation memory using local storage's `shortTermMemoryRepository`.
When disabled, omit the tick hook.

## Task 4: Verification And Commit

**Files:**

- Modify: this plan file.

- [x] **Step 7: Run focused checks**

Run:

```bash
pnpm --filter @aivilization/worker test -- ambientObservationMemory.test.ts tickRunner.test.ts localRuntimeStep.test.ts
pnpm --filter @aivilization/worker typecheck
```

Observed:

- `pnpm --filter @aivilization/worker test -- ambientObservationMemory.test.ts tickRunner.test.ts localRuntimeStep.test.ts` passed.
- `pnpm --filter @aivilization/worker typecheck` passed.

- [x] **Step 8: Run full verification**

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

Observed:

- `pnpm lint` passed.
- `pnpm typecheck` passed.
- `pnpm test` passed with 141 test files and 690 tests.
- `pnpm build` passed.
- `git diff --check` passed.

- [x] **Step 9: Inspect diff and commit**

Confirm changes are limited to ambient observation memory derivation, worker/local runtime wiring,
tests, exports, and this slice's docs.

Observed: diff is limited to the ambient observation derivation module, worker tick/local runtime
wiring, tests, exports, and this slice's docs.

Commit with:

```bash
git add docs/superpowers/specs/2026-06-25-ambient-observation-memory-design.md docs/superpowers/plans/2026-06-25-ambient-observation-memory-slice.md apps/worker/src/ambientObservationMemory.ts apps/worker/src/ambientObservationMemory.test.ts apps/worker/src/tickRunner.ts apps/worker/src/tickRunner.test.ts apps/worker/src/localRuntimeStep.ts apps/worker/src/localRuntimeStep.test.ts apps/worker/src/index.ts
git commit -m "feat: propagate ambient observation memories"
```
