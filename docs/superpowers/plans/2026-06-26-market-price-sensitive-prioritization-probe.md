# Market Price Sensitive Prioritization Probe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a backend probe that can prove contextual prioritization changes selected subtasks when market-price context changes.

**Architecture:** Keep behavior execution in `@aivilization/agent-runtime` because contextual prioritization is an agent cognition boundary, not an observability concern. The probe runs the same `SubtaskPrioritizer` against paired baseline/comparison inputs, records selected subtasks and compact world-decision economic context traces, and reports whether the decision is sensitive to the changed economic signal. Runtime profile and experiment gates can consume this stable result later without reimplementing agent cognition calls.

**Tech Stack:** TypeScript, Vitest, pnpm workspaces, existing `SubtaskPrioritizer`, scripted LLM provider, and `WorldDecisionContextTrace`.

---

### Task 1: Price-Sensitive Contextual Prioritization Probe

**Files:**
- Create: `packages/agent-runtime/src/subtaskPrioritizationSensitivity.ts`
- Modify: `packages/agent-runtime/src/index.ts`
- Test: `packages/agent-runtime/src/subtaskPrioritizationSensitivity.test.ts`

- [ ] **Step 1: Write the failing behavior test**

Create `packages/agent-runtime/src/subtaskPrioritizationSensitivity.test.ts` with a test that:
- builds the same branch plan and candidate list for both scenarios;
- uses a function-style scripted LLM provider that parses the actual user prompt;
- ranks `eat` first when Fish is affordable and ranks `work` first when Fish is expensive with low balance;
- calls `runSubtaskPrioritizationSensitivityProbe`;
- expects `status: "sensitive"`, different selected subtasks, and complete economic context traces for both scenarios.

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
pnpm vitest packages/agent-runtime/src/subtaskPrioritizationSensitivity.test.ts --run
```

Expected: FAIL because `subtaskPrioritizationSensitivity.ts` does not exist.

- [ ] **Step 3: Implement minimal probe**

Create `packages/agent-runtime/src/subtaskPrioritizationSensitivity.ts` with:
- `SubtaskPrioritizationSensitivityProbeResult`;
- `runSubtaskPrioritizationSensitivityProbe(input)`;
- helper selection summaries;
- helper world-decision trace creation using existing `createWorldDecisionContextTrace`.

The function must not invent planner behavior. It only runs the supplied prioritizer twice and compares selected `(branchId, subtaskId)` pairs.

- [ ] **Step 4: Export the probe**

Add `export * from './subtaskPrioritizationSensitivity';` to `packages/agent-runtime/src/index.ts`.

- [ ] **Step 5: Run test to verify GREEN**

Run:

```bash
pnpm vitest packages/agent-runtime/src/subtaskPrioritizationSensitivity.test.ts --run
```

Expected: PASS.

- [ ] **Step 6: Run broader verification**

Run:

```bash
pnpm typecheck
pnpm lint
pnpm test -- --reporter=dot
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 7: Commit**

Stage only this slice:

```bash
git add packages/agent-runtime/src/subtaskPrioritizationSensitivity.ts \
  packages/agent-runtime/src/subtaskPrioritizationSensitivity.test.ts \
  packages/agent-runtime/src/index.ts \
  docs/superpowers/plans/2026-06-26-market-price-sensitive-prioritization-probe.md
```

Commit with a Conventional Commit message explaining why the probe exists, which modules changed, the semantic boundary, user-visible backend evidence, and verification performed.

