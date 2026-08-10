# World State Trace Completeness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make LLM world-decision traces explicitly prove that inventory, job, and location state were present, then make runtime profile completeness depend on those fields.

**Architecture:** Extend the shared world-decision trace contract with field-presence booleans for inventory, job, and location. Keep the source context unchanged; only enrich the trace summaries and runtime profile completeness predicate so existing profile gates become stricter without introducing new planner behavior.

**Tech Stack:** TypeScript, Vitest, pnpm workspace packages, `@aivilization/agent-runtime`, `@aivilization/memory`, `@aivilization/observability`.

---

### Task 1: Agent Runtime and Memory Trace Field Coverage

**Files:**
- Create: `packages/agent-runtime/src/worldDecisionContext.test.ts`
- Modify: `packages/agent-runtime/src/worldDecisionContext.ts`
- Modify: `packages/memory/src/worldContext.test.ts`
- Modify: `packages/memory/src/worldContext.ts`

- [x] **Step 1: Write the failing tests**

Add an agent-runtime test that builds a `WorldDecisionContext` with:
- `locationId: 'market'`
- `job: 'stock-clerk'`
- `inventory: { Fish: 46 }`

Expect `createWorldDecisionContextTrace(context)` to include:
- `hasLocationId: true`
- `hasJob: true`
- `hasInventory: true`

Extend the memory world context test with the same three expectations on `createMemorySynthesisWorldDecisionContextTrace(context)`.

- [x] **Step 2: Run RED**

Run:

```bash
pnpm test -- packages/agent-runtime/src/worldDecisionContext.test.ts packages/memory/src/worldContext.test.ts
```

Expected: fails because the three field-presence booleans do not exist.

- [x] **Step 3: Implement minimal trace extension**

In both trace types and factory functions:
- Add `hasLocationId: boolean`.
- Add `hasJob: boolean`.
- Add `hasInventory: boolean`.

For the typed source contexts, compute:
- `hasLocationId: context.agent.locationId !== undefined`
- `hasJob: context.agent.job !== undefined`
- `hasInventory: context.agent.inventory !== undefined`

- [x] **Step 4: Run GREEN**

Run:

```bash
pnpm test -- packages/agent-runtime/src/worldDecisionContext.test.ts packages/memory/src/worldContext.test.ts
```

Expected: tests pass.

### Task 2: Observability Complete World Context Predicate

**Files:**
- Modify: `packages/observability/src/worldDecisionContextTrace.ts`
- Modify: `packages/observability/src/runtimeProfileRunReport.test.ts`
- Modify: `packages/observability/src/runtimeProfileRunReport.ts`

- [x] **Step 1: Write the failing runtime profile tests**

In `packages/observability/src/runtimeProfileRunReport.test.ts`, add tests proving:
- an agent-cycle LLM trace with physiology, balance, education, residential tier, and market spot prices but without `hasInventory`, `hasJob`, and `hasLocationId` increments `worldDecisionContextCount` but not `completeWorldDecisionContextCount`;
- a cognition LLM provider trace with the same missing flags also does not count as complete.

- [x] **Step 2: Run RED**

Run:

```bash
pnpm test -- packages/observability/src/runtimeProfileRunReport.test.ts
```

Expected: fails because the current completeness predicate does not require inventory, job, or location field flags.

- [x] **Step 3: Implement minimal observability contract update**

In `packages/observability/src/worldDecisionContextTrace.ts`, add:
- `hasLocationId: boolean`
- `hasJob: boolean`
- `hasInventory: boolean`

In `packages/observability/src/runtimeProfileRunReport.ts`:
- extend `RuntimeProfileWorldDecisionContextTraceLike` with optional versions of the three fields;
- update `isCompleteWorldDecisionContextTrace` to require all three fields to be `true`.

Update existing test fixture helpers in `runtimeProfileRunReport.test.ts` so intentionally complete traces include the three fields.

- [x] **Step 4: Run GREEN**

Run:

```bash
pnpm test -- packages/observability/src/runtimeProfileRunReport.test.ts
```

Expected: test passes.

### Task 3: Verification and Commit

**Files:**
- All files changed in Tasks 1-2.

- [x] **Step 1: Run focused tests**

```bash
pnpm test -- packages/agent-runtime/src/worldDecisionContext.test.ts packages/memory/src/worldContext.test.ts packages/observability/src/runtimeProfileRunReport.test.ts packages/observability/src/runtimeProfileRunGate.test.ts
```

Expected: all focused tests pass.

- [x] **Step 2: Run full verification**

```bash
pnpm lint
pnpm typecheck
pnpm test
git diff --check
```

Expected: all commands pass.

- [x] **Step 3: Commit**

Stage only the relevant code/tests/plan file and commit with a detailed Chinese Conventional Commit message.
